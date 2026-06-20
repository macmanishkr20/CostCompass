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
export interface FeasibilityResult {
  score: number;                   // 0–100
  rating: 'low' | 'medium' | 'high' | 'excellent';
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
