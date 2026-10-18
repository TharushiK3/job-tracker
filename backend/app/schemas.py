import re
from datetime import date, datetime
from typing import Literal, Self
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)


ApplicationStatus = Literal[
    "saved",
    "applied",
    "screening",
    "interview",
    "offer",
    "rejected",
    "withdrawn",
]


class ApplicationCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
    )

    company: str = Field(
        min_length=1,
        max_length=200,
        pattern=r"^[^\x00-\x1f\x7f]+$",
    )
    job_title: str = Field(
        min_length=1,
        max_length=200,
        pattern=r"^[^\x00-\x1f\x7f]+$",
    )


class ApplicationMarkApplied(BaseModel):
    model_config = ConfigDict(extra="forbid")

    applied_on: date
    time_zone: str = Field(min_length=1, max_length=100)

    @field_validator("applied_on", mode="before")
    @classmethod
    def require_iso_date(cls, value: object) -> str:
        if (
            not isinstance(value, str)
            or re.fullmatch(
                r"[0-9]{4}-[0-9]{2}-[0-9]{2}",
                value,
            )
            is None
        ):
            raise ValueError("Use a date in YYYY-MM-DD format.")

        return value

    @field_validator("time_zone")
    @classmethod
    def require_known_zone(cls, value: str) -> str:
        try:
            ZoneInfo(value)
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError(
                "Use a valid IANA time zone."
            ) from None

        return value

    @model_validator(mode="after")
    def reject_future_date(self) -> Self:
        today = datetime.now(ZoneInfo(self.time_zone)).date()

        if self.applied_on > today:
            raise ValueError(
                "Application date must be today or earlier "
                "in your time zone."
            )

        return self


class ApplicationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    company: str
    job_title: str
    status: ApplicationStatus
    applied_on: date | None
    created_at: datetime
    updated_at: datetime


class ApplicationOverview(BaseModel):
    tracked_roles: int = Field(ge=0)
    submitted_applications: int = Field(ge=0)
    interviews: int = Field(ge=0)
    offers: int = Field(ge=0)


class ApplicationPage(BaseModel):
    items: list[ApplicationRead]
    limit: int
    offset: int
    has_more: bool
    overview: ApplicationOverview