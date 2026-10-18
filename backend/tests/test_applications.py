import unittest
from collections.abc import Iterator
from datetime import UTC, datetime
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import select, text, update
from sqlalchemy.orm import Session

from app.auth import AuthenticatedIdentity, require_identity
from app.database import engine
from app.dependencies import get_session
from app.main import app
from app.models import JobApplication, User


class ApplicationApiTests(unittest.TestCase):
    def setUp(self) -> None:
        self.connection = engine.connect()
        self.addCleanup(self.connection.close)

        transaction = self.connection.begin()
        self.addCleanup(transaction.rollback)

        account = self.connection.scalar(
            text("SELECT current_user")
        )
        self.assertEqual(account, "job_tracker_app")

        self.identity = AuthenticatedIdentity(
            issuer="https://application-tests.invalid",
            subject=str(uuid4()),
        )

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

    def _save(
        self,
        company: str = "Verification Company",
        job_title: str = "Frontend Developer",
    ) -> dict:
        response = self.client.post(
            "/api/applications",
            json={
                "company": company,
                "job_title": job_title,
            },
        )

        self.assertEqual(response.status_code, 201, response.text)
        self.assertEqual(
            response.headers["cache-control"], "no-store"
        )
        return response.json()

    def _list_ids(self) -> set[str]:
        response = self.client.get("/api/applications")

        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(
            response.headers["cache-control"], "no-store"
        )

        return {
            item["id"]
            for item in response.json()["items"]
        }

    def test_create_returns_and_persists_saved_role(self) -> None:
        created = self._save(
            company="  Verification Company  ",
            job_title="  Frontend Developer  ",
        )

        self.assertEqual(created["company"], "Verification Company")
        self.assertEqual(created["job_title"], "Frontend Developer")
        self.assertEqual(created["status"], "saved")
        self.assertIsNone(created["applied_on"])

        self.assertEqual(self._list_ids(), {created["id"]})

        owner = self.connection.execute(
            select(User.auth_issuer, User.auth_subject)
            .join(
                JobApplication,
                JobApplication.user_id == User.id,
            )
            .where(JobApplication.id == UUID(created["id"]))
        ).one()

        self.assertEqual(
            tuple(owner),
            (self.identity.issuer, self.identity.subject),
        )

    def test_client_cannot_set_owner_or_status(self) -> None:
        forbidden_fields = [
            {"user_id": str(uuid4())},
            {"status": "applied"},
            {"applied_on": "2026-01-01"},
        ]

        for extra in forbidden_fields:
            with self.subTest(extra=extra):
                response = self.client.post(
                    "/api/applications",
                    json={
                        "company": "Verification Company",
                        "job_title": "Developer",
                        **extra,
                    },
                )
                self.assertEqual(response.status_code, 422)

        self.assertEqual(self._list_ids(), set())

    def test_invalid_labels_are_rejected(self) -> None:
        invalid_payloads = [
            {"company": "   ", "job_title": "Developer"},
            {"company": "Example", "job_title": ""},
            {"company": "x" * 201, "job_title": "Developer"},
            {"company": "Example", "job_title": 123},
            {"company": "Bad\x00Name", "job_title": "Developer"},
        ]

        for payload in invalid_payloads:
            with self.subTest(payload=payload):
                response = self.client.post(
                    "/api/applications",
                    json=payload,
                )
                self.assertEqual(response.status_code, 422)

    def test_accounts_are_isolated(self) -> None:
        identity_a = self.identity
        role_a = self._save(company="Account A Company")

        self.identity = AuthenticatedIdentity(
            issuer=identity_a.issuer,
            subject=str(uuid4()),
        )

        self.assertEqual(self._list_ids(), set())

        role_b = self._save(company="Account B Company")
        self.assertEqual(self._list_ids(), {role_b["id"]})

        self.identity = identity_a
        self.assertEqual(self._list_ids(), {role_a["id"]})

    def test_issuer_is_part_of_ownership(self) -> None:
        self._save()

        self.identity = AuthenticatedIdentity(
            issuer="https://another-application-tests.invalid",
            subject=self.identity.subject,
        )

        self.assertEqual(self._list_ids(), set())

    def test_archived_roles_are_excluded(self) -> None:
        created = self._save()

        self.connection.execute(
            update(JobApplication)
            .where(JobApplication.id == UUID(created["id"]))
            .values(archived_at=datetime.now(UTC))
        )

        self.assertEqual(self._list_ids(), set())

    def test_pagination_is_bounded(self) -> None:
        saved_ids = {
            self._save(job_title=f"Role {index}")["id"]
            for index in range(3)
        }

        first_response = self.client.get(
            "/api/applications?limit=2&offset=0"
        )
        second_response = self.client.get(
            "/api/applications?limit=2&offset=2"
        )

        self.assertEqual(first_response.status_code, 200)
        self.assertEqual(second_response.status_code, 200)

        first = first_response.json()
        second = second_response.json()

        first_ids = {item["id"] for item in first["items"]}
        second_ids = {item["id"] for item in second["items"]}

        self.assertEqual(len(first_ids), 2)
        self.assertEqual(len(second_ids), 1)
        self.assertTrue(first["has_more"])
        self.assertFalse(second["has_more"])
        self.assertTrue(first_ids.isdisjoint(second_ids))
        self.assertEqual(first_ids | second_ids, saved_ids)

        self.assertEqual(
            self.client.get(
                "/api/applications?limit=101"
            ).status_code,
            422,
        )
        self.assertEqual(
            self.client.get(
                "/api/applications?offset=-1"
            ).status_code,
            422,
        )

    def test_endpoints_require_authentication(self) -> None:
        app.dependency_overrides.pop(require_identity)

        responses = [
            self.client.get("/api/applications"),
            self.client.post(
                "/api/applications",
                json={
                    "company": "Verification Company",
                    "job_title": "Developer",
                },
            ),
        ]

        for response in responses:
            self.assertEqual(response.status_code, 401)
            self.assertEqual(
                response.headers["www-authenticate"],
                "Bearer",
            )


if __name__ == "__main__":
    unittest.main()