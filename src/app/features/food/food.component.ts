import { Component, ViewChild, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { RecipesComponent } from '../recipes/recipes.component';
import { RestaurantsComponent, RestaurantMode } from '../restaurants/restaurants.component';
import { AddButtonComponent } from '../../shared/add-button/add-button.component';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';

type FoodView = 'all' | 'recipes' | 'dineOut' | 'delivery' | 'takeout';

@Component({
  selector: 'app-food',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatMenuModule,
    GlobalNavMenuComponent,
    AddButtonComponent,
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
    { value: 'dineOut', label: 'Dine in', icon: 'storefront' },
    { value: 'delivery', label: 'Delivery', icon: 'delivery_dining' },
    { value: 'takeout', label: 'Takeout', icon: 'takeout_dining' }
  ];

  @ViewChild(RecipesComponent) private recipes?: RecipesComponent;
  @ViewChild(RestaurantsComponent) private restaurants?: RestaurantsComponent;

  view = signal<FoodView>('all');
  searchTerm = '';

  showRecipes(): boolean {
    return this.view() === 'all' || this.view() === 'recipes';
  }

  showRestaurants(): boolean {
    return this.view() !== 'recipes';
  }

  /** Which restaurants to list: all of them on the All view, otherwise just those for that way of eating. */
  restaurantMode(): RestaurantMode {
    const view = this.view();
    return view === 'recipes' ? 'all' : view;
  }

  /** The add button only needs a choice on All; the other views know what's being added. */
  addsBoth(): boolean {
    return this.view() === 'all';
  }

  addRecipe(): void {
    this.recipes?.openAddForm();
  }

  addRestaurant(): void {
    this.restaurants?.openAddForm();
  }

  addForView(): void {
    if (this.view() === 'recipes') this.addRecipe();
    else this.addRestaurant();
  }
}
