import { Injectable, effect, signal, untracked } from '@angular/core';
import { CalendarEvent, CalendarInfo } from './google-calendar.service';
import { LocalStorageService } from './local-storage.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';

interface GraphCalendar {
  id: string;
  name?: string;
  hexColor?: string;
  color?: string;
}

interface GraphEvent {
  id: string;
  subject?: string;
  bodyPreview?: string;
  isAllDay?: boolean;
  isCancelled?: boolean;
  webLink?: string;
  location?: { displayName?: string };
  start: { dateTime: string };
  end: { dateTime: string };
}

interface OutlookCache {
  events: CalendarEvent[];
  calendars: CalendarInfo[];
  syncedAt: string;
}

/** Microsoft's named calendar colors, for calendars that have no custom hex color. */
const PRESET_COLORS: Record<string, string> = {
  lightBlue: '#4aa3df', lightGreen: '#6cc070', lightOrange: '#f2994a', lightGray: '#9aa0a6',
  lightYellow: '#f2c94c', lightTeal: '#4db6ac', lightPink: '#f06292', lightBrown: '#a1887f',
  lightRed: '#e57373'
};
const DEFAULT_COLOR = '#0078d4';

/** Reads a JWT's expiry (seconds since epoch) without verifying it — only used to know when to stop trying. */
function tokenExpiryMs(token: string): number | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * Read-only link to a person's Outlook calendars through Microsoft Graph, using an access token
 * copied from Graph Explorer (so no Azure app registration is needed). Those tokens last about an
 * hour and can't be renewed, so each sync replaces a per-person copy of the events in Firestore;
 * when the token lapses the app keeps showing that last copy until a new token is pasted.
 */
@Injectable({
  providedIn: 'root'
})
export class OutlookCalendarService {
  private readonly TOKEN_STORAGE_KEY = 'outlook-calendar-token';
  private readonly VISIBLE_CALENDARS_KEY = 'outlook-calendar-hidden-ids';
  private readonly CACHE_COLLECTION = 'outlookCalendarCache';
  /** Re-sync while the token is still good, so changes made in Outlook show up. */
  private readonly RESYNC_MS = 15 * 60 * 1000;

  /** True while a pasted token is valid and being used to sync. */
  isSignedIn = signal<boolean>(false);
  /** True once a token has ever been synced, so cached events exist even when signed out. */
  hasCache = signal<boolean>(false);
  isSyncing = signal<boolean>(false);
  events = signal<CalendarEvent[]>([]);
  calendars = signal<CalendarInfo[]>([]);
  syncedAt = signal<Date | null>(null);
  /** Calendar IDs the person has switched off; new calendars default to visible. */
  hiddenCalendarIds = signal<Set<string>>(new Set());
  error = signal<string | null>(null);

  private accessToken: string | null = null;
  private expiryTimer?: number;
  private resyncTimer?: number;
  private bootstrappedUid: string | null = null;

  constructor(
    private localStorageService: LocalStorageService,
    private firestoreService: FirestoreService,
    private authService: AuthService
  ) {
    this.loadVisibilityPreferences();

    // Show the cached copy, and resume with a saved still-valid token, once the account is known.
    effect(() => {
      const uid = this.authService.currentUser()?.uid ?? null;
      untracked(() => {
        if (!uid || this.bootstrappedUid === uid) return;
        this.bootstrappedUid = uid;
        this.restore(uid);
      });
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && this.accessToken) this.syncIfStale();
    });
  }

  // ── Connect / disconnect ───────────────────────────────────────

  /** Uses a token pasted from Graph Explorer, syncs with it, and remembers it until it expires. */
  async connectWithToken(rawToken: string): Promise<boolean> {
    const token = rawToken.trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '');
    if (!token) {
      this.error.set('Paste the access token from Graph Explorer first.');
      return false;
    }
    const expiresAt = tokenExpiryMs(token);
    if (expiresAt !== null && expiresAt <= Date.now()) {
      this.error.set('That token has already expired — copy a fresh one from Graph Explorer.');
      return false;
    }

    this.accessToken = token;
    const ok = await this.sync();
    if (!ok) {
      this.accessToken = null;
      return false;
    }
    // A token with no readable expiry is assumed to last an hour.
    const expiry = expiresAt ?? Date.now() + 60 * 60 * 1000;
    this.localStorageService.setItem(this.TOKEN_STORAGE_KEY, {
      uid: this.authService.currentUser()?.uid,
      access_token: token,
      expires_at: expiry
    });
    this.beginSession(expiry);
    return true;
  }

  /** Forgets the token and deletes the stored copy of the events. */
  async signOut(): Promise<void> {
    this.endSession();
    this.localStorageService.removeItem(this.TOKEN_STORAGE_KEY);
    this.events.set([]);
    this.calendars.set([]);
    this.syncedAt.set(null);
    this.hasCache.set(false);
    const uid = this.authService.currentUser()?.uid;
    if (uid) {
      try {
        await this.firestoreService.deleteDocument(this.CACHE_COLLECTION, uid);
      } catch (err) {
        console.error('Error clearing the Outlook cache:', err);
      }
    }
  }

  // ── Session ────────────────────────────────────────────────────

  private async restore(uid: string): Promise<void> {
    const cached = await this.loadCache(uid);
    const saved = this.localStorageService.getItem<any>(this.TOKEN_STORAGE_KEY);
    if (saved?.uid === uid && saved.access_token && saved.expires_at && Date.now() < saved.expires_at) {
      this.accessToken = saved.access_token;
      this.beginSession(saved.expires_at);
      this.sync();
    } else if (cached) {
      this.localStorageService.removeItem(this.TOKEN_STORAGE_KEY);
    }
  }

  private beginSession(expiresAt: number): void {
    this.isSignedIn.set(true);
    this.clearTimers();
    this.expiryTimer = window.setTimeout(() => this.expireSession(), Math.max(expiresAt - Date.now(), 0));
    this.resyncTimer = window.setInterval(() => this.sync(), this.RESYNC_MS);
  }

  /** The token lapsed: stop syncing but keep showing the last copy. */
  private expireSession(): void {
    this.endSession();
    this.localStorageService.removeItem(this.TOKEN_STORAGE_KEY);
  }

  private endSession(): void {
    this.accessToken = null;
    this.isSignedIn.set(false);
    this.clearTimers();
  }

  private clearTimers(): void {
    if (this.expiryTimer) clearTimeout(this.expiryTimer);
    if (this.resyncTimer) clearInterval(this.resyncTimer);
    this.expiryTimer = undefined;
    this.resyncTimer = undefined;
  }

  private syncIfStale(): void {
    const saved = this.localStorageService.getItem<any>(this.TOKEN_STORAGE_KEY);
    if (!saved?.expires_at || Date.now() >= saved.expires_at) {
      this.expireSession();
    } else if (!this.syncedAt() || Date.now() - this.syncedAt()!.getTime() > this.RESYNC_MS) {
      this.sync();
    }
  }

  // ── Events ─────────────────────────────────────────────────────

  /**
   * Pulls every calendar's events from 7 days back to 60 ahead and replaces both the on-screen
   * events and the Firestore copy with them, so anything deleted or moved in Outlook disappears.
   */
  async sync(daysAhead: number = 60, daysBehind: number = 7): Promise<boolean> {
    if (!this.accessToken || this.isSyncing()) return false;
    this.isSyncing.set(true);
    try {
      const start = new Date();
      start.setDate(start.getDate() - daysBehind);
      const end = new Date();
      end.setDate(end.getDate() + daysAhead);

      const graphCalendars = await this.graphList<GraphCalendar>('https://graph.microsoft.com/v1.0/me/calendars?$top=50');
      const calendars: CalendarInfo[] = graphCalendars.map(c => ({
        id: `outlook:${c.id}`,
        summary: c.name || 'Calendar',
        backgroundColor: this.calendarColor(c)
      }));

      const query = new URLSearchParams({
        startDateTime: start.toISOString(),
        endDateTime: end.toISOString(),
        $top: '250',
        $select: 'id,subject,bodyPreview,isAllDay,isCancelled,webLink,location,start,end'
      }).toString();
      const results = await Promise.allSettled(
        graphCalendars.map(c => this.graphList<GraphEvent>(
          `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(c.id)}/calendarView?${query}`
        ))
      );

      const events: CalendarEvent[] = [];
      results.forEach((result, i) => {
        if (result.status !== 'fulfilled') return;
        for (const event of result.value) {
          if (!event.isCancelled) events.push(this.toCalendarEvent(event, `outlook:${graphCalendars[i].id}`));
        }
      });

      const syncedAt = new Date();
      this.calendars.set(calendars);
      this.events.set(events);
      this.syncedAt.set(syncedAt);
      this.hasCache.set(true);
      this.error.set(null);
      await this.saveCache({ events, calendars, syncedAt: syncedAt.toISOString() });
      return true;
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403) {
        this.error.set(err.status === 401
          ? 'Microsoft rejected the token — copy a fresh one from Graph Explorer.'
          : 'The token can\'t read calendars — in Graph Explorer, open "Modify permissions" and consent to Calendars.Read, then copy the new token.');
        this.expireSession();
      } else {
        this.error.set(`Error loading Outlook events: ${err?.message || err}`);
      }
      console.error('Error loading Outlook events:', err);
      return false;
    } finally {
      this.isSyncing.set(false);
    }
  }

  private async loadCache(uid: string): Promise<OutlookCache | null> {
    if (!this.firestoreService.isInitialized()) return null;
    try {
      const cached = await this.firestoreService.getDocument<OutlookCache>(this.CACHE_COLLECTION, uid);
      if (!cached?.events) return null;
      this.events.set(cached.events);
      this.calendars.set(cached.calendars || []);
      this.syncedAt.set(cached.syncedAt ? new Date(cached.syncedAt) : null);
      this.hasCache.set(true);
      return cached;
    } catch {
      // No cache yet (or not readable) — nothing to show until the first sync.
      return null;
    }
  }

  private async saveCache(cache: OutlookCache): Promise<void> {
    const uid = this.authService.currentUser()?.uid;
    if (!uid || !this.firestoreService.isInitialized()) return;
    try {
      await this.firestoreService.setDocument(this.CACHE_COLLECTION, uid, cache);
    } catch {
      // Non-critical — the on-screen events still work for this session.
    }
  }

  /** Follows @odata.nextLink pages, asking Graph for times in the device's own time zone. */
  private async graphList<T>(url: string): Promise<T[]> {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const items: T[] = [];
    let next: string | undefined = url;
    for (let page = 0; next && page < 10; page++) {
      const response: Response = await fetch(next, {
        headers: { Authorization: `Bearer ${this.accessToken}`, Prefer: `outlook.timezone="${timeZone}"` }
      });
      if (!response.ok) {
        throw Object.assign(new Error(`Microsoft Graph returned ${response.status}`), { status: response.status });
      }
      const body = await response.json();
      items.push(...(body.value || []));
      next = body['@odata.nextLink'];
    }
    return items;
  }

  private toCalendarEvent(event: GraphEvent, calendarId: string): CalendarEvent {
    const base: CalendarEvent = {
      id: `outlook:${event.id}`,
      summary: event.subject || '(No title)',
      // Trimmed so a few long notes can't push the cached copy past Firestore's document size limit.
      description: event.bodyPreview ? event.bodyPreview.slice(0, 200) : undefined,
      location: event.location?.displayName || undefined,
      htmlLink: event.webLink,
      calendarId,
      source: 'outlook',
      start: {},
      end: {}
    };
    // Optional fields left unset would be stored as `undefined`, which Firestore rejects.
    Object.keys(base).forEach(key => (base as any)[key] === undefined && delete (base as any)[key]);
    if (event.isAllDay) {
      // Graph gives local midnights; end is already the (exclusive) day after, like Google's.
      return { ...base, start: { date: event.start.dateTime.slice(0, 10) }, end: { date: event.end.dateTime.slice(0, 10) } };
    }
    // Times came back in the device's time zone with no offset, so they parse as local time.
    return {
      ...base,
      start: { dateTime: new Date(event.start.dateTime.slice(0, 19)).toISOString() },
      end: { dateTime: new Date(event.end.dateTime.slice(0, 19)).toISOString() }
    };
  }

  // ── Calendar choices ───────────────────────────────────────────

  private calendarColor(c: GraphCalendar): string {
    if (c.hexColor) return c.hexColor;
    return (c.color && PRESET_COLORS[c.color]) || DEFAULT_COLOR;
  }

  getCalendarColor(calendarId: string): string {
    return this.calendars().find(c => c.id === calendarId)?.backgroundColor || DEFAULT_COLOR;
  }

  isCalendarVisible(calendarId: string): boolean {
    return !this.hiddenCalendarIds().has(calendarId);
  }

  toggleCalendar(calendarId: string, visible: boolean): void {
    const hidden = new Set(this.hiddenCalendarIds());
    if (visible) hidden.delete(calendarId); else hidden.add(calendarId);
    this.hiddenCalendarIds.set(hidden);
    this.localStorageService.setItem(this.VISIBLE_CALENDARS_KEY, Array.from(hidden));
  }

  private loadVisibilityPreferences(): void {
    const hidden = this.localStorageService.getItem<string[]>(this.VISIBLE_CALENDARS_KEY);
    if (Array.isArray(hidden)) this.hiddenCalendarIds.set(new Set(hidden));
  }
}
