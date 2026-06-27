import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { MockDataService } from '../../core/services/mock-data.service';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { ScoreBadge } from '../../shared/components/score-badge/score-badge';
import { TiltDirective } from '../../shared/directives/tilt.directive';
import { statusClass, statusLabel, projectTypeLabel } from '../../shared/utils/status';

@Component({
  selector: 'app-dashboard',
  imports: [CurrencyPipe, DatePipe, RouterLink, LoadingSpinner, ScoreBadge, TiltDirective],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Dashboard {
  private readonly data = inject(MockDataService);

  protected readonly stats = toSignal(this.data.getDashboardStats());
  protected readonly recent = toSignal(this.data.getRecentEstimates());

  protected readonly statusLabel = statusLabel;
  protected readonly statusClass = statusClass;
  protected readonly projectTypeLabel = projectTypeLabel;
}
