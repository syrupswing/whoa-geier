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
    path: 'grocery-list',
    loadComponent: () => import('./features/grocery-list/grocery-list.component').then(m => m.GroceryListComponent)
  },
  {
    path: 'recipes',
    loadComponent: () => import('./features/recipes/recipes.component').then(m => m.RecipesComponent)
  },
  {
    path: 'restaurants',
    loadComponent: () => import('./features/restaurants/restaurants.component').then(m => m.RestaurantsComponent)
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
