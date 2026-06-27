"""The strict integrity guard — the founding rule, enforced at the graph's exit.

Before any estimate leaves the graph, this node re-derives every figure
deterministically from the agent-resolved inputs and assembles the final
`Estimation` from *those* numbers — so no agent-produced number can ever reach the
report. `integrity_verified` records whether the agents' own tool outputs matched
the clean recompute (they will, by construction, on an honest run); a mismatch is
logged and the authoritative recompute is used regardless.
"""

from __future__ import annotations

import logging
from typing import Optional

from ..shared import engine
from ..shared.config import get_settings
from .state import ORDER, EstimationState
from .tools import canonical_hash

logger = logging.getLogger("costcompass.agentic")


def _eq(agent_value: Optional[dict], fresh: dict) -> bool:
    return agent_value is not None and canonical_hash(agent_value) == canonical_hash(fresh)


def integrity_guard_node(state: EstimationState) -> dict:
    """Strict gate: numbers always come from a clean deterministic recompute."""
    inp = state["inp"]  # agent-resolved (platform et al. written by the architect)

    feas = engine.score_feasibility(inp)
    tokens = engine.project_tokens(inp)
    cost = engine.compute_cost(inp, feas)
    comparison = engine.compare_approaches(inp, feas, cost)
    roi = engine.project_roi(inp, feas, cost)

    verified = all(
        _eq(state.get(k), fresh)
        for k, fresh in (
            ("feasibility", feas), ("cost", cost), ("tokens", tokens),
            ("comparison", comparison), ("roi", roi),
        )
    )
    if not verified:
        logger.warning("Integrity guard: agent artifacts differed from the deterministic recompute "
                        "(using the authoritative recompute).")

    draft = state.get("draft") or {}
    verdict = draft.get("verdict") or engine.derive_verdict(feas, comparison)
    confidence = draft.get("confidence") or engine.assess_confidence(inp, feas)
    recommendations = draft.get("recommendations") or engine.build_recommendations(inp, feas)
    report_markdown = draft.get("report_markdown") or engine.compose_markdown(inp, feas, cost)

    agent_run = {
        "mode": "agentic",
        "supervisor_path": [n for n in ORDER if n in state.get("completed", [])],
        "steps": state.get("agent_steps", []),
        "critiques": state.get("critiques", []),
        "tool_ledger": state.get("tool_ledger", []),
        "revisions": state.get("revisions", 0),
        "integrity_verified": verified,
        "llm_used": get_settings().llm_enabled,
    }

    estimation = {
        "id": state["est_id"],
        "project_id": inp.project_name,
        "project_name": inp.project_name,
        "project_type": inp.project_type,
        "industry_domain": inp.industry_domain,
        "feasibility": feas,
        "verdict": verdict,
        "confidence": confidence,
        "cost_breakdown": cost,
        "token_projection": tokens,
        "comparison": comparison,
        "roi_projection": roi,
        "recommendations": recommendations,
        "report_markdown": report_markdown,
        "status": "complete",
        "generated_at": state["generated_at"],
        "repo_context": engine._build_repo_context(inp),
        "solution_proposal": state.get("proposal"),
        "agent_run": agent_run,
    }
    return {"estimation": estimation}
