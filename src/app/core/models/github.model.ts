/* ── GitHub repository analysis models ──────────────────────────── */

import { AITaskType } from './project.model';

export interface RepoRef {
  owner: string;
  repo: string;
  branch?: string;
}

export interface LanguageShare {
  name: string;
  bytes: number;
  percent: number;
}

export interface DetectedStack {
  language: string;
  framework: string;
  database: string;
  apiPattern: string;
  hostingPlatform: string;
  ciCd: string;
  packageManagers: string[];
  hasTests: boolean;
  hasDocker: boolean;
  hasDocs: boolean;
}

export interface SuggestedUseCase {
  name: string;
  taskType: AITaskType;
  rationale: string;
  priority: 'must_have' | 'nice_to_have' | 'exploratory';
}

export interface RepoAnalysis {
  fullName: string;
  htmlUrl: string;
  description: string;
  defaultBranch: string;
  branch: string;
  primaryLanguage: string;
  languages: LanguageShare[];
  fileCount: number;
  topics: string[];
  stars: number;
  license: string | null;
  lastPushed: string;
  truncated: boolean;
  manifestsFound: string[];
  stack: DetectedStack;
  suggestedUseCases: SuggestedUseCase[];
}
