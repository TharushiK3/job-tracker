from uuid import UUID

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.auth import AuthenticatedIdentity
from app.models import User


def get_or_create_user_id(
    session: Session,
    identity: AuthenticatedIdentity,
) -> UUID:
    """Resolve a verified identity; the caller controls the transaction."""

    statement = (
        insert(User)
        .values(
            auth_issuer=identity.issuer,
            auth_subject=identity.subject,
        )
        .on_conflict_do_nothing(
            constraint="uq_users_auth_identity"
        )
        .returning(User.id)
    )

    inserted_id = session.scalar(statement)

    if inserted_id is not None:
        return inserted_id

    existing_user = select(User.id).where(
        User.auth_issuer == identity.issuer,
        User.auth_subject == identity.subject,
    )

    return session.execute(existing_user).scalar_one()