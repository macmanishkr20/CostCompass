/* ── Project Models ─────────────────────────────────────────────── */

/** Azure regions offered in the wizards (ARM names — what pricing keys on). */
export const REGION_OPTIONS: { value: string; label: string }[] = [
  { value: 'eastus', label: 'East US' },
  { value: 'eastus2', label: 'East US 2' },
  { value: 'westus2', label: 'West US 2' },
  { value: 'westus3', label: 'West US 3' },
  { value: 'centralus', label: 'Central US' },
  { value: 'southcentralus', label: 'South Central US' },
  { value: 'westeurope', label: 'West Europe' },
  { value: 'northeurope', label: 'North Europe' },
  { value: 'uksouth', label: 'UK South' },
  { value: 'swedencentral', label: 'Sweden Central' },
  { value: 'switzerlandnorth', label: 'Switzerland North' },
  { value: 'francecentral', label: 'France Central' },
  { value: 'germanywestcentral', label: 'Germany West Central' },
  { value: 'uaenorth', label: 'UAE North' },
  { value: 'centralindia', label: 'Central India' },
  { value: 'southeastasia', label: 'Southeast Asia' },
  { value: 'japaneast', label: 'Japan East' },
  { value: 'australiaeast', label: 'Australia East' },
  { value: 'canadacentral', label: 'Canada Central' },
  { value: 'brazilsouth', label: 'Brazil South' },
];

export type ProjectType = 'new' | 'enhancement';
export type ProjectScale = 'small' | 'medium' | 'large' | 'enterprise';
export type ProjectStatus = 'draft' | 'intake_complete' | 'estimating' | 'complete' | 'archived';

export interface ProjectInput {
  projectName: string;
  projectType: ProjectType;
  description: string;
  industryDomain: string;
  targetUsers: string;
  scale: ProjectScale;
  features: FeatureItem[];
  aiUseCases: AIUseCase[];
  technicalPreferences: TechnicalPreferences;
  volumeAndScale: VolumeAndScale;
  // Overridable rate card / resourcing dials; omit to use platform baselines.
  costAssumptions?: CostAssumptions;
  // Enhancement-specific
  repoUrl?: string;
  repoBranch?: string;
  currentArchitecture?: CurrentArchitecture;
  enhancementScope?: string;
  integrationConstraints?: IntegrationConstraints;
  // Repo analysis snapshot (carried into the report for enhancement mode)
  repoFullName?: string;
  repoStars?: number;
  repoFileCount?: number;
  repoManifests?: string[];
  repoTopics?: string[];
}

export interface FeatureItem {
  id: string;
  name: string;
  description: string;
  complexity: 'low' | 'medium' | 'high' | 'very_high';
  aiCandidate: boolean;
}

export interface AIUseCase {
  id: string;
  name: string;
  taskType: AITaskType;
  description: string;
  priority: 'must_have' | 'nice_to_have' | 'exploratory';
  linkedFeatureIds: string[];
  // ROI benefit basis, overridable per use case: minutes of manual work one
  // automated call replaces. Omit to use the task-type default.
  minutesPerCall?: number;
  // Optional hard override of the derived $/call — bypasses the minutes×rate
  // math for a power user who already knows the unit value. Omit to keep the
  // transparent derivation, so existing payloads compute identical figures.
  valuePerCall?: number;
}

/**
 * Org-specific rate card and resourcing dials. Every dollar leadership sees
 * multiplies these; omit a field to fall back to the platform baseline so the
 * out-of-the-box estimate is unchanged.
 */
export interface CostAssumptions {
  devHourlyRate: number;
  maintHourlyRate: number;
  effectiveHoursPerWeek: number; // effective (not nominal) engineering hours/week
  // ROI benefit dials. value/call = minutes ÷ 60 × loadedHourlyRate × automation%.
  loadedHourlyRate: number; // fully-loaded cost of the person whose work AI offsets
  automationRatePercent: number; // share of calls AI handles end-to-end (deflection)
}

export type AITaskType =
  | 'text_classification'
  | 'summarization'
  | 'code_generation'
  | 'conversational_agent'
  | 'rag_qa'
  | 'multi_agent_orchestration'
  | 'document_analysis'
  | 'image_analysis'
  | 'translation'
  | 'data_extraction'
  | 'recommendation'
  | 'anomaly_detection'
  | 'rules_workflow'
  | 'crud_lookup'
  | 'threshold_alerting';

/**
 * Delivery platform the app is (or will be) built on. Selects the cost *model* —
 * consumption (Azure/AWS/GCP), per-seat licensing (M365/Copilot) or capex
 * (on-prem) — not just a price book.
 */
export type DeliveryPlatform = 'azure_paas' | 'aws' | 'gcp' | 'm365_copilot' | 'on_prem';

export interface TechnicalPreferences {
  preferredLLMProvider: string;
  deploymentModel: 'cloud' | 'hybrid' | 'edge';
  // Optional: when unset the engine infers it from existingInfra / hostingPlatform.
  deliveryPlatform?: DeliveryPlatform;
  existingInfra: string;
  complianceRequirements: string[];
  budgetCeiling?: number;
  budgetCurrency: string;
  // Azure regions used to price infrastructure: one primary region for all
  // services, with dedicated overrides for Azure OpenAI and Azure AI Search.
  azureRegion?: string;
  azureOpenAIRegion?: string;
  azureSearchRegion?: string;
}

export interface VolumeAndScale {
  expectedDailyUsers: number;
  requestsPerDay: number;
  dataVolumeGB: number;
  peakLoadPattern: string;
  growthRatePercent: number;
}

export interface CurrentArchitecture {
  framework: string;
  language: string;
  database: string;
  apiPattern: string;
  hostingPlatform: string;
  ciCd: string;
}

export interface IntegrationConstraints {
  deploymentTarget: string;
  budgetCeiling: number;
  budgetCurrency: string;
  timelineWeeks: number;
}

export interface Project {
  id: string;
  userId: string;
  input: ProjectInput;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
  estimationId?: string;
}
