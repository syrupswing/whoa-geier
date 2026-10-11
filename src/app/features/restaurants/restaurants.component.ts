import { Component, Input, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { RestaurantService, Restaurant, OrderLink } from '../../services/restaurant.service';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';

export type { Restaurant, OrderLink };

@Component({
  selector: 'app-restaurants',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    MatCheckboxModule,
    GlobalNavMenuComponent
  ],
  templateUrl: './restaurants.component.html',
  styleUrls: ['./restaurants.component.scss']
})
export class RestaurantsComponent {
  private restaurantService = inject(RestaurantService);

  restaurants = this.restaurantService.restaurants;

  /** Inside the Food page the page supplies the header and search, and picks which kind to show. */
  @Input() embedded = false;
  @Input() searchTerm = '';
  @Input() mode: 'all' | 'delivery' | 'dineOut' = 'all';
  filterCuisine = '';
  showAddForm = false;
  editingRestaurantId: string | null = null;

  newRestaurant = {
    name: '',
    cuisine: '',
    phone: '',
    website: '',
    deliveryApps: '',
    notes: '',
    rating: 0,
    delivery: false,
    dineOut: true
  };

  // Order link form fields
  newOrderLink = {
    text: '',
    url: ''
  };
  orderLinks: OrderLink[] = [];

  private matchesMode(restaurant: Restaurant): boolean {
    if (this.mode === 'delivery') return this.restaurantService.offersDelivery(restaurant);
    if (this.mode === 'dineOut') return this.restaurantService.offersDineOut(restaurant);
    return true;
  }

  getFilteredRestaurants(): Restaurant[] {
    return this.restaurants().filter(restaurant => {
      const matchesSearch = !this.searchTerm || 
        restaurant.name.toLowerCase().includes(this.searchTerm.toLowerCase());
      const matchesCuisine = !this.filterCuisine || 
        restaurant.cuisine.toLowerCase() === this.filterCuisine.toLowerCase();
      return matchesSearch && matchesCuisine && this.matchesMode(restaurant);
    });
  }

  getFavoriteRestaurants(): Restaurant[] {
    return this.restaurants().filter(r => r.favorite && this.matchesMode(r));
  }

  getAllCuisines(): string[] {
    const cuisines = new Set<string>();
    this.restaurants().forEach(restaurant => {
      cuisines.add(restaurant.cuisine);
    });
    return Array.from(cuisines).sort();
  }

  toggleFavorite(restaurantId: string): void {
    const restaurant = this.restaurants().find(r => r.id === restaurantId);
    if (restaurant) {
      void this.restaurantService.updateRestaurant(restaurantId, { favorite: !restaurant.favorite });
    }
  }

  getStarArray(rating?: number): boolean[] {
    const stars = rating || 0;
    return Array(5).fill(false).map((_, i) => i < stars);
  }

  toggleAddForm(): void {
    this.showAddForm = !this.showAddForm;
    if (!this.showAddForm) {
      this.resetForm();
    }
  }

  addRestaurant(): void {
    if (!this.newRestaurant.name.trim()) return;

    const restaurant: Omit<Restaurant, 'id'> = {
      name: this.newRestaurant.name,
      cuisine: this.newRestaurant.cuisine,
      phone: this.newRestaurant.phone,
      website: this.newRestaurant.website,
      deliveryApps: this.newRestaurant.deliveryApps.split(',').map(a => a.trim()).filter(a => a),
      orderLinks: [...this.orderLinks],
      notes: this.newRestaurant.notes,
      rating: this.newRestaurant.rating,
      delivery: this.newRestaurant.delivery,
      dineOut: this.newRestaurant.dineOut,
      favorite: false
    };

    void this.restaurantService.addRestaurant(restaurant);
    this.showAddForm = false;
    this.resetForm();
  }

  addOrderLink(): void {
    if (this.newOrderLink.text.trim() && this.newOrderLink.url.trim()) {
      this.orderLinks.push({
        text: this.newOrderLink.text.trim(),
        url: this.newOrderLink.url.trim()
      });
      this.newOrderLink = { text: '', url: '' };
    }
  }

  removeOrderLink(index: number): void {
    this.orderLinks.splice(index, 1);
  }

  resetForm(): void {
    this.newRestaurant = {
      name: '',
      cuisine: '',
      phone: '',
      website: '',
      deliveryApps: '',
      notes: '',
      rating: 0,
      delivery: false,
      dineOut: true
    };
    this.orderLinks = [];
    this.newOrderLink = { text: '', url: '' };
    this.editingRestaurantId = null;
  }

  editRestaurant(restaurant: Restaurant): void {
    this.editingRestaurantId = restaurant.id;
    this.newRestaurant = {
      name: restaurant.name,
      cuisine: restaurant.cuisine,
      phone: restaurant.phone || '',
      website: restaurant.website || '',
      deliveryApps: restaurant.deliveryApps.join(', '),
      notes: restaurant.notes || '',
      rating: restaurant.rating || 0,
      delivery: this.restaurantService.offersDelivery(restaurant),
      dineOut: this.restaurantService.offersDineOut(restaurant)
    };
    this.orderLinks = [...(restaurant.orderLinks || [])];
    this.showAddForm = true;
    // Scroll to form
    setTimeout(() => {
      document.querySelector('.add-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  updateRestaurant(): void {
    if (!this.newRestaurant.name.trim() || !this.editingRestaurantId) return;

    const updatedRestaurant: Omit<Restaurant, 'id'> = {
      name: this.newRestaurant.name,
      cuisine: this.newRestaurant.cuisine,
      phone: this.newRestaurant.phone,
      website: this.newRestaurant.website,
      deliveryApps: this.newRestaurant.deliveryApps.split(',').map(a => a.trim()).filter(a => a),
      orderLinks: [...this.orderLinks],
      notes: this.newRestaurant.notes,
      rating: this.newRestaurant.rating,
      delivery: this.newRestaurant.delivery,
      dineOut: this.newRestaurant.dineOut,
      favorite: this.restaurants().find(r => r.id === this.editingRestaurantId)?.favorite || false
    };

    void this.restaurantService.updateRestaurant(this.editingRestaurantId, updatedRestaurant);
    this.showAddForm = false;
    this.resetForm();
  }

  deleteRestaurant(restaurantId: string): void {
    if (confirm('Are you sure you want to delete this restaurant?')) {
      void this.restaurantService.deleteRestaurant(restaurantId);
    }
  }

  saveRestaurant(): void {
    if (this.editingRestaurantId) {
      this.updateRestaurant();
    } else {
      this.addRestaurant();
    }
  }
}
