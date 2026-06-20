import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';
import { IntakeWizard } from './intake-wizard/intake-wizard';
import { EnhanceWizard } from './enhance-wizard/enhance-wizard';

type EstimationMode = 'new' | 'enhancement';

@Component({
  selector: 'app-estimation',
  imports: [IntakeWizard, EnhanceWizard],
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
}
