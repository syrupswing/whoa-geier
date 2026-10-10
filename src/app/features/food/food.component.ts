import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatTabsModule } from '@angular/material/tabs';
import { MatIconModule } from '@angular/material/icon';
import { GroceryListComponent } from '../grocery-list/grocery-list.component';
import { RecipesComponent } from '../recipes/recipes.component';
import { RestaurantsComponent } from '../restaurants/restaurants.component';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';

@Component({
  selector: 'app-food',
  standalone: true,
  imports: [
    CommonModule,
    MatTabsModule,
    MatIconModule,
    GlobalNavMenuComponent,
    GroceryListComponent,
    RecipesComponent,
    RestaurantsComponent
  ],
  templateUrl: './food.component.html',
  styleUrls: ['./food.component.scss']
})
export class FoodComponent {
  selectedTabIndex = 0;
}
