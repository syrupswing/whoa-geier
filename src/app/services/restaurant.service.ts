import { Injectable, inject, signal } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { LocalStorageService } from './local-storage.service';

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
  /** Whether the family orders delivery from it; unset means "yes if it has delivery apps or order links". */
  delivery?: boolean;
  /** Whether it's somewhere to go out to; unset means yes. */
  dineOut?: boolean;
  favorite: boolean;
  notes?: string;
  rating?: number;
}

// Restaurants shared by the whole family in Firestore, so every device sees the same list.
@Injectable({
  providedIn: 'root'
})
export class RestaurantService {
  private firestoreService = inject(FirestoreService);
  private localStorageService = inject(LocalStorageService);

  private readonly COLLECTION_NAME = 'restaurants';
  private readonly LOCAL_STORAGE_KEY = 'family-command-center-restaurants';

  restaurants = signal<Restaurant[]>([]);
  isLoading = signal<boolean>(false);

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    this.isLoading.set(true);
    try {
      if (this.firestoreService.isInitialized()) {
        await this.migrateFromLocalStorageIfEmpty();
        this.firestoreService.subscribeToCollection<Restaurant>(
          this.COLLECTION_NAME, (items) => this.restaurants.set(items)
        );
      } else {
        this.restaurants.set(this.localStorageService.getItem<Restaurant[]>(this.LOCAL_STORAGE_KEY) || []);
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  // One-time move of whatever this device had saved locally into Firestore. Unlike recipes there
  // is no sample data to seed: a brand-new install starts with an empty list.
  private async migrateFromLocalStorageIfEmpty(): Promise<void> {
    const existing = await this.firestoreService.getCollection<Restaurant>(this.COLLECTION_NAME);
    if (existing.length > 0) return;

    const local = this.localStorageService.getItem<Restaurant[]>(this.LOCAL_STORAGE_KEY) || [];
    await Promise.all(
      local.map(restaurant => this.firestoreService.setDocument(this.COLLECTION_NAME, restaurant.id, restaurant))
    );
  }

  offersDelivery(r: Restaurant): boolean {
    return r.delivery ?? (r.deliveryApps?.length > 0 || r.orderLinks?.length > 0);
  }

  offersDineOut(r: Restaurant): boolean {
    return r.dineOut ?? true;
  }

  async addRestaurant(restaurant: Omit<Restaurant, 'id'>): Promise<void> {
    const id = Date.now().toString();
    await this.firestoreService.setDocument(this.COLLECTION_NAME, id, { ...restaurant, id });
  }

  async updateRestaurant(id: string, updates: Partial<Omit<Restaurant, 'id'>>): Promise<void> {
    await this.firestoreService.updateDocument(this.COLLECTION_NAME, id, updates);
  }

  async deleteRestaurant(id: string): Promise<void> {
    await this.firestoreService.deleteDocument(this.COLLECTION_NAME, id);
  }
}
