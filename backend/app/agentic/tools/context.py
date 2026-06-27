"""Tool primitives: the hashing helper, the shared context, and the Tool type.

These are the structural pieces of the deterministic tool layer, kept separate
from the catalogue of concrete tools so the ReAct executor and the agents can
depend on the *shapes* (`Tool`, `ToolContext`) without importing the whole engine
surface.
"""

from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass, field
from typing import Any, Callable

from ...shared.schemas import ProjectInput


def canonical_hash(obj: Any) -> str:
    """Stable SHA-256 over a JSON-serialisable result (order-independent)."""
    blob = json.dumps(obj, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


@dataclass
class ToolContext:
    """Shared scratchpad threaded through one specialist's tool calls.

    `inp` is mutable: a write-tool (e.g. set_platform) resolves an input field on
    a *copy* and rebinds it here, mirroring how the classifier resolves task_type.
    `artifacts` memoises deterministic results so a number is computed at most
    once. `steps`/`ledger` accumulate the transcript and the audit trail as plain
    dicts (validated into AgentStep/ToolCall at the graph boundary).
    """

    inp: ProjectInput
    agent: str = ""
    artifacts: dict[str, Any] = field(default_factory=dict)
    steps: list[dict] = field(default_factory=list)
    ledger: list[dict] = field(default_factory=list)

    def _record(self, tool: str, result: Any) -> None:
        self.ledger.append({"agent": self.agent, "tool": tool, "outputHash": canonical_hash(result)})


@dataclass
class Tool:
    name: str
    description: str
    parameters: dict  # JSON schema for native function-calling
    run: Callable[["ToolContext", dict], Any]
    writes: bool = False
