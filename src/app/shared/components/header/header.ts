import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink } from '@angular/router';
import { filter, map, startWith } from 'rxjs/operators';
import { AuthService } from '../../../core/services/auth.service';

@Component({
  selector: 'app-header',
  imports: [RouterLink],
  templateUrl: './header.html',
  styleUrl: './header.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Header {
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);

  protected readonly pageTitle = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map(() => this.titleFor(this.router.url)),
      startWith(this.titleFor(this.router.url)),
    ),
    { initialValue: this.titleFor(this.router.url) },
  );

  protected logout(): void {
    this.auth.logout();
    this.router.navigate(['/login']);
  }

  private titleFor(url: string): string {
    const path = url.split('?')[0];
    if (path.startsWith('/dashboard')) return 'Dashboard';
    if (path.startsWith('/estimate/new')) return 'New Estimate';
    if (path.startsWith('/estimate/enhance')) return 'Enhancement Estimate';
    if (path.includes('/report')) return 'Estimation Report';
    if (path.startsWith('/history')) return 'Estimate History';
    return 'CostCompass';
  }
}
