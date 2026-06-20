import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { CurrencyPipe, DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { MockDataService } from '../../core/services/mock-data.service';
import { LoadingSpinner } from '../../shared/components/loading-spinner/loading-spinner';
import { ScoreBadge } from '../../shared/components/score-badge/score-badge';
import { statusClass, statusLabel, projectTypeLabel } from '../../shared/utils/status';
import { ProjectStatus, ProjectType } from '../../core/models/project.model';

type StatusFilter = 'all' | ProjectStatus;
type TypeFilter = 'all' | ProjectType;

@Component({
  selector: 'app-history',
  imports: [CurrencyPipe, DatePipe, RouterLink, LoadingSpinner, ScoreBadge],
  templateUrl: './history.html',
  styleUrl: './history.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class History {
  private readonly data = inject(MockDataService);

  protected readonly all = toSignal(this.data.getAllEstimates());

  protected readonly query = signal('');
  protected readonly statusFilter = signal<StatusFilter>('all');
  protected readonly typeFilter = signal<TypeFilter>('all');

  protected readonly statuses: StatusFilter[] = [
    'all',
    'draft',
    'estimating',
    'intake_complete',
    'complete',
    'archived',
  ];
  protected readonly types: TypeFilter[] = ['all', 'new', 'enhancement'];

  protected readonly filtered = computed(() => {
    const list = this.all();
    if (!list) return undefined;
    const q = this.query().trim().toLowerCase();
    const status = this.statusFilter();
    const type = this.typeFilter();
    return list.filter((e) => {
      if (status !== 'all' && e.status !== status) return false;
      if (type !== 'all' && e.projectType !== type) return false;
      if (q && !`${e.projectName} ${e.industryDomain}`.toLowerCase().includes(q)) return false;
      return true;
    });
  });

  protected readonly statusLabel = statusLabel;
  protected readonly statusClass = statusClass;
  protected readonly projectTypeLabel = projectTypeLabel;

  protected onSearch(value: string): void {
    this.query.set(value);
  }

  protected filterLabel(value: StatusFilter | TypeFilter): string {
    if (value === 'all') return 'All';
    if (value === 'new' || value === 'enhancement') return projectTypeLabel(value);
    return statusLabel(value);
  }
}
