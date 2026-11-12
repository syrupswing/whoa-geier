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
  /** Whether the family picks food up from it; unset means no (this was added after the others, so older entries aren't assumed). */
  takeout?: boolean;
  /** The ideal way to order from it: an app name from KNOWN_ORDER_APPS (or one typed in), or DIRECT_ORDER / PHONE_ORDER. */
  bestApp?: string;
  /** Why that one is best, e.g. "no delivery fee with DashPass" or "cheaper ordering direct". */
  bestAppNote?: string;
  /** Anything worth remembering about it: favorite dishes, allergies, the wait, parking. */
  notes?: string;
}

/** Ordering ways that aren't a third-party app. */
export const DIRECT_ORDER = 'Restaurant website';
export const PHONE_ORDER = 'Call in';

/** Apps offered as one-tap choices; `search` builds a link to look the restaurant up when no order link is saved. */
export const KNOWN_ORDER_APPS: { name: string; search?: (restaurant: string) => string }[] = [
  { name: 'DoorDash', search: q => `https://www.doordash.com/search/store/${encodeURIComponent(q)}/` },
  { name: 'Uber Eats', search: q => `https://www.ubereats.com/search?q=${encodeURIComponent(q)}` },
  { name: 'Grubhub', search: q => `https://www.grubhub.com/search?queryText=${encodeURIComponent(q)}` },
  { name: 'Slice' },
  { name: 'ChowNow' },
  { name: 'Toast' }
];

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

  offersTakeout(r: Restaurant): boolean {
    return r.takeout ?? false;
  }

  /** A website as typed ("example.com" or a full address) as a usable link. */
  websiteUrl(r: Restaurant): string | null {
    const site = r.website?.trim();
    if (!site) return null;
    return /^https?:\/\//i.test(site) ? site : `https://${site}`;
  }

  /** Where the "order" button for the ideal app goes: a saved link for that app, else the app's search page, the website, or the phone. */
  bestOrderUrl(r: Restaurant): string | null {
    const app = r.bestApp?.trim();
    if (!app) return null;
    if (app === PHONE_ORDER) return r.phone ? `tel:${r.phone}` : null;
    if (app === DIRECT_ORDER) return this.websiteUrl(r);
    const lower = app.toLowerCase();
    const saved = r.orderLinks?.find(l => l.text.toLowerCase().includes(lower) || l.url.toLowerCase().includes(lower.replace(/\s+/g, '')));
    if (saved) return saved.url;
    return KNOWN_ORDER_APPS.find(a => a.name === app)?.search?.(r.name) ?? null;
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
