import { Injectable, signal, effect, untracked } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { environment } from '../../environments/environment';
import { LocalStorageService } from './local-storage.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';

declare const gapi: any;

/** App-native calendar items are either plain timing-based events or completable tasks. */
export type CalendarItemKind = 'event' | 'task';

/** "Every [interval] [unit]" — a weekly repeat recurs on the start date's weekday, a monthly one on its day of month. */
export interface RepeatRule {
  unit: 'day' | 'week' | 'month';
  interval: number;
}

/** One recorded completion of a task occurrence. */
export interface TaskCompletion {
  byUid: string;
  byName: string;
  /** ISO timestamp of when it was marked complete. */
  at: string;
}

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
  source?: 'google' | 'app' | 'outlook';
  /** A specific moment with no duration (a flight departure, a call reminder) — start/end dateTime are equal. */
  isPointInTime?: boolean;
  /** Marks the start time as an estimate rather than exact — only meaningful on a timed (non-point, non-all-day) event. */
  startApproximate?: boolean;
  /** Marks the end time as an estimate rather than exact — only meaningful on a timed (non-point, non-all-day) event. */
  endApproximate?: boolean;
  /** App-native events only — ties the event to one household member (e.g. a personal reminder) rather than the whole family. Unset means it concerns everyone. */
  memberId?: string;
  /** App-native events only — restricted by Firestore rules to be readable/writable only by the account linked to memberId. Only ever settable for yourself, never for someone else. */
  isPrivate?: boolean;
  /** App-native items only — unset is treated as a plain event. */
  kind?: CalendarItemKind;
  /** App-native items only — unset means the item doesn't repeat. */
  repeat?: RepeatRule;
  /** App-native items only — the Firebase uid/display name of whoever created it. A private item is visible only to this uid. */
  createdByUid?: string;
  createdByName?: string;
  /** Runtime only, never stored: for one expanded occurrence of a repeating item, the "YYYY-MM-DD" date that occurrence starts on. */
  occurrenceDate?: string;
  /** Tasks only — completions keyed by the occurrence's start date ("YYYY-MM-DD"), so a repeating task tracks each occurrence separately. */
  completions?: Record<string, TaskCompletion>;
}

export interface CalendarInfo {
  id: string;
  summary: string;
  backgroundColor?: string;
  foregroundColor?: string;
}

interface TokenResult {
  accessToken: string;
  expiresIn: number;
  scope?: string;
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
  private codeClient: any;
  private tokenRefreshTimer?: number;
  private refreshInFlight?: Promise<boolean>;
  private bootstrappedUid: string | null = null;

  constructor(
    private localStorageService: LocalStorageService,
    private firestoreService: FirestoreService,
    private authService: AuthService
  ) {
    this.loadVisibleCalendarPreferences();
    this.loadCachedEvents(); // Show stale events immediately while waiting for auth
    this.initializeGapi();

    // Reconnecting needs both the Google client and the Firebase account (the server keeps
    // the refresh token per account), and either can resolve first.
    effect(() => {
      const uid = this.authService.currentUser()?.uid ?? null;
      const ready = this.isInitialized();
      untracked(() => {
        if (!ready || !uid || this.bootstrappedUid === uid) return;
        this.bootstrappedUid = uid;
        this.checkSavedToken(uid);
      });
    });
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

      // The code client is only used for the explicit Connect click: it returns a one-time
      // code the server trades for a long-lived refresh token. Renewals never come back here.
      await this.loadGsiScript();
      this.codeClient = (window as any).google.accounts.oauth2.initCodeClient({
        client_id: environment.googleCalendar.clientId,
        scope: environment.googleCalendar.scopes,
        ux_mode: 'popup',
        callback: (response: any) => this.handleAuthCode(response),
        error_callback: () => {
          // Popup closed or blocked — nothing to do until the next Connect click.
        },
      });

      this.isInitialized.set(true);

      // Mobile browsers suspend the app long enough for the 1-hour token to lapse.
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
          this.refreshTokenIfStale();
        }
      });

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

  /** Exchanges the auth code from a Connect click for tokens; the server stores the refresh token. */
  private async handleAuthCode(response: any): Promise<void> {
    if (response.error || !response.code) {
      this.error.set(response.error || 'Google sign-in was cancelled');
      return;
    }
    try {
      const connect = httpsCallable<{ code: string }, TokenResult>(getFunctions(), 'googleCalendarConnect');
      const result = await connect({ code: response.code });
      this.applyToken(result.data);
    } catch (err: any) {
      if (err?.message === 'no-refresh-token') {
        this.error.set('Google didn\'t grant long-term access this time — tap Connect once more.');
      } else {
        this.error.set(`Error connecting Google Calendar: ${err?.message || err}`);
      }
    }
  }

  /** Fetches a fresh access token from the server-held refresh token. No Google window is involved. */
  private refreshAccessToken(): Promise<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = (async () => {
      try {
        const getToken = httpsCallable<void, TokenResult>(getFunctions(), 'googleCalendarToken');
        const result = await getToken();
        this.applyToken(result.data);
        return true;
      } catch (err: any) {
        if (err?.message === 'not-connected') {
          // No grant on the server (never connected, or revoked) — a Connect click is needed.
          this.clearLocalSession();
        } else {
          console.error('Google Calendar token refresh failed:', err);
        }
        return false;
      } finally {
        this.refreshInFlight = undefined;
      }
    })();
    return this.refreshInFlight;
  }

  private applyToken(token: TokenResult): void {
    const expiresIn = Number(token.expiresIn) || 3600;
    gapi.client.setToken({ access_token: token.accessToken, token_type: 'Bearer', scope: token.scope });
    this.saveToken(token.accessToken, expiresIn, token.scope);
    this.error.set(null);
    this.isSignedIn.set(true);
    this.scheduleTokenRefresh(expiresIn);
    this.loadCalendarEvents();
  }

  /** Renews shortly before expiry so an active session never hits a dead token. */
  private scheduleTokenRefresh(expiresInSeconds: number): void {
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
    }
    const refreshInMs = Math.max((expiresInSeconds - 300) * 1000, 60_000);
    this.tokenRefreshTimer = window.setTimeout(() => this.refreshAccessToken(), refreshInMs);
  }

  /** Timers are throttled or frozen while a tab/device sleeps, so re-check on return. */
  private refreshTokenIfStale(): void {
    if (!this.isSignedIn()) return;
    const savedToken = this.localStorageService.getItem<any>(this.TOKEN_STORAGE_KEY);
    const expiresAt = savedToken?.expires_at ?? 0;
    if (Date.now() > expiresAt - 300_000) {
      this.refreshAccessToken();
    }
  }

  private clearLocalSession(): void {
    if (typeof gapi !== 'undefined' && gapi.client) gapi.client.setToken(null);
    this.isSignedIn.set(false);
    if (this.tokenRefreshTimer) {
      clearTimeout(this.tokenRefreshTimer);
      this.tokenRefreshTimer = undefined;
    }
    this.localStorageService.removeItem(this.TOKEN_STORAGE_KEY);
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
  /** Must run from a click — it opens Google's one-time consent window. */
  signIn(): void {
    if (!this.isInitialized()) {
      this.error.set('Google API not initialized yet');
      return;
    }
    this.codeClient.requestCode();
  }

  /**
   * Disconnect from Google: the server revokes the grant and forgets the refresh token
   */
  async signOut(): Promise<void> {
    this.clearLocalSession();
    this.events.set([]);
    try {
      await httpsCallable(getFunctions(), 'googleCalendarDisconnect')();
    } catch (err) {
      console.error('Error disconnecting Google Calendar:', err);
    }
  }

  /**
   * Save the current access token so a reload can reuse it without a server round trip
   */
  private saveToken(accessToken: string, expiresIn: number, scope?: string): void {
    this.localStorageService.setItem(this.TOKEN_STORAGE_KEY, {
      uid: this.authService.currentUser()?.uid,
      access_token: accessToken,
      expires_at: Date.now() + expiresIn * 1000,
      token_type: 'Bearer',
      scope
    });
  }

  /**
   * Reuse a still-valid saved token for this account, otherwise ask the server for a fresh one
   */
  private checkSavedToken(uid: string): void {
    const savedToken = this.localStorageService.getItem<any>(this.TOKEN_STORAGE_KEY);

    if (savedToken?.uid === uid && savedToken.access_token && savedToken.expires_at && Date.now() < savedToken.expires_at) {
      gapi.client.setToken({
        access_token: savedToken.access_token,
        token_type: savedToken.token_type || 'Bearer',
        scope: savedToken.scope
      });
      this.isSignedIn.set(true);
      this.scheduleTokenRefresh(Math.floor((savedToken.expires_at - Date.now()) / 1000));
      this.loadCalendarEvents();
    } else {
      this.localStorageService.removeItem(this.TOKEN_STORAGE_KEY);
      this.refreshAccessToken();
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
        this.refreshAccessToken();
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
