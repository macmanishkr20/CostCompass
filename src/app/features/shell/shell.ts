import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { SidebarNav } from '../../shared/components/sidebar-nav/sidebar-nav';
import { Header } from '../../shared/components/header/header';

@Component({
  selector: 'app-shell',
  imports: [RouterOutlet, SidebarNav, Header],
  templateUrl: './shell.html',
  styleUrl: './shell.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Shell {}
