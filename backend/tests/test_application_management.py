import unittest
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from app.auth import AuthenticatedIdentity, require_identity
from app.config import get_settings
from app.database import engine
from app.dependencies import get_session
from app.main import app
from app.models import JobApplication


class ApplicationManagementTests(unittest.TestCase):
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
            issuer="https://application-management-tests.invalid",
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

    def _save(self, job_title: str = "Developer") -> dict:
        response = self.client.post(
            "/api/applications",
            json={
                "company": "Verification Company",
                "job_title": job_title,
            },
        )
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def _edit(self, application_id: str, payload: dict):
        return self.client.patch(
            f"/api/applications/{application_id}",
            json=payload,
        )

    def _archive(self, application_id: str):
        return self.client.post(
            f"/api/applications/{application_id}/archive",
            json={},
        )

    def _page(self) -> dict:
        response = self.client.get("/api/applications")
        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def _stored(self, application_id: str):
        return self.connection.execute(
            select(JobApplication.__table__).where(
                JobApplication.id == UUID(application_id)
            )
        ).mappings().one()

    def test_edit_updates_labels_and_preserves_progress(self) -> None:
        role = self._save()
        self.connection.execute(
            update(JobApplication)
            .where(JobApplication.id == UUID(role["id"]))
            .values(
                status="interview",
                applied_on=date.fromisoformat(self.applied_on),
            )
        )
        before = dict(self._stored(role["id"]))

        response = self._edit(
            role["id"],
            {
                "company": "  Corrected Company  ",
                "job_title": "  Software Engineer  ",
            },
        )
        self.assertEqual(response.status_code, 200, response.text)
        result = response.json()
        self.assertEqual(result["company"], "Corrected Company")
        self.assertEqual(result["job_title"], "Software Engineer")
        self.assertEqual(result["status"], "interview")
        self.assertEqual(result["applied_on"], self.applied_on)
        self.assertEqual(response.headers["cache-control"], "no-store")

        stored = self._stored(role["id"])
        for field in ["id", "user_id", "status", "applied_on", "created_at", "archived_at"]:
            self.assertEqual(stored[field], before[field], field)
        self.assertEqual(stored["company"], "Corrected Company")
        self.assertEqual(stored["job_title"], "Software Engineer")
        self.assertEqual(self._page()["items"][0], result)

    def test_partial_edit_leaves_omitted_labels_unchanged(self) -> None:
        role = self._save()

        company_response = self._edit(
            role["id"], {"company": "Updated Company"}
        )
        self.assertEqual(company_response.status_code, 200, company_response.text)
        self.assertEqual(company_response.json()["job_title"], "Developer")

        title_response = self._edit(
            role["id"], {"job_title": "Updated Title"}
        )
        self.assertEqual(title_response.status_code, 200, title_response.text)
        self.assertEqual(title_response.json()["company"], "Updated Company")
        self.assertEqual(title_response.json()["status"], "saved")
        self.assertIsNone(title_response.json()["applied_on"])

    def test_edit_accepts_limit_lengths_and_same_value_retries(self) -> None:
        role = self._save()
        payload = {"company": "C" * 200, "job_title": "J" * 200}

        first = self._edit(role["id"], payload)
        repeated = self._edit(role["id"], payload)

        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(repeated.status_code, 200, repeated.text)
        self.assertEqual(first.json(), repeated.json())
        self.assertEqual(self._page()["overview"]["tracked_roles"], 1)

    def test_invalid_edits_are_rejected_without_partial_writes(self) -> None:
        role = self._save()
        original = dict(self._stored(role["id"]))
        invalid_payloads = [
            {},
            {"company": None},
            {"job_title": None},
            {"company": ""},
            {"job_title": "   "},
            {"company": 42},
            {"job_title": False},
            {"company": []},
            {"company": "C" * 201},
            {"job_title": "J" * 201},
            {"company": "Invalid\nCompany"},
            {"job_title": "Invalid\x00Title"},
            {"company": "Changed", "job_title": ""},
            {"company": "Changed", "user_id": str(uuid4())},
            {"status": "offer"},
            {"applied_on": self.applied_on},
            {"archived_at": datetime.now(UTC).isoformat()},
            {"id": str(uuid4())},
            {"created_at": datetime.now(UTC).isoformat()},
            {"updated_at": datetime.now(UTC).isoformat()},
        ]

        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                response = self._edit(role["id"], payload)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(dict(self._stored(role["id"])), original)

    def test_edits_are_scoped_to_subject_and_issuer(self) -> None:
        role = self._save()
        original_identity = self.identity
        identities = [
            AuthenticatedIdentity(
                issuer=original_identity.issuer,
                subject=str(uuid4()),
            ),
            AuthenticatedIdentity(
                issuer="https://other-management-tests.invalid",
                subject=original_identity.subject,
            ),
        ]

        for identity in identities:
            with self.subTest(identity=identity):
                self.identity = identity
                response = self._edit(role["id"], {"company": "Intruder"})
                self.assertEqual(response.status_code, 404, response.text)
                self.assertEqual(response.headers["cache-control"], "no-store")

        self.identity = original_identity
        self.assertEqual(self._stored(role["id"])["company"], role["company"])
        self.assertEqual(self._page()["overview"]["tracked_roles"], 1)

    def test_archive_keeps_records_and_updates_all_overview_counts(self) -> None:
        roles = {
            stage: self._save(stage.title())
            for stage in ["saved", "applied", "interview", "offer"]
        }
        for stage, role in roles.items():
            if stage != "saved":
                self.connection.execute(
                    update(JobApplication)
                    .where(JobApplication.id == UUID(role["id"]))
                    .values(
                        status=stage,
                        applied_on=date.fromisoformat(self.applied_on),
                    )
                )

        self.assertEqual(
            self._page()["overview"],
            {"tracked_roles": 4, "submitted_applications": 3, "interviews": 1, "offers": 1},
        )

        stages_and_totals = [
            ("interview", (3, 2, 0, 1)),
            ("offer", (2, 1, 0, 0)),
            ("saved", (1, 1, 0, 0)),
            ("applied", (0, 0, 0, 0)),
        ]
        for stage, totals in stages_and_totals:
            with self.subTest(stage=stage):
                role_id = roles[stage]["id"]
                before = dict(self._stored(role_id))
                response = self._archive(role_id)
                self.assertEqual(response.status_code, 200, response.text)
                self.assertEqual(response.headers["cache-control"], "no-store")
                result = response.json()
                self.assertEqual(set(result), {"id", "archived_at"})
                self.assertEqual(result["id"], role_id)
                archived_at = datetime.fromisoformat(result["archived_at"].replace("Z", "+00:00"))
                self.assertIsNotNone(archived_at.tzinfo)

                stored = self._stored(role_id)
                self.assertEqual(stored["archived_at"], archived_at)
                for field in ["id", "user_id", "company", "job_title", "status", "applied_on", "created_at"]:
                    self.assertEqual(stored[field], before[field], field)

                page = self._page()
                self.assertNotIn(role_id, [item["id"] for item in page["items"]])
                self.assertEqual(
                    page["overview"],
                    dict(zip(
                        ["tracked_roles", "submitted_applications", "interviews", "offers"],
                        totals,
                    )),
                )

    def test_repeated_archive_returns_original_timestamp(self) -> None:
        role = self._save()
        first = self._archive(role["id"])
        self.assertEqual(first.status_code, 200, first.text)
        stored_after_first = dict(self._stored(role["id"]))

        repeated = self._archive(role["id"])
        self.assertEqual(repeated.status_code, 200, repeated.text)
        self.assertEqual(repeated.json(), first.json())
        self.assertEqual(dict(self._stored(role["id"])), stored_after_first)

    def test_archive_is_owner_scoped_even_for_an_archived_record(self) -> None:
        role = self._save()
        original_identity = self.identity
        other_identities = [
            AuthenticatedIdentity(issuer=original_identity.issuer, subject=str(uuid4())),
            AuthenticatedIdentity(
                issuer="https://other-archive-tests.invalid",
                subject=original_identity.subject,
            ),
        ]

        for already_archived in [False, True]:
            if already_archived:
                response = self._archive(role["id"])
                self.assertEqual(response.status_code, 200, response.text)

            for identity in other_identities:
                with self.subTest(archived=already_archived, identity=identity):
                    self.identity = identity
                    response = self._archive(role["id"])
                    self.assertEqual(response.status_code, 404, response.text)
                    self.assertEqual(response.headers["cache-control"], "no-store")

            self.identity = original_identity

    def test_archived_roles_reject_edits_and_application_updates(self) -> None:
        role = self._save()
        archived = self._archive(role["id"])
        self.assertEqual(archived.status_code, 200, archived.text)
        original = dict(self._stored(role["id"]))

        edited = self._edit(role["id"], {"company": "Changed"})
        self.assertEqual(edited.status_code, 404, edited.text)

        applied = self.client.post(
            f"/api/applications/{role['id']}/mark-applied",
            json={"applied_on": self.applied_on, "time_zone": "UTC"},
        )
        self.assertEqual(applied.status_code, 404, applied.text)
        self.assertEqual(dict(self._stored(role["id"])), original)

    def test_archive_rejects_unknown_fields_without_changing_record(self) -> None:
        role = self._save()
        original = dict(self._stored(role["id"]))
        for payload in [
            {"user_id": str(uuid4())},
            {"archived_at": datetime.now(UTC).isoformat()},
            {"status": "withdrawn"},
            {"company": "Changed"},
            {"restore": True},
        ]:
            with self.subTest(payload=payload):
                response = self.client.post(
                    f"/api/applications/{role['id']}/archive",
                    json=payload,
                )
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(dict(self._stored(role["id"])), original)

    def test_management_endpoints_require_authentication(self) -> None:
        role = self._save()
        original = dict(self._stored(role["id"]))
        app.dependency_overrides.pop(require_identity)

        self.assertEqual(self._edit(role["id"], {"company": "Changed"}).status_code, 401)
        self.assertEqual(self._archive(role["id"]).status_code, 401)
        self.assertEqual(dict(self._stored(role["id"])), original)

    def test_missing_and_invalid_identifiers_are_rejected(self) -> None:
        for application_id, expected in [(str(uuid4()), 404), ("invalid-id", 422)]:
            with self.subTest(application_id=application_id):
                self.assertEqual(self._edit(application_id, {"company": "Changed"}).status_code, expected)
                self.assertEqual(self._archive(application_id).status_code, expected)

    def test_caller_can_roll_back_edit_and_archive(self) -> None:
        role = self._save()
        before = dict(self._stored(role["id"]))

        savepoint = self.connection.begin_nested()
        try:
            edited = self._edit(role["id"], {"company": "Temporary"})
            self.assertEqual(edited.status_code, 200, edited.text)
            archived = self._archive(role["id"])
            self.assertEqual(archived.status_code, 200, archived.text)
            self.assertIsNotNone(self._stored(role["id"])["archived_at"])
        finally:
            savepoint.rollback()

        self.assertEqual(dict(self._stored(role["id"])), before)
        self.assertEqual(self._page()["items"][0]["company"], role["company"])

    def test_cors_preflight_allows_patch_for_the_frontend(self) -> None:
        origin = get_settings().clerk_authorized_parties[0]
        headers = {
            "Origin": origin,
            "Access-Control-Request-Method": "PATCH",
            "Access-Control-Request-Headers": "Authorization, Content-Type",
        }
        response = self.client.options(
            f"/api/applications/{uuid4()}",
            headers=headers,
        )
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.headers["access-control-allow-origin"], origin)
        self.assertIn("PATCH", response.headers["access-control-allow-methods"])

        rejected = self.client.options(
            f"/api/applications/{uuid4()}",
            headers={**headers, "Origin": "https://untrusted-management-tests.invalid"},
        )
        self.assertEqual(rejected.status_code, 400, rejected.text)
        self.assertNotIn("access-control-allow-origin", rejected.headers)


if __name__ == "__main__":
    unittest.main()

