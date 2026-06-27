"""The deterministic stage functions of the synchronous pipeline.

Each node is a pure `state -> partial-state` step. Only `_classify_node` and
`_architect_node` may touch an LLM — the classifier to label fuzzy use cases, the
architect to pick a delivery-platform *label*. Every downstream node is pure
arithmetic from `engine.py`, so the resulting Estimation is fully reproducible.
Both LLM-touching nodes fall back to deterministic heuristics that yield the same
inputs, so the numbers are identical with or without a provider configured.
"""

from __future__ import annotations

from ..shared import engine
from ..shared.architect import propose_solution
from ..shared.classifier import classify_use_cases
from ..shared.schemas import TechnicalPreferences
from .state import GraphState


def _classify_node(state: GraphState) -> dict:
    inp = state["inp"]
    classified = classify_use_cases(inp.ai_use_cases)
    return {"inp": inp.model_copy(update={"ai_use_cases": classified})}


def _architect_node(state: GraphState) -> dict:
    """ReAct agent picks the delivery platform, then writes it onto the input.

    Resolving `delivery_platform` here means the deterministic cost engine prices
    exactly the platform the agent chose — the LLM selects a label, code computes
    every dollar. The heuristic fallback writes the same value `classify_platform`
    would infer, so the numbers are unchanged when no LLM runs.
    """
    inp = state["inp"]
    proposal = propose_solution(inp)
    platform = proposal["recommended_platform"]
    tp = inp.technical_preferences
    new_tp = (
        tp.model_copy(update={"delivery_platform": platform})
        if tp is not None
        else TechnicalPreferences(delivery_platform=platform)
    )
    return {"inp": inp.model_copy(update={"technical_preferences": new_tp}), "proposal": proposal}


def _feasibility_node(state: GraphState) -> dict:
    return {"feasibility": engine.score_feasibility(state["inp"])}


def _cost_node(state: GraphState) -> dict:
    return {"cost": engine.compute_cost(state["inp"], state["feasibility"])}


def _tokens_node(state: GraphState) -> dict:
    return {"tokens": engine.project_tokens(state["inp"])}


def _compare_node(state: GraphState) -> dict:
    return {"comparison": engine.compare_approaches(state["inp"], state["feasibility"], state["cost"])}


def _roi_node(state: GraphState) -> dict:
    return {"roi": engine.project_roi(state["inp"], state["feasibility"], state["cost"])}


def _report_node(state: GraphState) -> dict:
    inp = state["inp"]
    feas = state["feasibility"]
    cost = state["cost"]
    comparison = state["comparison"]
    estimation = {
        "id": state["est_id"],
        "project_id": inp.project_name,
        "project_name": inp.project_name,
        "project_type": inp.project_type,
        "industry_domain": inp.industry_domain,
        "feasibility": feas,
        "verdict": engine.derive_verdict(feas, comparison),
        "confidence": engine.assess_confidence(inp, feas),
        "cost_breakdown": cost,
        "token_projection": state["tokens"],
        "comparison": comparison,
        "roi_projection": state["roi"],
        "recommendations": engine.build_recommendations(inp, feas),
        "report_markdown": engine.compose_markdown(inp, feas, cost),
        "status": "complete",
        "generated_at": state["generated_at"],
        "repo_context": engine._build_repo_context(inp),
        "solution_proposal": state.get("proposal"),
    }
    return {"estimation": estimation}
