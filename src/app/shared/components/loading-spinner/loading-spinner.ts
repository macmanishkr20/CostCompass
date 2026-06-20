import { ChangeDetectionStrategy, Component, input } from '@angular/core';

@Component({
  selector: 'app-loading-spinner',
  template: `
    <div class="spinner-wrap">
      <span class="spinner" aria-hidden="true"></span>
      @if (label()) {
        <span class="spinner-label">{{ label() }}</span>
      }
    </div>
  `,
  styles: [
    `
      .spinner-wrap {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: var(--space-md);
        padding: var(--space-2xl);
        color: var(--text-secondary);
      }
      .spinner {
        width: 30px;
        height: 30px;
        border-radius: 50%;
        border: 3px solid var(--border-primary);
        border-top-color: var(--accent-blue);
        animation: spin 0.8s linear infinite;
      }
      .spinner-label {
        font-size: var(--text-sm);
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LoadingSpinner {
  readonly label = input<string>('');
}
