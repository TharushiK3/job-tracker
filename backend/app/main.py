import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from app.auth import AuthenticatedIdentity, require_identity
from app.config import get_settings
from app.database import engine
from app.applications import router as applications_router

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    try:
        yield
    finally:
        engine.dispose()


app = FastAPI(
    title="Job Application Tracker API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().clerk_authorized_parties,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PATCH"],
    allow_headers=["Authorization", "Content-Type"],
)

app.include_router(applications_router)


@app.get("/health", tags=["Health"])
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "service": "job-tracker-api",
    }


@app.get(
    "/ready",
    tags=["Health"],
    responses={
        503: {"description": "Database connection unavailable"},
    },
)
def ready() -> dict[str, str]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except SQLAlchemyError:
        logger.exception("Database readiness check failed")

        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is unavailable",
        ) from None

    return {
        "status": "ready",
        "database": "connected",
    }


@app.get(
    "/api/me",
    tags=["Account"],
    response_model=AuthenticatedIdentity,
    responses={
        401: {"description": "Authentication required"},
        503: {"description": "Authentication service unavailable"},
    },
)
def me(
    response: Response,
    identity: Annotated[
        AuthenticatedIdentity,
        Depends(require_identity),
    ],
) -> AuthenticatedIdentity:
    response.headers["Cache-Control"] = "no-store"
    return identity
