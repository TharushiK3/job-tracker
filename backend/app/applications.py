from datetime import UTC, datetime
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
    ApplicationArchive,
    ApplicationArchivedRead,
    ApplicationCreate,
    ApplicationMarkApplied,
    ApplicationOverview,
    ApplicationPage,
    ApplicationRead,
    ApplicationRestore,
    ApplicationUpdate,
    ArchivedApplicationItem,
    ArchivedApplicationPage,
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


def _owned_application_for_update(
    session: Session,
    identity: AuthenticatedIdentity,
    application_id: UUID,
    *,
    include_archived: bool = False,
) -> JobApplication:
    """Call inside a transaction; lock only the application's row."""
    statement = (
        select(JobApplication)
        .join(User, JobApplication.user_id == User.id)
        .where(
            JobApplication.id == application_id,
            User.auth_issuer == identity.issuer,
            User.auth_subject == identity.subject,
        )
        .with_for_update(of=JobApplication)
    )

    if not include_archived:
        statement = statement.where(
            JobApplication.archived_at.is_(None)
        )

    application = session.scalar(statement)
    if application is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Application not found",
            headers={"Cache-Control": "no-store"},
        )

    return application


def _active_overview(
    session: Session,
    identity: AuthenticatedIdentity,
) -> ApplicationOverview:
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

    return ApplicationOverview.model_validate(
        overview_values
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

    overview = _active_overview(session, identity)

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


@router.get(
    "/archived",
    response_model=ArchivedApplicationPage,
)
def list_archived_applications(
    response: Response,
    identity: IdentityDependency,
    session: SessionDependency,
    limit: Annotated[int, Query(ge=1, le=100)] = 25,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> ArchivedApplicationPage:
    filters = (
        User.auth_issuer == identity.issuer,
        User.auth_subject == identity.subject,
        JobApplication.archived_at.is_not(None),
    )

    total_statement = (
        select(func.count(JobApplication.id))
        .select_from(JobApplication)
        .join(User, JobApplication.user_id == User.id)
        .where(*filters)
    )
    total = session.execute(total_statement).scalar_one()

    statement = (
        select(JobApplication)
        .join(User, JobApplication.user_id == User.id)
        .where(*filters)
        .order_by(
            JobApplication.archived_at.desc(),
            JobApplication.id.desc(),
        )
        .limit(limit + 1)
        .offset(offset)
    )
    applications = session.scalars(statement).all()

    result = ArchivedApplicationPage(
        items=[
            ArchivedApplicationItem.model_validate(application)
            for application in applications[:limit]
        ],
        limit=limit,
        offset=offset,
        has_more=len(applications) > limit,
        total=total,
        overview=_active_overview(session, identity),
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
        application = _owned_application_for_update(
            session, identity, application_id
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


@router.patch(
    "/{application_id}",
    response_model=ApplicationRead,
    responses={
        404: {"description": "Active application not found"},
    },
)
def edit_application(
    application_id: UUID,
    payload: ApplicationUpdate,
    response: Response,
    identity: IdentityDependency,
    session: SessionDependency,
) -> ApplicationRead:
    changes = payload.model_dump(exclude_unset=True)

    with session.begin():
        application = _owned_application_for_update(
            session, identity, application_id
        )

        if "company" in changes:
            application.company = changes["company"]
        if "job_title" in changes:
            application.job_title = changes["job_title"]

        session.flush()
        session.refresh(application)
        result = ApplicationRead.model_validate(application)

    response.headers["Cache-Control"] = "no-store"
    return result


@router.post(
    "/{application_id}/archive",
    response_model=ApplicationArchivedRead,
    responses={
        404: {"description": "Application not found"},
    },
)
def archive_application(
    application_id: UUID,
    payload: ApplicationArchive,
    response: Response,
    identity: IdentityDependency,
    session: SessionDependency,
) -> ApplicationArchivedRead:
    with session.begin():
        application = _owned_application_for_update(
            session,
            identity,
            application_id,
            include_archived=True,
        )

        # A repeated request returns the original archive timestamp.
        if application.archived_at is None:
            application.archived_at = datetime.now(UTC)
            session.flush()
            session.refresh(application)

        result = ApplicationArchivedRead.model_validate(application)

    response.headers["Cache-Control"] = "no-store"
    return result


@router.post(
    "/{application_id}/restore",
    response_model=ApplicationRead,
    responses={
        404: {"description": "Application not found"},
    },
)
def restore_application(
    application_id: UUID,
    payload: ApplicationRestore,
    response: Response,
    identity: IdentityDependency,
    session: SessionDependency,
) -> ApplicationRead:
    with session.begin():
        application = _owned_application_for_update(
            session,
            identity,
            application_id,
            include_archived=True,
        )

        # Returning an already active role makes a lost-response retry safe.
        if application.archived_at is not None:
            application.archived_at = None
            session.flush()
            session.refresh(application)

        result = ApplicationRead.model_validate(application)

    response.headers["Cache-Control"] = "no-store"
    return result
