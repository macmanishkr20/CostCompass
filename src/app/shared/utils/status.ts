import { ProjectStatus, ProjectType } from '../../core/models/project.model';

export function statusLabel(status: ProjectStatus): string {
  switch (status) {
    case 'complete':
      return 'Complete';
    case 'estimating':
      return 'Estimating';
    case 'intake_complete':
      return 'Ready';
    case 'draft':
      return 'Draft';
    case 'archived':
      return 'Archived';
  }
}

export function statusClass(status: ProjectStatus): string {
  switch (status) {
    case 'complete':
      return 'badge-success';
    case 'estimating':
      return 'badge-info';
    case 'intake_complete':
      return 'badge-info';
    case 'draft':
      return 'badge-warning';
    case 'archived':
      return 'badge-danger';
  }
}

export function projectTypeLabel(type: ProjectType): string {
  return type === 'new' ? 'New build' : 'Enhancement';
}
