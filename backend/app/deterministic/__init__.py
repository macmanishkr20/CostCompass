"""Deterministic estimation subsystem — the synchronous, fixed-DAG pipeline.

This is the baseline strategy and the always-safe fallback for the agentic graph.
It runs a straight line of pure engine stages (classify → architect → feasibility
→ cost → tokens → compare → roi → report) with no supervisor, no reflection and
no branching: the order *is* the contract, so every run is fully reproducible.

Layout (mirrors the agentic package, by concern):

    deterministic/
      state.py   # the GraphState carried along the line
      nodes.py   # the stage functions (only classify/architect may touch an LLM)
      graph.py   # LangGraph assembly + run_pipeline (entrypoint)

Public API: `run_pipeline`.
"""

from .graph import run_pipeline

__all__ = ["run_pipeline"]
