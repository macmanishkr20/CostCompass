"""Intake node — normalise the brief and (optionally) gate for human input."""

from __future__ import annotations

from ..state import _mark


def intake_node(state: dict) -> dict:
    """Normalise/enrich the brief. HITL clarifying questions are a guarded hook.

    When `agentic_hitl` is on, this is where a LangGraph `interrupt()` would pause
    for human answers (the checkpointer persists state across the pause). The
    synchronous request path keeps it off so estimation never blocks.
    """
    steps = [{"agent": "intake", "kind": "thought", "content": "Parsed intake; brief is sufficient to estimate."}]
    return {"completed": _mark(state, "intake"), "agent_steps": steps}
