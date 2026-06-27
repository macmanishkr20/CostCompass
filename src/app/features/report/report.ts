import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CurrencyPipe, DatePipe, DecimalPipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { ChartConfiguration } from 'chart.js';
import { marked } from 'marked';
import { EstimationService } from '../../core/services/estimation.service';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { ScoreBadge } from '../../shared/components/score-badge/score-badge';
import { ChartCanvas } from '../../shared/components/chart-canvas/chart-canvas';
import { TiltDirective } from '../../shared/directives/tilt.directive';

// Shared light-theme chart palette (graphite ink + gold-led series).
const TEXT = '#3a3d42';
const MUTED = '#6b6f76';
const GRID = 'rgba(22, 24, 28, 0.10)';
const SERIES = ['#E6B800', '#26282c', '#B88A00', '#9aa0a8'];

@Component({
  selector: 'app-report',
  imports: [CurrencyPipe, DatePipe, DecimalPipe, RouterLink, LoadingSpinner, ScoreBadge, ChartCanvas, TiltDirective],
  templateUrl: './report.html',
  styleUrl: './report.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Report {
  private readonly route = inject(ActivatedRoute);
  private readonly estimationSvc = inject(EstimationService);

  // undefined = loading, null = not found, object = loaded.
  protected readonly estimation = toSignal(
    this.route.paramMap.pipe(switchMap((p) => this.estimationSvc.getById(p.get('id') ?? ''))),
  );

  /**
   * Splits the analysed capabilities into AI-led vs standard-software-led, so a
   * "Hybrid" verdict can name exactly which features go which way instead of
   * leaving "hybrid" as a vague middle. Empty unless at least one capability
   * carries the recommendedApproach tag (older estimations omit it).
   */
  protected readonly capabilitySplit = computed(() => {
    const items = this.estimation()?.feasibility.useCaseAnalysis ?? [];
    const tagged = items.filter((u) => u.recommendedApproach);
    return {
      hasSplit: tagged.length > 0,
      ai: tagged.filter((u) => u.recommendedApproach === 'ai'),
      standard: tagged.filter((u) => u.recommendedApproach === 'standard'),
    };
  });

  /** Server-composed markdown rendered to safe HTML for the report body. */
  protected readonly renderedReport = computed(() => {
    const e = this.estimation();
    return e ? (marked.parse(e.reportMarkdown, { async: false }) as string) : '';
  });

  /** Doughnut of first-year cost composition. */
  protected readonly costChart = computed<ChartConfiguration | null>(() => {
    const e = this.estimation();
    if (!e) return null;
    const c = e.costBreakdown;
    return {
      type: 'doughnut',
      data: {
        labels: ['Development', 'Infrastructure', 'AI tokens', 'Maintenance'],
        datasets: [
          {
            data: [
              c.development.totalCost,
              c.infrastructure.annualCost,
              c.aiTokens.annualCost.expected,
              c.maintenance.annualCost,
            ],
            backgroundColor: SERIES,
            borderColor: '#ffffff',
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '62%',
        plugins: {
          legend: {
            position: 'right',
            labels: { color: TEXT, boxWidth: 12, padding: 14, font: { size: 12 } },
          },
          tooltip: {
            callbacks: { label: (ctx) => ` ${ctx.label}: ${this.money(Number(ctx.parsed))}` },
          },
        },
      },
    };
  });

  /** Cumulative-net ROI curve over 36 months. */
  protected readonly roiChart = computed<ChartConfiguration | null>(() => {
    const e = this.estimation();
    const roi = e?.roiProjection;
    if (!roi) return null;
    return {
      type: 'line',
      data: {
        labels: roi.curve.map((p) => `M${p.month}`),
        datasets: [
          {
            label: 'Cumulative net',
            data: roi.curve.map((p) => p.cumulativeNet),
            borderColor: SERIES[0],
            backgroundColor: 'rgba(230, 184, 0, 0.14)',
            fill: true,
            tension: 0.3,
            pointRadius: 3,
            pointBackgroundColor: SERIES[0],
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${this.money(Number(ctx.parsed.y))}` } },
        },
        scales: {
          x: { ticks: { color: MUTED }, grid: { color: GRID } },
          y: {
            ticks: { color: MUTED, callback: (v) => this.compact(Number(v)) },
            grid: { color: GRID },
          },
        },
      },
    };
  });

  protected pdfHref(id: string): string {
    return this.estimationSvc.pdfUrl(id);
  }

  protected excelHref(id: string): string {
    return this.estimationSvc.excelUrl(id);
  }

  private money(n: number): string {
    const currency = this.estimation()?.costBreakdown.currency ?? 'USD';
    return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(n);
  }

  private compact(n: number): string {
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)}M`;
    if (abs >= 1e3) return `${sign}${(abs / 1e3).toFixed(0)}K`;
    return `${n}`;
  }

  protected compactTokens(n: number): string {
    if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
    return `${n}`;
  }

  protected severityClass(sev: string): string {
    switch (sev) {
      case 'critical':
      case 'high':
        return 'badge-danger';
      case 'medium':
        return 'badge-warning';
      default:
        return 'badge-info';
    }
  }

  protected priorityClass(p: string): string {
    switch (p) {
      case 'critical':
      case 'high':
        return 'badge-danger';
      case 'medium':
        return 'badge-warning';
      default:
        return 'badge-info';
    }
  }

  /** Human label for the delivery platform's cost model. */
  protected costModelLabel(model: string): string {
    switch (model) {
      case 'licensing':
        return 'Licensing-led · per seat';
      case 'capex':
        return 'Capex-led · amortized + ops';
      case 'consumption':
        return 'Consumption · metered';
      default:
        return model;
    }
  }

  /** Short human label for a delivery-platform key (used for alternatives). */
  protected platformLabel(platform: string): string {
    switch (platform) {
      case 'azure_paas':
        return 'Azure PaaS';
      case 'aws':
        return 'AWS';
      case 'gcp':
        return 'Google Cloud';
      case 'm365_copilot':
        return 'Microsoft 365 + Copilot';
      case 'on_prem':
        return 'On-premises / private cloud';
      default:
        return platform;
    }
  }

  /** Human label for an agentic node / specialist (used in the agent-run card). */
  protected agentLabel(node: string): string {
    switch (node) {
      case 'intake':
        return 'Intake';
      case 'solution_architect':
        return 'Architect';
      case 'feasibility_analyst':
        return 'Feasibility';
      case 'cost_engineer':
        return 'Cost';
      case 'comparison_analyst':
        return 'Comparison';
      case 'roi_analyst':
        return 'ROI';
      case 'report_synthesizer':
        return 'Report';
      case 'risk_critic':
        return 'Risk critic';
      case 'supervisor':
        return 'Supervisor';
      default:
        return node;
    }
  }

  /** How the delivery platform was chosen — drives the provenance chip. */
  protected solutionSourceLabel(source: string): string {
    switch (source) {
      case 'agent':
        return 'ReAct agent';
      case 'explicit':
        return 'Your choice';
      case 'heuristic':
        return 'Heuristic';
      default:
        return source;
    }
  }

  /** Human label for how an Azure unit price was sourced. */
  protected priceSourceLabel(src: string): string {
    switch (src) {
      case 'live':
        return 'live retail price';
      case 'fallback':
        return 'fallback price';
      default:
        return 'baseline estimate';
    }
  }
}
