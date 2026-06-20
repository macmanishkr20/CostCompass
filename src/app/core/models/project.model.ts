/* ── Project Models ─────────────────────────────────────────────── */

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
  // Enhancement-specific
  repoUrl?: string;
  repoBranch?: string;
  currentArchitecture?: CurrentArchitecture;
  enhancementScope?: string;
  integrationConstraints?: IntegrationConstraints;
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
  | 'anomaly_detection';

export interface TechnicalPreferences {
  preferredLLMProvider: string;
  deploymentModel: 'cloud' | 'hybrid' | 'edge';
  existingInfra: string;
  complianceRequirements: string[];
  budgetCeiling?: number;
  budgetCurrency: string;
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
