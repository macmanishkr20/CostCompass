"""Report-synthesizer node — derives the decisive verdict, confidence, narrative.

All four outputs are deterministic engine calls; the agent layer chooses *when*
to synthesize, the engine decides *what* the verdict is, so the narrative can
never drift from the numbers.
"""

from __future__ import annotations

from ...shared import engine
from ..state import _mark


def report_node(state: dict) -> dict:
    inp = state["inp"]
    feas = state["feasibility"]
    cost = state["cost"]
    comparison = state["comparison"]
    draft = {
        "verdict": engine.derive_verdict(feas, comparison),
        "confidence": engine.assess_confidence(inp, feas),
        "recommendations": engine.build_recommendations(inp, feas),
        "report_markdown": engine.compose_markdown(inp, feas, cost),
    }
    steps = [{"agent": "report_synthesizer", "kind": "thought",
              "content": f"Composed draft; verdict = {draft['verdict']['decision']}."}]
    return {"draft": draft, "completed": _mark(state, "report_synthesizer"), "agent_steps": steps}
