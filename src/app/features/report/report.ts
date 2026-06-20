import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { switchMap } from 'rxjs/operators';
import { EstimationService } from '../../core/services/estimation.service';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { ScoreBadge } from '../../shared/components/score-badge/score-badge';

@Component({
  selector: 'app-report',
  imports: [CurrencyPipe, DatePipe, RouterLink, LoadingSpinner, ScoreBadge],
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
