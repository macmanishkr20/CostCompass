"""Standalone parity & sanity smoke test for the deterministic engine.

Runs without a server. Builds a fixed ProjectInput, executes the pipeline, and
asserts a set of hand-computed values so the Python engine demonstrably matches
the TypeScript reference. Also round-trips PDF/Excel exports and the repository.

Usage:  python smoke_test.py
"""

from __future__ import annotations

import sys

from app import engine
from app.exports import estimation_to_excel, estimation_to_pdf
from app.pipeline import run_pipeline
from app.schemas import Estimation, ProjectInput

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

    print("\n── Development cost ──")
    # feature hours: high=130, medium=64
    # aiIntegration: rag_qa must_have base80 * cx(agentic55<70 =>1)=80 ; summarization nice_to_have base48 * 1 = 48 ; sum=128
    # breakdown hours total = 130 + 64 + 128 = 322 ; dev = 322*115 = 37030
    check("ai_integration_hours", est.cost_breakdown.development.ai_integration_hours, 128)
    check("development_total", est.cost_breakdown.development.total_cost, 322 * 115)

    print("\n── Infrastructure (medium, 30GB, 3000 req/day, needs AI Search) ──")
    # Container Apps 320 ; Cosmos round(40+30*0.25)=round(47.5)=48 ; Blob round2(max(2,30*0.021=0.63))=2.0
    # App Insights round(30+3000*0.00002=30.06)=30 ; APIM medium=50 ; AI Search Standard=250
    # sum = 320+48+2+30+50+250 = 700
    check("infra_monthly", est.cost_breakdown.infrastructure.monthly_cost, 700)
    check("infra_annual", est.cost_breakdown.infrastructure.annual_cost, 8400)
    svc_names = [s.service_name for s in est.cost_breakdown.infrastructure.services]
    check("has_ai_search", "Azure AI Search" in svc_names, True)

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
    # annualRun = (700 + 85.56 + 3040)*12 = 3825.56*12 = 45906.72
    # expected = round(37030 + 45906.72) = round(82936.72) = 82937
    check("total_expected", est.cost_breakdown.total.expected, 82937)
    check("total_min", est.cost_breakdown.total.min, engine.jround(82937 * 0.82))
    check("total_max", est.cost_breakdown.total.max, engine.jround(82937 * 1.35))

    print("\n── ROI (deterministic) ──")
    # value drivers: rag annualCalls = round(1875*365)=684375 *0.55 = 376406.25 -> round2 376406.25
    #   summ annualCalls = round(1125*365)=410625 *0.45 = 184781.25
    #   annualBenefit = 376406.25 + 184781.25 = 561187.5
    approx("annual_benefit", est.roi_projection.annual_benefit, 561187.5)
    check("payback_is_positive", est.roi_projection.payback_months is not None and est.roi_projection.payback_months > 0, True)
    check("roi_curve_points", len(est.roi_projection.curve), 13)

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

    print("\n" + ("=" * 48))
    if FAILS:
        print(f"RESULT: {len(FAILS)} FAILURE(S): {FAILS}")
        return 1
    print("RESULT: ALL CHECKS PASSED")
    return 0


if __name__ == "__main__":
    sys.exit(main())
