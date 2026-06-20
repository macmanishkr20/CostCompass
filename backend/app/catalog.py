"""Deterministic pricing & scoring catalog.

This is the single source of truth for every number the engine multiplies.
It mirrors the Angular `estimation.service.ts` constants verbatim so the
Python backend and the TypeScript reference produce identical dollars. The
LLM never touches anything in here — code computes every figure.
"""

from __future__ import annotations

from typing import TypedDict

# ── Rate card (blended USD) ──
DEV_HOURLY_RATE = 115
MAINT_HOURLY_RATE = 95
HOURS_PER_DEV_WEEK = 32  # effective, not nominal

COMPLEXITY_HOURS: dict[str, int] = {
    "low": 24,
    "medium": 64,
    "high": 130,
    "very_high": 240,
}

PRIORITY_WEIGHT: dict[str, float] = {
    "must_have": 1.0,
    "nice_to_have": 0.6,
    "exploratory": 0.3,
}


# ── Model pricing catalog (USD per 1M tokens) ──
class ModelPrice(TypedDict):
    provider: str
    in_per_1m: float
    out_per_1m: float


MODEL_CATALOG: dict[str, ModelPrice] = {
    "gpt-4o": {"provider": "Azure OpenAI", "in_per_1m": 2.5, "out_per_1m": 10},
    "gpt-4o-mini": {"provider": "Azure OpenAI", "in_per_1m": 0.15, "out_per_1m": 0.6},
    "claude-sonnet-4": {"provider": "Anthropic", "in_per_1m": 3, "out_per_1m": 15},
    "claude-haiku": {"provider": "Anthropic", "in_per_1m": 0.8, "out_per_1m": 4},
    "gemini-2-pro": {"provider": "Google", "in_per_1m": 1.25, "out_per_1m": 5},
    "gemini-2-flash": {"provider": "Google", "in_per_1m": 0.075, "out_per_1m": 0.3},
}


# ── Per-task-type profile: token shape, default model, and scoring weights ──
class TaskProfile(TypedDict):
    in_tokens: int
    out_tokens: int
    model: str
    ai_n: int      # contribution to AI-necessity
    agentic: int   # contribution to agentic suitability
    trad: int      # contribution to traditional suitability
    value_per_call: float  # USD of manual labour offset by automating one call


TASK_PROFILES: dict[str, TaskProfile] = {
    "text_classification": {"in_tokens": 800, "out_tokens": 80, "model": "gpt-4o-mini", "ai_n": 55, "agentic": 20, "trad": 70, "value_per_call": 0.08},
    "summarization": {"in_tokens": 4000, "out_tokens": 600, "model": "gpt-4o-mini", "ai_n": 66, "agentic": 25, "trad": 45, "value_per_call": 0.45},
    "code_generation": {"in_tokens": 2500, "out_tokens": 1200, "model": "claude-sonnet-4", "ai_n": 80, "agentic": 55, "trad": 25, "value_per_call": 1.20},
    "conversational_agent": {"in_tokens": 1500, "out_tokens": 500, "model": "gpt-4o", "ai_n": 80, "agentic": 72, "trad": 25, "value_per_call": 0.60},
    "rag_qa": {"in_tokens": 3500, "out_tokens": 700, "model": "gpt-4o-mini", "ai_n": 78, "agentic": 55, "trad": 30, "value_per_call": 0.55},
    "multi_agent_orchestration": {"in_tokens": 6000, "out_tokens": 2500, "model": "gpt-4o", "ai_n": 88, "agentic": 92, "trad": 15, "value_per_call": 2.50},
    "document_analysis": {"in_tokens": 8000, "out_tokens": 1000, "model": "gpt-4o", "ai_n": 75, "agentic": 50, "trad": 35, "value_per_call": 1.40},
    "image_analysis": {"in_tokens": 1200, "out_tokens": 400, "model": "gpt-4o", "ai_n": 82, "agentic": 35, "trad": 30, "value_per_call": 0.35},
    "translation": {"in_tokens": 1000, "out_tokens": 1000, "model": "gemini-2-flash", "ai_n": 60, "agentic": 20, "trad": 55, "value_per_call": 0.20},
    "data_extraction": {"in_tokens": 2000, "out_tokens": 400, "model": "gpt-4o-mini", "ai_n": 62, "agentic": 35, "trad": 60, "value_per_call": 0.30},
    "recommendation": {"in_tokens": 1500, "out_tokens": 300, "model": "gemini-2-pro", "ai_n": 70, "agentic": 40, "trad": 50, "value_per_call": 0.25},
    "anomaly_detection": {"in_tokens": 1000, "out_tokens": 120, "model": "gemini-2-flash", "ai_n": 58, "agentic": 30, "trad": 72, "value_per_call": 0.40},
}

# Valid task types (kept here so the classifier can validate against the catalog).
TASK_TYPES: list[str] = list(TASK_PROFILES.keys())

SCALE_INFRA_BASE: dict[str, int] = {"small": 120, "medium": 320, "large": 850, "enterprise": 2200}
SCALE_APIM: dict[str, int] = {"small": 0, "medium": 50, "large": 250, "enterprise": 700}
SCALE_MAINT_HOURS: dict[str, int] = {"small": 12, "medium": 24, "large": 48, "enterprise": 90}


# ── Archetype copy (mirrors shared/utils/feasibility.ts) ──
ARCHETYPE_LABEL: dict[str, str] = {
    "traditional": "Traditional Only",
    "traditional_plus_ai": "Traditional + AI",
    "rag_assistant": "RAG Assistant",
    "single_agent": "Single Agent",
    "multi_agent": "Multi-Agent",
    "hybrid": "Hybrid",
}

ARCHETYPE_BLURB: dict[str, str] = {
    "traditional": "Standard software delivers this best — AI adds cost without proportional value.",
    "traditional_plus_ai": "A conventional build with a few targeted AI features where they clearly pay off.",
    "rag_assistant": "A retrieval-augmented assistant grounded in your own data and documents.",
    "single_agent": "One autonomous agent with tools, handling multi-step tasks end to end.",
    "multi_agent": "Several coordinated agents orchestrated across specialised roles.",
    "hybrid": "A deliberate mix of deterministic services and agents, each where it fits.",
}


def archetype_label(a: str) -> str:
    return ARCHETYPE_LABEL.get(a, a)


def archetype_blurb(a: str) -> str:
    return ARCHETYPE_BLURB.get(a, "")


def rating_for_score(score: float) -> str:
    if score >= 80:
        return "excellent"
    if score >= 60:
        return "high"
    if score >= 40:
        return "medium"
    return "low"
