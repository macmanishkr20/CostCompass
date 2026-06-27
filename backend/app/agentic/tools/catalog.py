"""Deterministic tool catalogue — the only way an agent can produce a number.

Every figure in CostCompass is computed by `engine.py`. The agentic layer keeps
that guarantee by exposing the engine (and the platform-strategy helpers) as a
catalogue of *tools*. A specialist ReAct agent reasons in prose, but when it
needs a feasibility score, a cost breakdown, a token projection, an ROI curve —
anything numeric — it must call one of these tools. The tool runs the exact
deterministic engine function and returns its result verbatim.

Two properties make this safe:

* **Caching** — a tool computes once per run and memoises into the shared
  `ToolContext`, so repeated calls are free and always identical.
* **Hashed ledger** — every computation appends a SHA-256 of its canonical-JSON
  output to `ctx.ledger`, so any number in the final report is traceable to the
  precise call that produced it. The strict integrity guard later re-derives the
  same figures from the resolved inputs and refuses any mismatch.

Tools never invent numbers; agents never bypass tools. That is the whole point.
"""

from __future__ import annotations

from typing import Any, Callable, Optional

from ...shared import engine
from ...shared.architect import (
    _tool_analyze_use_cases,
    _tool_baseline_guess,
    _tool_list_platforms,
    _tool_read_constraints,
)
from ...shared.platforms import DEFAULT_PLATFORM, PLATFORM_PROFILES
from ...shared.schemas import TechnicalPreferences
from .context import Tool, ToolContext

_VALID_PLATFORMS = set(PLATFORM_PROFILES.keys())

_NO_ARGS = {"type": "object", "properties": {}, "additionalProperties": False}


# ── Read-only inspection tools (reuse the architect's deterministic views) ──

def _info(text: str) -> dict:
    return {"info": text}


def _t_list_platforms(ctx: ToolContext, args: dict) -> dict:
    return _info(_tool_list_platforms())


def _t_analyze_use_cases(ctx: ToolContext, args: dict) -> dict:
    return _info(_tool_analyze_use_cases(ctx.inp))


def _t_read_constraints(ctx: ToolContext, args: dict) -> dict:
    return _info(_tool_read_constraints(ctx.inp))


def _t_baseline_guess(ctx: ToolContext, args: dict) -> dict:
    return _info(_tool_baseline_guess(ctx.inp))


# ── Numeric tools (cached + ledgered engine calls) ──────────────────

def _cached(ctx: ToolContext, key: str, compute: Callable[[], Any]) -> Any:
    if key in ctx.artifacts:
        return ctx.artifacts[key]
    result = compute()
    ctx.artifacts[key] = result
    ctx._record(key, result)
    return result


def ensure_feasibility(ctx: ToolContext) -> dict:
    return _cached(ctx, "feasibility", lambda: engine.score_feasibility(ctx.inp))


def ensure_tokens(ctx: ToolContext) -> dict:
    return _cached(ctx, "tokens", lambda: engine.project_tokens(ctx.inp))


def ensure_cost(ctx: ToolContext) -> dict:
    feas = ensure_feasibility(ctx)
    return _cached(ctx, "cost", lambda: engine.compute_cost(ctx.inp, feas))


def ensure_comparison(ctx: ToolContext) -> dict:
    feas = ensure_feasibility(ctx)
    cost = ensure_cost(ctx)
    return _cached(ctx, "comparison", lambda: engine.compare_approaches(ctx.inp, feas, cost))


def ensure_roi(ctx: ToolContext) -> dict:
    feas = ensure_feasibility(ctx)
    cost = ensure_cost(ctx)
    return _cached(ctx, "roi", lambda: engine.project_roi(ctx.inp, feas, cost))


def _t_score_feasibility(ctx: ToolContext, args: dict) -> dict:
    return ensure_feasibility(ctx)


def _t_project_tokens(ctx: ToolContext, args: dict) -> dict:
    return ensure_tokens(ctx)


def _t_compute_cost(ctx: ToolContext, args: dict) -> dict:
    return ensure_cost(ctx)


def _t_compare_approaches(ctx: ToolContext, args: dict) -> dict:
    return ensure_comparison(ctx)


def _t_project_roi(ctx: ToolContext, args: dict) -> dict:
    return ensure_roi(ctx)


# ── Write tool (resolves the delivery_platform input, like classify→task_type) ──

def set_platform(ctx: ToolContext, platform: str) -> dict:
    """Resolve the delivery platform on a copy of the working input."""
    platform = (platform or "").strip()
    if platform not in _VALID_PLATFORMS:
        return {"error": f"unknown platform '{platform}'", "valid": sorted(_VALID_PLATFORMS)}
    tp = ctx.inp.technical_preferences
    new_tp = (
        tp.model_copy(update={"delivery_platform": platform})
        if tp is not None
        else TechnicalPreferences(delivery_platform=platform)
    )
    ctx.inp = ctx.inp.model_copy(update={"technical_preferences": new_tp})
    # Resolving a platform may invalidate previously-cached costs; drop them so a
    # later tool recomputes against the new platform.
    for k in ("cost", "comparison", "roi"):
        ctx.artifacts.pop(k, None)
    profile = PLATFORM_PROFILES.get(platform) or PLATFORM_PROFILES[DEFAULT_PLATFORM]
    return {"resolved_platform": platform, "cost_model": profile.cost_model, "label": profile.label}


def _t_set_platform(ctx: ToolContext, args: dict) -> dict:
    return set_platform(ctx, str(args.get("platform", "")))


# ── Registry ─────────────────────────────────────────────────────────

TOOLS: dict[str, Tool] = {
    "list_platforms": Tool(
        "list_platforms",
        "List the five candidate delivery platforms with their cost models and best-fit notes.",
        _NO_ARGS, _t_list_platforms,
    ),
    "analyze_use_cases": Tool(
        "analyze_use_cases",
        "Summarise the project's AI use-case mix: counts of AI-led vs deterministic vs agentic tasks, scale.",
        _NO_ARGS, _t_analyze_use_cases,
    ),
    "read_constraints": Tool(
        "read_constraints",
        "Read stated constraints: existing infra, compliance, deployment model, seat signals, domain.",
        _NO_ARGS, _t_read_constraints,
    ),
    "baseline_platform_guess": Tool(
        "baseline_platform_guess",
        "Get the deterministic keyword classifier's platform hint. Treat as a starting point.",
        _NO_ARGS, _t_baseline_guess,
    ),
    "score_feasibility": Tool(
        "score_feasibility",
        "Deterministically score AI necessity, agentic suitability and traditional suitability, and pick the "
        "recommendation archetype. Returns the full FeasibilityResult — return it verbatim.",
        _NO_ARGS, _t_score_feasibility,
    ),
    "project_tokens": Tool(
        "project_tokens",
        "Deterministically project daily/monthly/annual token usage and per-model recommendations.",
        _NO_ARGS, _t_project_tokens,
    ),
    "compute_cost": Tool(
        "compute_cost",
        "Deterministically compute the full cost breakdown (development, infrastructure, AI tokens, maintenance, "
        "total) for the resolved delivery platform. Returns the exact CostBreakdown — never edit a figure.",
        _NO_ARGS, _t_compute_cost,
    ),
    "compare_approaches": Tool(
        "compare_approaches",
        "Deterministically compare the AI approach vs a standard-software approach across cost, timeline and team.",
        _NO_ARGS, _t_compare_approaches,
    ),
    "project_roi": Tool(
        "project_roi",
        "Deterministically project ROI: annual benefit, payback months, 3-year value and the cumulative curve.",
        _NO_ARGS, _t_project_roi,
    ),
    "set_platform": Tool(
        "set_platform",
        "Resolve the delivery platform for costing. Pass one of: azure_paas, aws, gcp, m365_copilot, on_prem.",
        {
            "type": "object",
            "properties": {
                "platform": {
                    "type": "string",
                    "enum": sorted(_VALID_PLATFORMS),
                    "description": "The chosen delivery-platform key.",
                }
            },
            "required": ["platform"],
            "additionalProperties": False,
        },
        _t_set_platform, writes=True,
    ),
}


def run_tool(name: str, args: Optional[dict], ctx: ToolContext) -> Any:
    """Dispatch a tool call by name; unknown tools return a structured error."""
    tool = TOOLS.get(name)
    if tool is None:
        return {"error": f"unknown tool '{name}'", "available": sorted(TOOLS.keys())}
    return tool.run(ctx, args or {})
