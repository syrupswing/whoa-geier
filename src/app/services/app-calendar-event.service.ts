import { Injectable, inject, signal, computed, effect, OnDestroy } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { CalendarEvent, TaskCompletion } from './google-calendar.service';
import { AuthService } from './auth.service';
import { Unsubscribe } from 'firebase/firestore';

export type AppCalendarEvent = CalendarEvent & { source: 'app' };

/** The day after a "YYYY-MM-DD" date, as "YYYY-MM-DD" (local calendar arithmetic, no time-zone shift). */
export function nextDayIso(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

/**
 * All-day end dates are exclusive (the day after the last day), matching Google Calendar and
 * what the calendar views expect. Older app items stored end == start for a one-day event,
 * which the dashboard read as ending the day before it started — treat those as one day.
 */
function normalizeAllDayEnd(event: AppCalendarEvent): AppCalendarEvent {
  const { start, end } = event;
  if (start?.date && !start.dateTime && end?.date && end.date <= start.date) {
    return { ...event, end: { date: nextDayIso(start.date) } };
  }
  return event;
}

// App-native calendar events, stored in Firestore and merged into the same calendar view
// as Google Calendar events (see CalendarComponent). Exists because this app only has
// read access to Google Calendar (OAuth scope + gapi events.list, no insert call) — rather
// than add write scope there, in-app-created events (e.g. from quick-add) live here instead
// and are told apart from Google events by color (see CalendarComponent.getEventColor).
@Injectable({
  providedIn: 'root'
})
export class AppCalendarEventService implements OnDestroy {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);
  private readonly COLLECTION_NAME = 'calendarEvents';
  private unsubscribes: Unsubscribe[] = [];
  private sharedItems = signal<AppCalendarEvent[]>([]);
  private ownItems = signal<AppCalendarEvent[]>([]);

  /** Shared items plus the signed-in person's own (including their private ones), de-duplicated. */
  events = computed(() => {
    const byId = new Map<string, AppCalendarEvent>();
    for (const item of [...this.sharedItems(), ...this.ownItems()]) byId.set(item.id, item);
    return [...byId.values()].map(normalizeAllDayEnd);
  });

  constructor() {
    // Two filtered queries, because the security rules only allow reads provably limited to what
    // this person may see: items that aren't private, and items they created.
    effect(() => {
      const uid = this.authService.currentUser()?.uid;
      this.unsubscribes.forEach(u => u());
      this.unsubscribes = [];
      this.sharedItems.set([]);
      this.ownItems.set([]);
      if (!uid || !this.firestoreService.isInitialized()) return;
      const shared = this.firestoreService.subscribeToWhereEquals<AppCalendarEvent>(
        this.COLLECTION_NAME, 'isPrivate', false, items => this.sharedItems.set(items)
      );
      const own = this.firestoreService.subscribeToWhereEquals<AppCalendarEvent>(
        this.COLLECTION_NAME, 'createdByUid', uid, items => this.ownItems.set(items)
      );
      this.unsubscribes = [shared, own].filter((u): u is Unsubscribe => !!u);
    }, { allowSignalWrites: true });
  }

  ngOnDestroy(): void {
    this.unsubscribes.forEach(u => u());
  }

  async addEvent(event: Omit<AppCalendarEvent, 'id' | 'source'>): Promise<string | null> {
    const user = this.authService.currentUser();
    const data: Omit<AppCalendarEvent, 'id'> = {
      ...event,
      source: 'app',
      kind: event.kind ?? 'event',
      // Always stored, because the shared-items query matches on it.
      isPrivate: event.isPrivate ?? false,
      // Who made it — drives "created by" on shared items and who may see a private one.
      ...(user ? { createdByUid: user.uid, createdByName: user.displayName || user.email || 'Someone' } : {})
    };
    return this.firestoreService.addDocument<AppCalendarEvent>(this.COLLECTION_NAME, data);
  }

  async updateEvent(id: string, updates: Partial<Omit<AppCalendarEvent, 'id' | 'source'>>): Promise<boolean> {
    return this.firestoreService.updateDocument<AppCalendarEvent>(this.COLLECTION_NAME, id, updates);
  }

  /**
   * Records who completed one occurrence of a task, and when. Keyed by the occurrence's date so a
   * repeating task keeps a separate completion for each occurrence.
   */
  async completeOccurrence(id: string, occurrenceDate: string): Promise<boolean> {
    const user = this.authService.currentUser();
    const completion: TaskCompletion = {
      byUid: user?.uid ?? '',
      byName: user?.displayName || user?.email || 'Someone',
      at: new Date().toISOString()
    };
    // A dotted key is a Firestore field path, so only this one occurrence is written.
    return this.firestoreService.updateDocument<AppCalendarEvent>(
      this.COLLECTION_NAME, id, { [`completions.${occurrenceDate}`]: completion } as any
    );
  }

  /** Hides one occurrence of a task from the calendar until the given time. */
  async snoozeOccurrence(id: string, occurrenceDate: string, until: Date): Promise<boolean> {
    return this.firestoreService.updateDocument<AppCalendarEvent>(
      this.COLLECTION_NAME, id, { [`snoozes.${occurrenceDate}`]: until.toISOString() } as any
    );
  }

  /** Brings a snoozed occurrence back (a dotted key set to undefined becomes a field delete). */
  async unsnoozeOccurrence(id: string, occurrenceDate: string): Promise<boolean> {
    return this.firestoreService.updateDocument<AppCalendarEvent>(
      this.COLLECTION_NAME, id, { [`snoozes.${occurrenceDate}`]: undefined } as any
    );
  }

  /** Undoes a completion (a dotted key set to undefined becomes a field delete). */
  async clearCompletion(id: string, occurrenceDate: string): Promise<boolean> {
    return this.firestoreService.updateDocument<AppCalendarEvent>(
      this.COLLECTION_NAME, id, { [`completions.${occurrenceDate}`]: undefined } as any
    );
  }

  async deleteEvent(id: string): Promise<boolean> {
    return this.firestoreService.deleteDocument(this.COLLECTION_NAME, id);
  }
}
