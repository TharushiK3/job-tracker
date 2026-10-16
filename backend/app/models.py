from datetime import date, datetime
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
    ForeignKey,
    Index,
    MetaData,
    String,
    UniqueConstraint,
    Uuid,
    func,
    text,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    metadata = MetaData(
        schema="tracker",
        naming_convention={
            "pk": "pk_%(table_name)s",
            "fk": (
                "fk_%(table_name)s_%(column_0_name)s_"
                "%(referred_table_name)s"
            ),
            "uq": "uq_%(table_name)s_%(column_0_name)s",
            "ck": "ck_%(table_name)s_%(constraint_name)s",
            "ix": "ix_%(column_0_label)s",
        },
    )


class User(Base):
    __tablename__ = "users"

    __table_args__ = (
        UniqueConstraint(
            "auth_issuer",
            "auth_subject",
            name="uq_users_auth_identity",
        ),
        CheckConstraint(
            "length(btrim(auth_issuer)) > 0",
            name="auth_issuer_not_blank",
        ),
        CheckConstraint(
            "length(btrim(auth_subject)) > 0",
            name="auth_subject_not_blank",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid,
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    auth_issuer: Mapped[str] = mapped_column(String(512))
    auth_subject: Mapped[str] = mapped_column(String(255))

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )


class JobApplication(Base):
    __tablename__ = "applications"

    __table_args__ = (
        CheckConstraint(
            "length(btrim(company)) > 0",
            name="company_not_blank",
        ),
        CheckConstraint(
            "length(btrim(job_title)) > 0",
            name="job_title_not_blank",
        ),
        CheckConstraint(
            "status IN "
            "('saved', 'applied', 'screening', 'interview', "
            "'offer', 'rejected', 'withdrawn')",
            name="status_valid",
        ),
        CheckConstraint(
            "(status = 'saved' AND applied_on IS NULL) OR "
            "(status <> 'saved' AND applied_on IS NOT NULL)",
            name="status_matches_application_date",
        ),
        Index(
            "ix_applications_user_created_id",
            "user_id",
            "created_at",
            "id",
        ),
        Index(
            "ix_applications_user_status",
            "user_id",
            "status",
        ),
    )

    id: Mapped[UUID] = mapped_column(
        Uuid,
        primary_key=True,
        server_default=text("gen_random_uuid()"),
    )

    user_id: Mapped[UUID] = mapped_column(
        Uuid,
        ForeignKey("tracker.users.id", ondelete="CASCADE"),
    )

    company: Mapped[str] = mapped_column(String(200))
    job_title: Mapped[str] = mapped_column(String(200))

    status: Mapped[str] = mapped_column(
        String(20),
        server_default="saved",
    )

    applied_on: Mapped[date | None] = mapped_column(Date)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
    )

    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
    )

    archived_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True),
    )