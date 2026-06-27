"""Shared machinery for building a specialist ReAct agent node.

The four analytical specialists (feasibility, cost, comparison, ROI) are
structurally identical: hydrate a `ToolContext` from the current graph state, run
a focused tool-calling ReAct loop when an LLM is configured, then *guarantee* the
artifact by calling the engine tool directly. This module factors out that common
harness so each specialist node is just a system prompt plus a one-line
`ensure_*` call.

Every figure still comes from `engine.py` via a tool; agents own judgement,
ordering and narrative, never arithmetic.
"""

from __future__ import annotations

from ...shared.config import get_settings
from ..reasoning import run_react
from ..tools import TOOLS, ToolContext


def _ctx(state: dict, name: str) -> ToolContext:
    """Build a specialist's tool context, seeded with artifacts computed so far."""
    ctx = ToolContext(inp=state["inp"], agent=name)
    for k in ("feasibility", "cost", "tokens", "comparison", "roi"):
        v = state.get(k)
        if v:
            ctx.artifacts[k] = v
    return ctx


def _brief(inp) -> str:
    """The shared natural-language brief handed to every specialist."""
    ucs = ", ".join(f"{u.name} [{u.task_type or 'unclassified'}]" for u in (inp.ai_use_cases or [])) or "none specified"
    return (
        f"Project: {inp.project_name} ({inp.project_type})\n"
        f"Domain: {inp.industry_domain or 'unspecified'}\n"
        f"Description: {inp.description or '(none)'}\n"
        f"Scale: {inp.scale}\n"
        f"AI use cases: {ucs}\n\n"
        "Use your tools to gather facts, then finish your analysis. "
        "Never state a number you did not get from a tool."
    )


def _run_specialist(state: dict, name: str, system: str, tool_names: list[str]) -> ToolContext:
    """Run a specialist's ReAct loop if an LLM is configured; always return ctx."""
    ctx = _ctx(state, name)
    if get_settings().llm_enabled:
        run_react(system=system, user=_brief(ctx.inp), tools=[TOOLS[n] for n in tool_names], ctx=ctx, agent_name=name)
    else:
        ctx.steps.append(
            {"agent": name, "kind": "fallback", "content": "No LLM configured — running deterministic engine tools."}
        )
    return ctx
