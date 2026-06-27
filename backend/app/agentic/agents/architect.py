"""Solution-architect node — resolves the delivery platform for the run.

This wraps the standalone ReAct solution architect (`app.architect`) as a graph
node and writes the chosen platform back onto the working input so every
downstream cost is priced against it. On a reflection route-back the critic may
set `force_platform`; honoring it here is the corrective action that makes the
reflection loop actually converge.
"""

from __future__ import annotations

from ...shared.architect import propose_solution
from ...shared.platforms import DEFAULT_PLATFORM, PLATFORM_PROFILES
from ...shared.schemas import TechnicalPreferences
from ..state import _mark


def _platform_proposal(platform: str, rationale: str, source: str = "agent") -> dict:
    profile = PLATFORM_PROFILES.get(platform) or PLATFORM_PROFILES[DEFAULT_PLATFORM]
    return {
        "recommended_platform": profile.key,
        "platform_label": profile.label,
        "cost_model": profile.cost_model,
        "rationale": rationale,
        "alternatives": [],
        "reasoning_steps": [],
        "source": source,
    }


def architect_node(state: dict) -> dict:
    """Solution architect — resolves the delivery platform (reuses the ReAct architect)."""
    inp = state["inp"]
    forced = state.get("force_platform")
    steps: list[dict] = []
    if forced:
        rationale = (
            f"Compliance constraints require a data-resident deployment, so the platform was revised to "
            f"{PLATFORM_PROFILES[forced].label} on the risk-critic's recommendation."
        )
        proposal = _platform_proposal(forced, rationale, source="agent")
        platform = forced
        steps.append({"agent": "solution_architect", "kind": "decision",
                      "content": f"Revised platform → {platform} (compliance-driven)."})
    else:
        proposal = propose_solution(inp)
        platform = proposal["recommended_platform"]
        steps.append({"agent": "solution_architect", "kind": "decision",
                      "content": f"Selected platform → {platform} (source: {proposal['source']})."})
        steps.extend(
            {"agent": "solution_architect", "kind": "thought", "content": s}
            for s in (proposal.get("reasoning_steps") or [])[:6]
        )

    tp = inp.technical_preferences
    new_tp = (
        tp.model_copy(update={"delivery_platform": platform})
        if tp is not None
        else TechnicalPreferences(delivery_platform=platform)
    )
    new_inp = inp.model_copy(update={"technical_preferences": new_tp})
    return {"inp": new_inp, "proposal": proposal, "completed": _mark(state, "solution_architect"), "agent_steps": steps}
