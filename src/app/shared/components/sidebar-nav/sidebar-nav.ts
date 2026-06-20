import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-sidebar-nav',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './sidebar-nav.html',
  styleUrl: './sidebar-nav.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SidebarNav {}
