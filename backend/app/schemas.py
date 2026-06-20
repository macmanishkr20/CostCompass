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


class TechnicalPreferences(CamelModel):
    preferred_llm_provider: str = Field(default="Azure OpenAI", alias="preferredLLMProvider")
    deployment_model: Literal["cloud", "hybrid", "edge"] = "cloud"
    existing_infra: str = ""
    compliance_requirements: list[str] = Field(default_factory=list)
    budget_ceiling: Optional[float] = None
    budget_currency: str = "USD"


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
    hourly_rate: int
    total_cost: int
    breakdown: list[DevBreakdownItem]


class AzureServiceCost(CamelModel):
    service_name: str
    tier: str
    monthly_cost: float
    details: str
    azure_pricing_url: Optional[str] = None


class InfrastructureCost(CamelModel):
    monthly_cost: float
    annual_cost: float
    services: list[AzureServiceCost]


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
    hourly_rate: int
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


# ── Recommendations ─────────────────────────────────────────────────

class Recommendation(CamelModel):
    priority: Literal["critical", "high", "medium", "low"]
    category: str
    title: str
    description: str
    estimated_impact: str


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
    cost_breakdown: CostBreakdown
    token_projection: TokenProjection
    comparison: AIvsStandardComparison
    roi_projection: ROIProjection
    recommendations: list[Recommendation]
    report_markdown: str
    status: Literal["generating", "complete", "error"] = "complete"
    generated_at: str
    repo_context: Optional[RepoContext] = None


class EstimationSSEChunk(CamelModel):
    node: str
    status: str
    content: Optional[str] = None
    progress: Optional[int] = None
    data: Optional[Any] = None
