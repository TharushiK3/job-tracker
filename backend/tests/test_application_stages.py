import unittest
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from app.auth import AuthenticatedIdentity, require_identity
from app.database import engine
from app.dependencies import get_session
from app.main import app
from app.models import JobApplication


class ApplicationStageTests(unittest.TestCase):
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
            issuer="https://application-stage-tests.invalid",
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

    def _applied(self, title: str = "Developer") -> dict:
        role = self._save(title)
        response = self.client.post(
            f"/api/applications/{role['id']}/mark-applied",
            json={"applied_on": self.applied_on, "time_zone": "UTC"},
        )
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def _change(self, role_id: str, **changes):
        return self.client.post(
            f"/api/applications/{role_id}/stage",
            json={"expected_status": "applied", "status": "interview", **changes},
        )

    def test_each_stage_persists_and_preserves_application_details(self) -> None:
        role = self._applied()
        expected_status = "applied"
        for target in ["screening", "interview", "offer", "rejected", "withdrawn", "applied"]:
            with self.subTest(target=target):
                response = self._change(role["id"], expected_status=expected_status, status=target)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.headers["cache-control"], "no-store")
                result = response.json()
                self.assertEqual(result["status"], target)
                self.assertEqual(self._stored(role["id"])["status"], target)
                for key in ["id", "company", "job_title", "applied_on", "created_at"]:
                    self.assertEqual(result[key], role[key])
                self.assertEqual(set(result), set(role))
                expected_status = target

    def test_repeated_target_is_a_no_op(self) -> None:
        role = self._applied()
        first = self._change(role["id"])
        self.assertEqual(first.status_code, 200, first.text)
        repeated = self._change(role["id"])
        self.assertEqual(repeated.status_code, 200, repeated.text)
        self.assertEqual(repeated.json(), first.json())
        already_achieved = self._change(role["id"], expected_status="offer")
        self.assertEqual(already_achieved.status_code, 200)
        self.assertEqual(already_achieved.json(), first.json())

    def test_stale_previous_stage_is_rejected_without_a_write(self) -> None:
        role = self._applied()
        self._stage(role["id"], "screening")
        response = self._change(role["id"], status="offer")
        self.assertEqual(response.status_code, 409, response.text)
        self.assertIn("Refresh", response.json()["detail"])
        self.assertEqual(response.headers["cache-control"], "no-store")
        self.assertEqual(self._stored(role["id"])["status"], "screening")
        self.assertEqual(self._stored(role["id"])["applied_on"], date.fromisoformat(self.applied_on))

    def test_saved_role_requires_an_application_date_first(self) -> None:
        role = self._save()
        response = self._change(role["id"])
        self.assertEqual(response.status_code, 409)
        self.assertIn("Mark as applied", response.json()["detail"])
        stored = self._stored(role["id"])
        self.assertEqual(stored["status"], "saved")
        self.assertIsNone(stored["applied_on"])

    def test_stage_updates_are_scoped_to_subject_and_issuer(self) -> None:
        role = self._applied()
        original = self.identity
        for identity in [
            AuthenticatedIdentity(issuer=original.issuer, subject=str(uuid4())),
            AuthenticatedIdentity(issuer="https://other-stage-tests.invalid", subject=original.subject),
        ]:
            with self.subTest(identity=identity):
                self.identity = identity
                response = self._change(role["id"])
                self.assertEqual(response.status_code, 404)
                self.assertEqual(response.headers["cache-control"], "no-store")
                self.assertEqual(self._stored(role["id"])["status"], "applied")
        self.identity = original
        self.assertEqual(self._change(role["id"]).status_code, 200)

    def test_archived_roles_reject_stage_updates_until_restored(self) -> None:
        role = self._applied()
        self._archive(role["id"])
        archived_at = self._stored(role["id"])["archived_at"]
        self.assertEqual(self._change(role["id"]).status_code, 404)
        stored = self._stored(role["id"])
        self.assertEqual(stored["archived_at"], archived_at)
        self.assertEqual(stored["status"], "applied")
        self.assertEqual(self._restore(role["id"]).status_code, 200)
        restored_change = self._change(role["id"])
        self.assertEqual(restored_change.status_code, 200, restored_change.text)
        self.assertEqual(restored_change.json()["status"], "interview")
        self.assertEqual(restored_change.json()["applied_on"], self.applied_on)
        self.assertEqual(self._archived()["total"], 0)

    def test_invalid_commands_are_rejected_without_partial_writes(self) -> None:
        role = self._applied()
        valid = {"expected_status": "applied", "status": "interview"}
        invalid = [
            {},
            {"status": "interview"},
            {"expected_status": "applied"},
            {**valid, "status": "saved"},
            {**valid, "status": "Interview"},
            {**valid, "status": "unknown"},
            {**valid, "status": None},
            {**valid, "status": 1},
            {**valid, "expected_status": "saved"},
            {**valid, "expected_status": None},
            {**valid, "expected_status": True},
            {**valid, "user_id": str(uuid4())},
            {**valid, "company": "Changed Company"},
            {**valid, "applied_on": "2026-01-01"},
            {**valid, "archived_at": None},
        ]
        for payload in invalid:
            with self.subTest(payload=payload):
                response = self.client.post(f"/api/applications/{role['id']}/stage", json=payload)
                self.assertEqual(response.status_code, 422, response.text)
                stored = self._stored(role["id"])
                self.assertEqual(stored["status"], "applied")
                self.assertEqual(stored["company"], role["company"])
                self.assertEqual(stored["applied_on"], date.fromisoformat(self.applied_on))

    def test_stage_updates_require_authentication(self) -> None:
        role = self._applied()
        app.dependency_overrides.pop(require_identity)
        self.assertEqual(self._change(role["id"]).status_code, 401)
        self.assertEqual(self._stored(role["id"])["status"], "applied")

    def test_missing_and_invalid_identifiers_are_rejected(self) -> None:
        self.assertEqual(self._change(str(uuid4())).status_code, 404)
        self.assertEqual(self._change("not-a-uuid").status_code, 422)

    def test_overview_follows_stage_changes_across_all_owned_active_roles(self) -> None:
        main = self._applied("Main role")
        self._save("Saved role")
        archived = self._applied("Archived role")
        self._archive(archived["id"])
        original = self.identity
        self.identity = AuthenticatedIdentity(issuer=original.issuer, subject=str(uuid4()))
        other = self._applied("Other account's offer")
        self.assertEqual(self._change(other["id"], status="offer").status_code, 200)
        self.identity = original

        previous = "applied"
        for target, interviews, offers in [("interview", 1, 0), ("offer", 0, 1), ("rejected", 0, 0)]:
            with self.subTest(target=target):
                response = self._change(main["id"], expected_status=previous, status=target)
                self.assertEqual(response.status_code, 200, response.text)
                expected = {"tracked_roles": 2, "submitted_applications": 1, "interviews": interviews, "offers": offers}
                page = self.client.get("/api/applications?limit=1").json()
                self.assertEqual(len(page["items"]), 1)
                self.assertTrue(page["has_more"])
                self.assertEqual(page["overview"], expected)
                empty_page = self.client.get("/api/applications?offset=1000").json()
                self.assertEqual(empty_page["overview"], expected)
                self.assertEqual(self._archived()["overview"], expected)
                previous = target

    def test_caller_can_roll_back_stage_update(self) -> None:
        role = self._applied()
        checkpoint = self.connection.begin_nested()
        try:
            response = self._change(role["id"])
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(self._stored(role["id"])["status"], "interview")
        finally:
            checkpoint.rollback()
        self.assertEqual(self._stored(role["id"])["status"], "applied")
        self.assertEqual(self._stored(role["id"])["applied_on"], date.fromisoformat(self.applied_on))

    def test_late_retry_does_not_regress_a_later_stage(self) -> None:
        role = self._applied()
        first = self._change(role["id"])
        self.assertEqual(first.status_code, 200, first.text)
        later = self._change(role["id"], expected_status="interview", status="offer")
        self.assertEqual(later.status_code, 200, later.text)
        late_retry = self._change(role["id"])
        self.assertEqual(late_retry.status_code, 409, late_retry.text)
        self.assertEqual(self._stored(role["id"])["status"], "offer")


if __name__ == "__main__":
    unittest.main()

