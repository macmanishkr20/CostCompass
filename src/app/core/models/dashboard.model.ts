/* ── Dashboard & list view-models ───────────────────────────────── */

import { ProjectType, ProjectStatus } from './project.model';

export interface DashboardStats {
  totalEstimates: number;
  avgFeasibilityScore: number;       // 0–100
  totalProjectedCost: number;        // expected, summed
  currency: string;
  activeProjects: number;
}

export interface EstimateSummary {
  id: string;
  projectName: string;
  projectType: ProjectType;
  industryDomain: string;
  feasibilityScore: number;          // 0–100
  recommendationLabel: string;       // e.g. "RAG Assistant", "Multi-Agent"
  totalCostExpected: number;
  currency: string;
  status: ProjectStatus;
  updatedAt: string;                 // ISO
}
