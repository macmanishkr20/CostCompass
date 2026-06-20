import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { NgClass } from '@angular/common';

@Component({
  selector: 'app-score-badge',
  imports: [NgClass],
  template: `<span class="badge" [ngClass]="badgeClass()">{{ score() }} · {{ label() }}</span>`,
  styles: [`.badge { font-family: var(--font-mono); }`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScoreBadge {
  readonly score = input.required<number>();

  protected readonly label = computed(() => {
    const s = this.score();
    if (s >= 80) return 'Excellent';
    if (s >= 60) return 'High';
    if (s >= 40) return 'Medium';
    return 'Low';
  });

  protected readonly badgeClass = computed(() => {
    const s = this.score();
    if (s >= 80) return 'badge-success';
    if (s >= 60) return 'badge-info';
    if (s >= 40) return 'badge-warning';
    return 'badge-danger';
  });
}
