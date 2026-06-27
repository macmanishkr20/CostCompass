"""The state object threaded through the synchronous estimation graph.

A plain `TypedDict` carried node-to-node along a fixed linear DAG. Unlike the
agentic `EstimationState` there are no reducers or planning fields: the graph is
a straight line, each node writes its own artifact, and nothing is revisited.
"""

from __future__ import annotations

from typing import TypedDict

from ..shared.schemas import ProjectInput


class GraphState(TypedDict, total=False):
    inp: ProjectInput
    est_id: str
    generated_at: str
    proposal: dict
    feasibility: dict
    cost: dict
    tokens: dict
    comparison: dict
    roi: dict
    estimation: dict
