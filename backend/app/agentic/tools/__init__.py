"""The deterministic tool layer.

Public surface:

* `Tool`, `ToolContext`, `canonical_hash` — the structural primitives.
* `TOOLS`, `run_tool` — the catalogue and its dispatcher (used by the ReAct
  executor).
* `ensure_*`, `set_platform` — direct engine-backed helpers the specialist nodes
  call to *guarantee* their artifact even when no LLM is available.
"""

from .catalog import (
    TOOLS,
    ensure_comparison,
    ensure_cost,
    ensure_feasibility,
    ensure_roi,
    ensure_tokens,
    run_tool,
    set_platform,
)
from .context import Tool, ToolContext, canonical_hash

__all__ = [
    "Tool",
    "ToolContext",
    "canonical_hash",
    "TOOLS",
    "run_tool",
    "set_platform",
    "ensure_feasibility",
    "ensure_tokens",
    "ensure_cost",
    "ensure_comparison",
    "ensure_roi",
]
