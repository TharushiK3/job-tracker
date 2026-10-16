from pydantic_settings import SettingsConfigDict

from app.config import BACKEND_DIR, Settings


class MigrationSettings(Settings):
    model_config = SettingsConfigDict(
        env_file=BACKEND_DIR / ".env.migrations",
        env_file_encoding="utf-8-sig",
        env_prefix="MIGRATION_",
        extra="forbid",
        hide_input_in_errors=True,
    )