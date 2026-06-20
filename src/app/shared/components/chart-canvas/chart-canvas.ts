import {
  ChangeDetectionStrategy,
  Component,
  effect,
  ElementRef,
  input,
  OnDestroy,
  viewChild,
} from '@angular/core';
import { Chart, ChartConfiguration, registerables } from 'chart.js';

// Register controllers/elements/scales once for the whole app.
Chart.register(...registerables);

/**
 * Thin signal-driven wrapper around chart.js. Pass a full `ChartConfiguration`
 * and it (re)renders into a canvas, destroying the previous instance on change
 * or teardown. Sizing is owned by the host element via CSS.
 */
@Component({
  selector: 'app-chart-canvas',
  template: `<canvas #canvas></canvas>`,
  styles: [`:host { display: block; position: relative; width: 100%; height: 100%; }`],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChartCanvas implements OnDestroy {
  readonly config = input.required<ChartConfiguration>();
  private readonly canvasRef = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private chart?: Chart;

  constructor() {
    effect(() => {
      const cfg = this.config();
      const el = this.canvasRef().nativeElement;
      this.chart?.destroy();
      this.chart = new Chart(el, cfg);
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }
}
