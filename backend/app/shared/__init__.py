"""Shared domain core — the common library both estimation strategies build on.

Everything here is independent of *how* an estimate is orchestrated (synchronous
DAG vs. agentic graph). It is the single source of truth for the numbers and the
domain knowledge:

    config.py          # environment-driven settings (incl. the AI flags)
    schemas.py         # the Pydantic DTOs (ProjectInput, Estimation, …)
    engine.py          # the deterministic compute engine — every figure
    architect.py       # the solution-architect agent (delivery-platform choice)
    classifier.py      # use-case → task-type classification
    platforms.py       # delivery-platform strategy & profiles
    catalog.py         # domain constants (task types, scale factors)
    azure_catalog.py   # Azure service specs
    azure_planner.py   # Azure service selection
    azure_pricing.py   # Azure retail-price lookups

Both `app.deterministic` and `app.agentic` depend on this package; it depends on
neither. That one-directional rule keeps the two strategies swappable and the
"LLM never computes a number" guarantee in one auditable place.
"""
