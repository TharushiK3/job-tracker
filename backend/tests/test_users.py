import unittest
from uuid import UUID, uuid4

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app.auth import AuthenticatedIdentity
from app.database import engine
from app.models import User
from app.users import get_or_create_user_id


class UserMappingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.session = Session(engine)
        self.addCleanup(self.session.close)

        self.identity = AuthenticatedIdentity(
            issuer="https://user-mapping-tests.invalid",
            subject=str(uuid4()),
        )

        account = self.session.scalar(
            text("SELECT current_user")
        )
        self.assertEqual(account, "job_tracker_app")

    def test_repeated_identity_reuses_one_user(self) -> None:
        first_id = get_or_create_user_id(
            self.session, self.identity
        )
        second_id = get_or_create_user_id(
            self.session, self.identity
        )

        self.assertIsInstance(first_id, UUID)
        self.assertEqual(first_id, second_id)

        matching_ids = self.session.scalars(
            select(User.id).where(
                User.auth_issuer == self.identity.issuer,
                User.auth_subject == self.identity.subject,
            )
        ).all()

        self.assertEqual(matching_ids, [first_id])

    def test_different_subjects_have_different_users(self) -> None:
        other_identity = AuthenticatedIdentity(
            issuer=self.identity.issuer,
            subject=str(uuid4()),
        )

        first_id = get_or_create_user_id(
            self.session, self.identity
        )
        second_id = get_or_create_user_id(
            self.session, other_identity
        )

        self.assertNotEqual(first_id, second_id)

    def test_same_subject_from_different_issuers_stays_separate(
        self,
    ) -> None:
        other_identity = AuthenticatedIdentity(
            issuer="https://another-issuer.invalid",
            subject=self.identity.subject,
        )

        first_id = get_or_create_user_id(
            self.session, self.identity
        )
        second_id = get_or_create_user_id(
            self.session, other_identity
        )

        self.assertNotEqual(first_id, second_id)

    def test_caller_can_roll_back_user_creation(self) -> None:
        user_id = get_or_create_user_id(
            self.session, self.identity
        )

        self.session.rollback()

        remaining_user = self.session.get(User, user_id)

        self.assertIsNone(remaining_user)


if __name__ == "__main__":
    unittest.main()