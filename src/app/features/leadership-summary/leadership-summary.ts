import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { EstimationService } from '../../core/services/estimation.service';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { TiltDirective } from '../../shared/directives/tilt.directive';

/**
 * Board-ready, one-screen summary built off the *same* Estimation the full
 * report renders — no second computation, no divergent numbers. It leads with
 * the canonical verdict, states how much to trust it (confidence), surfaces the
 * four numbers leadership actually decides on, and shows the AI-vs-standard cost
 * face-off with a deterministic "why".
 */
@Component({
  selector: 'app-leadership-summary',
  imports: [CurrencyPipe, DatePipe, RouterLink, LoadingSpinner, TiltDirective],
  templateUrl: './leadership-summary.html',
  styleUrl: './leadership-summary.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LeadershipSummary {
  private readonly route = inject(ActivatedRoute);
  private readonly estimationSvc = inject(EstimationService);

  // undefined = loading, null = not found, object = loaded.
  protected readonly estimation = toSignal(
    this.route.paramMap.pipe(switchMap((p) => this.estimationSvc.getById(p.get('id') ?? ''))),
  );

  /** The single richest value driver, used in the "why" narrative. */
  protected readonly topDriver = computed(() => {
    const drivers = this.estimation()?.roiProjection?.valueDrivers ?? [];
    if (drivers.length === 0) return null;
    return drivers.reduce((best, d) => (d.annualValue > best.annualValue ? d : best));
  });

  /**
   * Deterministic, board-readable bullets explaining the verdict. Every line is
   * derived from figures already on the Estimation, so it can never drift from
   * the numbers shown elsewhere.
   */
  protected readonly whyPoints = computed<string[]>(() => {
    const e = this.estimation();
    if (!e) return [];
    const points: string[] = [];

    // 1) The comparison engine's own one-line summary leads.
    if (e.comparison.summary) points.push(e.comparison.summary);

    // 2) Payback — the number a CFO reaches for first.
    const roi = e.roiProjection;
    if (roi) {
      if (roi.paybackMonths !== null) {
        points.push(
          `The build pays for itself in about ${roi.paybackMonths} month${roi.paybackMonths === 1 ? '' : 's'}, then returns ${this.money(roi.netAnnualBenefit)} net every year.`,
        );
      } else {
        points.push(
          `Modelled benefit doesn't recover the build cost within the window — treat this as a strategic, not a payback-driven, investment.`,
        );
      }
    }

    // 3) The biggest single source of value — with its defensible basis.
    const driver = this.topDriver();
    if (driver) {
      const basis =
        driver.minutesPerCall != null && driver.loadedHourlyRate != null && driver.automationRatePercent != null
          ? ` Each call is worth ${this.moneyPrecise(driver.valuePerCall)} — ${driver.minutesPerCall} min of manual work at ${this.money(driver.loadedHourlyRate)}/hr, ${driver.automationRatePercent}% automated.`
          : '';
      points.push(
        `Most of the value comes from ${driver.useCase}: ${this.money(driver.annualValue)} a year across ${this.compactNum(driver.annualCalls)} calls.${basis}`,
      );
    }

    // 4) The dimension where AI most clearly wins (or loses).
    const dims = e.comparison.dimensions;
    if (dims.length > 0) {
      const edge = dims.reduce((best, d) =>
        Math.abs(d.aiScore - d.standardScore) > Math.abs(best.aiScore - best.standardScore) ? d : best,
      );
      const aiAhead = edge.aiScore >= edge.standardScore;
      points.push(
        `${aiAhead ? 'AI’s clearest edge' : 'Standard’s clearest edge'} is ${edge.dimension.toLowerCase()} (${edge.aiScore} vs ${edge.standardScore} of 10).`,
      );
    }

    return points;
  });

  /** Signed delta between AI and standard expected cost (positive = AI costs more). */
  protected readonly costDelta = computed(() => {
    const c = this.estimation()?.comparison;
    if (!c) return 0;
    return c.aiApproach.totalCost.expected - c.standardApproach.totalCost.expected;
  });

  protected pdfHref(id: string): string {
    return this.estimationSvc.pdfUrl(id);
  }

  protected excelHref(id: string): string {
    return this.estimationSvc.excelUrl(id);
  }

  protected money(n: number): string {
    const currency = this.estimation()?.costBreakdown.currency ?? 'USD';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      maximumFractionDigits: 0,
    }).format(n);
  }

  /** Cents-precision currency — for small per-unit figures like $/call. */
  protected moneyPrecise(n: number): string {
    const currency = this.estimation()?.costBreakdown.currency ?? 'USD';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(n);
  }

  private compactNum(n: number): string {
    if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
    return `${n}`;
  }
}
