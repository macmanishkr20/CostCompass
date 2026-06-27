"""Risk-critic node — closes a bounded reflection loop over the draft estimate.

Deterministic checks scan the assembled draft for internal contradictions and
emit at most one HIGH-severity issue (compliance vs. platform, or verdict vs.
AI-necessity). A HIGH issue lets the supervisor route back once to the
responsible specialist to fix it; a compliance/platform conflict also sets
`force_platform` so the architect's re-run converges. Everything else is
informational, so the loop always terminates.
"""

from __future__ import annotations

from ..state import _mark

# Compliance keywords that imply a data-resident / self-hosted deployment.
_RESIDENCY_SIGNALS = (
    "residency", "resident", "sovereign", "air-gap", "air gap",
    "on-prem", "on prem", "on-premise", "hipaa", "gdpr", "pci",
)


def _crit(issue: str, severity: str, target: str) -> dict:
    return {"issue": issue, "severity": severity, "target": target, "resolved": False}


def critic_node(state: dict) -> dict:
    inp = state["inp"]
    feas = state["feasibility"]
    roi = state["roi"]
    draft = state.get("draft", {})
    verdict = draft.get("verdict", {})
    proposal = state.get("proposal", {})

    open_crit: list[dict] = []
    updates: dict = {}

    if verdict.get("decision") == "build_with_ai" and feas["sub_scores"]["ai_necessity"] < 35:
        open_crit.append(_crit("Verdict recommends building with AI, but AI-necessity scores low.",
                               "high", "feasibility_analyst"))

    tp = inp.technical_preferences
    compliance = [c.lower() for c in (tp.compliance_requirements if tp else [])]
    blob = " ".join(compliance)
    needs_resident = any(k in blob for k in _RESIDENCY_SIGNALS)
    platform = tp.delivery_platform if tp else None
    explicit = proposal.get("source") == "explicit"
    if needs_resident and platform != "on_prem" and not explicit and not state.get("force_platform"):
        open_crit.append(_crit(
            f"Compliance ({', '.join(compliance)}) implies data residency, but the platform is "
            f"'{platform}'. An on-premises deployment fits better.",
            "high", "solution_architect"))
        updates["force_platform"] = "on_prem"

    if verdict.get("decision") == "build_with_ai" and roi.get("payback_months") is None:
        open_crit.append(_crit("Verdict is go, but ROI shows no payback within the horizon — flag the assumption.",
                               "medium", "roi_analyst"))

    steps = (
        [{"agent": "risk_critic", "kind": "critique", "content": c["issue"]} for c in open_crit]
        or [{"agent": "risk_critic", "kind": "thought", "content": "No blocking inconsistencies found."}]
    )
    return {"open_critiques": open_crit, "critiques": open_crit, "completed": _mark(state, "risk_critic"),
            "agent_steps": steps, **updates}
