import { Injectable, signal } from '@angular/core';
import { environment } from '../../environments/environment';
import { LocalStorageService } from './local-storage.service';

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
  
  // Signals for reactive state
  isSignedIn = signal<boolean>(false);
  isInitialized = signal<boolean>(false);
  events = signal<CalendarEvent[]>([]);
  calendars = signal<CalendarInfo[]>([]);
  visibleCalendarIds = signal<Set<string>>(new Set(['primary']));
  error = signal<string | null>(null);

  private gapiInited = false;
  private tokenClient: any;

  constructor(private localStorageService: LocalStorageService) {
    // Load saved calendar visibility preferences
    this.loadVisibleCalendarPreferences();
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
            this.error.set(response.error);
            return;
          }
          // Save token to localStorage
          this.saveToken(response);
          this.isSignedIn.set(true);
          this.loadCalendarEvents();
        },
      });

      this.isInitialized.set(true);
      
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
      // Prompt the user to select a Google Account and ask for consent
      this.tokenClient.requestAccessToken({ prompt: 'consent' });
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
      // Set the token in gapi client
      gapi.client.setToken({
        access_token: savedToken.access_token,
        token_type: savedToken.token_type || 'Bearer',
        scope: savedToken.scope
      });
      
      this.isSignedIn.set(true);
      this.loadCalendarEvents();
    } else {
      // Token expired, remove it
      this.localStorageService.removeItem(this.TOKEN_STORAGE_KEY);
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
        summary: c.summary,
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
    } catch (err: any) {
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
