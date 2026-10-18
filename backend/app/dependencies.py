import logging
from collections.abc import Iterator

from fastapi import HTTPException, status
from sqlalchemy.exc import OperationalError
from sqlalchemy.exc import TimeoutError as SQLAlchemyTimeoutError
from sqlalchemy.orm import Session

from app.database import engine


logger = logging.getLogger(__name__)


def get_session() -> Iterator[Session]:
    try:
        with Session(engine) as session:
            yield session
    except (OperationalError, SQLAlchemyTimeoutError):
        logger.exception("Database connection unavailable")

        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Database is unavailable",
            headers={"Cache-Control": "no-store"},
        ) from None