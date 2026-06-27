"""The supervisor — the dynamic router that makes this agentic, not a DAG.

A forward pass picks the next uncompleted specialist from `ORDER`. After the
critic runs, if a HIGH-severity issue is still open and the revision budget
remains, the supervisor truncates the pipeline back to the responsible specialist
(clearing the artifacts produced at/after it) so the fix propagates on re-run.
Otherwise it FINISHes into the strict integrity guard. Deciding the next hop at
runtime — rather than along fixed edges — is what makes the graph agentic.
"""

from __future__ import annotations

from ..shared.config import get_settings
from .state import ORDER, _clear_artifacts_from, _next_for


def supervisor_node(state: dict) -> dict:
    """Dynamic router: walk the specialist order forward, then reflect once."""
    completed = list(state.get("completed", []))
    nxt = _next_for(completed)
    if nxt is not None:
        return {"next_agent": nxt, "agent_steps": [{"agent": "supervisor", "kind": "route", "content": f"→ {nxt}"}]}

    open_high = [c for c in state.get("open_critiques", []) if c.get("severity") == "high" and not c.get("resolved")]
    budget = get_settings().agentic_max_revisions
    if open_high and state.get("revisions", 0) < budget:
        target = open_high[0]["target"]
        if target in ORDER:
            keep = [n for n in completed if ORDER.index(n) < ORDER.index(target)]
            rev = state.get("revisions", 0) + 1
            cleared = _clear_artifacts_from(target)
            return {
                "next_agent": target,
                "completed": keep,
                "revisions": rev,
                "open_critiques": [],
                **cleared,
                "agent_steps": [{"agent": "supervisor", "kind": "route",
                                 "content": f"Revision {rev}: re-running {target} to resolve — {open_high[0]['issue']}"}],
            }

    return {"next_agent": "FINISH",
            "agent_steps": [{"agent": "supervisor", "kind": "decision",
                             "content": "Analysis complete → strict integrity guard."}]}
