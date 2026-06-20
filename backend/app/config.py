"""Environment-driven settings. Safe local defaults so the app runs with no config."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # ── LLM classifier ──
    enable_llm_classifier: bool = True
    anthropic_api_key: str | None = None
    anthropic_base_url: str | None = None
    classifier_model: str = "claude-3-5-haiku-latest"

    # ── Persistence ──
    data_dir: str = "./.data"
    cosmos_endpoint: str | None = None
    cosmos_key: str | None = None
    cosmos_database: str = "costcompass"
    cosmos_container: str = "estimations"

    # ── CORS ──
    cors_origins: str = "http://localhost:4200,http://127.0.0.1:4200"

    @property
    def llm_enabled(self) -> bool:
        """The classify node calls Claude only when explicitly enabled AND a key exists."""
        return self.enable_llm_classifier and bool(self.anthropic_api_key)

    @property
    def cosmos_enabled(self) -> bool:
        return bool(self.cosmos_endpoint and self.cosmos_key)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
