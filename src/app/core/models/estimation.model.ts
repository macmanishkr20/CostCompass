/* ── Estimation & Report Models ─────────────────────────────────── */

import { CurrentArchitecture, DeliveryPlatform, ProjectType } from './project.model';

export interface Estimation {
  id: string;
  projectId: string;
  projectName: string;
  projectType: ProjectType;
  industryDomain?: string;
  feasibility: FeasibilityResult;
  /** The decisive call. Optional for estimates persisted before it existed. */
  verdict?: Verdict;
  /** How much to trust these figures. Optional for the same reason. */
  confidence?: ConfidenceAssessment;
  costBreakdown: CostBreakdown;
  tokenProjection: TokenProjection;
  comparison: AIvsStandardComparison;
  roiProjection?: ROIProjection;
  recommendations: Recommendation[];
  reportMarkdown: string;
  status: 'generating' | 'complete' | 'error';
  generatedAt: string;
  /** Present only for enhancement-mode estimates (existing-app analysis). */
  repoContext?: RepoContext;
  /** How the delivery platform was chosen and why. Optional for older records. */
  solutionProposal?: SolutionProposal;
  /** Multi-agent ReAct orchestration trace. Present only for AGENTIC_MODE runs. */
  agentRun?: AgentRun;
}

/* ── Agentic run (multi-agent ReAct orchestration) ──── */

/** One entry in the multi-agent reasoning transcript. */
export interface AgentStep {
  agent: string;
  /** ReAct/orchestration phase. */
  kind: 'thought' | 'action' | 'observation' | 'decision' | 'route' | 'critique' | 'fallback' | string;
  content: string;
}

/** A consistency issue the risk-critic raised about the draft estimate. */
export interface AgentCritique {
  issue: string;
  severity: 'low' | 'medium' | 'high';
  target: string;
  resolved: boolean;
}

/** An audited deterministic computation an agent invoked (SHA-256 of its output). */
export interface ToolCall {
  agent: string;
  tool: string;
  outputHash: string;
}

/**
 * How a multi-agent run unfolded: the supervisor's path through the specialist
 * ReAct agents, the full reasoning transcript, the critic's findings, and the
 * hashed tool ledger. `integrityVerified` records whether the agents' own tool
 * outputs matched the strict deterministic recompute that produced the final
 * numbers — so every figure stays code-computed and auditable. Present only for
 * estimates produced with AGENTIC_MODE on; optional for every other record.
 */
export interface AgentRun {
  mode: 'agentic' | 'deterministic';
  supervisorPath: string[];
  steps: AgentStep[];
  critiques: AgentCritique[];
  toolLedger: ToolCall[];
  revisions: number;
  integrityVerified: boolean;
  llmUsed: boolean;
}

/* ── Solution architecture proposal (ReAct agent) ──── */

/** A platform the architect considered but rejected, and why. */
export interface SolutionAlternative {
  platform: DeliveryPlatform;
  whyNot: string;
}

/**
 * The recommended delivery platform plus the architect's reasoning. Produced by
 * the backend ReAct solution-architect node (LLM when configured, else a
 * deterministic heuristic). The LLM only chooses a platform label and explains
 * it — the deterministic engine still computes every cost from the resolved
 * platform.
 */
export interface SolutionProposal {
  recommendedPlatform: DeliveryPlatform;
  platformLabel: string;
  costModel: string;
  rationale: string;
  alternatives: SolutionAlternative[];
  /** Thought/Action/Observation trace; empty on the heuristic path. */
  reasoningSteps: string[];
  source: 'agent' | 'heuristic' | 'explicit';
}

/* ── Verdict (the canonical, decisive call) ──── */

/**
 * The platform's single, unambiguous recommendation — willing to say no.
 * Derived from the feasibility archetype and the AI-vs-standard comparison.
 */
export interface Verdict {
  decision: 'build_with_ai' | 'hybrid' | 'do_not_use_ai';
  headline: string; // Boardroom-ready phrasing of the call
  oneLiner: string; // The one-line why
  disposition: 'go' | 'caution' | 'stop'; // UI/copy tone
  recommendAi: boolean;
}

/* ── Confidence (deterministic self-assessment) ──── */

export interface ConfidenceFactor {
  label: string;
  detail: string;
  impact: 'positive' | 'neutral' | 'negative';
}

/**
 * How much weight to place on the estimate, computed — not guessed — from input
 * completeness, how decisively the score clears the decision thresholds, and how
 * grounded the estimate is.
 */
export interface ConfidenceAssessment {
  level: 'low' | 'medium' | 'high';
  score: number; // 0–100
  rationale: string;
  factors: ConfidenceFactor[];
}

/* ── ROI Projection (deterministic payback & 3-year value) ──── */
export interface ROIProjection {
  annualBenefit: number;
  annualRunCost: number;
  developmentCost: number;
  netAnnualBenefit: number;
  paybackMonths: number | null;
  threeYearValue: number;
  roiPercent: number;
  curve: ROICurvePoint[];
  valueDrivers: ValueDriver[];
  assumptions: string[];
}

export interface ROICurvePoint {
  month: number;
  cumulativeNet: number;
}

export interface ValueDriver {
  useCase: string;
  valuePerCall: number;
  annualCalls: number;
  annualValue: number;
  /** Transparent benefit basis (absent when a flat valuePerCall override was used). */
  minutesPerCall?: number;
  loadedHourlyRate?: number;
  automationRatePercent?: number;
}

/** Snapshot of the analyzed repository carried into the report. */
export interface RepoContext {
  fullName: string;
  htmlUrl: string;
  branch: string;
  primaryLanguage: string;
  stars: number;
  fileCount: number;
  architecture: CurrentArchitecture;
  manifestsFound: string[];
  topics: string[];
}

/* ── Feasibility ──── */

/**
 * The six recommendation archetypes the scoring engine can land on,
 * ordered roughly by increasing AI/agentic intensity.
 */
export type RecommendationArchetype =
  | 'traditional' // Build with standard software only — AI not justified
  | 'traditional_plus_ai' // Mostly traditional, targeted AI features bolted on
  | 'rag_assistant' // Retrieval-augmented assistant over your data
  | 'single_agent' // One autonomous agent with tools
  | 'multi_agent' // Orchestrated multi-agent system
  | 'hybrid'; // Deliberate mix of traditional services + agents

/**
 * The three independent sub-scores that drive the recommendation.
 * Each is 0–100. The engine compares them to pick an archetype.
 */
export interface FeasibilitySubScores {
  aiNecessity: number; // How strongly the problem demands AI/ML at all
  agenticSuitability: number; // How well it fits autonomous, multi-step agents
  traditionalSuitability: number; // How well plain deterministic software fits
}

export interface FeasibilityResult {
  score: number; // 0–100 composite
  rating: 'low' | 'medium' | 'high' | 'excellent';
  subScores: FeasibilitySubScores;
  archetype: RecommendationArchetype;
  archetypeLabel: string; // Human label, e.g. "RAG Assistant"
  archetypeRationale: string; // Why this archetype over the others
  rationale: string;
  useCaseAnalysis: UseCaseAnalysis[];
  risks: RiskItem[];
  opportunities: string[];
}

export interface UseCaseAnalysis {
  useCaseName: string;
  feasibilityScore: number;
  aiTaskType: string;
  justification: string;
  recommendedModel: string;
  complexity: 'low' | 'medium' | 'high';
  // Per-capability lean so "Hybrid" can name which features go AI vs standard.
  // Optional for backward-compat with estimations persisted before this field existed.
  recommendedApproach?: 'ai' | 'standard';
}

export interface RiskItem {
  category: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  mitigation: string;
}

/* ── Cost Breakdown ──── */
export interface CostBreakdown {
  development: DevelopmentCost;
  infrastructure: InfrastructureCost;
  aiTokens: TokenCost;
  maintenance: MaintenanceCost;
  total: CostRange;
  currency: string;
}

export interface DevelopmentCost {
  aiIntegrationHours: number;
  hourlyRate: number;
  totalCost: number;
  breakdown: { category: string; hours: number; cost: number }[];
}

export interface InfrastructureCost {
  monthlyCost: number;
  annualCost: number;
  services: AzureServiceCost[];
  // Delivery-platform metadata. Optional for backward-compat with estimations
  // persisted before the platform dimension existed (those are Azure PaaS).
  platform?: DeliveryPlatform;
  platformLabel?: string;
  // 'consumption' (metered compute), 'licensing' (per-seat) or 'capex' (amortized).
  costModel?: string;
  // Whether AI token spend is metered separately (consumption/capex) or bundled
  // into a per-seat licence (M365/Copilot). When false the AI-tokens line is $0.
  metersTokens?: boolean;
  notes?: string[];
}

export interface AzureServiceCost {
  serviceName: string;
  category: string;              // Compute, AI, Data & Storage, Security, …
  tier: string;
  region: string;               // ARM region this service is priced in
  quantity: number;             // deterministic units consumed per month
  unit: string;                 // what a unit is (hour, GB/mo, 1M tokens, …)
  unitPrice: number;            // USD per unit
  monthlyCost: number;
  // 'live' = priced from the Azure Retail Prices API; 'fallback' = metered
  // service the API couldn't reach; 'estimate' = deterministic baseline.
  priceSource: 'live' | 'fallback' | 'estimate';
  // Azure OpenAI tokens are already counted in the AI-tokens line, so its row
  // is shown for completeness but excluded from the infra subtotal.
  includedInTotal: boolean;
  details: string;
  azurePricingUrl?: string;      // Deep link to the Azure pricing calculator
}

export interface TokenCost {
  monthlyTokens: TokenScenario;
  monthlyCost: TokenScenario;
  annualCost: TokenScenario;
  modelBreakdown: ModelTokenBreakdown[];
}

export interface TokenScenario {
  optimistic: number;
  expected: number;
  pessimistic: number;
}

export interface ModelTokenBreakdown {
  model: string;
  useCases: string[];
  monthlyInputTokens: number;
  monthlyOutputTokens: number;
  monthlyCost: number;
  inputPricePer1M: number;
  outputPricePer1M: number;
}

export interface MaintenanceCost {
  monthlyHours: number;
  hourlyRate: number;
  monthlyCost: number;
  annualCost: number;
  includes: string[];
}

export interface CostRange {
  min: number;
  expected: number;
  max: number;
}

/* ── Token Projection (usage volume, not cost) ──── */
export interface TokenProjection {
  daily: TokenScenario;
  monthly: TokenScenario;
  annual: TokenScenario;
  modelRecommendations: ModelRecommendation[];
  assumptions: string[];
}

export interface ModelRecommendation {
  useCase: string;
  provider: string;
  recommendedModel: string;
  rationale: string;
  avgInputTokens: number;
  avgOutputTokens: number;
}

/* ── AI vs Standard Comparison ──── */
export interface AIvsStandardComparison {
  aiApproach: ApproachDetail;
  standardApproach: ApproachDetail;
  summary: string;
  recommendation: 'ai' | 'standard' | 'hybrid';
  recommendationRationale: string;
  dimensions: ComparisonDimension[];
}

export interface ApproachDetail {
  totalCost: CostRange;
  timelineWeeks: number;
  teamSize: number;
  benefits: string[];
  challenges: string[];
  monthlyRunCost: number;
}

export interface ComparisonDimension {
  dimension: string;
  aiScore: number;          // 0–10
  standardScore: number;    // 0–10
  notes: string;
}

/* ── Recommendations ──── */
export interface Recommendation {
  priority: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  estimatedImpact: string;
}

/* ── SSE Streaming ──── */
export interface EstimationSSEChunk {
  node: string;           // Current agent node
  status: string;         // 'processing' | 'complete' | 'error'
  content?: string;       // Partial content
  progress?: number;      // 0-100
  data?: any;             // Partial result data
}
