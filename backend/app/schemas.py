import re
from datetime import date, datetime
from typing import Annotated, Literal, Self
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
    model_validator,
)
from pydantic.json_schema import SkipJsonSchema


ApplicationStatus = Literal[
    "saved",
    "applied",
    "screening",
    "interview",
    "offer",
    "rejected",
    "withdrawn",
]


ApplicationLabel = Annotated[
    str,
    Field(
        min_length=1,
        max_length=200,
        pattern=r"^[^\x00-\x1f\x7f]+$",
    ),
]


class ApplicationCreate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
    )

    company: ApplicationLabel
    job_title: ApplicationLabel


class ApplicationUpdate(BaseModel):
    model_config = ConfigDict(
        extra="forbid",
        str_strip_whitespace=True,
    )

    # None represents an omitted field internally. Explicit JSON null is invalid.
    company: ApplicationLabel | SkipJsonSchema[None] = None
    job_title: ApplicationLabel | SkipJsonSchema[None] = None

    @field_validator("company", "job_title")
    @classmethod
    def reject_null(cls, value: str | None) -> str:
        if value is None:
            raise ValueError("Provide text or omit this field.")
        return value

    @model_validator(mode="after")
    def require_edit(self) -> Self:
        if not self.model_fields_set:
            raise ValueError("Provide a company or job title to update.")
        return self


class ApplicationArchive(BaseModel):
    """The archive command accepts an empty JSON object."""

    model_config = ConfigDict(extra="forbid")


class ApplicationRestore(BaseModel):
    """The restore command accepts an empty JSON object."""

    model_config = ConfigDict(extra="forbid")


class ApplicationArchivedRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    archived_at: datetime


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


class ArchivedApplicationItem(ApplicationRead):
    archived_at: datetime


class ArchivedApplicationPage(BaseModel):
    items: list[ArchivedApplicationItem]
    limit: int
    offset: int
    has_more: bool
    total: int = Field(ge=0)
    overview: ApplicationOverview
