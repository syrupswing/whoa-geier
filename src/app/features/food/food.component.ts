import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { RecipesComponent } from '../recipes/recipes.component';
import { RestaurantsComponent } from '../restaurants/restaurants.component';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';

type FoodView = 'all' | 'recipes' | 'delivery' | 'dineOut';

@Component({
  selector: 'app-food',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    GlobalNavMenuComponent,
    RecipesComponent,
    RestaurantsComponent
  ],
  templateUrl: './food.component.html',
  styleUrls: ['./food.component.scss']
})
export class FoodComponent {
  readonly views: { value: FoodView; label: string; icon: string }[] = [
    { value: 'all', label: 'All', icon: 'restaurant_menu' },
    { value: 'recipes', label: 'Cook at home', icon: 'menu_book' },
    { value: 'delivery', label: 'Delivery', icon: 'delivery_dining' },
    { value: 'dineOut', label: 'Going out', icon: 'storefront' }
  ];

  view = signal<FoodView>('all');
  searchTerm = '';

  showRecipes(): boolean {
    return this.view() === 'all' || this.view() === 'recipes';
  }

  showRestaurants(): boolean {
    return this.view() !== 'recipes';
  }

  /** Which restaurants to list: all of them on the All view, otherwise just those for that way of eating. */
  restaurantMode(): 'all' | 'delivery' | 'dineOut' {
    const view = this.view();
    return view === 'delivery' || view === 'dineOut' ? view : 'all';
  }
}
