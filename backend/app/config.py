from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


BACKEND_DIR = Path(__file__).resolve().parents[1]


class DatabaseSettings(BaseSettings):
    db_host: str = Field(min_length=1)
    db_port: int = Field(ge=1, le=65535)
    db_name: str = Field(min_length=1)
    db_user: str = Field(min_length=1)
    db_password: SecretStr = Field(min_length=1)


class Settings(DatabaseSettings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env",
        env_file_encoding="utf-8-sig",
        extra="forbid",
        hide_input_in_errors=True,
    )

    clerk_secret_key: SecretStr = Field(min_length=1)
    clerk_issuer: str = Field(
        min_length=1,
        max_length=512,
        pattern=r"^https://[^/?#\s]+$",
    )
    clerk_authorized_parties: list[str] = Field(min_length=1)
    clerk_jwt_key: SecretStr | None = None


@lru_cache
def get_settings() -> Settings:
    return Settings()