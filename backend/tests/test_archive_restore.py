import unittest
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import func, select, text, update
from sqlalchemy.orm import Session

from app.auth import AuthenticatedIdentity, require_identity
from app.database import engine
from app.dependencies import get_session
from app.main import app
from app.models import JobApplication, User


class ArchiveRestoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = engine.connect()
        self.addCleanup(self.connection.close)

        transaction = self.connection.begin()
        self.addCleanup(transaction.rollback)

        self.assertEqual(
            self.connection.scalar(text("SELECT current_user")),
            "job_tracker_app",
        )

        self.identity = AuthenticatedIdentity(
            issuer="https://archive-restore-tests.invalid",
            subject=str(uuid4()),
        )

        self.applied_on = (
            datetime.now(UTC).date() - timedelta(days=1)
        ).isoformat()

        previous_overrides = app.dependency_overrides.copy()

        def restore_overrides() -> None:
            app.dependency_overrides.clear()
            app.dependency_overrides.update(previous_overrides)

        self.addCleanup(restore_overrides)

        def override_identity() -> AuthenticatedIdentity:
            return self.identity

        def override_session() -> Iterator[Session]:
            with Session(
                bind=self.connection,
                join_transaction_mode="create_savepoint",
            ) as session:
                yield session

        app.dependency_overrides[require_identity] = (
            override_identity
        )
        app.dependency_overrides[get_session] = override_session

        self.client = TestClient(app)
        self.addCleanup(self.client.close)

    def _save(self, title: str = "Developer") -> dict:
        response = self.client.post(
            "/api/applications",
            json={"company": "Verification Company", "job_title": title},
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def _archive(self, role_id: str) -> dict:
        response = self.client.post(
            f"/api/applications/{role_id}/archive", json={}
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def _restore(self, role_id: str):
        return self.client.post(
            f"/api/applications/{role_id}/restore", json={}
        )

    def _archived(self, query: str = "") -> dict:
        response = self.client.get(f"/api/applications/archived{query}")
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        return response.json()

    def _active(self) -> dict:
        response = self.client.get("/api/applications")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def _stored(self, role_id: str):
        return self.connection.execute(
            select(JobApplication.__table__).where(
                JobApplication.id == UUID(role_id)
            )
        ).mappings().one()

    def _stage(self, role_id: str, stage: str) -> None:
        self.connection.execute(
            update(JobApplication)
            .where(JobApplication.id == UUID(role_id))
            .values(status=stage, applied_on=date.fromisoformat(self.applied_on))
        )

    def test_new_account_has_an_empty_archive_without_creating_user(self) -> None:
        def user_count():
            return self.connection.scalar(
                select(func.count(User.id)).where(
                    User.auth_issuer == self.identity.issuer,
                    User.auth_subject == self.identity.subject,
                )
            )

        self.assertEqual(user_count(), 0)
        page = self._archived()
        self.assertEqual(page["items"], [])
        self.assertEqual(page["total"], 0)
        self.assertFalse(page["has_more"])
        self.assertEqual(
            page["overview"],
            {"tracked_roles": 0, "submitted_applications": 0, "interviews": 0, "offers": 0},
        )
        self.assertEqual(user_count(), 0)

    def test_archive_lists_details_in_archive_time_order(self) -> None:
        old = self._save("Old archive")
        newer = self._save("New archive")
        active = self._save("Still active")
        self._stage(newer["id"], "interview")
        self._archive(old["id"])
        self._archive(newer["id"])
        for role, day in [(old, 1), (newer, 2)]:
            self.connection.execute(
                update(JobApplication)
                .where(JobApplication.id == UUID(role["id"]))
                .values(archived_at=datetime(2026, 1, day, tzinfo=UTC))
            )

        page = self._archived()
        self.assertEqual([item["id"] for item in page["items"]], [newer["id"], old["id"]])
        item = page["items"][0]
        self.assertEqual(item["job_title"], "New archive")
        self.assertEqual(item["status"], "interview")
        self.assertEqual(item["applied_on"], self.applied_on)
        self.assertEqual(
            set(item),
            {"id", "company", "job_title", "status", "applied_on", "created_at", "updated_at", "archived_at"},
        )
        self.assertIsNotNone(datetime.fromisoformat(item["archived_at"].replace("Z", "+00:00")).tzinfo)
        self.assertEqual(page["total"], 2)
        self.assertEqual([item["id"] for item in self._active()["items"]], [active["id"]])

    def test_archive_listing_is_scoped_to_subject_and_issuer(self) -> None:
        role = self._save()
        self._archive(role["id"])
        original = self.identity
        for identity in [
            AuthenticatedIdentity(issuer=original.issuer, subject=str(uuid4())),
            AuthenticatedIdentity(issuer="https://other-archive-list.invalid", subject=original.subject),
        ]:
            with self.subTest(identity=identity):
                self.identity = identity
                empty = self._archived()
                self.assertEqual(empty["items"], [])
                self.assertEqual(empty["total"], 0)
                own_role = self._save("Other account's role")
                self._archive(own_role["id"])
                self.assertEqual([item["id"] for item in self._archived()["items"]], [own_role["id"]])
        self.identity = original
        self.assertEqual([item["id"] for item in self._archived()["items"]], [role["id"]])

    def test_archive_pagination_is_stable_for_equal_timestamps(self) -> None:
        roles = [self._save(str(index)) for index in range(3)]
        for role in roles:
            self._archive(role["id"])
        self.connection.execute(
            update(JobApplication)
            .where(JobApplication.id.in_([UUID(role["id"]) for role in roles]))
            .values(archived_at=datetime(2026, 1, 1, tzinfo=UTC))
        )
        expected = sorted([role["id"] for role in roles], reverse=True)
        for offset in range(3):
            page = self._archived(f"?limit=1&offset={offset}")
            self.assertEqual([item["id"] for item in page["items"]], [expected[offset]])
            self.assertEqual(page["has_more"], offset < 2)
            self.assertEqual(page["total"], 3)
            self.assertEqual(page["limit"], 1)
            self.assertEqual(page["offset"], offset)
        empty_page = self._archived("?offset=1000")
        self.assertEqual(empty_page["items"], [])
        self.assertEqual(empty_page["total"], 3)
        self.assertFalse(empty_page["has_more"])

    def test_archive_pagination_rejects_invalid_values(self) -> None:
        for query in ["?limit=0", "?limit=101", "?offset=-1", "?limit=abc", "?offset=1.5"]:
            with self.subTest(query=query):
                response = self.client.get(f"/api/applications/archived{query}")
                self.assertEqual(response.status_code, 422, response.text)

    def test_archive_overview_counts_all_owned_active_roles(self) -> None:
        original = self.identity
        roles = {stage: self._save(stage) for stage in ["saved", "applied", "interview", "offer"]}
        for stage, role in roles.items():
            if stage != "saved":
                self._stage(role["id"], stage)
        archived = self._save("Archived offer")
        self._stage(archived["id"], "offer")
        self._archive(archived["id"])

        self.identity = AuthenticatedIdentity(issuer=original.issuer, subject=str(uuid4()))
        other = self._save("Other account's offer")
        self._stage(other["id"], "offer")
        self.identity = original

        for query in ["?limit=1", "?offset=1000"]:
            page = self._archived(query)
            self.assertEqual(page["total"], 1)
            self.assertEqual(
                page["overview"],
                {"tracked_roles": 4, "submitted_applications": 3, "interviews": 1, "offers": 1},
            )

    def test_restore_preserves_fields_and_returns_role_to_active_list(self) -> None:
        role = self._save("Interview role")
        self._stage(role["id"], "interview")
        self._archive(role["id"])
        before = dict(self._stored(role["id"]))
        self.assertEqual(self._active()["overview"]["tracked_roles"], 0)

        response = self._restore(role["id"])
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(set(response.json()), set(role))
        self.assertEqual(response.json()["status"], "interview")
        self.assertEqual(response.json()["applied_on"], self.applied_on)

        stored = self._stored(role["id"])
        self.assertIsNone(stored["archived_at"])
        for field in ["id", "user_id", "company", "job_title", "status", "applied_on", "created_at"]:
            self.assertEqual(stored[field], before[field], field)
        self.assertEqual(self._active()["items"], [response.json()])
        archive = self._archived()
        self.assertEqual(archive["items"], [])
        self.assertEqual(archive["total"], 0)
        self.assertEqual(archive["overview"], {"tracked_roles": 1, "submitted_applications": 1, "interviews": 1, "offers": 0})

    def test_restore_is_safe_to_repeat_for_active_and_restored_roles(self) -> None:
        role = self._save()
        active_retry = self._restore(role["id"])
        self.assertEqual(active_retry.status_code, 200, active_retry.text)
        self.assertEqual(active_retry.json(), role)

        self._archive(role["id"])
        restored = self._restore(role["id"])
        repeated = self._restore(role["id"])
        self.assertEqual(restored.status_code, 200, restored.text)
        self.assertEqual(repeated.status_code, 200, repeated.text)
        self.assertEqual(restored.json(), repeated.json())
        self.assertEqual(self._active()["overview"]["tracked_roles"], 1)

    def test_restore_is_scoped_to_subject_and_issuer(self) -> None:
        role = self._save()
        self._archive(role["id"])
        original = self.identity
        for identity in [
            AuthenticatedIdentity(issuer=original.issuer, subject=str(uuid4())),
            AuthenticatedIdentity(issuer="https://other-restore.invalid", subject=original.subject),
        ]:
            self.identity = identity
            response = self._restore(role["id"])
            self.assertEqual(response.status_code, 404, response.text)
            self.assertEqual(response.headers["cache-control"], "no-store")
            self.assertIsNotNone(self._stored(role["id"])["archived_at"])
        self.identity = original
        self.assertEqual(self._restore(role["id"]).status_code, 200)

    def test_archive_listing_and_restore_require_authentication(self) -> None:
        role = self._save()
        self._archive(role["id"])
        app.dependency_overrides.pop(require_identity)
        self.assertEqual(self.client.get("/api/applications/archived").status_code, 401)
        self.assertEqual(self._restore(role["id"]).status_code, 401)
        self.assertIsNotNone(self._stored(role["id"])["archived_at"])

    def test_restore_rejects_extra_fields_without_changing_record(self) -> None:
        role = self._save()
        self._archive(role["id"])
        before = dict(self._stored(role["id"]))
        for payload in [
            {"user_id": str(uuid4())}, {"company": "Changed"},
            {"status": "offer"}, {"applied_on": self.applied_on},
            {"archived_at": None}, {"updated_at": datetime.now(UTC).isoformat()},
        ]:
            with self.subTest(payload=payload):
                response = self.client.post(f"/api/applications/{role['id']}/restore", json=payload)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(dict(self._stored(role["id"])), before)

    def test_restore_rejects_missing_and_invalid_identifiers(self) -> None:
        self.assertEqual(self._restore(str(uuid4())).status_code, 404)
        self.assertEqual(self._restore("invalid-id").status_code, 422)

    def test_caller_can_roll_back_restore(self) -> None:
        role = self._save()
        self._archive(role["id"])
        before = dict(self._stored(role["id"]))
        savepoint = self.connection.begin_nested()
        try:
            response = self._restore(role["id"])
            self.assertEqual(response.status_code, 200, response.text)
            self.assertIsNone(self._stored(role["id"])["archived_at"])
        finally:
            savepoint.rollback()
        self.assertEqual(dict(self._stored(role["id"])), before)
        self.assertEqual(self._archived()["total"], 1)

    def test_restored_role_can_be_archived_again_without_duplicates(self) -> None:
        role = self._save()
        first_archive = self._archive(role["id"])
        self.assertEqual(self._restore(role["id"]).status_code, 200)
        second_archive = self._archive(role["id"])
        self.assertEqual(second_archive["id"], first_archive["id"])
        self.assertIsNotNone(self._stored(role["id"])["archived_at"])
        self.assertEqual(self._archived()["total"], 1)
        self.assertEqual(self._active()["overview"]["tracked_roles"], 0)


if __name__ == "__main__":
    unittest.main()

