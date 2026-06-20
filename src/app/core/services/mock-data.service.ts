import { Injectable } from '@angular/core';
import { Observable, of } from 'rxjs';
import { delay } from 'rxjs/operators';
import { DashboardStats, EstimateSummary } from '../models/dashboard.model';

/**
 * Temporary in-memory data source for the Phase 1 shell.
 * Replaced by EstimationService (HTTP) once the backend lands.
 */
@Injectable({ providedIn: 'root' })
export class MockDataService {
  private readonly estimates: EstimateSummary[] = [
    {
      id: 'est_001',
      projectName: 'Customer Support Copilot',
      projectType: 'new',
      industryDomain: 'SaaS / B2B',
      feasibilityScore: 88,
      recommendationLabel: 'RAG Assistant',
      totalCostExpected: 72000,
      currency: 'USD',
      status: 'complete',
      updatedAt: '2026-06-18T14:20:00Z',
    },
    {
      id: 'est_002',
      projectName: 'Invoice Reconciliation Automation',
      projectType: 'enhancement',
      industryDomain: 'Finance',
      feasibilityScore: 64,
      recommendationLabel: 'Traditional + AI',
      totalCostExpected: 41500,
      currency: 'USD',
      status: 'complete',
      updatedAt: '2026-06-15T09:05:00Z',
    },
    {
      id: 'est_003',
      projectName: 'Field Engineer Knowledge Agent',
      projectType: 'new',
      industryDomain: 'Energy / Utilities',
      feasibilityScore: 91,
      recommendationLabel: 'Multi-Agent',
      totalCostExpected: 128000,
      currency: 'USD',
      status: 'estimating',
      updatedAt: '2026-06-20T08:40:00Z',
    },
    {
      id: 'est_004',
      projectName: 'Contract Clause Extractor',
      projectType: 'enhancement',
      industryDomain: 'Legal',
      feasibilityScore: 79,
      recommendationLabel: 'Single Agent',
      totalCostExpected: 58000,
      currency: 'USD',
      status: 'complete',
      updatedAt: '2026-06-11T16:30:00Z',
    },
    {
      id: 'est_005',
      projectName: 'Inventory Forecast Dashboard',
      projectType: 'new',
      industryDomain: 'Retail',
      feasibilityScore: 38,
      recommendationLabel: 'Traditional Only',
      totalCostExpected: 22000,
      currency: 'USD',
      status: 'draft',
      updatedAt: '2026-06-09T11:15:00Z',
    },
  ];

  getDashboardStats(): Observable<DashboardStats> {
    const completed = this.estimates.filter((e) => e.status === 'complete');
    const avg =
      this.estimates.reduce((s, e) => s + e.feasibilityScore, 0) / (this.estimates.length || 1);
    const total = this.estimates.reduce((s, e) => s + e.totalCostExpected, 0);
    return of({
      totalEstimates: this.estimates.length,
      avgFeasibilityScore: Math.round(avg),
      totalProjectedCost: total,
      currency: 'USD',
      activeProjects: this.estimates.filter((e) => e.status === 'estimating' || e.status === 'draft')
        .length,
    }).pipe(delay(250));
  }

  getRecentEstimates(limit = 5): Observable<EstimateSummary[]> {
    const sorted = [...this.estimates].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return of(sorted.slice(0, limit)).pipe(delay(250));
  }

  getAllEstimates(): Observable<EstimateSummary[]> {
    const sorted = [...this.estimates].sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    return of(sorted).pipe(delay(250));
  }

  getEstimateById(id: string): Observable<EstimateSummary | null> {
    return of(this.estimates.find((e) => e.id === id) ?? null).pipe(delay(250));
  }
}
