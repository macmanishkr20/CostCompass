"""Standalone parity & sanity smoke test for the deterministic engine.

Runs without a server. Builds a fixed ProjectInput, executes the pipeline, and
asserts a set of hand-computed values so the Python engine demonstrably matches
the TypeScript reference. Also round-trips PDF/Excel exports and the repository.

Usage:  python smoke_test.py
"""

from __future__ import annotations

import os
import sys

# Price infra from the deterministic catalog baseline (no live network calls)
# so the parity assertions below are reproducible offline.
os.environ.setdefault("AZURE_LIVE_PRICING", "false")
# Keep the LLM nodes (classify + architect) on their deterministic heuristics so
# the parity assertions are reproducible and never depend on a live model.
os.environ.setdefault("ENABLE_LLM_CLASSIFIER", "false")

from app.shared import engine
from app.exports import estimation_to_excel, estimation_to_pdf
from app.deterministic import run_pipeline
from app.shared.schemas import Estimation, ProjectInput

FAILS: list[str] = []


def check(label: str, got, want) -> None:
    ok = got == want
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got={got!r} want={want!r}")
    if not ok:
        FAILS.append(label)


def approx(label: str, got: float, want: float, tol: float = 0.001) -> None:
    ok = abs(got - want) <= tol
    print(f"  [{'PASS' if ok else 'FAIL'}] {label}: got={got!r} want≈{want!r}")
    if not ok:
        FAILS.append(label)


# ── Fixture: two AI use cases (RAG + summarization), medium scale ──
INPUT = ProjectInput.model_validate({
    "projectName": "Acme Support Copilot",
    "projectType": "new",
    "description": "Support assistant over the knowledge base.",
    "industryDomain": "SaaS",
    "targetUsers": "Support agents",
    "scale": "medium",
    "features": [
        {"id": "f1", "name": "Knowledge base ingest", "description": "", "complexity": "high", "aiCandidate": True},
        {"id": "f2", "name": "Agent console", "description": "", "complexity": "medium", "aiCandidate": False},
    ],
    "aiUseCases": [
        {"id": "u1", "name": "Answer from docs", "taskType": "rag_qa", "description": "", "priority": "must_have", "linkedFeatureIds": []},
        {"id": "u2", "name": "Summarize tickets", "taskType": "summarization", "description": "", "priority": "nice_to_have", "linkedFeatureIds": []},
    ],
    "technicalPreferences": {
        "preferredLLMProvider": "Azure OpenAI", "deploymentModel": "cloud",
        "existingInfra": "Azure", "complianceRequirements": [], "budgetCurrency": "USD",
    },
    "volumeAndScale": {
        "expectedDailyUsers": 400, "requestsPerDay": 3000, "dataVolumeGB": 30,
        "peakLoadPattern": "Business hours", "growthRatePercent": 20,
    },
})


def main() -> int:
    est: Estimation = run_pipeline(INPUT, "est_test", "2026-06-20T00:00:00+00:00")

    print("\n── Feasibility ──")
    # sub-scores hand calc (in IEEE-754 float64, matching the TS engine exactly):
    #   weights: must_have=1 (rag_qa), nice_to_have=0.6 (summarization); wSum=1.6
    #   aiN = (78*1 + 66*0.6)/1.6 = 117.6/1.6 = 73.49999999999999 -> round 73
    #   features: 1 of 2 aiCandidate => ratio 0.5 => +0
    check("ai_necessity", est.feasibility.sub_scores.ai_necessity, 73)
    #   agentic = (55*1 + 25*0.6)/1.6 = 70/1.6 = 43.75
    #     mustHaves=1 => +4 => 47.75 ; no multi-agent ; round 48
    check("agentic_suitability", est.feasibility.sub_scores.agentic_suitability, 48)
    #   trad = (30*1 + 45*0.6)/1.6 = 57/1.6 = 35.625 ; useCases=2 so no +10 ; round 36
    check("traditional_suitability", est.feasibility.sub_scores.traditional_suitability, 36)
    #   composite = clamp(round(0.55*73 + 0.3*48 + 0.15*(100-36)))
    #     = round(40.15 + 14.4 + 9.6) = round(64.15) = 64
    check("composite_score", est.feasibility.score, 64)
    check("rating", est.feasibility.rating, "high")
    #   archetype: aiN>=55, agentic 48<58, hasRetrieval(rag_qa) => rag_assistant
    check("archetype", est.feasibility.archetype, "rag_assistant")

    print("\n── Solution proposal (architect node, heuristic w/ LLM off) ──")
    # No explicit platform + no AWS/GCP/M365/on-prem keywords => azure_paas default.
    # With the LLM disabled the architect must mirror classify_platform exactly so
    # the priced platform (and every downstream number) is unchanged.
    sp = est.solution_proposal
    check("proposal_present", sp is not None, True)
    check("proposal_platform", sp.recommended_platform if sp else None, "azure_paas")
    check("proposal_source", sp.source if sp else None, "heuristic")
    check("proposal_matches_infra", (sp.recommended_platform if sp else None), infra_platform := est.cost_breakdown.infrastructure.platform)

    print("\n── Development cost ──")
    # feature hours: high=130, medium=64
    # aiIntegration: rag_qa must_have base80 * cx(agentic55<70 =>1)=80 ; summarization nice_to_have base48 * 1 = 48 ; sum=128
    # breakdown hours total = 130 + 64 + 128 = 322 ; dev = 322*115 = 37030
    check("ai_integration_hours", est.cost_breakdown.development.ai_integration_hours, 128)
    check("development_total", est.cost_breakdown.development.total_cost, 322 * 115)

    print("\n── Infrastructure (medium, 30GB, 3000 req/day, needs AI Search) ──")
    # Planner (rule fallback, no LLM) + catalog baselines (live pricing off):
    #   Container Apps 320 ; Cosmos round(40+30*0.25)=48 ; Blob round2(100*0.0184)=1.84
    #   Monitor round(30+3000*0.00002)=30 ; APIM medium=50 ; Redis medium=55
    #   AI Search S1 round2(730*0.336)=245.28 ; Content Safety medium=20
    #   Key Vault round2(18*0.03)=0.54 ; Defender medium=45
    #   Azure OpenAI is listed but excluded from the subtotal (included_in_total=False).
    #   sum(in_total) = 320+48+1.84+30+50+55+245.28+20+0.54+45 = 815.66 -> round 816
    infra = est.cost_breakdown.infrastructure
    in_total_sum = sum(s.monthly_cost for s in infra.services if s.included_in_total)
    check("infra_monthly", infra.monthly_cost, 816)
    check("infra_monthly_consistent", infra.monthly_cost, engine.jround(in_total_sum))
    check("infra_annual", infra.annual_cost, 816 * 12)
    svc_names = [s.service_name for s in infra.services]
    check("has_ai_search", "Azure AI Search" in svc_names, True)
    check("has_key_vault", "Azure Key Vault" in svc_names, True)
    check("has_defender", "Microsoft Defender for Cloud" in svc_names, True)
    # Azure OpenAI is shown for completeness but not added to the infra subtotal.
    openai = next((s for s in infra.services if s.service_name == "Azure OpenAI"), None)
    check("openai_listed", openai is not None, True)
    check("openai_excluded_from_total", openai is not None and openai.included_in_total, False)
    # Every service carries a region, a pricing source, and a calculator deep link.
    check("services_have_region", all(s.region for s in infra.services), True)
    check("services_have_calc_link", all(s.azure_pricing_url for s in infra.services), True)
    check("price_sources_valid", all(s.price_source in ("live", "fallback", "estimate") for s in infra.services), True)

    print("\n── Tokens ──")
    # totalReq/day = max(3000, 2) = 3000 ; weights [1, 0.6] wTotal 1.6
    # rag_qa: dailyReq = 3000*1/1.6 = 1875 ; monthlyReq=56250 ; in=56250*3500=196,875,000 out=56250*700=39,375,000
    #   model gpt-4o-mini in0.15 out0.6 => cost = 196.875*0.15 + 39.375*0.6 = 29.53125 + 23.625 = 53.15625 -> round2 53.16
    # summarization: dailyReq=3000*0.6/1.6=1125 ; monthlyReq=33750 ; in=33750*4000=135,000,000 out=33750*600=20,250,000
    #   same model gpt-4o-mini -> grouped with rag under gpt-4o-mini
    # grouped gpt-4o-mini: in = 196,875,000+135,000,000=331,875,000 ; out=39,375,000+20,250,000=59,625,000
    #   cost = 331.875*0.15 + 59.625*0.6 = 49.78125 + 35.775 = 85.55625 -> round2 85.56
    mb = est.cost_breakdown.ai_tokens.model_breakdown
    check("single_model_group", len(mb), 1)
    check("model_name", mb[0].model, "gpt-4o-mini")
    check("monthly_input_tokens", mb[0].monthly_input_tokens, 331_875_000)
    check("monthly_output_tokens", mb[0].monthly_output_tokens, 59_625_000)
    approx("monthly_token_cost", est.cost_breakdown.ai_tokens.monthly_cost.expected, 85.56)

    print("\n── Maintenance & total ──")
    # maintHours = 24 + 2*4 = 32 ; maintMonthly = 32*95 = 3040
    check("maint_monthly", est.cost_breakdown.maintenance.monthly_cost, 3040)
    # annualRun = (816 + 85.56 + 3040)*12 = 3941.56*12 = 47298.72
    # expected = round(37030 + 47298.72) = round(84328.72) = 84329
    check("total_expected", est.cost_breakdown.total.expected, 84329)
    check("total_min", est.cost_breakdown.total.min, engine.jround(84329 * 0.82))
    check("total_max", est.cost_breakdown.total.max, engine.jround(84329 * 1.35))

    print("\n── ROI (deterministic, transparent benefit basis) ──")
    # value/call is built bottom-up: minutes ÷ 60 × loaded($75) × automation(70%)
    #   per-minute value = 75/60 * 0.70 = 0.875
    #   rag_qa     6 min => 5.25 ; summarization 4 min => 3.50
    # rag  annualCalls = round(1875*365)=684375 * 5.25 = 3,592,968.75
    # summ annualCalls = round(1125*365)=410625 * 3.50 = 1,437,187.50
    #   annualBenefit = 3,592,968.75 + 1,437,187.50 = 5,030,156.25
    approx("annual_benefit", est.roi_projection.annual_benefit, 5030156.25)
    rag_vd = est.roi_projection.value_drivers[0]
    check("driver_value_per_call", rag_vd.value_per_call, 5.25)
    check("driver_minutes_per_call", rag_vd.minutes_per_call, 6)
    check("driver_loaded_rate", rag_vd.loaded_hourly_rate, 75)
    check("driver_automation_pct", rag_vd.automation_rate_percent, 70)
    check("payback_is_positive", est.roi_projection.payback_months is not None and est.roi_projection.payback_months > 0, True)
    check("roi_curve_points", len(est.roi_projection.curve), 13)

    print("\n── Verdict (decisive call) ──")
    # composite 64 >= 55 => comparison leans "ai"; archetype rag_assistant (not
    # traditional) => decision build_with_ai / disposition go / recommend AI.
    check("verdict_present", est.verdict is not None, True)
    check("verdict_decision", est.verdict.decision, "build_with_ai")
    check("verdict_disposition", est.verdict.disposition, "go")
    check("verdict_recommend_ai", est.verdict.recommend_ai, True)

    print("\n── Confidence (deterministic self-assessment) ──")
    # detail 4/4=1.0 ; volume 4/4=1.0 ; decisive (clamp(9/15)+clamp(18/15))/2 =
    #   (0.6+1.0)/2 = 0.8 ; grounded(new build) 0.5
    # raw = 100*(0.30*1 + 0.30*1 + 0.30*0.8 + 0.10*0.5) = 100*0.89 = 89 ; high
    check("confidence_present", est.confidence is not None, True)
    check("confidence_score", est.confidence.score, 89)
    check("confidence_level", est.confidence.level, "high")
    check("confidence_factor_count", len(est.confidence.factors), 4)

    print("\n── Exports ──")
    pdf = estimation_to_pdf(est)
    check("pdf_is_pdf", pdf[:5], b"%PDF-")
    check("pdf_nontrivial", len(pdf) > 2000, True)
    xlsx = estimation_to_excel(est)
    check("xlsx_is_zip", xlsx[:2], b"PK")
    check("xlsx_nontrivial", len(xlsx) > 3000, True)

    print("\n── Enhancement-mode line item ──")
    enh_payload = INPUT.model_dump(by_alias=True)
    enh_payload["projectType"] = "enhancement"
    enh_payload["currentArchitecture"] = {
        "framework": "FastAPI", "language": "Python", "database": "Postgres",
        "apiPattern": "REST", "hostingPlatform": "Azure", "ciCd": "GitHub Actions",
    }
    enh = ProjectInput.model_validate(enh_payload)
    est2 = run_pipeline(enh, "est_test2", "2026-06-20T00:00:00+00:00")
    cats = [b.category for b in est2.cost_breakdown.development.breakdown]
    # integration hours = 40 + 2*24 = 88
    check("has_integration_line", "Integrate with existing FastAPI" in cats, True)
    integ = next(b for b in est2.cost_breakdown.development.breakdown if b.category == "Integrate with existing FastAPI")
    check("integration_hours", integ.hours, 88)
    check("repo_context_present", est2.repo_context is not None, True)
    # Enhancement infra counts only NET-NEW Azure services (no existing hosting/DB).
    enh_svcs = [s.service_name for s in est2.cost_breakdown.infrastructure.services]
    check("enh_excludes_existing_hosting", "Azure Container Apps" not in enh_svcs, True)
    check("enh_excludes_existing_db", "Azure Cosmos DB" not in enh_svcs, True)
    check("enh_adds_ai_search", "Azure AI Search" in enh_svcs, True)

    # ── Agentic mode: strict integrity guard must reproduce deterministic numbers ──
    print("\n── Agentic pipeline (multi-agent ReAct, LLM off) ──")
    from app.agentic import run_agentic_pipeline

    ag = run_agentic_pipeline(INPUT, "est_agentic", "2026-06-20T00:00:00+00:00")
    det = est  # the deterministic run from earlier in this test
    check("agentic_total_min", ag.cost_breakdown.total.min, det.cost_breakdown.total.min)
    check("agentic_total_expected", ag.cost_breakdown.total.expected, det.cost_breakdown.total.expected)
    check("agentic_total_max", ag.cost_breakdown.total.max, det.cost_breakdown.total.max)
    check("agentic_feasibility", ag.feasibility.score, det.feasibility.score)
    check("agentic_roi_3yr", ag.roi_projection.three_year_value, det.roi_projection.three_year_value)
    check("agentic_verdict", ag.verdict.decision if ag.verdict else None,
          det.verdict.decision if det.verdict else None)
    ar = ag.agent_run
    check("agent_run_present", ar is not None, True)
    check("agent_run_mode", ar.mode if ar else None, "agentic")
    check("agent_run_integrity_verified", ar.integrity_verified if ar else None, True)
    check("agent_run_full_path", len(ar.supervisor_path) if ar else 0, 8)
    check("agent_run_tool_ledger", sorted({t.tool for t in ar.tool_ledger}) if ar else [],
          ["comparison", "cost", "feasibility", "roi", "tokens"])

    print("\n" + ("=" * 48))
    if FAILS:
        print(f"RESULT: {len(FAILS)} FAILURE(S): {FAILS}")
        return 1
    print("RESULT: ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
