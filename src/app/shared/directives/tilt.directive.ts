import { Directive, ElementRef, HostListener, inject, input } from '@angular/core';

/**
 * Mouse-parallax 3D tilt. Pairs with the `.tilt-3d` styles in styles.css:
 * on pointer move it writes `--tilt-rx/ry` (rotation) and `--tilt-mx/my`
 * (the cursor-tracked specular sheen position) straight onto the element.
 *
 * Zoneless-safe by design — handlers mutate inline CSS custom properties
 * directly and never touch component state, so they trigger no change
 * detection. Writes are coalesced into a single requestAnimationFrame per
 * frame to stay smooth under rapid pointer movement.
 */
@Directive({
  selector: '[appTilt]',
  standalone: true,
  host: { class: 'tilt-3d' },
})
export class TiltDirective {
  /** Maximum rotation (degrees) reached at the element's edges. */
  readonly tiltMax = input(8);

  private readonly el: HTMLElement = inject(ElementRef).nativeElement;
  private frame = 0;
  private rx = 0;
  private ry = 0;
  private mx = 50;
  private my = 50;

  @HostListener('pointermove', ['$event'])
  onMove(ev: PointerEvent): void {
    if (ev.pointerType === 'touch') return; // tilt is a fine-pointer affordance
    const rect = this.el.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const px = (ev.clientX - rect.left) / rect.width; // 0..1 across
    const py = (ev.clientY - rect.top) / rect.height; // 0..1 down
    const max = this.tiltMax();

    this.ry = (px - 0.5) * 2 * max; // cursor right → rotate toward right
    this.rx = -(py - 0.5) * 2 * max; // cursor down → rotate toward bottom
    this.mx = px * 100;
    this.my = py * 100;

    this.el.classList.add('is-tilting');
    this.schedule();
  }

  @HostListener('pointerleave')
  onLeave(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.rx = this.ry = 0;
    this.el.classList.remove('is-tilting');
    this.apply();
  }

  private schedule(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.apply();
    });
  }

  private apply(): void {
    const s = this.el.style;
    s.setProperty('--tilt-rx', `${this.rx.toFixed(2)}deg`);
    s.setProperty('--tilt-ry', `${this.ry.toFixed(2)}deg`);
    s.setProperty('--tilt-mx', `${this.mx.toFixed(1)}%`);
    s.setProperty('--tilt-my', `${this.my.toFixed(1)}%`);
  }
}
