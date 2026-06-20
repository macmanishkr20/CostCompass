/* ── Estimation & Report Models ─────────────────────────────────── */

export interface Estimation {
  id: string;
  projectId: string;
  feasibility: FeasibilityResult;
  costBreakdown: CostBreakdown;
  tokenProjection: TokenProjection;
  comparison: AIvsStandardComparison;
  recommendations: Recommendation[];
  reportMarkdown: string;
  status: 'generating' | 'complete' | 'error';
  generatedAt: string;
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
}

export interface AzureServiceCost {
  serviceName: string;
  tier: string;
  monthlyCost: number;
  details: string;
  azurePricingUrl?: string;      // Link to Azure Price Calculator
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
