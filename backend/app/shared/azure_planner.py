"""Azure service planner — decides *which* services an estimate needs.

This is the second (and only other) place an LLM touches the pipeline. Given the
project description, use cases, scale and compliance, Claude picks a subset of
the catalog's service keys. When no key is configured — or the call fails — a
deterministic rule set (`ServiceSpec.select`) chooses instead. Either way the
planner only returns *labels from the fixed catalog*; it never prices anything.

For enhancement projects the candidate set is narrowed to the "net-new" services
(`ServiceSpec.net_new`), so the estimate counts only the *extra* Azure services
the AI work requires on top of the existing application.
"""

from __future__ import annotations

import json
import logging

from .azure_catalog import CATEGORY_ORDER, SERVICE_SPECS, SPEC_BY_KEY, PlanContext, ServiceSpec
from .config import get_settings
from .schemas import ProjectInput

logger = logging.getLogger("costcompass.azure_planner")


def _candidate_specs(ctx: PlanContext) -> list[ServiceSpec]:
    """Services eligible for this project (all for new builds, net-new for enhancements)."""
    if ctx.project_type == "enhancement":
        return [s for s in SERVICE_SPECS if s.net_new]
    return list(SERVICE_SPECS)


def _rule_keys(ctx: PlanContext, candidates: list[ServiceSpec]) -> set[str]:
    """Deterministic selection: every candidate whose rule fires."""
    return {s.key for s in candidates if s.select(ctx)}


def _mandatory_keys(ctx: PlanContext, candidate_keys: set[str]) -> set[str]:
    """Floor the LLM can't remove — without these the estimate is incoherent."""
    req: set[str] = set()
    if ctx.project_type != "enhancement":
        for k in ("app_hosting", "database", "monitor"):
            if k in candidate_keys:
                req.add(k)
    if ctx.uses_azure_openai and "openai" in candidate_keys:
        req.add("openai")
    if ctx.needs_search and "ai_search" in candidate_keys:
        req.add("ai_search")
    return req


def _select_with_claude(inp: ProjectInput, ctx: PlanContext, candidates: list[ServiceSpec]) -> set[str] | None:
    """Ask Claude which service keys apply. Returns None on any failure."""
    settings = get_settings()
    try:
        from anthropic import Anthropic
    except Exception:  # pragma: no cover - SDK always present per requirements
        return None

    client_kwargs: dict = {"api_key": settings.anthropic_api_key}
    if settings.anthropic_base_url:
        client_kwargs["base_url"] = settings.anthropic_base_url

    allowed = {s.key for s in candidates}
    menu = "\n".join(f"- {s.key}: {s.name} — {s.purpose}" for s in candidates)
    use_cases = ", ".join(sorted(ctx.task_types)) or "none specified"
    mode = (
        "This is an ENHANCEMENT of an existing app: choose ONLY the extra Azure services the AI "
        "work newly requires; assume hosting, database, networking and monitoring already exist."
        if ctx.project_type == "enhancement"
        else "This is a NEW build from scratch: include every Azure service the app needs, even small ones."
    )
    prompt = (
        "You are an Azure solution architect sizing the infrastructure for a software project.\n"
        f"{mode}\n\n"
        f"Project: {inp.project_name}\n"
        f"Description: {inp.description or '(none)'}\n"
        f"Scale: {ctx.scale}; ~{ctx.requests_per_day} requests/day; ~{ctx.data_gb:g} GB data.\n"
        f"AI task types: {use_cases}.\n"
        f"Compliance: {', '.join(ctx.compliance) or 'none'}.\n\n"
        "Pick the applicable services from this catalog (use the keys exactly):\n"
        f"{menu}\n\n"
        'Respond with ONLY a JSON array of the chosen keys, e.g. ["app_hosting","database","openai"]. No prose.'
    )

    try:
        client = Anthropic(**client_kwargs)
        msg = client.messages.create(
            model=settings.classifier_model,
            max_tokens=400,
            messages=[{"role": "user", "content": prompt}],
        )
        raw = "".join(b.text for b in msg.content if getattr(b, "type", None) == "text").strip()
        if raw.startswith("```"):
            raw = raw.strip("`").split("\n", 1)[-1]
        start, end = raw.find("["), raw.rfind("]")
        parsed = json.loads(raw[start : end + 1])
        chosen = {k for k in parsed if isinstance(k, str) and k in allowed}
        return chosen or None
    except Exception as exc:  # noqa: BLE001 - any failure means fall back to rules
        logger.warning("Claude service selection failed, using rules: %s", exc)
        return None


def select_services(inp: ProjectInput, ctx: PlanContext) -> list[ServiceSpec]:
    """Return the ordered list of ServiceSpecs to price for this project."""
    candidates = _candidate_specs(ctx)
    candidate_keys = {s.key for s in candidates}

    chosen: set[str] | None = None
    if get_settings().llm_enabled:
        chosen = _select_with_claude(inp, ctx, candidates)
    if chosen is None:
        chosen = _rule_keys(ctx, candidates)

    chosen |= _mandatory_keys(ctx, candidate_keys)

    # Stable display order: by category flow, then catalog order within a category.
    rank = {c: i for i, c in enumerate(CATEGORY_ORDER)}
    ordered = sorted(
        (SPEC_BY_KEY[k] for k in chosen if k in SPEC_BY_KEY),
        key=lambda s: (rank.get(s.category, 99), SERVICE_SPECS.index(s)),
    )
    return ordered
