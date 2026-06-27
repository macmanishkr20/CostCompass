"""The agentic estimation graph (LangGraph) — wiring and entrypoint.

Topology — a supervisor that dynamically routes among specialist ReAct agents,
with a bounded reflection loop and a final integrity gate:

    START → intake → supervisor ⇄ {solution_architect, feasibility_analyst,
            cost_engineer, comparison_analyst, roi_analyst,
            report_synthesizer, risk_critic} → integrity_guard → END

The supervisor decides the next hop at runtime (that dynamic control flow is what
makes this *agentic* rather than a fixed DAG); the integrity guard re-derives
every figure deterministically before the estimate leaves the graph.
"""

from __future__ import annotations

from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import END, START, StateGraph

from ..shared.schemas import Estimation, ProjectInput
from .agents import (
    architect_node,
    comparison_node,
    cost_node,
    critic_node,
    feasibility_node,
    intake_node,
    report_node,
    roi_node,
)
from .integrity import integrity_guard_node
from .state import EstimationState
from .supervisor import supervisor_node


def _route(state: EstimationState) -> str:
    return state.get("next_agent", "FINISH")


_WORKERS = [
    "solution_architect", "feasibility_analyst", "cost_engineer",
    "comparison_analyst", "roi_analyst", "report_synthesizer", "risk_critic",
]


def _build_agentic_graph():
    g = StateGraph(EstimationState)
    g.add_node("intake", intake_node)
    g.add_node("supervisor", supervisor_node)
    g.add_node("solution_architect", architect_node)
    g.add_node("feasibility_analyst", feasibility_node)
    g.add_node("cost_engineer", cost_node)
    g.add_node("comparison_analyst", comparison_node)
    g.add_node("roi_analyst", roi_node)
    g.add_node("report_synthesizer", report_node)
    g.add_node("risk_critic", critic_node)
    g.add_node("integrity_guard", integrity_guard_node)

    g.add_edge(START, "intake")
    g.add_edge("intake", "supervisor")
    for n in _WORKERS:
        g.add_edge(n, "supervisor")
    g.add_conditional_edges(
        "supervisor",
        _route,
        {**{n: n for n in _WORKERS}, "FINISH": "integrity_guard"},
    )
    g.add_edge("integrity_guard", END)
    return g.compile(checkpointer=MemorySaver())


# Compiled once at import; stateless across invocations (per-run state lives in
# the checkpointer keyed by thread_id).
_GRAPH = _build_agentic_graph()


def run_agentic_pipeline(inp: ProjectInput, est_id: str, generated_at: str) -> Estimation:
    """Execute the supervisor graph and return a validated Estimation."""
    init: EstimationState = {
        "inp": inp,
        "est_id": est_id,
        "generated_at": generated_at,
        "completed": [],
        "revisions": 0,
    }
    config = {"configurable": {"thread_id": est_id}, "recursion_limit": 60}
    final = _GRAPH.invoke(init, config)
    return Estimation.model_validate(final["estimation"])
