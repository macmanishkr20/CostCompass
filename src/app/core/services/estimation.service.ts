import { inject, Injectable } from '@angular/core';
import { from, Observable, of } from 'rxjs';
import { concatMap, delay, map } from 'rxjs/operators';
import {
  AIUseCase,
  AITaskType,
  ProjectInput,
  ProjectScale,
} from '../models/project.model';
import {
  AIvsStandardComparison,
  CostBreakdown,
  Estimation,
  EstimationSSEChunk,
  FeasibilityResult,
  FeasibilitySubScores,
  ModelTokenBreakdown,
  Recommendation,
  RecommendationArchetype,
  TokenProjection,
  UseCaseAnalysis,
} from '../models/estimation.model';
import { EstimateSummary } from '../models/dashboard.model';
import { MockDataService } from './mock-data.service';
import { archetypeBlurb, archetypeLabel, ratingForScore } from '../../shared/utils/feasibility';

/* ── Rate card (blended USD) ── */
const DEV_HOURLY_RATE = 115;
const MAINT_HOURLY_RATE = 95;
const HOURS_PER_DEV_WEEK = 32; // effective, not nominal

const COMPLEXITY_HOURS: Record<string, number> = {
  low: 24,
  medium: 64,
  high: 130,
  very_high: 240,
};

const PRIORITY_WEIGHT: Record<AIUseCase['priority'], number> = {
  must_have: 1,
  nice_to_have: 0.6,
  exploratory: 0.3,
};

/* ── Model pricing catalog (USD per 1M tokens) ── */
interface ModelPrice {
  provider: string;
  inPer1M: number;
  outPer1M: number;
}
const MODEL_CATALOG: Record<string, ModelPrice> = {
  'gpt-4o': { provider: 'Azure OpenAI', inPer1M: 2.5, outPer1M: 10 },
  'gpt-4o-mini': { provider: 'Azure OpenAI', inPer1M: 0.15, outPer1M: 0.6 },
  'claude-sonnet-4': { provider: 'Anthropic', inPer1M: 3, outPer1M: 15 },
  'claude-haiku': { provider: 'Anthropic', inPer1M: 0.8, outPer1M: 4 },
  'gemini-2-pro': { provider: 'Google', inPer1M: 1.25, outPer1M: 5 },
  'gemini-2-flash': { provider: 'Google', inPer1M: 0.075, outPer1M: 0.3 },
};

/* ── Per-task-type profile: token shape, default model, and scoring weights ── */
interface TaskProfile {
  inTokens: number;
  outTokens: number;
  model: string;
  aiN: number; // contribution to AI-necessity
  agentic: number; // contribution to agentic suitability
  trad: number; // contribution to traditional suitability
}
const TASK_PROFILES: Record<AITaskType, TaskProfile> = {
  text_classification: { inTokens: 800, outTokens: 80, model: 'gpt-4o-mini', aiN: 55, agentic: 20, trad: 70 },
  summarization: { inTokens: 4000, outTokens: 600, model: 'gpt-4o-mini', aiN: 66, agentic: 25, trad: 45 },
  code_generation: { inTokens: 2500, outTokens: 1200, model: 'claude-sonnet-4', aiN: 80, agentic: 55, trad: 25 },
  conversational_agent: { inTokens: 1500, outTokens: 500, model: 'gpt-4o', aiN: 80, agentic: 72, trad: 25 },
  rag_qa: { inTokens: 3500, outTokens: 700, model: 'gpt-4o-mini', aiN: 78, agentic: 55, trad: 30 },
  multi_agent_orchestration: { inTokens: 6000, outTokens: 2500, model: 'gpt-4o', aiN: 88, agentic: 92, trad: 15 },
  document_analysis: { inTokens: 8000, outTokens: 1000, model: 'gpt-4o', aiN: 75, agentic: 50, trad: 35 },
  image_analysis: { inTokens: 1200, outTokens: 400, model: 'gpt-4o', aiN: 82, agentic: 35, trad: 30 },
  translation: { inTokens: 1000, outTokens: 1000, model: 'gemini-2-flash', aiN: 60, agentic: 20, trad: 55 },
  data_extraction: { inTokens: 2000, outTokens: 400, model: 'gpt-4o-mini', aiN: 62, agentic: 35, trad: 60 },
  recommendation: { inTokens: 1500, outTokens: 300, model: 'gemini-2-pro', aiN: 70, agentic: 40, trad: 50 },
  anomaly_detection: { inTokens: 1000, outTokens: 120, model: 'gemini-2-flash', aiN: 58, agentic: 30, trad: 72 },
};

const SCALE_INFRA_BASE: Record<ProjectScale, number> = {
  small: 120,
  medium: 320,
  large: 850,
  enterprise: 2200,
};
const SCALE_APIM: Record<ProjectScale, number> = {
  small: 0,
  medium: 50,
  large: 250,
  enterprise: 700,
};
const SCALE_MAINT_HOURS: Record<ProjectScale, number> = {
  small: 12,
  medium: 24,
  large: 48,
  enterprise: 90,
};

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}
function round(n: number): number {
  return Math.round(n);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

@Injectable({ providedIn: 'root' })
export class EstimationService {
  private readonly mock = inject(MockDataService);
  private readonly store = new Map<string, Estimation>();

  /**
   * Simulated streaming generation: emits progress chunks per pipeline node,
   * then a final 'complete' chunk carrying the full estimation.
   */
  generate(input: ProjectInput): Observable<EstimationSSEChunk> {
    const id = `est_${Date.now().toString(36)}`;
    const estimation = this.computeEstimation(input, id, new Date().toISOString());
    this.store.set(id, estimation);

    const steps: EstimationSSEChunk[] = [
      { node: 'intake', status: 'processing', content: 'Parsing project intake…', progress: 10 },
      { node: 'feasibility', status: 'processing', content: 'Scoring AI necessity, agentic & traditional fit…', progress: 35 },
      { node: 'costing', status: 'processing', content: 'Computing development, infra & token costs…', progress: 60 },
      { node: 'comparison', status: 'processing', content: 'Comparing AI vs standard approaches…', progress: 80 },
      { node: 'report', status: 'processing', content: 'Composing the report…', progress: 95 },
      { node: 'report', status: 'complete', content: 'Done', progress: 100, data: { id, estimation } },
    ];

    return from(steps).pipe(concatMap((c, i) => of(c).pipe(delay(i === 0 ? 250 : 550))));
  }

  /** Loads a full estimation; synthesises one from a seed summary if not generated this session. */
  getById(id: string): Observable<Estimation | null> {
    const found = this.store.get(id);
    if (found) return of(found).pipe(delay(150));
    return this.mock.getEstimateById(id).pipe(
      map((summary) => (summary ? this.synthesizeFromSummary(summary) : null)),
    );
  }

  /* ── Core deterministic engine ──────────────────────────────────── */

  computeEstimation(input: ProjectInput, id: string, generatedAt: string): Estimation {
    const feasibility = this.scoreFeasibility(input);
    const costBreakdown = this.computeCost(input, feasibility);
    const tokenProjection = this.projectTokens(input);
    const comparison = this.compareApproaches(input, feasibility, costBreakdown);
    const recommendations = this.buildRecommendations(input, feasibility);

    return {
      id,
      projectId: input.projectName,
      feasibility,
      costBreakdown,
      tokenProjection,
      comparison,
      recommendations,
      reportMarkdown: this.composeMarkdown(input, feasibility, costBreakdown),
      status: 'complete',
      generatedAt,
    };
  }

  private scoreFeasibility(input: ProjectInput): FeasibilityResult {
    const useCases = input.aiUseCases ?? [];
    const subScores = this.computeSubScores(input);
    const archetype = this.pickArchetype(subScores, useCases);
    const composite = clamp(
      round(0.55 * subScores.aiNecessity + 0.3 * subScores.agenticSuitability + 0.15 * (100 - subScores.traditionalSuitability)),
    );

    const useCaseAnalysis: UseCaseAnalysis[] = useCases.map((uc) => {
      const p = TASK_PROFILES[uc.taskType];
      const cx = p.agentic >= 70 ? 'high' : p.agentic >= 40 ? 'medium' : 'low';
      return {
        useCaseName: uc.name,
        feasibilityScore: clamp(round(p.aiN * 0.6 + p.agentic * 0.4)),
        aiTaskType: uc.taskType,
        justification: `${uc.priority.replace('_', ' ')} · best served by ${p.model} given the ${uc.taskType.replace(/_/g, ' ')} workload.`,
        recommendedModel: p.model,
        complexity: cx,
      };
    });

    return {
      score: composite,
      rating: ratingForScore(composite),
      subScores,
      archetype,
      archetypeLabel: archetypeLabel(archetype),
      archetypeRationale: this.archetypeRationale(archetype, subScores),
      rationale: this.feasibilityRationale(subScores, archetype),
      useCaseAnalysis,
      risks: this.buildRisks(input, archetype),
      opportunities: this.buildOpportunities(archetype, useCases),
    };
  }

  private computeSubScores(input: ProjectInput): FeasibilitySubScores {
    const useCases = input.aiUseCases ?? [];
    if (useCases.length === 0) {
      return { aiNecessity: 18, agenticSuitability: 12, traditionalSuitability: 86 };
    }

    let wSum = 0;
    let aiN = 0;
    let agentic = 0;
    let trad = 0;
    let hasMultiAgent = false;
    for (const uc of useCases) {
      const p = TASK_PROFILES[uc.taskType];
      const w = PRIORITY_WEIGHT[uc.priority];
      wSum += w;
      aiN += p.aiN * w;
      agentic += p.agentic * w;
      trad += p.trad * w;
      if (uc.taskType === 'multi_agent_orchestration') hasMultiAgent = true;
    }
    aiN /= wSum;
    agentic /= wSum;
    trad /= wSum;

    // Feature signal: share of features flagged as AI candidates nudges necessity up.
    const features = input.features ?? [];
    const aiCandidateRatio = features.length ? features.filter((f) => f.aiCandidate).length / features.length : 0.5;
    aiN += (aiCandidateRatio - 0.5) * 16;

    // Interdependence: more must-have use cases boosts agentic suitability.
    const mustHaves = useCases.filter((u) => u.priority === 'must_have').length;
    agentic += Math.min(mustHaves, 4) * 4;
    if (hasMultiAgent) agentic += 8;

    // Fewer/simpler AI use cases means traditional stays viable.
    if (useCases.length <= 1) trad += 10;

    return {
      aiNecessity: clamp(round(aiN)),
      agenticSuitability: clamp(round(agentic)),
      traditionalSuitability: clamp(round(trad)),
    };
  }

  private pickArchetype(s: FeasibilitySubScores, useCases: AIUseCase[]): RecommendationArchetype {
    const hasMultiAgent = useCases.some((u) => u.taskType === 'multi_agent_orchestration');
    const hasRetrieval = useCases.some((u) => u.taskType === 'rag_qa' || u.taskType === 'document_analysis');

    if (s.aiNecessity < 35) return 'traditional';
    if (s.aiNecessity < 55) return 'traditional_plus_ai';

    if (s.agenticSuitability >= 72 && hasMultiAgent) return 'multi_agent';
    if (s.agenticSuitability >= 58) return 'single_agent';
    if (hasRetrieval) return 'rag_assistant';
    if (s.traditionalSuitability >= 50) return 'hybrid';
    return 'rag_assistant';
  }

  private archetypeRationale(a: RecommendationArchetype, s: FeasibilitySubScores): string {
    return `AI-necessity ${s.aiNecessity}, agentic-suitability ${s.agenticSuitability}, traditional-suitability ${s.traditionalSuitability}. ${archetypeBlurb(a)}`;
  }

  private feasibilityRationale(s: FeasibilitySubScores, a: RecommendationArchetype): string {
    if (a === 'traditional') {
      return 'The workload is well-defined and deterministic. AI would add operating cost and unpredictability without a clear accuracy or value gain.';
    }
    if (a === 'multi_agent') {
      return 'Multiple interdependent, multi-step tasks benefit from specialised agents coordinating — the value of autonomy outweighs the added orchestration cost.';
    }
    return `A measured AI investment is justified here (necessity ${s.aiNecessity}/100), with the recommended pattern keeping run-cost proportional to the value delivered.`;
  }

  private computeCost(input: ProjectInput, feas: FeasibilityResult): CostBreakdown {
    const features = input.features ?? [];
    const useCases = input.aiUseCases ?? [];
    const currency = input.technicalPreferences?.budgetCurrency || 'USD';

    // Development: feature build + AI integration per use case.
    const featureBreakdown = features.map((f) => {
      const hours = COMPLEXITY_HOURS[f.complexity] ?? 64;
      return { category: f.name, hours, cost: round(hours * DEV_HOURLY_RATE) };
    });
    const aiIntegrationHours = useCases.reduce((sum, uc) => {
      const base = uc.priority === 'must_have' ? 80 : uc.priority === 'nice_to_have' ? 48 : 28;
      const cx = TASK_PROFILES[uc.taskType].agentic >= 70 ? 1.4 : 1;
      return sum + base * cx;
    }, 0);
    if (aiIntegrationHours > 0) {
      featureBreakdown.push({
        category: 'AI integration & evaluation',
        hours: round(aiIntegrationHours),
        cost: round(aiIntegrationHours * DEV_HOURLY_RATE),
      });
    }
    const totalDevHours = featureBreakdown.reduce((s, b) => s + b.hours, 0);
    const developmentCost = round(totalDevHours * DEV_HOURLY_RATE);

    // Infrastructure (monthly Azure).
    const scale = input.scale ?? 'medium';
    const dataGB = input.volumeAndScale?.dataVolumeGB ?? 10;
    const needsSearch = useCases.some((u) => u.taskType === 'rag_qa' || u.taskType === 'document_analysis');
    const services = [
      { serviceName: 'Azure Container Apps', tier: scale, monthlyCost: SCALE_INFRA_BASE[scale], details: 'App + API hosting, autoscaling' },
      { serviceName: 'Azure Cosmos DB', tier: 'Serverless', monthlyCost: round(40 + dataGB * 0.25), details: `~${dataGB} GB operational data` },
      { serviceName: 'Azure Blob Storage', tier: 'Hot', monthlyCost: round2(Math.max(2, dataGB * 0.021)), details: 'Artifacts, exports, raw documents' },
      { serviceName: 'Application Insights', tier: 'Pay-as-you-go', monthlyCost: round(30 + (input.volumeAndScale?.requestsPerDay ?? 1000) * 0.00002), details: 'Telemetry & monitoring' },
    ];
    if (SCALE_APIM[scale] > 0) {
      services.push({ serviceName: 'API Management', tier: scale, monthlyCost: SCALE_APIM[scale], details: 'Gateway, throttling, keys' });
    }
    if (needsSearch) {
      services.push({ serviceName: 'Azure AI Search', tier: scale === 'small' ? 'Basic' : 'Standard', monthlyCost: scale === 'small' ? 75 : 250, details: 'Vector + keyword retrieval for RAG' });
    }
    const infraMonthly = round(services.reduce((s, x) => s + x.monthlyCost, 0));

    // Tokens (monthly).
    const modelBreakdown = this.modelTokenBreakdown(input);
    const monthlyTokenCost = round2(modelBreakdown.reduce((s, m) => s + m.monthlyCost, 0));
    const monthlyTokens = modelBreakdown.reduce((s, m) => s + m.monthlyInputTokens + m.monthlyOutputTokens, 0);

    // Maintenance.
    const maintHours = (SCALE_MAINT_HOURS[scale] ?? 24) + useCases.length * 4;
    const maintMonthly = round(maintHours * MAINT_HOURLY_RATE);

    // First-year total (one-off dev + 12 months run).
    const annualRun = (infraMonthly + monthlyTokenCost + maintMonthly) * 12;
    const expected = round(developmentCost + annualRun);

    return {
      development: {
        aiIntegrationHours: round(aiIntegrationHours),
        hourlyRate: DEV_HOURLY_RATE,
        totalCost: developmentCost,
        breakdown: featureBreakdown,
      },
      infrastructure: {
        monthlyCost: infraMonthly,
        annualCost: infraMonthly * 12,
        services,
      },
      aiTokens: {
        monthlyTokens: { optimistic: round(monthlyTokens * 0.7), expected: round(monthlyTokens), pessimistic: round(monthlyTokens * 1.6) },
        monthlyCost: { optimistic: round2(monthlyTokenCost * 0.7), expected: monthlyTokenCost, pessimistic: round2(monthlyTokenCost * 1.6) },
        annualCost: { optimistic: round2(monthlyTokenCost * 0.7 * 12), expected: round2(monthlyTokenCost * 12), pessimistic: round2(monthlyTokenCost * 1.6 * 12) },
        modelBreakdown,
      },
      maintenance: {
        monthlyHours: maintHours,
        hourlyRate: MAINT_HOURLY_RATE,
        monthlyCost: maintMonthly,
        annualCost: maintMonthly * 12,
        includes: ['Prompt & model upkeep', 'Monitoring & cost guardrails', 'Eval regression checks', 'Dependency updates'],
      },
      total: { min: round(expected * 0.82), expected, max: round(expected * 1.35) },
      currency,
    };
  }

  private modelTokenBreakdown(input: ProjectInput): ModelTokenBreakdown[] {
    const useCases = input.aiUseCases ?? [];
    if (useCases.length === 0) return [];
    const totalRequestsPerDay = Math.max(input.volumeAndScale?.requestsPerDay ?? 1000, useCases.length);

    // Distribute daily requests across use cases by priority weight.
    const weights = useCases.map((u) => PRIORITY_WEIGHT[u.priority]);
    const wTotal = weights.reduce((a, b) => a + b, 0);

    // Group by model.
    const byModel = new Map<string, { useCases: string[]; inTok: number; outTok: number }>();
    useCases.forEach((uc, i) => {
      const p = TASK_PROFILES[uc.taskType];
      const dailyReq = (totalRequestsPerDay * weights[i]) / wTotal;
      const monthlyReq = dailyReq * 30;
      const entry = byModel.get(p.model) ?? { useCases: [], inTok: 0, outTok: 0 };
      entry.useCases.push(uc.name);
      entry.inTok += monthlyReq * p.inTokens;
      entry.outTok += monthlyReq * p.outTokens;
      byModel.set(p.model, entry);
    });

    return [...byModel.entries()].map(([model, e]) => {
      const price = MODEL_CATALOG[model];
      const monthlyCost = round2((e.inTok / 1e6) * price.inPer1M + (e.outTok / 1e6) * price.outPer1M);
      return {
        model,
        useCases: e.useCases,
        monthlyInputTokens: round(e.inTok),
        monthlyOutputTokens: round(e.outTok),
        monthlyCost,
        inputPricePer1M: price.inPer1M,
        outputPricePer1M: price.outPer1M,
      };
    });
  }

  private projectTokens(input: ProjectInput): TokenProjection {
    const breakdown = this.modelTokenBreakdown(input);
    const monthly = breakdown.reduce((s, m) => s + m.monthlyInputTokens + m.monthlyOutputTokens, 0);
    const daily = monthly / 30;
    const mk = (base: number) => ({ optimistic: round(base * 0.7), expected: round(base), pessimistic: round(base * 1.6) });

    const useCases = input.aiUseCases ?? [];
    const modelRecommendations = useCases.map((uc) => {
      const p = TASK_PROFILES[uc.taskType];
      const cat = MODEL_CATALOG[p.model];
      return {
        useCase: uc.name,
        provider: cat.provider,
        recommendedModel: p.model,
        rationale: `${uc.taskType.replace(/_/g, ' ')} ≈ ${p.inTokens}/${p.outTokens} in/out tokens per call.`,
        avgInputTokens: p.inTokens,
        avgOutputTokens: p.outTokens,
      };
    });

    return {
      daily: mk(daily),
      monthly: mk(monthly),
      annual: mk(monthly * 12),
      modelRecommendations,
      assumptions: [
        `${input.volumeAndScale?.requestsPerDay ?? 1000} requests/day at launch`,
        `${input.volumeAndScale?.growthRatePercent ?? 0}% projected growth`,
        'Pessimistic scenario assumes 60% higher volume and longer contexts',
      ],
    };
  }

  private compareApproaches(input: ProjectInput, feas: FeasibilityResult, cost: CostBreakdown): AIvsStandardComparison {
    const aiTotal = cost.total;
    const aiMonthlyRun = cost.infrastructure.monthlyCost + cost.aiTokens.monthlyCost.expected + cost.maintenance.monthlyCost;
    const aiDevHours = cost.development.breakdown.reduce((s, b) => s + b.hours, 0);
    const aiTeam = Math.max(2, Math.ceil(aiDevHours / (HOURS_PER_DEV_WEEK * 8)));
    const aiWeeks = Math.max(4, round(aiDevHours / (HOURS_PER_DEV_WEEK * aiTeam)));

    // Standard build: to reach parity, traditional effort scales with how much AI was carrying the load.
    const reliance = feas.subScores.aiNecessity / 100;
    const stdDevHours = round(aiDevHours * (0.85 + reliance * 0.8)); // more manual work where AI did heavy lifting
    const stdDevCost = round(stdDevHours * DEV_HOURLY_RATE);
    const stdMonthlyRun = round(cost.infrastructure.monthlyCost * 0.5 + cost.maintenance.monthlyCost * 0.8);
    const stdTeam = Math.max(2, Math.ceil(stdDevHours / (HOURS_PER_DEV_WEEK * 8)));
    const stdWeeks = Math.max(4, round(stdDevHours / (HOURS_PER_DEV_WEEK * stdTeam)));
    const stdExpected = round(stdDevCost + stdMonthlyRun * 12);

    const recommendation = feas.score >= 55 ? 'ai' : feas.score >= 40 ? 'hybrid' : 'standard';

    const dimensions = [
      { dimension: 'Time to market', aiScore: clamp(round(5 + reliance * 4), 0, 10), standardScore: clamp(round(8 - reliance * 3), 0, 10), notes: 'AI accelerates ambiguous tasks; standard is faster for well-specified ones.' },
      { dimension: 'Accuracy on fuzzy input', aiScore: clamp(round(4 + reliance * 5), 0, 10), standardScore: clamp(round(8 - reliance * 5), 0, 10), notes: 'Unstructured input favours AI.' },
      { dimension: 'Run cost', aiScore: clamp(round(9 - reliance * 4), 0, 10), standardScore: 9, notes: 'Tokens add ongoing cost the standard build avoids.' },
      { dimension: 'Scalability', aiScore: 8, standardScore: 7, notes: 'Both scale on Azure; AI adds token-budget management.' },
      { dimension: 'Maintainability', aiScore: clamp(round(7 - reliance * 2), 0, 10), standardScore: 7, notes: 'Prompt/model drift needs evals; rules need manual upkeep.' },
      { dimension: 'Flexibility', aiScore: clamp(round(6 + reliance * 4), 0, 10), standardScore: clamp(round(6 - reliance * 2), 0, 10), notes: 'AI adapts to new cases with less re-coding.' },
    ];

    return {
      aiApproach: {
        totalCost: aiTotal,
        timelineWeeks: aiWeeks,
        teamSize: aiTeam,
        benefits: ['Handles unstructured & ambiguous input', 'Faster to adapt to new cases', 'Higher ceiling on automation'],
        challenges: ['Ongoing token cost', 'Needs evaluation & guardrails', 'Output variability to manage'],
        monthlyRunCost: round(aiMonthlyRun),
      },
      standardApproach: {
        totalCost: { min: round(stdExpected * 0.85), expected: stdExpected, max: round(stdExpected * 1.3) },
        timelineWeeks: stdWeeks,
        teamSize: stdTeam,
        benefits: ['Predictable, testable behaviour', 'No per-request token cost', 'Simpler compliance story'],
        challenges: ['Brittle on unstructured input', 'More manual rules to maintain', 'Lower automation ceiling'],
        monthlyRunCost: stdMonthlyRun,
      },
      summary:
        recommendation === 'ai'
          ? 'AI delivers materially more value here than a standard build, and the run-cost premium is justified.'
          : recommendation === 'hybrid'
            ? 'A hybrid split — AI on the fuzzy parts, standard software elsewhere — gives the best cost/value balance.'
            : 'A standard build meets the requirement at lower total cost; reserve AI for a later, targeted phase.',
      recommendation,
      recommendationRationale: feas.archetypeRationale,
      dimensions,
    };
  }

  private buildRisks(input: ProjectInput, a: RecommendationArchetype) {
    const risks = [];
    if (a !== 'traditional') {
      risks.push({ category: 'Cost', description: 'Token spend can grow faster than usage if contexts or retries balloon.', severity: 'medium' as const, mitigation: 'Set per-feature token budgets, cache, and alert on cost-per-request.' });
      risks.push({ category: 'Quality', description: 'Model output variability may surface incorrect or inconsistent results.', severity: 'high' as const, mitigation: 'Add an eval suite, human-in-the-loop on high-stakes paths, and guardrails.' });
    }
    if (a === 'multi_agent') {
      risks.push({ category: 'Complexity', description: 'Multi-agent orchestration adds failure modes and debugging surface.', severity: 'high' as const, mitigation: 'Start with the smallest agent set; add tracing and step-level retries.' });
    }
    const compliance = input.technicalPreferences?.complianceRequirements ?? [];
    if (compliance.length) {
      risks.push({ category: 'Compliance', description: `Data handling must satisfy: ${compliance.join(', ')}.`, severity: 'high' as const, mitigation: 'Use private/regional model endpoints and data-residency-aware storage.' });
    }
    if (risks.length === 0) {
      risks.push({ category: 'Scope', description: 'Requirements are deterministic; main risk is over-engineering.', severity: 'low' as const, mitigation: 'Ship the standard build; revisit AI only with a measured use case.' });
    }
    return risks;
  }

  private buildOpportunities(a: RecommendationArchetype, useCases: AIUseCase[]): string[] {
    if (a === 'traditional') {
      return ['Bank the savings now; instrument the product to find a future AI use case with real signal.'];
    }
    const ops = ['Phase the rollout: prove value on one use case before expanding.'];
    if (useCases.some((u) => u.taskType === 'rag_qa')) ops.push('Reuse the retrieval layer across future assistant features.');
    if (a === 'multi_agent' || a === 'single_agent') ops.push('Capture agent traces to build an evaluation dataset over time.');
    ops.push('Negotiate committed-throughput pricing once volume stabilises.');
    return ops;
  }

  private buildRecommendations(input: ProjectInput, feas: FeasibilityResult): Recommendation[] {
    const recs: Recommendation[] = [
      {
        priority: 'high',
        category: 'Approach',
        title: `Build as: ${feas.archetypeLabel}`,
        description: feas.archetypeRationale,
        estimatedImpact: 'Sets the cost and complexity envelope for the whole project.',
      },
    ];
    if (feas.archetype !== 'traditional') {
      recs.push({
        priority: 'high',
        category: 'FinOps',
        title: 'Instrument cost-per-request from day one',
        description: 'Tag every model call with a use case and surface $/request in a dashboard.',
        estimatedImpact: 'Keeps token spend predictable and prevents budget surprises.',
      });
      recs.push({
        priority: 'medium',
        category: 'Quality',
        title: 'Stand up an evaluation harness early',
        description: 'A small labelled set + automated scoring catches regressions before users do.',
        estimatedImpact: 'Reduces production incidents and rework.',
      });
    }
    recs.push({
      priority: 'medium',
      category: 'Delivery',
      title: 'Ship a thin vertical slice first',
      description: 'One use case, end to end, in front of real users before scaling breadth.',
      estimatedImpact: 'De-risks the estimate with real usage data.',
    });
    return recs;
  }

  private composeMarkdown(input: ProjectInput, feas: FeasibilityResult, cost: CostBreakdown): string {
    const fmt = (n: number) => `${cost.currency} ${n.toLocaleString()}`;
    return [
      `# ${input.projectName} — AI Feasibility & Cost`,
      ``,
      `**Recommendation:** ${feas.archetypeLabel} (feasibility ${feas.score}/100, ${feas.rating}).`,
      ``,
      feas.rationale,
      ``,
      `## Cost (first year)`,
      `- Development: ${fmt(cost.development.totalCost)}`,
      `- Infrastructure: ${fmt(cost.infrastructure.annualCost)}/yr`,
      `- AI tokens: ${fmt(cost.aiTokens.annualCost.expected)}/yr (expected)`,
      `- Maintenance: ${fmt(cost.maintenance.annualCost)}/yr`,
      `- **Total expected: ${fmt(cost.total.expected)}** (range ${fmt(cost.total.min)}–${fmt(cost.total.max)})`,
    ].join('\n');
  }

  /* ── Seed-summary synthesis (so existing rows open a full report) ── */

  private synthesizeFromSummary(summary: EstimateSummary): Estimation {
    const input = this.summaryToInput(summary);
    const est = this.computeEstimation(input, summary.id, summary.updatedAt);
    // Keep headline numbers consistent with the dashboard/history row.
    est.feasibility.score = summary.feasibilityScore;
    est.feasibility.rating = ratingForScore(summary.feasibilityScore);
    est.feasibility.archetypeLabel = summary.recommendationLabel;
    return est;
  }

  private summaryToInput(s: EstimateSummary): ProjectInput {
    const scale: ProjectScale =
      s.totalCostExpected < 30000 ? 'small' : s.totalCostExpected < 80000 ? 'medium' : s.totalCostExpected < 150000 ? 'large' : 'enterprise';
    const taskTypes = this.tasksForLabel(s.recommendationLabel);
    const aiUseCases: AIUseCase[] = taskTypes.map((t, i) => ({
      id: `uc_${i}`,
      name: t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()),
      taskType: t,
      description: '',
      priority: i === 0 ? 'must_have' : 'nice_to_have',
      linkedFeatureIds: [],
    }));
    return {
      projectName: s.projectName,
      projectType: s.projectType,
      description: `${s.projectName} — ${s.industryDomain}`,
      industryDomain: s.industryDomain,
      targetUsers: 'Internal & external stakeholders',
      scale,
      features: [
        { id: 'f1', name: 'Core application', description: '', complexity: 'high', aiCandidate: taskTypes.length > 0 },
        { id: 'f2', name: 'Reporting & dashboards', description: '', complexity: 'medium', aiCandidate: false },
      ],
      aiUseCases,
      technicalPreferences: {
        preferredLLMProvider: 'Azure OpenAI',
        deploymentModel: 'cloud',
        existingInfra: 'Azure',
        complianceRequirements: [],
        budgetCurrency: s.currency,
      },
      volumeAndScale: {
        expectedDailyUsers: scale === 'enterprise' ? 5000 : scale === 'large' ? 1500 : scale === 'medium' ? 400 : 80,
        requestsPerDay: scale === 'enterprise' ? 40000 : scale === 'large' ? 12000 : scale === 'medium' ? 3000 : 600,
        dataVolumeGB: scale === 'enterprise' ? 500 : scale === 'large' ? 120 : scale === 'medium' ? 30 : 8,
        peakLoadPattern: 'Business hours',
        growthRatePercent: 20,
      },
    };
  }

  private tasksForLabel(label: string): AITaskType[] {
    switch (label) {
      case 'Multi-Agent':
        return ['multi_agent_orchestration', 'rag_qa'];
      case 'Single Agent':
        return ['conversational_agent', 'data_extraction'];
      case 'RAG Assistant':
        return ['rag_qa', 'document_analysis'];
      case 'Traditional + AI':
        return ['text_classification', 'summarization'];
      case 'Traditional Only':
        return [];
      default:
        return ['rag_qa'];
    }
  }
}
