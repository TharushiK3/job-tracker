from typing import Annotated

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import AuthenticatedIdentity, require_identity
from app.dependencies import get_session
from app.models import JobApplication, User
from app.schemas import (
    ApplicationCreate,
    ApplicationPage,
    ApplicationRead,
)
from app.users import get_or_create_user_id


IdentityDependency = Annotated[
    AuthenticatedIdentity,
    Depends(require_identity),
]

SessionDependency = Annotated[
    Session,
    Depends(get_session, scope="function"),
]


router = APIRouter(
    prefix="/api/applications",
    tags=["Applications"],
    responses={
        401: {"description": "Authentication required"},
        503: {"description": "Service temporarily unavailable"},
    },
)


@router.post(
    "",
    response_model=ApplicationRead,
    status_code=status.HTTP_201_CREATED,
)
def create_application(
    payload: ApplicationCreate,
    response: Response,
    identity: IdentityDependency,
    session: SessionDependency,
) -> ApplicationRead:
    with session.begin():
        user_id = get_or_create_user_id(session, identity)

        application = JobApplication(
            user_id=user_id,
            company=payload.company,
            job_title=payload.job_title,
            status="saved",
            applied_on=None,
        )

        session.add(application)
        session.flush()
        session.refresh(application)

        result = ApplicationRead.model_validate(application)

    response.headers["Cache-Control"] = "no-store"
    return result


@router.get(
    "",
    response_model=ApplicationPage,
)
def list_applications(
    response: Response,
    identity: IdentityDependency,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ApplicationPage:
    statement = (
        select(JobApplication)
        .join(User, JobApplication.user_id == User.id)
        .where(
            User.auth_issuer == identity.issuer,
            User.auth_subject == identity.subject,
            JobApplication.archived_at.is_(None),
        )
        .order_by(
            JobApplication.created_at.desc(),
            JobApplication.id.desc(),
        )
        .limit(limit + 1)
        .offset(offset)
    )

    applications = session.scalars(statement).all()

    result = ApplicationPage(
        items=[
            ApplicationRead.model_validate(application)
            for application in applications[:limit]
        ],
        limit=limit,
        offset=offset,
        has_more=len(applications) > limit,
    )

    response.headers["Cache-Control"] = "no-store"
    return result