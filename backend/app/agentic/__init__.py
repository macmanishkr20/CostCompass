"""Agentic estimation subsystem — a supervisor-routed, multi-agent ReAct graph.

This package is the AI-architecture layer of CostCompass. It is enabled by
`AGENTIC_MODE` and always falls back to the deterministic pipeline on any failure.

Layout (by architectural concern):

    agentic/
      state.py          # graph state + the specialist-progression contract
      supervisor.py     # the dynamic router (what makes this agentic)
      integrity.py      # the strict integrity guard (the founding rule)
      graph.py          # LangGraph assembly + run_agentic_pipeline (entrypoint)
      reasoning/        # the provider-agnostic tool-calling ReAct executor
      tools/            # the deterministic tool layer (the only source of numbers)
      agents/           # the specialist nodes (intake, architect, specialists,
                        #   synthesis, critic) built on the shared ReAct harness

Founding rule, preserved end-to-end: agents decide *what* to analyse, *how* to
interpret and *which* path to take; the deterministic tools compute *every*
number; the integrity guard re-derives the numbers and rejects any drift. The LLM
never moves a figure.

Public API: `run_agentic_pipeline`.
"""

from .graph import run_agentic_pipeline

__all__ = ["run_agentic_pipeline"]
