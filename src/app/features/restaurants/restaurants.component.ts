import { Component, signal, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { LocalStorageService } from '../../services/local-storage.service';

export interface OrderLink {
  text: string;
  url: string;
}

export interface Restaurant {
  id: string;
  name: string;
  cuisine: string;
  phone?: string;
  website?: string;
  deliveryApps: string[];
  orderLinks: OrderLink[];
  favorite: boolean;
  notes?: string;
  rating?: number;
}

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
    MatChipsModule
  ],
  templateUrl: './restaurants.component.html',
  styleUrls: ['./restaurants.component.scss']
})
export class RestaurantsComponent implements OnInit {
  private readonly STORAGE_KEY = 'family-command-center-restaurants';
  private localStorageService = inject(LocalStorageService);

  restaurants = signal<Restaurant[]>([
    {
      id: '1',
      name: 'Pizza Palace',
      cuisine: 'Italian',
      phone: '555-1234',
      website: 'pizzapalace.com',
      deliveryApps: ['DoorDash', 'Uber Eats'],
      orderLinks: [
        { text: 'Order on DoorDash', url: 'https://doordash.com' },
        { text: 'Order on Uber Eats', url: 'https://ubereats.com' }
      ],
      favorite: true,
      notes: 'Great pepperoni pizza!',
      rating: 5
    },
    {
      id: '2',
      name: 'Thai Orchid',
      cuisine: 'Thai',
      phone: '555-5678',
      deliveryApps: ['DoorDash', 'Grubhub'],
      orderLinks: [
        { text: 'DoorDash', url: 'https://doordash.com' }
      ],
      favorite: true,
      notes: 'Pad Thai is amazing',
      rating: 5
    },
    {
      id: '3',
      name: 'Burger Barn',
      cuisine: 'American',
      phone: '555-9012',
      deliveryApps: ['Uber Eats'],
      orderLinks: [],
      favorite: false,
      rating: 4
    }
  ]);

  searchTerm = '';
  filterCuisine = '';
  showAddForm = false;
  editingRestaurantId: string | null = null;

  ngOnInit(): void {
    this.loadRestaurants();
  }

  private loadRestaurants(): void {
    const savedRestaurants = this.localStorageService.getItem<Restaurant[]>(this.STORAGE_KEY);
    if (savedRestaurants && savedRestaurants.length > 0) {
      this.restaurants.set(savedRestaurants);
    }
  }

  private saveRestaurants(): void {
    this.localStorageService.setItem(this.STORAGE_KEY, this.restaurants());
  }
  
  newRestaurant = {
    name: '',
    cuisine: '',
    phone: '',
    website: '',
    deliveryApps: '',
    notes: '',
    rating: 0
  };

  // Order link form fields
  newOrderLink = {
    text: '',
    url: ''
  };
  orderLinks: OrderLink[] = [];

  getFilteredRestaurants(): Restaurant[] {
    return this.restaurants().filter(restaurant => {
      const matchesSearch = !this.searchTerm || 
        restaurant.name.toLowerCase().includes(this.searchTerm.toLowerCase());
      const matchesCuisine = !this.filterCuisine || 
        restaurant.cuisine.toLowerCase() === this.filterCuisine.toLowerCase();
      return matchesSearch && matchesCuisine;
    });
  }

  getFavoriteRestaurants(): Restaurant[] {
    return this.restaurants().filter(r => r.favorite);
  }

  getAllCuisines(): string[] {
    const cuisines = new Set<string>();
    this.restaurants().forEach(restaurant => {
      cuisines.add(restaurant.cuisine);
    });
    return Array.from(cuisines).sort();
  }

  toggleFavorite(restaurantId: string): void {
    const updated = this.restaurants().map(restaurant =>
      restaurant.id === restaurantId ? { ...restaurant, favorite: !restaurant.favorite } : restaurant
    );
    this.restaurants.set(updated);
    this.saveRestaurants();
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

    const restaurant: Restaurant = {
      id: Date.now().toString(),
      name: this.newRestaurant.name,
      cuisine: this.newRestaurant.cuisine,
      phone: this.newRestaurant.phone,
      website: this.newRestaurant.website,
      deliveryApps: this.newRestaurant.deliveryApps.split(',').map(a => a.trim()).filter(a => a),
      orderLinks: [...this.orderLinks],
      notes: this.newRestaurant.notes,
      rating: this.newRestaurant.rating,
      favorite: false
    };

    this.restaurants.set([...this.restaurants(), restaurant]);
    this.saveRestaurants();
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
      rating: 0
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
      rating: restaurant.rating || 0
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

    const updatedRestaurant: Restaurant = {
      id: this.editingRestaurantId,
      name: this.newRestaurant.name,
      cuisine: this.newRestaurant.cuisine,
      phone: this.newRestaurant.phone,
      website: this.newRestaurant.website,
      deliveryApps: this.newRestaurant.deliveryApps.split(',').map(a => a.trim()).filter(a => a),
      orderLinks: [...this.orderLinks],
      notes: this.newRestaurant.notes,
      rating: this.newRestaurant.rating,
      favorite: this.restaurants().find(r => r.id === this.editingRestaurantId)?.favorite || false
    };

    this.restaurants.set(this.restaurants().map(r => r.id === this.editingRestaurantId ? updatedRestaurant : r));
    this.saveRestaurants();
    this.showAddForm = false;
    this.resetForm();
  }

  deleteRestaurant(restaurantId: string): void {
    if (confirm('Are you sure you want to delete this restaurant?')) {
      this.restaurants.set(this.restaurants().filter(r => r.id !== restaurantId));
      this.saveRestaurants();
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
