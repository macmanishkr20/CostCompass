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

// Shared dark-mode chart palette.
const TEXT = '#cbd5e1';
const MUTED = '#94a3b8';
const GRID = 'rgba(148, 163, 184, 0.12)';
const SERIES = ['#6366f1', '#22d3ee', '#a855f7', '#f59e0b'];

@Component({
  selector: 'app-report',
  imports: [CurrencyPipe, DatePipe, DecimalPipe, RouterLink, LoadingSpinner, ScoreBadge, ChartCanvas],
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
            borderColor: 'rgba(15, 23, 42, 0.55)',
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
            backgroundColor: 'rgba(99, 102, 241, 0.15)',
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
}
