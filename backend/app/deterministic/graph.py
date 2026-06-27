"""The synchronous estimation graph (LangGraph) — wiring and entrypoint.

A small StateGraph wires the deterministic engine stages into a fixed line:

    classify → architect → feasibility → cost → tokens → compare → roi → report

There is no supervisor and no branching — the order is the contract. The graph
gives a clean place to stream per-node progress over SSE and keeps each stage
independently testable; every figure is computed by `engine.py`.
"""

from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from ..shared.schemas import Estimation, ProjectInput
from .nodes import (
    _architect_node,
    _classify_node,
    _compare_node,
    _cost_node,
    _feasibility_node,
    _report_node,
    _roi_node,
    _tokens_node,
)
from .state import GraphState


def _build_graph():
    g = StateGraph(GraphState)
    g.add_node("classify", _classify_node)
    g.add_node("architect", _architect_node)
    g.add_node("feasibility", _feasibility_node)
    g.add_node("cost", _cost_node)
    g.add_node("tokens", _tokens_node)
    g.add_node("compare", _compare_node)
    g.add_node("roi", _roi_node)
    g.add_node("report", _report_node)

    g.add_edge(START, "classify")
    g.add_edge("classify", "architect")
    g.add_edge("architect", "feasibility")
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
    """Execute the deterministic graph and return a validated Estimation."""
    final = _GRAPH.invoke({"inp": inp, "est_id": est_id, "generated_at": generated_at})
    return Estimation.model_validate(final["estimation"])
