import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./components/login/login.component').then(m => m.LoginComponent)
  },
  {
    path: '',
    loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [authGuard]
  },
  {
    path: 'food',
    loadComponent: () => import('./features/food/food.component').then(m => m.FoodComponent)
  },
  {
    path: 'grocery',
    redirectTo: 'food',
    pathMatch: 'full'
  },
  {
    path: 'calendar',
    loadComponent: () => import('./features/calendar/calendar.component').then(m => m.CalendarComponent)
  },
  {
    path: 'quick-links',
    loadComponent: () => import('./features/quick-links/quick-links.component').then(m => m.QuickLinksComponent)
  },
  {
    path: 'vehicles',
    loadComponent: () => import('./features/vehicles/vehicles.component').then(m => m.VehiclesComponent)
  },
  {
    path: 'remi-world',
    loadComponent: () => import('./features/remi-world/remi-world.component').then(m => m.RemiWorldComponent)
  }
];
