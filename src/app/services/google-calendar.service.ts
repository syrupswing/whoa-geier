import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { LocalStorageService } from './local-storage.service';
import { FirestoreService } from './firestore.service';

declare const gapi: any;

export interface CalendarEvent {
  id: string;
  summary: string;
  description?: string;
  start: {
    dateTime?: string;
    date?: string;
  };
  end: {
    dateTime?: string;
    date?: string;
  };
  location?: string;
  htmlLink?: string;
  colorId?: string;
  calendarId?: string;
  source?: 'google' | 'app';
}

export interface CalendarInfo {
  id: string;
  summary: string;
  backgroundColor?: string;
  foregroundColor?: string;
}

@Injectable({
  providedIn: 'root'
})
export class GoogleCalendarService {
  private readonly TOKEN_STORAGE_KEY = 'google-calendar-token';
  private readonly VISIBLE_CALENDARS_KEY = 'google-calendar-visible-ids';
  private readonly CACHE_DOC = 'calendar-events';
  private readonly CACHE_COLLECTION = 'app-cache';

  // Signals for reactive state
  isSignedIn = signal<boolean>(false);
  isInitialized = signal<boolean>(false);
  events = signal<CalendarEvent[]>([]);
  calendars = signal<CalendarInfo[]>([]);
  visibleCalendarIds = signal<Set<string>>(new Set(['primary']));
  error = signal<string | null>(null);
  isLoadingFromCache = signal<boolean>(false);

  private gapiInited = false;
  private tokenClient: any;
  private needsConsent = false;
  private tokenRefreshTimer?: number;

  constructor(
    private localStorageService: LocalStorageService,
    private firestoreService: FirestoreService
  ) {
    this.loadVisibleCalendarPreferences();
    this.loadCachedEvents(); // Show stale events immediately while waiting for auth
    this.initializeGapi();
  }

  /**
   * Initialize the Google API client
   */
  private async initializeGapi(): Promise<void> {
    try {
      // Load the gapi script
      await this.loadGapiScript();

      // Initialize gapi client
      await new Promise<void>((resolve, reject) => {
        gapi.load('client', async () => {
          try {
            // Initialize with or without API key (OAuth works without it)
            const initConfig: any = {
              discoveryDocs: environment.googleCalendar.discoveryDocs,
            };
            
            // Only add API key if it's provided and looks valid
            if (environment.googleCalendar.apiKey && 
                environment.googleCalendar.apiKey.startsWith('AIza')) {
              initConfig.apiKey = environment.googleCalendar.apiKey;
            }
            
            await gapi.client.init(initConfig);
            this.gapiInited = true;
            resolve();
          } catch (err: any) {
            this.error.set(`Error initializing GAPI: ${err.message}`);
            reject(err);
          }
        });
      });

      // Initialize token client for OAuth
      await this.loadGsiScript();
      this.tokenClient = (window as any).google.accounts.oauth2.initTokenClient({
        client_id: environment.googleCalendar.clientId,
        scope: environment.googleCalendar.scopes,
        prompt: '', // Don't show consent screen every time
        callback: (response: any) => {
          if (response.error) {
            this.needsConsent = true;
            this.error.set(response.error);
            return;
          }
          this.needsConsent = false;
          // Save token to localStorage
          this.saveToken(response);
          this.isSignedIn.set(true);
          this.scheduleTokenRefresh(Number(response.expires_in) || 3600);
          this.loadCalendarEvents();
        },
        error_callback: () => {
          // A silent attempt failed (no Google session / grant not usable here),
          // so the next explicit sign-in has to be interactive.
          this.needsConsent = true;
        },
      });

      this.isInitialized.set(true);

      // Mobile browsers suspend the app long enough for the 1-hour token to lapse.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.refreshTokenIfStale();
        }
      });

      // Check for saved token and auto-reconnect
      this.checkSavedToken();
    } catch (err: any) {
      this.error.set(`Initialization error: ${err.message}`);
      console.error('Error initializing Google Calendar API:', err);
    }
  }

  /**
   * Load the GAPI script
   */
  private loadGapiScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if ((window as any).gapi) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://apis.google.com/js/api.js';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load GAPI script'));
      document.head.appendChild(script);
    });
  }

  /**
   * Load the Google Identity Services script
   */
  private loadGsiScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if ((window as any).google?.accounts) {
        resolve();
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load GSI script'));
      document.head.appendChild(script);
    });
  }

  // Silently re-request an access token using the already-granted consent
  private trySilentRefresh(): void {
    if (!this.tokenClient) return;
    try {
      this.tokenClient.requestAccessToken({ prompt: '' });
    } catch {
      // Silent refresh not possible; user will need to sign in manually
      this.needsConsent = true;
    }
  }

  /** Renews shortly before expiry so an active session never hits a dead token. */
  private scheduleTokenRefresh(expiresInSeconds: number): void {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
    }
    const refreshInMs = Math.max((expiresInSeconds - 300) * 1000, 60_000);
    this.tokenRefreshTimer = window.setTimeout(() => this.trySilentRefresh(), refreshInMs);
  }

  private refreshTokenIfStale(): void {
    if (!this.isInitialized()) return;
    const savedToken = this.localStorageService.getItem<any>(this.TOKEN_STORAGE_KEY);
    const expiresAt = savedToken?.expires_at ?? 0;
    if (Date.now() > expiresAt - 300_000) {
      this.trySilentRefresh();
    }
  }

  // Load last-cached events from Firestore so the UI shows data before sign-in
  async loadCachedEvents(): Promise<void> {
    if (!this.firestoreService.isInitialized()) return;
    this.isLoadingFromCache.set(true);
    try {
      const cached = await this.firestoreService.getDocument<{ events: CalendarEvent[]; calendars: CalendarInfo[] }>(
        this.CACHE_COLLECTION, this.CACHE_DOC
      );
      if (cached?.events?.length) {
        this.events.set(cached.events);
      }
      if (cached?.calendars?.length) {
        this.calendars.set(cached.calendars);
        // Restore visible calendars preference if not already set
        const current = this.visibleCalendarIds();
        if (current.size <= 1 && current.has('primary')) {
          const ids = new Set(cached.calendars.map((c: CalendarInfo) => c.id));
          this.visibleCalendarIds.set(ids);
        }
      }
    } catch {
      // Cache miss is fine — just nothing to show yet
    } finally {
      this.isLoadingFromCache.set(false);
    }
  }

  private async cacheEventsToFirestore(events: CalendarEvent[]): Promise<void> {
    if (!this.firestoreService.isInitialized()) return;
    try {
      await this.firestoreService.setDocument(this.CACHE_COLLECTION, this.CACHE_DOC, {
        events,
        calendars: this.calendars(),
        cachedAt: new Date().toISOString(),
      });
    } catch {
      // Non-critical — silently ignore cache write failures
    }
  }

  toggleCalendar(calendarId: string, visible: boolean): void {
    const updated = new Set(this.visibleCalendarIds());
    if (visible) {
      updated.add(calendarId);
    } else {
      updated.delete(calendarId);
    }
    this.visibleCalendarIds.set(updated);
    // Persist to localStorage
    this.saveVisibleCalendarPreferences(updated);
  }

  isCalendarVisible(calendarId: string): boolean {
    return this.visibleCalendarIds().has(calendarId);
  }

  private loadVisibleCalendarPreferences(): void {
    try {
      const saved = this.localStorageService.getItem<string>(this.VISIBLE_CALENDARS_KEY);
      if (saved) {
        const ids = JSON.parse(saved) as string[];
        this.visibleCalendarIds.set(new Set(ids));
      }
    } catch (err) {
      console.error('Error loading calendar preferences:', err);
    }
  }

  private saveVisibleCalendarPreferences(visibleIds: Set<string>): void {
    try {
      const ids = Array.from(visibleIds);
      this.localStorageService.setItem(this.VISIBLE_CALENDARS_KEY, JSON.stringify(ids));
    } catch (err) {
      console.error('Error saving calendar preferences:', err);
    }
  }

  getCalendarColor(calendarId: string): string {
    const cal = this.calendars().find(c => c.id === calendarId);
    return cal?.backgroundColor || '#2196F3';
  }
  signIn(): void {
    if (!this.isInitialized()) {
      this.error.set('Google API not initialized yet');
      return;
    }

    if (gapi.client.getToken() === null) {
      // Re-consenting is only needed when a silent attempt has already failed;
      // forcing it every time is what made mobile re-authorize constantly.
      this.tokenClient.requestAccessToken({ prompt: this.needsConsent ? 'consent' : '' });
    } else {
      // Skip display of account chooser and consent dialog for an existing session
      this.tokenClient.requestAccessToken({ prompt: '' });
    }
  }

  /**
   * Sign out from Google
   */
  signOut(): void {
    const token = gapi.client.getToken();
    if (token !== null) {
      (window as any).google.accounts.oauth2.revoke(token.access_token);
      gapi.client.setToken(null);
      this.isSignedIn.set(false);
      this.events.set([]);
      if (this.tokenRefreshTimer) {
        clearTimeout(this.tokenRefreshTimer);
        this.tokenRefreshTimer = undefined;
      }
      this.needsConsent = true;
      // Clear saved token
      this.localStorageService.removeItem(this.TOKEN_STORAGE_KEY);
    }
  }

  /**
   * Save token to localStorage
   */
  private saveToken(tokenResponse: any): void {
    const tokenData = {
      access_token: tokenResponse.access_token,
      expires_at: Date.now() + (tokenResponse.expires_in * 1000),
      token_type: tokenResponse.token_type,
      scope: tokenResponse.scope
    };
    this.localStorageService.setItem(this.TOKEN_STORAGE_KEY, tokenData);
  }

  /**
   * Check for saved token and auto-reconnect if valid
   */
  private checkSavedToken(): void {
    const savedToken = this.localStorageService.getItem<any>(this.TOKEN_STORAGE_KEY);
    
    if (!savedToken || !savedToken.access_token) {
      return;
    }

    // Check if token is still valid (not expired)
    if (savedToken.expires_at && Date.now() < savedToken.expires_at) {
      gapi.client.setToken({
        access_token: savedToken.access_token,
        token_type: savedToken.token_type || 'Bearer',
        scope: savedToken.scope
      });
      this.isSignedIn.set(true);
      this.scheduleTokenRefresh(Math.floor((savedToken.expires_at - Date.now()) / 1000));
      this.loadCalendarEvents();
    } else {
      // Token expired — attempt silent refresh before giving up
      this.localStorageService.removeItem(this.TOKEN_STORAGE_KEY);
      this.trySilentRefresh();
    }
  }

  /**
   * Load calendar events from Google Calendar
   * Loads events for a date range (default: 7 days past, 60 days future)
   */
  async loadCalendarEvents(daysAhead: number = 60, daysBehind: number = 7): Promise<void> {
    if (!this.gapiInited || !this.isSignedIn()) {
      return;
    }

    try {
      const now = new Date();
      const startDate = new Date();
      startDate.setDate(now.getDate() - daysBehind);
      const endDate = new Date();
      endDate.setDate(now.getDate() + daysAhead);

      // Fetch all calendars the user has access to
      const calListResponse = await gapi.client.calendar.calendarList.list({
        minAccessRole: 'reader',
      });
      const calendarList = calListResponse.result.items || [];
      this.calendars.set(calendarList.map((c: any) => ({
        id: c.id,
        // summaryOverride holds the user's own rename of a shared/subscribed calendar.
        summary: c.summaryOverride || c.summary || c.id,
        backgroundColor: c.backgroundColor,
        foregroundColor: c.foregroundColor,
      })));

      // Auto-enable all calendars on first load if user hasn't saved preferences yet
      const currentVisible = this.visibleCalendarIds();
      if (currentVisible.size === 1 && currentVisible.has('primary')) {
        // Only the default 'primary' is set, so enable all calendars for first-time users
        this.visibleCalendarIds.set(new Set(calendarList.map((c: any) => c.id)));
        this.saveVisibleCalendarPreferences(new Set(calendarList.map((c: any) => c.id)));
      }

      const calendarIds = calendarList.map((c: any) => c.id).filter(Boolean);

      // Fall back to primary if list is empty
      if (calendarIds.length === 0) calendarIds.push('primary');

      // Load events from all calendars in parallel and merge
      const results = await Promise.allSettled(
        calendarIds.map((calendarId: string) =>
          gapi.client.calendar.events.list({
            calendarId,
            timeMin: startDate.toISOString(),
            timeMax: endDate.toISOString(),
            showDeleted: false,
            singleEvents: true,
            maxResults: 250,
            orderBy: 'startTime',
          })
        )
      );

      const allEvents: CalendarEvent[] = [];
      const seenIds = new Set<string>();
      for (let i = 0; i < results.length; i++) {
        const result = results[i];
        const calendarId = calendarIds[i];
        if (result.status === 'fulfilled') {
          for (const event of (result.value.result.items || []) as CalendarEvent[]) {
            event.calendarId = calendarId;
            if (!seenIds.has(event.id)) {
              seenIds.add(event.id);
              allEvents.push(event);
            }
          }
        }
      }

      this.events.set(allEvents);
      this.error.set(null);
      this.cacheEventsToFirestore(allEvents);
    } catch (err: any) {
      if (err?.status === 401) {
        this.trySilentRefresh();
        return;
      }
      this.error.set(`Error loading events: ${err.message}`);
      console.error('Error loading calendar events:', err);
    }
  }

  /**
   * Get events for a specific date range
   */
  async getEventsInRange(startDate: Date, endDate: Date): Promise<CalendarEvent[]> {
    if (!this.gapiInited || !this.isSignedIn()) {
      return [];
    }

    try {
      const response = await gapi.client.calendar.events.list({
        calendarId: 'primary',
        timeMin: startDate.toISOString(),
        timeMax: endDate.toISOString(),
        showDeleted: false,
        singleEvents: true,
        orderBy: 'startTime',
      });

      return response.result.items || [];
    } catch (err: any) {
      this.error.set(`Error loading events: ${err.message}`);
      console.error('Error loading calendar events:', err);
      return [];
    }
  }
}
