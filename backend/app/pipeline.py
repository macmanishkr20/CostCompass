"""LangGraph estimation pipeline.

A small StateGraph wires the deterministic engine stages together:

    classify → feasibility → cost → tokens → compare → roi → report

Only the classify node may call an LLM (to label fuzzy use cases). Every
downstream node is pure Python arithmetic from `engine.py`, so the resulting
Estimation is fully reproducible. The graph gives us a clean place to stream
per-node progress over SSE and to extend the flow later.
"""

from __future__ import annotations

from typing import Any, Optional, TypedDict

from langgraph.graph import END, START, StateGraph

from . import engine
from .classifier import classify_use_cases
from .schemas import Estimation, ProjectInput


class GraphState(TypedDict, total=False):
    inp: ProjectInput
    est_id: str
    generated_at: str
    feasibility: dict
    cost: dict
    tokens: dict
    comparison: dict
    roi: dict
    estimation: dict


def _classify_node(state: GraphState) -> dict:
    inp = state["inp"]
    classified = classify_use_cases(inp.ai_use_cases)
    return {"inp": inp.model_copy(update={"ai_use_cases": classified})}


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
    estimation = {
        "id": state["est_id"],
        "project_id": inp.project_name,
        "project_name": inp.project_name,
        "project_type": inp.project_type,
        "industry_domain": inp.industry_domain,
        "feasibility": feas,
        "cost_breakdown": cost,
        "token_projection": state["tokens"],
        "comparison": state["comparison"],
        "roi_projection": state["roi"],
        "recommendations": engine.build_recommendations(inp, feas),
        "report_markdown": engine.compose_markdown(inp, feas, cost),
        "status": "complete",
        "generated_at": state["generated_at"],
        "repo_context": engine._build_repo_context(inp),
    }
    return {"estimation": estimation}


def _build_graph():
    g = StateGraph(GraphState)
    g.add_node("classify", _classify_node)
    g.add_node("feasibility", _feasibility_node)
    g.add_node("cost", _cost_node)
    g.add_node("tokens", _tokens_node)
    g.add_node("compare", _compare_node)
    g.add_node("roi", _roi_node)
    g.add_node("report", _report_node)

    g.add_edge(START, "classify")
    g.add_edge("classify", "feasibility")
    g.add_edge("feasibility", "cost")
    g.add_edge("cost", "tokens")
    g.add_edge("tokens", "compare")
    g.add_edge("compare", "roi")
    g.add_edge("roi", "report")
    g.add_edge("report", END)
    return g.compile()


# Compiled once at import; the graph is stateless across invocations.
_GRAPH = _build_graph()


def run_pipeline(inp: ProjectInput, est_id: str, generated_at: str) -> Estimation:
    """Execute the full graph and return a validated Estimation."""
    final = _GRAPH.invoke({"inp": inp, "est_id": est_id, "generated_at": generated_at})
    return Estimation.model_validate(final["estimation"])


# Ordered SSE progress steps, mirroring the Angular mock's streaming UX.
SSE_STEPS: list[dict[str, Any]] = [
    {"node": "intake", "status": "processing", "content": "Parsing project intake…", "progress": 10},
    {"node": "feasibility", "status": "processing", "content": "Scoring AI necessity, agentic & traditional fit…", "progress": 35},
    {"node": "costing", "status": "processing", "content": "Computing development, infra & token costs…", "progress": 60},
    {"node": "comparison", "status": "processing", "content": "Comparing AI vs standard approaches…", "progress": 80},
    {"node": "report", "status": "processing", "content": "Composing the report…", "progress": 95},
]
