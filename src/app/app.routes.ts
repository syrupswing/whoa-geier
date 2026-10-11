import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';
import { loginGuard } from './guards/login.guard';

export const routes: Routes = [
  {
    path: 'login',
    loadComponent: () => import('./components/login/login.component').then(m => m.LoginComponent),
    canActivate: [loginGuard]
  },
  {
    path: '',
    loadComponent: () => import('./features/dashboard/dashboard.component').then(m => m.DashboardComponent),
    canActivate: [authGuard]
  },
  {
    path: 'grocery-list',
    loadComponent: () => import('./features/grocery-list/grocery-list.component').then(m => m.GroceryListComponent),
    canActivate: [authGuard]
  },
  {
    path: 'backlog',
    loadComponent: () => import('./features/backlog/backlog.component').then(m => m.BacklogComponent),
    canActivate: [authGuard]
  },
  // The to-do list was replaced by the backlog.
  { path: 'todos', redirectTo: 'backlog', pathMatch: 'full' },
  {
    path: 'food',
    loadComponent: () => import('./features/food/food.component').then(m => m.FoodComponent),
    canActivate: [authGuard]
  },
  // Recipes and restaurants used to be separate pages.
  { path: 'recipes', redirectTo: 'food', pathMatch: 'full' },
  { path: 'restaurants', redirectTo: 'food', pathMatch: 'full' },
  {
    path: 'calendar',
    loadComponent: () => import('./features/calendar/calendar.component').then(m => m.CalendarComponent),
    canActivate: [authGuard]
  },
  {
    path: 'quick-links',
    loadComponent: () => import('./features/quick-links/quick-links.component').then(m => m.QuickLinksComponent),
    canActivate: [authGuard]
  },
  {
    path: 'vehicles',
    loadComponent: () => import('./features/vehicles/vehicles.component').then(m => m.VehiclesComponent),
    canActivate: [authGuard]
  },
  {
    path: 'remi-world',
    loadComponent: () => import('./features/remi-world/remi-world.component').then(m => m.RemiWorldComponent),
    canActivate: [authGuard]
  },
  {
    path: 'settings',
    loadComponent: () => import('./features/settings/settings.component').then(m => m.SettingsComponent),
    canActivate: [authGuard]
  },
  {
    path: '**',
    redirectTo: '/login'
  }
];
