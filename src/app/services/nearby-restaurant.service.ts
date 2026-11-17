import { Injectable, inject, signal } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { HomeLocationService } from './home-location.service';

export interface NearbyRestaurant {
  placeId: string;
  name: string;
  address: string;
  cuisineLabel: string;
  phone: string;
  website: string;
  mapsUrl: string;
  openNow: boolean | null;
  hoursToday: string;
  dineIn: boolean | null;
  takeout: boolean | null;
  delivery: boolean | null;
  driveMinutes: number | null;
  distanceMeters: number | null;
}

export interface PlaceStatus {
  placeId: string;
  openNow: boolean | null;
  hoursToday: string;
  business: string;
}

/**
 * Finds restaurants near home through Google Places (a Cloud Function holds the key), and keeps
 * fresh open-now status for saved restaurants. Only the place id is stored on a restaurant; hours
 * are looked up again and held in memory for the session.
 */
@Injectable({
  providedIn: 'root'
})
export class NearbyRestaurantService {
  private home = inject(HomeLocationService);

  /** Latest open-now/hours by place id, this session only. */
  statuses = signal<Record<string, PlaceStatus>>({});
  private requested = new Set<string>();

  /** Resolves with results, or an error message to show. */
  async search(query: string): Promise<{ results: NearbyRestaurant[]; error: string | null }> {
    const origin = this.home.originAddress();
    if (!origin) return { results: [], error: 'Add your home address in Settings first (your own tab under People).' };
    try {
      const call = httpsCallable<{ query: string; origin: string }, { results: NearbyRestaurant[] }>(
        getFunctions(), 'nearbyRestaurants'
      );
      const { data } = await call({ query, origin });
      return { results: data.results, error: null };
    } catch (err: any) {
      return { results: [], error: err?.message || 'Couldn\'t search for restaurants — try again.' };
    }
  }

  /** Looks up open-now for place ids not yet checked this session. Never throws. */
  async refresh(placeIds: string[]): Promise<void> {
    const fresh = [...new Set(placeIds)].filter(id => !this.requested.has(id)).slice(0, 20);
    if (fresh.length === 0) return;
    fresh.forEach(id => this.requested.add(id));
    try {
      const call = httpsCallable<{ placeIds: string[] }, { statuses: PlaceStatus[] }>(getFunctions(), 'placeStatus');
      const { data } = await call({ placeIds: fresh });
      this.statuses.update(all => ({ ...all, ...Object.fromEntries(data.statuses.map(s => [s.placeId, s])) }));
    } catch (err) {
      console.warn('Place status lookup failed:', err);
      fresh.forEach(id => this.requested.delete(id));
    }
  }
}
