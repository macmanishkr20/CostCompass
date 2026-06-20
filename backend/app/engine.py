"""Deterministic estimation engine — the Python twin of estimation.service.ts.

Every dollar shown to leadership is computed here, never by an LLM, so the
figures are reproducible. The functions return plain snake_case dicts that
validate cleanly into the Pydantic `Estimation` model.

Parity note: JavaScript `Math.round` is half-up; Python's built-in `round`
is banker's rounding. We therefore use `jround`/`round2` (floor(n + 0.5))
so the backend reproduces the TypeScript engine's output exactly.
"""

from __future__ import annotations

import math

from .catalog import (
    DEV_HOURLY_RATE,
    HOURS_PER_DEV_WEEK,
    MAINT_HOURLY_RATE,
    COMPLEXITY_HOURS,
    MODEL_CATALOG,
    PRIORITY_WEIGHT,
    SCALE_APIM,
    SCALE_INFRA_BASE,
    SCALE_MAINT_HOURS,
    TASK_PROFILES,
    archetype_blurb,
    archetype_label,
    rating_for_score,
)
from .schemas import ProjectInput


# ── Parity helpers ──────────────────────────────────────────────────

def jround(n: float) -> int:
    """JS Math.round (half-up). All engine inputs are non-negative."""
    return math.floor(n + 0.5)


def round2(n: float) -> float:
    """Round to 2 decimals, half-up, matching Math.round(n*100)/100."""
    return math.floor(n * 100 + 0.5) / 100


def clamp(n: float, lo: float = 0, hi: float = 100) -> float:
    return max(lo, min(hi, n))


def _locale(n: float) -> str:
    """Approximate JS Number.toLocaleString() (en-US) for the report copy."""
    if isinstance(n, float) and not n.is_integer():
        return f"{n:,.3f}".rstrip("0").rstrip(".")
    return f"{int(n):,}"


# ── Input accessors (mirror TS `?.` / `??` semantics) ──────────────

def _profile(task_type: str | None):
    return TASK_PROFILES.get(task_type or "rag_qa", TASK_PROFILES["rag_qa"])


def _data_gb(inp: ProjectInput) -> float:
    vs = inp.volume_and_scale
    return vs.data_volume_gb if (vs and vs.data_volume_gb is not None) else 10


def _requests_per_day(inp: ProjectInput) -> int:
    vs = inp.volume_and_scale
    return vs.requests_per_day if (vs and vs.requests_per_day is not None) else 1000


def _growth(inp: ProjectInput) -> float:
    vs = inp.volume_and_scale
    return vs.growth_rate_percent if (vs and vs.growth_rate_percent is not None) else 0


def _currency(inp: ProjectInput) -> str:
    tp = inp.technical_preferences
    return (tp.budget_currency if tp else None) or "USD"


def _compliance(inp: ProjectInput) -> list[str]:
    tp = inp.technical_preferences
    return tp.compliance_requirements if tp else []


# ── Feasibility ─────────────────────────────────────────────────────

def compute_sub_scores(inp: ProjectInput) -> dict:
    use_cases = inp.ai_use_cases or []
    if len(use_cases) == 0:
        return {"ai_necessity": 18, "agentic_suitability": 12, "traditional_suitability": 86}

    w_sum = ai_n = agentic = trad = 0.0
    has_multi_agent = False
    for uc in use_cases:
        p = _profile(uc.task_type)
        w = PRIORITY_WEIGHT[uc.priority]
        w_sum += w
        ai_n += p["ai_n"] * w
        agentic += p["agentic"] * w
        trad += p["trad"] * w
        if uc.task_type == "multi_agent_orchestration":
            has_multi_agent = True
    ai_n /= w_sum
    agentic /= w_sum
    trad /= w_sum

    features = inp.features or []
    if features:
        ai_candidate_ratio = sum(1 for f in features if f.ai_candidate) / len(features)
    else:
        ai_candidate_ratio = 0.5
    ai_n += (ai_candidate_ratio - 0.5) * 16

    must_haves = sum(1 for u in use_cases if u.priority == "must_have")
    agentic += min(must_haves, 4) * 4
    if has_multi_agent:
        agentic += 8

    if len(use_cases) <= 1:
        trad += 10

    return {
        "ai_necessity": int(clamp(jround(ai_n))),
        "agentic_suitability": int(clamp(jround(agentic))),
        "traditional_suitability": int(clamp(jround(trad))),
    }


def pick_archetype(s: dict, use_cases: list) -> str:
    has_multi_agent = any(u.task_type == "multi_agent_orchestration" for u in use_cases)
    has_retrieval = any(u.task_type in ("rag_qa", "document_analysis") for u in use_cases)

    if s["ai_necessity"] < 35:
        return "traditional"
    if s["ai_necessity"] < 55:
        return "traditional_plus_ai"

    if s["agentic_suitability"] >= 72 and has_multi_agent:
        return "multi_agent"
    if s["agentic_suitability"] >= 58:
        return "single_agent"
    if has_retrieval:
        return "rag_assistant"
    if s["traditional_suitability"] >= 50:
        return "hybrid"
    return "rag_assistant"


def _archetype_rationale(a: str, s: dict) -> str:
    return (
        f"AI-necessity {s['ai_necessity']}, agentic-suitability {s['agentic_suitability']}, "
        f"traditional-suitability {s['traditional_suitability']}. {archetype_blurb(a)}"
    )


def _feasibility_rationale(s: dict, a: str) -> str:
    if a == "traditional":
        return (
            "The workload is well-defined and deterministic. AI would add operating cost "
            "and unpredictability without a clear accuracy or value gain."
        )
    if a == "multi_agent":
        return (
            "Multiple interdependent, multi-step tasks benefit from specialised agents "
            "coordinating — the value of autonomy outweighs the added orchestration cost."
        )
    return (
        f"A measured AI investment is justified here (necessity {s['ai_necessity']}/100), "
        "with the recommended pattern keeping run-cost proportional to the value delivered."
    )


def _build_risks(inp: ProjectInput, a: str) -> list[dict]:
    risks: list[dict] = []
    if a != "traditional":
        risks.append({
            "category": "Cost",
            "description": "Token spend can grow faster than usage if contexts or retries balloon.",
            "severity": "medium",
            "mitigation": "Set per-feature token budgets, cache, and alert on cost-per-request.",
        })
        risks.append({
            "category": "Quality",
            "description": "Model output variability may surface incorrect or inconsistent results.",
            "severity": "high",
            "mitigation": "Add an eval suite, human-in-the-loop on high-stakes paths, and guardrails.",
        })
    if a == "multi_agent":
        risks.append({
            "category": "Complexity",
            "description": "Multi-agent orchestration adds failure modes and debugging surface.",
            "severity": "high",
            "mitigation": "Start with the smallest agent set; add tracing and step-level retries.",
        })
    compliance = _compliance(inp)
    if compliance:
        risks.append({
            "category": "Compliance",
            "description": f"Data handling must satisfy: {', '.join(compliance)}.",
            "severity": "high",
            "mitigation": "Use private/regional model endpoints and data-residency-aware storage.",
        })
    if len(risks) == 0:
        risks.append({
            "category": "Scope",
            "description": "Requirements are deterministic; main risk is over-engineering.",
            "severity": "low",
            "mitigation": "Ship the standard build; revisit AI only with a measured use case.",
        })
    return risks


def _build_opportunities(a: str, use_cases: list) -> list[str]:
    if a == "traditional":
        return ["Bank the savings now; instrument the product to find a future AI use case with real signal."]
    ops = ["Phase the rollout: prove value on one use case before expanding."]
    if any(u.task_type == "rag_qa" for u in use_cases):
        ops.append("Reuse the retrieval layer across future assistant features.")
    if a in ("multi_agent", "single_agent"):
        ops.append("Capture agent traces to build an evaluation dataset over time.")
    ops.append("Negotiate committed-throughput pricing once volume stabilises.")
    return ops


def score_feasibility(inp: ProjectInput) -> dict:
    use_cases = inp.ai_use_cases or []
    sub = compute_sub_scores(inp)
    archetype = pick_archetype(sub, use_cases)
    composite = int(clamp(jround(
        0.55 * sub["ai_necessity"] + 0.3 * sub["agentic_suitability"] + 0.15 * (100 - sub["traditional_suitability"])
    )))

    use_case_analysis = []
    for uc in use_cases:
        p = _profile(uc.task_type)
        cx = "high" if p["agentic"] >= 70 else "medium" if p["agentic"] >= 40 else "low"
        task = uc.task_type or "rag_qa"
        use_case_analysis.append({
            "use_case_name": uc.name,
            "feasibility_score": int(clamp(jround(p["ai_n"] * 0.6 + p["agentic"] * 0.4))),
            "ai_task_type": task,
            "justification": (
                f"{uc.priority.replace('_', ' ', 1)} · best served by {p['model']} "
                f"given the {task.replace('_', ' ')} workload."
            ),
            "recommended_model": p["model"],
            "complexity": cx,
        })

    return {
        "score": composite,
        "rating": rating_for_score(composite),
        "sub_scores": sub,
        "archetype": archetype,
        "archetype_label": archetype_label(archetype),
        "archetype_rationale": _archetype_rationale(archetype, sub),
        "rationale": _feasibility_rationale(sub, archetype),
        "use_case_analysis": use_case_analysis,
        "risks": _build_risks(inp, archetype),
        "opportunities": _build_opportunities(archetype, use_cases),
    }


# ── Tokens ──────────────────────────────────────────────────────────

def model_token_breakdown(inp: ProjectInput) -> list[dict]:
    use_cases = inp.ai_use_cases or []
    if len(use_cases) == 0:
        return []
    total_requests_per_day = max(_requests_per_day(inp), len(use_cases))

    weights = [PRIORITY_WEIGHT[u.priority] for u in use_cases]
    w_total = sum(weights)

    by_model: dict[str, dict] = {}
    for i, uc in enumerate(use_cases):
        p = _profile(uc.task_type)
        daily_req = (total_requests_per_day * weights[i]) / w_total
        monthly_req = daily_req * 30
        entry = by_model.setdefault(p["model"], {"use_cases": [], "in_tok": 0.0, "out_tok": 0.0})
        entry["use_cases"].append(uc.name)
        entry["in_tok"] += monthly_req * p["in_tokens"]
        entry["out_tok"] += monthly_req * p["out_tokens"]

    result = []
    for model, e in by_model.items():
        price = MODEL_CATALOG[model]
        monthly_cost = round2((e["in_tok"] / 1e6) * price["in_per_1m"] + (e["out_tok"] / 1e6) * price["out_per_1m"])
        result.append({
            "model": model,
            "use_cases": e["use_cases"],
            "monthly_input_tokens": jround(e["in_tok"]),
            "monthly_output_tokens": jround(e["out_tok"]),
            "monthly_cost": monthly_cost,
            "input_price_per_1m": price["in_per_1m"],
            "output_price_per_1m": price["out_per_1m"],
        })
    return result


def project_tokens(inp: ProjectInput) -> dict:
    breakdown = model_token_breakdown(inp)
    monthly = sum(m["monthly_input_tokens"] + m["monthly_output_tokens"] for m in breakdown)
    daily = monthly / 30

    def mk(base: float) -> dict:
        return {"optimistic": jround(base * 0.7), "expected": jround(base), "pessimistic": jround(base * 1.6)}

    use_cases = inp.ai_use_cases or []
    model_recommendations = []
    for uc in use_cases:
        p = _profile(uc.task_type)
        cat = MODEL_CATALOG[p["model"]]
        task = uc.task_type or "rag_qa"
        model_recommendations.append({
            "use_case": uc.name,
            "provider": cat["provider"],
            "recommended_model": p["model"],
            "rationale": f"{task.replace('_', ' ')} ≈ {p['in_tokens']}/{p['out_tokens']} in/out tokens per call.",
            "avg_input_tokens": p["in_tokens"],
            "avg_output_tokens": p["out_tokens"],
        })

    return {
        "daily": mk(daily),
        "monthly": mk(monthly),
        "annual": mk(monthly * 12),
        "model_recommendations": model_recommendations,
        "assumptions": [
            f"{_requests_per_day(inp)} requests/day at launch",
            f"{jround(_growth(inp)) if float(_growth(inp)).is_integer() else _growth(inp)}% projected growth",
            "Pessimistic scenario assumes 60% higher volume and longer contexts",
        ],
    }


# ── Cost ────────────────────────────────────────────────────────────

def compute_cost(inp: ProjectInput, feas: dict) -> dict:
    features = inp.features or []
    use_cases = inp.ai_use_cases or []
    currency = _currency(inp)

    feature_breakdown = []
    for f in features:
        hours = COMPLEXITY_HOURS.get(f.complexity, 64)
        feature_breakdown.append({"category": f.name, "hours": hours, "cost": jround(hours * DEV_HOURLY_RATE)})

    ai_integration_hours = 0.0
    for uc in use_cases:
        base = 80 if uc.priority == "must_have" else 48 if uc.priority == "nice_to_have" else 28
        cx = 1.4 if _profile(uc.task_type)["agentic"] >= 70 else 1
        ai_integration_hours += base * cx
    if ai_integration_hours > 0:
        feature_breakdown.append({
            "category": "AI integration & evaluation",
            "hours": jround(ai_integration_hours),
            "cost": jround(ai_integration_hours * DEV_HOURLY_RATE),
        })

    if inp.project_type == "enhancement":
        framework = (inp.current_architecture.framework if inp.current_architecture else "") or "existing app"
        integration_hours = jround(40 + len(use_cases) * 24)
        feature_breakdown.append({
            "category": f"Integrate with existing {framework}",
            "hours": integration_hours,
            "cost": jround(integration_hours * DEV_HOURLY_RATE),
        })

    total_dev_hours = sum(b["hours"] for b in feature_breakdown)
    development_cost = jround(total_dev_hours * DEV_HOURLY_RATE)

    scale = inp.scale or "medium"
    data_gb = _data_gb(inp)
    needs_search = any(u.task_type in ("rag_qa", "document_analysis") for u in use_cases)
    services = [
        {"service_name": "Azure Container Apps", "tier": scale, "monthly_cost": SCALE_INFRA_BASE[scale], "details": "App + API hosting, autoscaling"},
        {"service_name": "Azure Cosmos DB", "tier": "Serverless", "monthly_cost": jround(40 + data_gb * 0.25), "details": f"~{data_gb} GB operational data"},
        {"service_name": "Azure Blob Storage", "tier": "Hot", "monthly_cost": round2(max(2, data_gb * 0.021)), "details": "Artifacts, exports, raw documents"},
        {"service_name": "Application Insights", "tier": "Pay-as-you-go", "monthly_cost": jround(30 + _requests_per_day(inp) * 0.00002), "details": "Telemetry & monitoring"},
    ]
    if SCALE_APIM[scale] > 0:
        services.append({"service_name": "API Management", "tier": scale, "monthly_cost": SCALE_APIM[scale], "details": "Gateway, throttling, keys"})
    if needs_search:
        services.append({
            "service_name": "Azure AI Search",
            "tier": "Basic" if scale == "small" else "Standard",
            "monthly_cost": 75 if scale == "small" else 250,
            "details": "Vector + keyword retrieval for RAG",
        })
    infra_monthly = jround(sum(x["monthly_cost"] for x in services))

    model_breakdown = model_token_breakdown(inp)
    monthly_token_cost = round2(sum(m["monthly_cost"] for m in model_breakdown))
    monthly_tokens = sum(m["monthly_input_tokens"] + m["monthly_output_tokens"] for m in model_breakdown)

    maint_hours = SCALE_MAINT_HOURS.get(scale, 24) + len(use_cases) * 4
    maint_monthly = jround(maint_hours * MAINT_HOURLY_RATE)

    annual_run = (infra_monthly + monthly_token_cost + maint_monthly) * 12
    expected = jround(development_cost + annual_run)

    return {
        "development": {
            "ai_integration_hours": jround(ai_integration_hours),
            "hourly_rate": DEV_HOURLY_RATE,
            "total_cost": development_cost,
            "breakdown": feature_breakdown,
        },
        "infrastructure": {
            "monthly_cost": infra_monthly,
            "annual_cost": infra_monthly * 12,
            "services": services,
        },
        "ai_tokens": {
            "monthly_tokens": {"optimistic": jround(monthly_tokens * 0.7), "expected": jround(monthly_tokens), "pessimistic": jround(monthly_tokens * 1.6)},
            "monthly_cost": {"optimistic": round2(monthly_token_cost * 0.7), "expected": monthly_token_cost, "pessimistic": round2(monthly_token_cost * 1.6)},
            "annual_cost": {"optimistic": round2(monthly_token_cost * 0.7 * 12), "expected": round2(monthly_token_cost * 12), "pessimistic": round2(monthly_token_cost * 1.6 * 12)},
            "model_breakdown": model_breakdown,
        },
        "maintenance": {
            "monthly_hours": maint_hours,
            "hourly_rate": MAINT_HOURLY_RATE,
            "monthly_cost": maint_monthly,
            "annual_cost": maint_monthly * 12,
            "includes": ["Prompt & model upkeep", "Monitoring & cost guardrails", "Eval regression checks", "Dependency updates"],
        },
        "total": {"min": jround(expected * 0.82), "expected": expected, "max": jround(expected * 1.35)},
        "currency": currency,
    }


# ── AI vs Standard comparison ───────────────────────────────────────

def compare_approaches(inp: ProjectInput, feas: dict, cost: dict) -> dict:
    ai_total = cost["total"]
    ai_monthly_run = cost["infrastructure"]["monthly_cost"] + cost["ai_tokens"]["monthly_cost"]["expected"] + cost["maintenance"]["monthly_cost"]
    ai_dev_hours = sum(b["hours"] for b in cost["development"]["breakdown"])
    ai_team = max(2, math.ceil(ai_dev_hours / (HOURS_PER_DEV_WEEK * 8)))
    ai_weeks = max(4, jround(ai_dev_hours / (HOURS_PER_DEV_WEEK * ai_team)))

    reliance = feas["sub_scores"]["ai_necessity"] / 100
    std_dev_hours = jround(ai_dev_hours * (0.85 + reliance * 0.8))
    std_dev_cost = jround(std_dev_hours * DEV_HOURLY_RATE)
    std_monthly_run = jround(cost["infrastructure"]["monthly_cost"] * 0.5 + cost["maintenance"]["monthly_cost"] * 0.8)
    std_team = max(2, math.ceil(std_dev_hours / (HOURS_PER_DEV_WEEK * 8)))
    std_weeks = max(4, jround(std_dev_hours / (HOURS_PER_DEV_WEEK * std_team)))
    std_expected = jround(std_dev_cost + std_monthly_run * 12)

    recommendation = "ai" if feas["score"] >= 55 else "hybrid" if feas["score"] >= 40 else "standard"

    dimensions = [
        {"dimension": "Time to market", "ai_score": int(clamp(jround(5 + reliance * 4), 0, 10)), "standard_score": int(clamp(jround(8 - reliance * 3), 0, 10)), "notes": "AI accelerates ambiguous tasks; standard is faster for well-specified ones."},
        {"dimension": "Accuracy on fuzzy input", "ai_score": int(clamp(jround(4 + reliance * 5), 0, 10)), "standard_score": int(clamp(jround(8 - reliance * 5), 0, 10)), "notes": "Unstructured input favours AI."},
        {"dimension": "Run cost", "ai_score": int(clamp(jround(9 - reliance * 4), 0, 10)), "standard_score": 9, "notes": "Tokens add ongoing cost the standard build avoids."},
        {"dimension": "Scalability", "ai_score": 8, "standard_score": 7, "notes": "Both scale on Azure; AI adds token-budget management."},
        {"dimension": "Maintainability", "ai_score": int(clamp(jround(7 - reliance * 2), 0, 10)), "standard_score": 7, "notes": "Prompt/model drift needs evals; rules need manual upkeep."},
        {"dimension": "Flexibility", "ai_score": int(clamp(jround(6 + reliance * 4), 0, 10)), "standard_score": int(clamp(jround(6 - reliance * 2), 0, 10)), "notes": "AI adapts to new cases with less re-coding."},
    ]

    if recommendation == "ai":
        summary = "AI delivers materially more value here than a standard build, and the run-cost premium is justified."
    elif recommendation == "hybrid":
        summary = "A hybrid split — AI on the fuzzy parts, standard software elsewhere — gives the best cost/value balance."
    else:
        summary = "A standard build meets the requirement at lower total cost; reserve AI for a later, targeted phase."

    return {
        "ai_approach": {
            "total_cost": ai_total,
            "timeline_weeks": ai_weeks,
            "team_size": ai_team,
            "benefits": ["Handles unstructured & ambiguous input", "Faster to adapt to new cases", "Higher ceiling on automation"],
            "challenges": ["Ongoing token cost", "Needs evaluation & guardrails", "Output variability to manage"],
            "monthly_run_cost": jround(ai_monthly_run),
        },
        "standard_approach": {
            "total_cost": {"min": jround(std_expected * 0.85), "expected": std_expected, "max": jround(std_expected * 1.3)},
            "timeline_weeks": std_weeks,
            "team_size": std_team,
            "benefits": ["Predictable, testable behaviour", "No per-request token cost", "Simpler compliance story"],
            "challenges": ["Brittle on unstructured input", "More manual rules to maintain", "Lower automation ceiling"],
            "monthly_run_cost": std_monthly_run,
        },
        "summary": summary,
        "recommendation": recommendation,
        "recommendation_rationale": feas["archetype_rationale"],
        "dimensions": dimensions,
    }


# ── ROI projection (deterministic payback + savings curve) ──────────

def project_roi(inp: ProjectInput, feas: dict, cost: dict) -> dict:
    use_cases = inp.ai_use_cases or []
    development_cost = cost["development"]["total_cost"]
    ai_monthly_run = (
        cost["infrastructure"]["monthly_cost"]
        + cost["ai_tokens"]["monthly_cost"]["expected"]
        + cost["maintenance"]["monthly_cost"]
    )
    annual_run_cost = round2(ai_monthly_run * 12)

    value_drivers = []
    annual_benefit = 0.0
    if use_cases:
        total_requests_per_day = max(_requests_per_day(inp), len(use_cases))
        weights = [PRIORITY_WEIGHT[u.priority] for u in use_cases]
        w_total = sum(weights)
        for i, uc in enumerate(use_cases):
            p = _profile(uc.task_type)
            daily_req = (total_requests_per_day * weights[i]) / w_total
            annual_calls = jround(daily_req * 365)
            value_per_call = p["value_per_call"]
            annual_value = round2(annual_calls * value_per_call)
            annual_benefit += annual_value
            value_drivers.append({
                "use_case": uc.name,
                "value_per_call": value_per_call,
                "annual_calls": annual_calls,
                "annual_value": annual_value,
            })
    annual_benefit = round2(annual_benefit)

    net_annual_benefit = round2(annual_benefit - annual_run_cost)
    payback_months = round2(development_cost / (net_annual_benefit / 12)) if net_annual_benefit > 0 else None

    total_investment_3yr = development_cost + annual_run_cost * 3
    total_benefit_3yr = annual_benefit * 3
    three_year_value = round2(total_benefit_3yr - total_investment_3yr)
    roi_percent = jround(three_year_value / total_investment_3yr * 100) if total_investment_3yr > 0 else 0

    curve = [
        {"month": m, "cumulative_net": round2(net_annual_benefit * (m / 12) - development_cost)}
        for m in range(0, 37, 3)
    ]

    return {
        "annual_benefit": annual_benefit,
        "annual_run_cost": annual_run_cost,
        "development_cost": development_cost,
        "net_annual_benefit": net_annual_benefit,
        "payback_months": payback_months,
        "three_year_value": three_year_value,
        "roi_percent": roi_percent,
        "curve": curve,
        "value_drivers": value_drivers,
        "assumptions": [
            "Benefit = automated calls × the per-task-type value of the manual work they replace.",
            f"{_requests_per_day(inp)} requests/day at launch, distributed across use cases by priority.",
            "Run cost mirrors the first-year operating total (infra + tokens + maintenance).",
            "Three-year view holds volume and pricing flat — no growth or discounting applied.",
        ],
    }


# ── Recommendations & report ────────────────────────────────────────

def build_recommendations(inp: ProjectInput, feas: dict) -> list[dict]:
    recs = [{
        "priority": "high",
        "category": "Approach",
        "title": f"Build as: {feas['archetype_label']}",
        "description": feas["archetype_rationale"],
        "estimated_impact": "Sets the cost and complexity envelope for the whole project.",
    }]
    if feas["archetype"] != "traditional":
        recs.append({
            "priority": "high",
            "category": "FinOps",
            "title": "Instrument cost-per-request from day one",
            "description": "Tag every model call with a use case and surface $/request in a dashboard.",
            "estimated_impact": "Keeps token spend predictable and prevents budget surprises.",
        })
        recs.append({
            "priority": "medium",
            "category": "Quality",
            "title": "Stand up an evaluation harness early",
            "description": "A small labelled set + automated scoring catches regressions before users do.",
            "estimated_impact": "Reduces production incidents and rework.",
        })
    recs.append({
        "priority": "medium",
        "category": "Delivery",
        "title": "Ship a thin vertical slice first",
        "description": "One use case, end to end, in front of real users before scaling breadth.",
        "estimated_impact": "De-risks the estimate with real usage data.",
    })
    return recs


def compose_markdown(inp: ProjectInput, feas: dict, cost: dict) -> str:
    currency = cost["currency"]

    def fmt(n: float) -> str:
        return f"{currency} {_locale(n)}"

    return "\n".join([
        f"# {inp.project_name} — AI Feasibility & Cost",
        "",
        f"**Recommendation:** {feas['archetype_label']} (feasibility {feas['score']}/100, {feas['rating']}).",
        "",
        feas["rationale"],
        "",
        "## Cost (first year)",
        f"- Development: {fmt(cost['development']['total_cost'])}",
        f"- Infrastructure: {fmt(cost['infrastructure']['annual_cost'])}/yr",
        f"- AI tokens: {fmt(cost['ai_tokens']['annual_cost']['expected'])}/yr (expected)",
        f"- Maintenance: {fmt(cost['maintenance']['annual_cost'])}/yr",
        f"- **Total expected: {fmt(cost['total']['expected'])}** (range {fmt(cost['total']['min'])}–{fmt(cost['total']['max'])})",
    ])


def _build_repo_context(inp: ProjectInput) -> dict | None:
    if inp.project_type != "enhancement" or not inp.current_architecture:
        return None
    a = inp.current_architecture
    return {
        "full_name": inp.repo_full_name or inp.repo_url or inp.project_name,
        "html_url": inp.repo_url or "",
        "branch": inp.repo_branch or "main",
        "primary_language": a.language,
        "stars": inp.repo_stars or 0,
        "file_count": inp.repo_file_count or 0,
        "architecture": a.model_dump(),
        "manifests_found": inp.repo_manifests or [],
        "topics": inp.repo_topics or [],
    }


# ── Top-level orchestrator ──────────────────────────────────────────

def estimate(inp: ProjectInput, est_id: str, generated_at: str) -> dict:
    """Run the full deterministic pipeline and return an Estimation dict."""
    feas = score_feasibility(inp)
    cost = compute_cost(inp, feas)
    tokens = project_tokens(inp)
    comparison = compare_approaches(inp, feas, cost)
    roi = project_roi(inp, feas, cost)
    recommendations = build_recommendations(inp, feas)
    markdown = compose_markdown(inp, feas, cost)

    return {
        "id": est_id,
        "project_id": inp.project_name,
        "project_name": inp.project_name,
        "project_type": inp.project_type,
        "industry_domain": inp.industry_domain,
        "feasibility": feas,
        "cost_breakdown": cost,
        "token_projection": tokens,
        "comparison": comparison,
        "roi_projection": roi,
        "recommendations": recommendations,
        "report_markdown": markdown,
        "status": "complete",
        "generated_at": generated_at,
        "repo_context": _build_repo_context(inp),
    }
