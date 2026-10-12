import { Injectable } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';

export interface PlaceSuggestion {
  /** The full address/place text to store on the event. */
  text: string;
  main: string;
  secondary: string;
}

/**
 * Address autocomplete for event locations, backed by Google Places through a Cloud Function
 * (the Maps API key stays server-side). Autocomplete requests that share a session token — one
 * per typing session, ended by picking a suggestion — are billed together by Google.
 */
@Injectable({
  providedIn: 'root'
})
export class PlaceSuggestService {
  private sessionToken = crypto.randomUUID();

  /** Suggestions for the text typed so far. Never throws; `failed` says the lookup itself broke (as opposed to finding nothing). */
  async suggest(input: string): Promise<{ suggestions: PlaceSuggestion[]; failed: boolean }> {
    if (input.trim().length < 3) return { suggestions: [], failed: false };
    try {
      const call = httpsCallable<{ input: string; sessionToken: string }, { suggestions: PlaceSuggestion[] }>(
        getFunctions(), 'placeSuggestions'
      );
      const { data } = await call({ input, sessionToken: this.sessionToken });
      return { suggestions: data.suggestions, failed: false };
    } catch (err) {
      console.warn('Place suggestions failed:', err);
      return { suggestions: [], failed: true };
    }
  }

  /** Call once a suggestion is chosen: the next search starts a new billing session. */
  endSession(): void {
    this.sessionToken = crypto.randomUUID();
  }
}
