"""Pydantic models mirroring the Angular TypeScript interfaces.

JSON crosses the wire in camelCase (the Angular app speaks camelCase), while
Python code reads snake_case. A `to_camel` alias generator bridges the two;
a handful of fields with acronyms/digits (LLM, per1M) get explicit aliases so
they round-trip byte-for-byte with the frontend models.
"""

from __future__ import annotations

from typing import Any, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base: snake_case in Python, camelCase on the wire, accept both on input."""

    model_config = ConfigDict(
        alias_generator=to_camel,
        populate_by_name=True,
        extra="ignore",
    )


# ── Project input ───────────────────────────────────────────────────

ProjectType = Literal["new", "enhancement"]
ProjectScale = Literal["small", "medium", "large", "enterprise"]
Complexity = Literal["low", "medium", "high", "very_high"]
Priority = Literal["must_have", "nice_to_have", "exploratory"]
AITaskType = Literal[
    "text_classification", "summarization", "code_generation", "conversational_agent",
    "rag_qa", "multi_agent_orchestration", "document_analysis", "image_analysis",
    "translation", "data_extraction", "recommendation", "anomaly_detection",
    # Deterministic, non-AI capabilities — let a use case honestly say it needs no LLM.
    "rules_workflow", "crud_lookup", "threshold_alerting",
]


class FeatureItem(CamelModel):
    id: str = ""
    name: str = ""
    description: str = ""
    complexity: Complexity = "medium"
    ai_candidate: bool = False


class AIUseCase(CamelModel):
    id: str = ""
    name: str = ""
    # Free-text intake can leave this blank; the classify node fills it in.
    task_type: Optional[str] = None
    description: str = ""
    priority: Priority = "must_have"
    linked_feature_ids: list[str] = Field(default_factory=list)
    # ROI benefit basis, overridable per use case: how many minutes of manual
    # work one automated call replaces. None falls back to the task-type default.
    minutes_per_call: Optional[float] = None
    # Optional hard override of the derived $/call — bypasses the minutes×rate
    # math entirely for a power user who already knows the unit value. None keeps
    # the transparent derivation, so existing payloads compute identical figures.
    value_per_call: Optional[float] = None


class CostAssumptions(CamelModel):
    """Org-specific rate card and resourcing dials.

    Every figure leadership sees ultimately multiplies these. They default to
    the platform's blended baseline so an omitted block reproduces the
    out-of-the-box numbers exactly; an org overrides them with its own real
    rates and effective working hours to localise the entire estimate.
    """

    dev_hourly_rate: float = 115
    maint_hourly_rate: float = 95
    # Effective (not nominal) engineering hours delivered per person-week —
    # the resourcing dial behind timeline and team-size math.
    effective_hours_per_week: float = 32
    # ROI benefit dials. value/call = minutes ÷ 60 × loaded_rate × automation%.
    # The fully-loaded cost of the person whose work AI offsets, and the share of
    # calls AI handles end-to-end (deflection) rather than an assumed perfect 100%.
    loaded_hourly_rate: float = 75
    automation_rate_percent: float = 70


DeliveryPlatform = Literal["azure_paas", "aws", "gcp", "m365_copilot", "on_prem"]


class TechnicalPreferences(CamelModel):
    preferred_llm_provider: str = Field(default="Azure OpenAI", alias="preferredLLMProvider")
    deployment_model: Literal["cloud", "hybrid", "edge"] = "cloud"
    # Which delivery platform the app is (or will be) built on. Selects the cost
    # *model* — consumption (Azure/AWS/GCP), per-seat licensing (M365/Copilot) or
    # capex (on-prem) — not just a price book. None lets the engine infer it from
    # existing_infra / hosting_platform / deployment_target keywords.
    delivery_platform: Optional[DeliveryPlatform] = None
    existing_infra: str = ""
    compliance_requirements: list[str] = Field(default_factory=list)
    budget_ceiling: Optional[float] = None
    budget_currency: str = "USD"
    # Azure regions used to price infrastructure. A single primary region drives
    # every service, with dedicated overrides for the two services whose
    # availability/price varies most by region.
    azure_region: str = "eastus"
    azure_openai_region: str = Field(default="eastus", alias="azureOpenAIRegion")
    azure_search_region: str = Field(default="eastus", alias="azureSearchRegion")


class VolumeAndScale(CamelModel):
    expected_daily_users: Optional[int] = None
    requests_per_day: Optional[int] = None
    # to_camel would yield "dataVolumeGb"; the TS field is "dataVolumeGB".
    data_volume_gb: Optional[float] = Field(default=None, alias="dataVolumeGB")
    peak_load_pattern: str = ""
    growth_rate_percent: Optional[float] = None


class CurrentArchitecture(CamelModel):
    framework: str = ""
    language: str = ""
    database: str = ""
    api_pattern: str = ""
    hosting_platform: str = ""
    ci_cd: str = ""


class IntegrationConstraints(CamelModel):
    deployment_target: str = ""
    budget_ceiling: float = 0
    budget_currency: str = "USD"
    timeline_weeks: int = 0


class ProjectInput(CamelModel):
    project_name: str = "Untitled project"
    project_type: ProjectType = "new"
    description: str = ""
    industry_domain: str = ""
    target_users: str = ""
    scale: ProjectScale = "medium"
    features: list[FeatureItem] = Field(default_factory=list)
    ai_use_cases: list[AIUseCase] = Field(default_factory=list)
    technical_preferences: Optional[TechnicalPreferences] = None
    volume_and_scale: Optional[VolumeAndScale] = None
    # Overridable rate card / resourcing dials; None uses platform baselines.
    cost_assumptions: Optional[CostAssumptions] = None
    # Enhancement-specific
    repo_url: Optional[str] = None
    repo_branch: Optional[str] = None
    current_architecture: Optional[CurrentArchitecture] = None
    enhancement_scope: Optional[str] = None
    integration_constraints: Optional[IntegrationConstraints] = None
    # Repo analysis snapshot (carried into the report for enhancement mode)
    repo_full_name: Optional[str] = None
    repo_stars: Optional[int] = None
    repo_file_count: Optional[int] = None
    repo_manifests: Optional[list[str]] = None
    repo_topics: Optional[list[str]] = None


# ── Feasibility ─────────────────────────────────────────────────────

RecommendationArchetype = Literal[
    "traditional", "traditional_plus_ai", "rag_assistant",
    "single_agent", "multi_agent", "hybrid",
]


class FeasibilitySubScores(CamelModel):
    ai_necessity: int
    agentic_suitability: int
    traditional_suitability: int


class UseCaseAnalysis(CamelModel):
    use_case_name: str
    feasibility_score: int
    ai_task_type: str
    justification: str
    recommended_model: str
    complexity: Literal["low", "medium", "high"]
    # Per-capability lean so "Hybrid" can name which features go AI vs standard.
    # Optional for backward-compat with estimations persisted before this field existed.
    recommended_approach: Optional[Literal["ai", "standard"]] = None


class RiskItem(CamelModel):
    category: str
    description: str
    severity: Literal["low", "medium", "high", "critical"]
    mitigation: str


class FeasibilityResult(CamelModel):
    score: int
    rating: Literal["low", "medium", "high", "excellent"]
    sub_scores: FeasibilitySubScores
    archetype: RecommendationArchetype
    archetype_label: str
    archetype_rationale: str
    rationale: str
    use_case_analysis: list[UseCaseAnalysis]
    risks: list[RiskItem]
    opportunities: list[str]


# ── Cost ────────────────────────────────────────────────────────────

class DevBreakdownItem(CamelModel):
    category: str
    hours: int
    cost: int


class DevelopmentCost(CamelModel):
    ai_integration_hours: int
    hourly_rate: float
    total_cost: int
    breakdown: list[DevBreakdownItem]


class AzureServiceCost(CamelModel):
    service_name: str
    category: str = "General"
    tier: str
    region: str = ""
    quantity: float = 1
    unit: str = ""
    unit_price: float = 0
    monthly_cost: float
    # 'live'  = priced from the Azure Retail Prices API just now
    # 'fallback' = a metered service the API couldn't reach; catalog price used
    # 'estimate' = no clean per-unit meter; deterministic baseline estimate
    price_source: Literal["live", "fallback", "estimate"] = "estimate"
    # Azure OpenAI token cost is already counted in the AI-tokens line; listing
    # it here for completeness without adding it to the infra subtotal avoids
    # double counting. Such rows carry included_in_total=False.
    included_in_total: bool = True
    details: str
    azure_pricing_url: Optional[str] = None


class InfrastructureCost(CamelModel):
    monthly_cost: float
    annual_cost: float
    services: list[AzureServiceCost]
    # Delivery-platform metadata. Optional for backward-compat with estimations
    # persisted before the platform dimension existed (those are Azure PaaS).
    platform: Optional[DeliveryPlatform] = None
    platform_label: Optional[str] = None
    # 'consumption' (metered compute), 'licensing' (per-seat) or 'capex' (amortized).
    cost_model: Optional[str] = None
    # Whether AI token spend is metered separately (consumption/capex) or bundled
    # into a per-seat licence (M365/Copilot). When False the AI-tokens line is $0.
    meters_tokens: Optional[bool] = None
    notes: list[str] = Field(default_factory=list)


class TokenScenario(CamelModel):
    optimistic: float
    expected: float
    pessimistic: float


class ModelTokenBreakdown(CamelModel):
    model: str
    use_cases: list[str]
    monthly_input_tokens: int
    monthly_output_tokens: int
    monthly_cost: float
    input_price_per_1m: float = Field(alias="inputPricePer1M")
    output_price_per_1m: float = Field(alias="outputPricePer1M")


class TokenCost(CamelModel):
    monthly_tokens: TokenScenario
    monthly_cost: TokenScenario
    annual_cost: TokenScenario
    model_breakdown: list[ModelTokenBreakdown]


class MaintenanceCost(CamelModel):
    monthly_hours: int
    hourly_rate: float
    monthly_cost: int
    annual_cost: int
    includes: list[str]


class CostRange(CamelModel):
    min: int
    expected: int
    max: int


class CostBreakdown(CamelModel):
    development: DevelopmentCost
    infrastructure: InfrastructureCost
    ai_tokens: TokenCost
    maintenance: MaintenanceCost
    total: CostRange
    currency: str


# ── Token projection ────────────────────────────────────────────────

class ModelRecommendation(CamelModel):
    use_case: str
    provider: str
    recommended_model: str
    rationale: str
    avg_input_tokens: int
    avg_output_tokens: int


class TokenProjection(CamelModel):
    daily: TokenScenario
    monthly: TokenScenario
    annual: TokenScenario
    model_recommendations: list[ModelRecommendation]
    assumptions: list[str]


# ── AI vs Standard comparison ───────────────────────────────────────

class ApproachDetail(CamelModel):
    total_cost: CostRange
    timeline_weeks: int
    team_size: int
    benefits: list[str]
    challenges: list[str]
    monthly_run_cost: int


class ComparisonDimension(CamelModel):
    dimension: str
    ai_score: int
    standard_score: int
    notes: str


class AIvsStandardComparison(CamelModel):
    ai_approach: ApproachDetail
    standard_approach: ApproachDetail
    summary: str
    recommendation: Literal["ai", "standard", "hybrid"]
    recommendation_rationale: str
    dimensions: list[ComparisonDimension]


# ── ROI projection (deterministic) ──────────────────────────────────

class ValueDriver(CamelModel):
    use_case: str
    value_per_call: float
    annual_calls: int
    annual_value: float
    # Transparent benefit basis (None when a flat value_per_call override was
    # used, or for estimates persisted before the decomposition existed).
    minutes_per_call: Optional[float] = None
    loaded_hourly_rate: Optional[float] = None
    automation_rate_percent: Optional[float] = None


class ROICurvePoint(CamelModel):
    month: int
    cumulative_net: float


class ROIProjection(CamelModel):
    annual_benefit: float
    annual_run_cost: float
    development_cost: float
    net_annual_benefit: float
    payback_months: Optional[float] = None
    three_year_value: float
    roi_percent: int
    curve: list[ROICurvePoint]
    value_drivers: list[ValueDriver]
    assumptions: list[str]


# ── Confidence (deterministic self-assessment) ──────────────────────

class ConfidenceFactor(CamelModel):
    """One scored dimension behind the headline confidence level."""

    label: str
    detail: str
    # How this factor moves confidence: a strong signal lifts it, a weak/
    # defaulted one drags it down, a neutral one neither helps nor hurts.
    impact: Literal["positive", "neutral", "negative"]


class ConfidenceAssessment(CamelModel):
    """How much weight to place on this estimate, computed — not guessed.

    The score is a deterministic function of input completeness, how decisively
    the feasibility score clears the decision thresholds, and how grounded the
    estimate is. It tells leadership whether to treat the numbers as bankable or
    directional, and the factors say exactly what to firm up to raise it.
    """

    level: Literal["low", "medium", "high"]
    score: int  # 0–100
    rationale: str
    factors: list[ConfidenceFactor]


# ── Verdict (the canonical, decisive call) ──────────────────────────

class Verdict(CamelModel):
    """The platform's single, unambiguous recommendation — willing to say no.

    Derived from the feasibility archetype and the AI-vs-standard comparison, it
    collapses the analysis into one decision leadership can act on, including the
    honest "don't use AI here" when standard software is the better call.
    """

    decision: Literal["build_with_ai", "hybrid", "do_not_use_ai"]
    # Boardroom-ready phrasing of the call and the one-line why.
    headline: str
    one_liner: str
    # UI/copy tone: a green go, an amber qualified go, or a red stop.
    disposition: Literal["go", "caution", "stop"]
    recommend_ai: bool


# ── Recommendations ─────────────────────────────────────────────────

class Recommendation(CamelModel):
    priority: Literal["critical", "high", "medium", "low"]
    category: str
    title: str
    description: str
    estimated_impact: str


# ── Solution architecture proposal (ReAct agent) ────────────────────

class SolutionAlternative(CamelModel):
    """A platform the architect considered but did not recommend, and why."""
    platform: DeliveryPlatform
    why_not: str


class SolutionProposal(CamelModel):
    """The recommended delivery platform + the architect's reasoning.

    Produced by the ReAct solution-architect node (LLM when configured, else a
    deterministic heuristic). The LLM only *chooses a platform label and explains
    it* — the deterministic engine still computes every dollar from the resolved
    `delivery_platform`. Optional on Estimation for backward compatibility with
    records persisted before this node existed.
    """
    recommended_platform: DeliveryPlatform
    platform_label: str
    cost_model: str  # 'consumption' | 'licensing' | 'capex'
    rationale: str
    alternatives: list[SolutionAlternative] = Field(default_factory=list)
    # The Thought/Action/Observation trace, surfaced for transparency. Empty for
    # the heuristic path (which records a short deterministic note instead).
    reasoning_steps: list[str] = Field(default_factory=list)
    # 'agent' = LLM ReAct loop; 'heuristic' = deterministic fallback;
    # 'explicit' = the user picked the platform, no inference needed.
    source: Literal["agent", "heuristic", "explicit"] = "heuristic"


# ── Agentic run (multi-agent ReAct orchestration) ───────────────────

class AgentStep(CamelModel):
    """One entry in the multi-agent reasoning transcript.

    `kind` is the ReAct/orchestration phase: 'thought' | 'action' |
    'observation' | 'decision' | 'route' | 'critique' | 'fallback'. Surfaced for
    transparency; never carries a number the engine didn't compute.
    """
    agent: str
    kind: str
    content: str


class AgentCritique(CamelModel):
    """A consistency issue the risk-critic raised about the draft estimate."""
    issue: str
    severity: Literal["low", "medium", "high"]
    target: str  # which specialist/artifact the critique concerns
    resolved: bool = False


class ToolCall(CamelModel):
    """An audited deterministic computation an agent invoked.

    `output_hash` is a SHA-256 of the tool's canonical-JSON result, so any number
    in the report is traceable to the exact deterministic call that produced it.
    """
    agent: str
    tool: str
    output_hash: str


class AgentRun(CamelModel):
    """How a multi-agent (supervisor + specialist ReAct agents) run unfolded.

    Present only on estimates produced with AGENTIC_MODE on. The strict integrity
    guard re-derives every figure from the agent-resolved inputs and refuses to
    let an agent-fabricated number survive — `integrity_verified` records whether
    the agents' own tool outputs matched that clean recompute. Optional on
    Estimation for backward compatibility with deterministically produced records.
    """
    mode: Literal["agentic", "deterministic"] = "deterministic"
    supervisor_path: list[str] = Field(default_factory=list)
    steps: list[AgentStep] = Field(default_factory=list)
    critiques: list[AgentCritique] = Field(default_factory=list)
    tool_ledger: list[ToolCall] = Field(default_factory=list)
    revisions: int = 0
    integrity_verified: bool = False
    llm_used: bool = False


# ── Repo context ────────────────────────────────────────────────────

class RepoContext(CamelModel):
    full_name: str
    html_url: str
    branch: str
    primary_language: str
    stars: int
    file_count: int
    architecture: CurrentArchitecture
    manifests_found: list[str]
    topics: list[str]


# ── Top-level estimation ────────────────────────────────────────────

class Estimation(CamelModel):
    id: str
    project_id: str
    project_name: str
    project_type: ProjectType
    industry_domain: str = ""
    feasibility: FeasibilityResult
    # The decisive call and how much to trust it. Optional for backward
    # compatibility with estimations persisted before these were introduced;
    # every freshly computed estimate populates both.
    verdict: Optional[Verdict] = None
    confidence: Optional[ConfidenceAssessment] = None
    cost_breakdown: CostBreakdown
    token_projection: TokenProjection
    comparison: AIvsStandardComparison
    roi_projection: ROIProjection
    recommendations: list[Recommendation]
    report_markdown: str
    status: Literal["generating", "complete", "error"] = "complete"
    generated_at: str
    repo_context: Optional[RepoContext] = None
    # How the delivery platform was chosen and why. Optional for backward
    # compatibility with estimations persisted before the architect node.
    solution_proposal: Optional[SolutionProposal] = None
    # The multi-agent ReAct orchestration trace (supervisor path, reasoning
    # steps, critiques, tool ledger, integrity result). Present only for runs
    # produced with AGENTIC_MODE on; Optional for every other record.
    agent_run: Optional[AgentRun] = None


class EstimationSSEChunk(CamelModel):
    node: str
    status: str
    content: Optional[str] = None
    progress: Optional[int] = None
    data: Optional[Any] = None
