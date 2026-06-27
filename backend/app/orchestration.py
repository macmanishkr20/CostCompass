"""Estimation strategy selector — the single entry point the API calls.

Two interchangeable strategies produce an `Estimation` from a `ProjectInput`:

* the **deterministic** pipeline (`app.deterministic`) — a fixed synchronous DAG;
  the baseline and the always-safe fallback.
* the **agentic** graph (`app.agentic`) — a supervisor-routed multi-agent ReAct
  run, gated by `AGENTIC_MODE`.

`run_estimation` picks between them. The agentic path is wrapped so any failure
falls back to the deterministic pipeline — it is an enhancement, never a hard
dependency — and the strict integrity guard keeps the numbers identical either
way (both ultimately price the same resolved input through `engine.py`). This
module owns only the *selection*; neither pipeline imports the other.
"""

from __future__ import annotations

import logging
from typing import Any

from .shared.config import get_settings
from .deterministic import run_pipeline
from .shared.schemas import Estimation, ProjectInput

logger = logging.getLogger("costcompass.orchestration")


def run_estimation(inp: ProjectInput, est_id: str, generated_at: str) -> Estimation:
    """Route an estimation to the agentic graph when AGENTIC_MODE is on, else the
    deterministic pipeline. Falls back to deterministic on any agentic failure.
    """
    if get_settings().agentic_mode:
        try:
            from .agentic import run_agentic_pipeline

            return run_agentic_pipeline(inp, est_id, generated_at)
        except Exception:  # noqa: BLE001 - deterministic pipeline is the safety net
            logger.exception("Agentic pipeline failed; falling back to the deterministic pipeline.")
    return run_pipeline(inp, est_id, generated_at)


# Ordered SSE progress steps, mirroring the Angular mock's streaming UX.
SSE_STEPS: list[dict[str, Any]] = [
    {"node": "intake", "status": "processing", "content": "Parsing project intake…", "progress": 10},
    {"node": "architect", "status": "processing", "content": "Selecting the best-fit delivery platform…", "progress": 25},
    {"node": "feasibility", "status": "processing", "content": "Scoring AI necessity, agentic & traditional fit…", "progress": 40},
    {"node": "costing", "status": "processing", "content": "Computing development, infra & token costs…", "progress": 60},
    {"node": "comparison", "status": "processing", "content": "Comparing AI vs standard approaches…", "progress": 80},
    {"node": "report", "status": "processing", "content": "Composing the report…", "progress": 95},
]
