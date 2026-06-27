"""Environment-driven settings. Safe local defaults so the app runs with no config."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", case_sensitive=False)

    # ── LLM classifier ──
    # The classify node maps fuzzy/free-text use cases to a fixed task-type
    # label. Provider auto-selects: Azure OpenAI when configured, else Anthropic,
    # else a deterministic keyword heuristic. The LLM NEVER computes a cost.
    enable_llm_classifier: bool = True

    # Azure OpenAI (preferred). `azure_openai_deployment` is the *deployment*
    # name you created in the Azure portal, not the base model name.
    azure_openai_endpoint: str | None = None  # https://<resource>.openai.azure.com
    azure_openai_api_key: str | None = None
    azure_openai_deployment: str = "gpt-4o-mini"
    azure_openai_api_version: str = "2024-10-21"

    # Anthropic (direct) — alternative provider.
    anthropic_api_key: str | None = None
    anthropic_base_url: str | None = None
    classifier_model: str = "claude-3-5-haiku-latest"

    # ── Agentic orchestration (multi-agent ReAct on LangGraph) ──
    # When on, estimates run through a supervisor that dynamically routes among
    # specialist ReAct agents (architect, feasibility, cost, comparison, roi,
    # critic). Every number still comes from deterministic engine tools, and a
    # strict integrity guard re-derives the figures from the agent-resolved
    # inputs — so an agent can never fabricate a cost. Off by default: the
    # deterministic pipeline remains the baseline and the always-safe fallback.
    agentic_mode: bool = False
    # Bounds the reflection loop: how many times the critic may send the
    # supervisor back to a specialist to fix a flagged inconsistency.
    agentic_max_revisions: int = 2
    # When on, the intake agent may pause for human clarifying answers via a
    # LangGraph interrupt. Off keeps the synchronous request path non-blocking.
    agentic_hitl: bool = False

    # ── Azure infrastructure pricing ──
    # When enabled the infra engine queries the public Azure Retail Prices API
    # to refine unit prices; on any failure (offline, timeout) it falls back to
    # the catalog's baseline prices so the app still runs zero-config.
    azure_live_pricing: bool = True
    azure_default_region: str = "eastus"

    # ── Persistence ──
    data_dir: str = "./.data"
    cosmos_endpoint: str | None = None
    cosmos_key: str | None = None
    cosmos_database: str = "costcompass"
    cosmos_container: str = "estimations"

    # ── CORS ──
    cors_origins: str = "http://localhost:4200,http://127.0.0.1:4200"

    @property
    def azure_openai_enabled(self) -> bool:
        return bool(self.azure_openai_endpoint and self.azure_openai_api_key)

    @property
    def anthropic_enabled(self) -> bool:
        return bool(self.anthropic_api_key)

    @property
    def llm_enabled(self) -> bool:
        """The classify node calls an LLM only when enabled AND a provider is configured."""
        return self.enable_llm_classifier and (self.azure_openai_enabled or self.anthropic_enabled)

    @property
    def llm_provider(self) -> str:
        """Which classifier path runs: 'azure_openai' | 'anthropic' | 'heuristic'."""
        if not self.enable_llm_classifier:
            return "heuristic"
        if self.azure_openai_enabled:
            return "azure_openai"
        if self.anthropic_enabled:
            return "anthropic"
        return "heuristic"

    @property
    def cosmos_enabled(self) -> bool:
        return bool(self.cosmos_endpoint and self.cosmos_key)

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
