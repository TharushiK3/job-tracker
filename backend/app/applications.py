from typing import Annotated
from uuid import UUID

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Response,
    status,
)
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import AuthenticatedIdentity, require_identity
from app.dependencies import get_session
from app.models import JobApplication, User
from app.schemas import (
    ApplicationCreate,
    ApplicationMarkApplied,
    ApplicationOverview,
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
    filters = (
        User.auth_issuer == identity.issuer,
        User.auth_subject == identity.subject,
        JobApplication.archived_at.is_(None),
    )

    overview_statement = (
        select(
            func.count(JobApplication.id).label(
                "tracked_roles"
            ),
            func.count(JobApplication.id)
            .filter(JobApplication.applied_on.is_not(None))
            .label("submitted_applications"),
            func.count(JobApplication.id)
            .filter(JobApplication.status == "interview")
            .label("interviews"),
            func.count(JobApplication.id)
            .filter(JobApplication.status == "offer")
            .label("offers"),
        )
        .select_from(JobApplication)
        .join(User, JobApplication.user_id == User.id)
        .where(*filters)
    )

    overview_values = session.execute(
        overview_statement
    ).mappings().one()

    overview = ApplicationOverview.model_validate(
        overview_values
    )

    applications_statement = (
        select(JobApplication)
        .join(User, JobApplication.user_id == User.id)
        .where(*filters)
        .order_by(
            JobApplication.created_at.desc(),
            JobApplication.id.desc(),
        )
        .limit(limit + 1)
        .offset(offset)
    )

    applications = session.scalars(
        applications_statement
    ).all()

    result = ApplicationPage(
        items=[
            ApplicationRead.model_validate(application)
            for application in applications[:limit]
        ],
        limit=limit,
        offset=offset,
        has_more=len(applications) > limit,
        overview=overview,
    )

    response.headers["Cache-Control"] = "no-store"
    return result


@router.post(
    "/{application_id}/mark-applied",
    response_model=ApplicationRead,
    responses={
        404: {"description": "Application not found"},
        409: {"description": "Application date conflicts"},
    },
)
def mark_application_applied(
    application_id: UUID,
    payload: ApplicationMarkApplied,
    response: Response,
    identity: IdentityDependency,
    session: SessionDependency,
) -> ApplicationRead:
    with session.begin():
        statement = (
            select(JobApplication)
            .join(User, JobApplication.user_id == User.id)
            .where(
                JobApplication.id == application_id,
                User.auth_issuer == identity.issuer,
                User.auth_subject == identity.subject,
                JobApplication.archived_at.is_(None),
            )
            .with_for_update(of=JobApplication)
        )

        application = session.scalar(statement)

        if application is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Application not found",
            )

        if application.status == "saved":
            application.status = "applied"
            application.applied_on = payload.applied_on

            session.flush()
            session.refresh(application)

        elif application.applied_on != payload.applied_on:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This role already has a different "
                    "application date. Refresh the list."
                ),
            )

        result = ApplicationRead.model_validate(application)

    response.headers["Cache-Control"] = "no-store"
    return result