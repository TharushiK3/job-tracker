import unittest
from collections.abc import Iterator
from datetime import UTC, date, datetime, timedelta
from unittest.mock import patch
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from sqlalchemy import text, update
from sqlalchemy.orm import Session

from app.auth import AuthenticatedIdentity, require_identity
from app.database import engine
from app.dependencies import get_session
from app.main import app
from app.models import JobApplication


class ApplicationUpdateTests(unittest.TestCase):
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
            issuer="https://application-update-tests.invalid",
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

    def _apply(self, application_id: str, **changes):
        return self.client.post(
            f"/api/applications/{application_id}/mark-applied",
            json={
                "applied_on": self.applied_on,
                "time_zone": "UTC",
                **changes,
            },
        )

    def _page(self, query: str = "") -> dict:
        response = self.client.get(
            f"/api/applications{query}"
        )

        self.assertEqual(response.status_code, 200, response.text)
        return response.json()

    def test_application_date_is_saved_and_retries_are_safe(
        self,
    ) -> None:
        role = self._save()

        first = self._apply(role["id"])
        self.assertEqual(first.status_code, 200, first.text)
        self.assertEqual(first.json()["status"], "applied")
        self.assertEqual(
            first.json()["applied_on"], self.applied_on
        )
        self.assertEqual(
            first.headers["cache-control"], "no-store"
        )

        repeated = self._apply(role["id"])
        self.assertEqual(repeated.status_code, 200)
        self.assertEqual(repeated.json(), first.json())

        different_date = (
            date.fromisoformat(self.applied_on)
            - timedelta(days=1)
        ).isoformat()

        conflict = self._apply(
            role["id"],
            applied_on=different_date,
        )
        self.assertEqual(conflict.status_code, 409)

        self.connection.execute(
            update(JobApplication)
            .where(JobApplication.id == UUID(role["id"]))
            .values(status="interview")
        )

        replay = self._apply(role["id"])
        self.assertEqual(replay.status_code, 200)
        self.assertEqual(replay.json()["status"], "interview")

        page = self._page()
        self.assertEqual(
            page["items"][0]["applied_on"], self.applied_on
        )
        self.assertEqual(
            page["overview"]["submitted_applications"], 1
        )

    def test_updates_are_owner_scoped(self) -> None:
        role = self._save()
        original_identity = self.identity

        self.assertEqual(
            self._apply(str(uuid4())).status_code,
            404,
        )

        self.identity = AuthenticatedIdentity(
            issuer=original_identity.issuer,
            subject=str(uuid4()),
        )
        self.assertEqual(
            self._apply(role["id"]).status_code,
            404,
        )

        self.identity = AuthenticatedIdentity(
            issuer="https://another-update-tests.invalid",
            subject=original_identity.subject,
        )
        self.assertEqual(
            self._apply(role["id"]).status_code,
            404,
        )

        self.identity = original_identity

        self.connection.execute(
            update(JobApplication)
            .where(JobApplication.id == UUID(role["id"]))
            .values(archived_at=datetime.now(UTC))
        )

        self.assertEqual(
            self._apply(role["id"]).status_code,
            404,
        )

    def test_update_requires_authentication(self) -> None:
        role = self._save()
        app.dependency_overrides.pop(require_identity)

        response = self._apply(role["id"])

        self.assertEqual(response.status_code, 401)

    def test_invalid_dates_and_zones_are_rejected(self) -> None:
        role = self._save()

        future_date = (
            datetime.now(UTC).date() + timedelta(days=2)
        ).isoformat()

        invalid_changes = [
            {"applied_on": future_date},
            {"applied_on": "2026-02-30"},
            {"applied_on": "2026/01/01"},
            {"applied_on": 0},
            {"time_zone": "Mars/Olympus"},
            {"user_id": str(uuid4())},
        ]

        for changes in invalid_changes:
            with self.subTest(changes=changes):
                response = self._apply(
                    role["id"], **changes
                )
                self.assertEqual(
                    response.status_code, 422, response.text
                )

        stored = self._page()["items"][0]
        self.assertEqual(stored["status"], "saved")
        self.assertIsNone(stored["applied_on"])

    def test_dates_follow_the_supplied_time_zone(self) -> None:
        role = self._save()

        fixed_now = datetime(
            2026, 1, 1, 20, 0, tzinfo=UTC
        )

        with patch("app.schemas.datetime") as clock:
            clock.now.side_effect = (
                lambda zone: fixed_now.astimezone(zone)
            )

            local_response = self._apply(
                role["id"],
                applied_on="2026-01-02",
                time_zone="Asia/Colombo",
            )
            self.assertEqual(
                local_response.status_code,
                200,
                local_response.text,
            )

            utc_response = self._apply(
                role["id"],
                applied_on="2026-01-02",
                time_zone="UTC",
            )
            self.assertEqual(utc_response.status_code, 422)

    def test_overview_counts_all_owned_active_roles(self) -> None:
        original_identity = self.identity

        self._save("Saved role")
        applied = self._save("Applied role")
        interview = self._save("Interview role")
        offer = self._save("Offer role")
        archived = self._save("Archived role")

        for role, stage in [
            (applied, "applied"),
            (interview, "interview"),
            (offer, "offer"),
            (archived, "applied"),
        ]:
            self.connection.execute(
                update(JobApplication)
                .where(JobApplication.id == UUID(role["id"]))
                .values(
                    status=stage,
                    applied_on=date.fromisoformat(
                        self.applied_on
                    ),
                )
            )

        self.connection.execute(
            update(JobApplication)
            .where(JobApplication.id == UUID(archived["id"]))
            .values(archived_at=datetime.now(UTC))
        )

        self.identity = AuthenticatedIdentity(
            issuer=original_identity.issuer,
            subject=str(uuid4()),
        )
        self._save("Another account's role")

        self.identity = original_identity

        expected = {
            "tracked_roles": 4,
            "submitted_applications": 3,
            "interviews": 1,
            "offers": 1,
        }

        page = self._page("?limit=1")
        self.assertEqual(len(page["items"]), 1)
        self.assertTrue(page["has_more"])
        self.assertEqual(page["overview"], expected)

        empty_page = self._page("?offset=1000")
        self.assertEqual(empty_page["items"], [])
        self.assertEqual(empty_page["overview"], expected)

        self.identity = AuthenticatedIdentity(
            issuer=original_identity.issuer,
            subject=str(uuid4()),
        )

        empty_account = self._page()
        self.assertEqual(empty_account["items"], [])
        self.assertEqual(
            empty_account["overview"],
            {
                "tracked_roles": 0,
                "submitted_applications": 0,
                "interviews": 0,
                "offers": 0,
            },
        )


if __name__ == "__main__":
    unittest.main()