import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./features/login/login').then((m) => m.Login),
    title: 'Sign in · CostCompass',
  },
  {
    path: '',
    loadComponent: () => import('./features/shell/shell').then((m) => m.Shell),
    canActivate: [authGuard],
    children: [
      { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard').then((m) => m.Dashboard),
        title: 'Dashboard · CostCompass',
      },
      {
        path: 'estimate/new',
        loadComponent: () => import('./features/estimation/estimation').then((m) => m.Estimation),
        data: { mode: 'new' },
        title: 'New Estimate · CostCompass',
      },
      {
        path: 'estimate/enhance',
        loadComponent: () => import('./features/estimation/estimation').then((m) => m.Estimation),
        data: { mode: 'enhancement' },
        title: 'Enhancement Estimate · CostCompass',
      },
      {
        path: 'estimate/:id/report',
        loadComponent: () => import('./features/report/report').then((m) => m.Report),
        title: 'Report · CostCompass',
      },
      {
        path: 'history',
        loadComponent: () => import('./features/history/history').then((m) => m.History),
        title: 'History · CostCompass',
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
