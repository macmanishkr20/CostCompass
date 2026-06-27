"""The shared graph state and the specialist-progression contract.

`EstimationState` is the single object threaded through every node of the agentic
graph. It carries three kinds of field:

* **Inputs / identity** — the (agent-resolvable) `ProjectInput`, the estimation id
  and timestamp.
* **Supervisor planning** — `completed`, `revisions`, `next_agent`,
  `force_platform`, `open_critiques`. Plain overwrite is safe because the graph is
  strictly sequential (no parallel nodes race on these).
* **Deterministic artifacts** — `feasibility`, `cost`, `tokens`, `comparison`,
  `roi`, `proposal`, `draft`. Each numeric artifact is written only by an engine
  tool, never by a model.
* **Append-only audit trail** — `agent_steps`, `tool_ledger`, `critiques` use the
  `_extend` reducer so every node's contribution accumulates.

This module also owns the *progression contract*: `ORDER` (the canonical
specialist sequence the supervisor walks), `_ARTIFACT_PRODUCER` (which specialist
owns which artifact, for route-back invalidation), and the small helpers that
advance or rewind the walk. Keeping these next to the state shape makes the
graph's structural invariants live in one place; the supervisor, the agents and
the integrity guard all import them from here.
"""

from __future__ import annotations

from typing import Annotated, Optional, TypedDict

from ..shared.schemas import ProjectInput


def _extend(a: list | None, b: list | None) -> list:
    """Append-only reducer for accumulating audit fields across nodes."""
    return (a or []) + (b or [])


class EstimationState(TypedDict, total=False):
    # Inputs / identity
    inp: ProjectInput
    est_id: str
    generated_at: str

    # Supervisor planning (plain overwrite — sequential graph, no races)
    completed: list[str]
    revisions: int
    next_agent: str
    force_platform: Optional[str]
    open_critiques: list[dict]

    # Deterministic artifacts (each written only by an engine tool)
    feasibility: Optional[dict]
    cost: Optional[dict]
    tokens: Optional[dict]
    comparison: Optional[dict]
    roi: Optional[dict]
    proposal: Optional[dict]
    draft: Optional[dict]

    # Accumulating audit trail (append-only reducers)
    agent_steps: Annotated[list, _extend]
    tool_ledger: Annotated[list, _extend]
    critiques: Annotated[list, _extend]

    estimation: Optional[dict]


# ── Progression contract ─────────────────────────────────────────────

# Canonical specialist order. The supervisor walks it forward and truncates it on
# a reflection route-back. Node names == completed-list keys == graph node ids.
ORDER = [
    "intake",
    "solution_architect",
    "feasibility_analyst",
    "cost_engineer",
    "comparison_analyst",
    "roi_analyst",
    "report_synthesizer",
    "risk_critic",
]

# Which specialist produces which numeric artifact (for route-back invalidation).
_ARTIFACT_PRODUCER = {
    "feasibility": "feasibility_analyst",
    "cost": "cost_engineer",
    "tokens": "cost_engineer",
    "comparison": "comparison_analyst",
    "roi": "roi_analyst",
}


def _mark(state: dict, name: str) -> list[str]:
    """Return `completed` with `name` appended (idempotent)."""
    done = list(state.get("completed", []))
    if name not in done:
        done.append(name)
    return done


def _next_for(completed: list[str]) -> str | None:
    """The next specialist in ORDER that has not run yet, or None when done."""
    for n in ORDER:
        if n not in completed:
            return n
    return None


def _clear_artifacts_from(target: str) -> dict:
    """State updates that drop every artifact produced at/after `target`."""
    ti = ORDER.index(target)
    return {a: None for a, prod in _ARTIFACT_PRODUCER.items() if ORDER.index(prod) >= ti}
