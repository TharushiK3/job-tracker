import logging
from typing import Annotated

import httpx
from clerk_backend_api.security import authenticate_request
from clerk_backend_api.security.types import AuthenticateRequestOptions
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, ConfigDict

from app.config import Settings, get_settings


logger = logging.getLogger(__name__)

bearer_scheme = HTTPBearer(
    scheme_name="ClerkSession",
    auto_error=False,
)


class AuthenticatedIdentity(BaseModel):
    model_config = ConfigDict(frozen=True)

    issuer: str
    subject: str


def _unauthorized() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Authentication required",
        headers={
            "WWW-Authenticate": "Bearer",
            "Cache-Control": "no-store",
        },
    )


def _unavailable() -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
        detail="Authentication service is temporarily unavailable",
        headers={"Cache-Control": "no-store"},
    )


def require_identity(
    request: Request,
    credentials: Annotated[
        HTTPAuthorizationCredentials | None,
        Depends(bearer_scheme),
    ],
    settings: Annotated[Settings, Depends(get_settings)],
) -> AuthenticatedIdentity:
    if credentials is None:
        raise _unauthorized()

    if credentials.credentials.count(".") != 2:
        raise _unauthorized()

    # This object stays in memory. Creating it sends no HTTP request.
    # It gives the SDK a normalized Bearer header without cookies.
    token_request = httpx.Request(
        method=request.method,
        url=str(request.url),
        headers={
            "Authorization": f"Bearer {credentials.credentials}",
        },
    )

    jwt_key = (
        settings.clerk_jwt_key.get_secret_value()
        if settings.clerk_jwt_key is not None
        else None
    )

    try:
        state = authenticate_request(
            token_request,
            AuthenticateRequestOptions(
                secret_key=settings.clerk_secret_key.get_secret_value(),
                jwt_key=jwt_key,
                authorized_parties=settings.clerk_authorized_parties,
                accepts_token=["session_token"],
            ),
        )
    except httpx.HTTPError:
        logger.warning("Clerk verification request failed")
        raise _unavailable() from None

    if not state.is_signed_in:
        reason = getattr(state.reason, "name", None)

        if reason in {
            "JWK_FAILED_TO_LOAD",
            "JWK_REMOTE_INVALID",
            "JWK_FAILED_TO_RESOLVE",
            "SECRET_KEY_MISSING",
            "SERVER_ERROR",
        }:
            logger.warning("Clerk verification unavailable: %s", reason)
            raise _unavailable()

        raise _unauthorized()

    claims = state.payload

    if not isinstance(claims, dict):
        raise _unauthorized()

    if (
        claims.get("iss") != settings.clerk_issuer
        or claims.get("azp") not in settings.clerk_authorized_parties
        or claims.get("sts") == "pending"
        or any(name not in claims for name in ("exp", "iat", "nbf"))
    ):
        raise _unauthorized()

    subject = claims.get("sub")
    session_id = claims.get("sid")

    if (
        not isinstance(subject, str)
        or not subject.strip()
        or len(subject) > 255
    ):
        raise _unauthorized()

    if not isinstance(session_id, str) or not session_id.strip():
        raise _unauthorized()

    return AuthenticatedIdentity(
        issuer=settings.clerk_issuer,
        subject=subject,
    )