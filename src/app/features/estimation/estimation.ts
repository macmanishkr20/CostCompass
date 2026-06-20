import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { IntakeWizard } from './intake-wizard/intake-wizard';

type EstimationMode = 'new' | 'enhancement';

@Component({
  selector: 'app-estimation',
  imports: [RouterLink, IntakeWizard],
  templateUrl: './estimation.html',
  styleUrl: './estimation.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Estimation {
  private readonly route = inject(ActivatedRoute);

  protected readonly mode = toSignal(
    this.route.data.pipe(map((d) => (d['mode'] as EstimationMode) ?? 'new')),
    { initialValue: 'new' as EstimationMode },
  );

  protected readonly title = computed(() =>
    this.mode() === 'enhancement' ? 'Enhance an existing app' : 'New AI estimate',
  );

  protected readonly subtitle = computed(() =>
    this.mode() === 'enhancement'
      ? 'Connect a GitHub repository and scope AI add-ons against the existing codebase.'
      : 'Describe a greenfield idea to score AI feasibility and project its cost.',
  );

  protected readonly steps = computed(() =>
    this.mode() === 'enhancement'
      ? [
          'Connect GitHub repository',
          'Analyze codebase & stack',
          'Select enhancement use cases',
          'Feasibility scoring',
          'Deterministic cost & token projection',
        ]
      : [
          'Project intake & goals',
          'Use cases & data profile',
          'Volume & scale assumptions',
          'Feasibility scoring',
          'Deterministic cost & token projection',
        ],
  );
}
