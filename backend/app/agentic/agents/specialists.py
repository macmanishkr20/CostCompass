"""The four symmetric analytical specialists: feasibility, cost, comparison, ROI.

Each is a ReAct agent over a focused slice of the tool catalogue that then
guarantees its numeric artifact with the matching `ensure_*` engine call — so the
node always produces a result even when the LLM is down (the current 401 path) or
absent. The system prompts pin each agent to "never state a number you did not
get from a tool"; the engine tools are where every figure actually comes from.
"""

from __future__ import annotations

from ..state import _mark
from ..tools import (
    ensure_comparison,
    ensure_cost,
    ensure_feasibility,
    ensure_roi,
    ensure_tokens,
)
from .base import _run_specialist

_FEAS_SYS = (
    "You are an AI feasibility analyst. Decide how strongly this project needs AI, how well it fits autonomous "
    "agents, and how well plain software fits. Call analyze_use_cases and read_constraints to gather facts, then "
    "call score_feasibility for the authoritative scores and archetype. You NEVER state a score you did not get "
    "from score_feasibility. Finish with a one-paragraph interpretation."
)
_COST_SYS = (
    "You are a cloud cost engineer. The delivery platform is already resolved. Call read_constraints to confirm "
    "scale, then call compute_cost and project_tokens for the authoritative figures. You NEVER state a dollar "
    "amount or token count you did not get from a tool. Finish with a short interpretation of the cost shape."
)
_COMPARE_SYS = (
    "You are a delivery-strategy analyst. Call compare_approaches for the authoritative AI-vs-standard comparison. "
    "You NEVER invent costs, timelines or team sizes — they come from the tool. Finish by naming the trade-off."
)
_ROI_SYS = (
    "You are an ROI analyst. Call project_roi for the authoritative payback, 3-year value and curve. You NEVER "
    "state a benefit or payback you did not get from the tool. Finish with whether the investment pays off."
)


def feasibility_node(state: dict) -> dict:
    ctx = _run_specialist(state, "feasibility_analyst", _FEAS_SYS,
                          ["score_feasibility", "analyze_use_cases", "read_constraints"])
    feas = ensure_feasibility(ctx)
    return {"feasibility": feas, "inp": ctx.inp, "completed": _mark(state, "feasibility_analyst"),
            "agent_steps": ctx.steps, "tool_ledger": ctx.ledger}


def cost_node(state: dict) -> dict:
    ctx = _run_specialist(state, "cost_engineer", _COST_SYS,
                          ["compute_cost", "project_tokens", "read_constraints", "list_platforms"])
    cost = ensure_cost(ctx)
    tokens = ensure_tokens(ctx)
    return {"cost": cost, "tokens": tokens, "inp": ctx.inp, "completed": _mark(state, "cost_engineer"),
            "agent_steps": ctx.steps, "tool_ledger": ctx.ledger}


def comparison_node(state: dict) -> dict:
    ctx = _run_specialist(state, "comparison_analyst", _COMPARE_SYS, ["compare_approaches"])
    comparison = ensure_comparison(ctx)
    return {"comparison": comparison, "inp": ctx.inp, "completed": _mark(state, "comparison_analyst"),
            "agent_steps": ctx.steps, "tool_ledger": ctx.ledger}


def roi_node(state: dict) -> dict:
    ctx = _run_specialist(state, "roi_analyst", _ROI_SYS, ["project_roi"])
    roi = ensure_roi(ctx)
    return {"roi": roi, "inp": ctx.inp, "completed": _mark(state, "roi_analyst"),
            "agent_steps": ctx.steps, "tool_ledger": ctx.ledger}
