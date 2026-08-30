import { Injectable, inject, signal, OnDestroy } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { CalendarEvent } from './google-calendar.service';
import { Unsubscribe } from 'firebase/firestore';

export type AppCalendarEvent = CalendarEvent & { source: 'app' };

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
  private readonly COLLECTION_NAME = 'calendarEvents';
  private firestoreSubscription: Unsubscribe | null = null;

  events = signal<AppCalendarEvent[]>([]);

  constructor() {
    if (this.firestoreService.isInitialized()) {
      this.firestoreSubscription = this.firestoreService.subscribeToCollection<AppCalendarEvent>(
        this.COLLECTION_NAME, (items) => this.events.set(items)
      );
    }
  }

  ngOnDestroy(): void {
    if (this.firestoreSubscription) {
      this.firestoreSubscription();
    }
  }

  async addEvent(event: Omit<AppCalendarEvent, 'id' | 'source'>): Promise<string | null> {
    const data: Omit<AppCalendarEvent, 'id'> = { ...event, source: 'app' };
    return this.firestoreService.addDocument<AppCalendarEvent>(this.COLLECTION_NAME, data);
  }

  async updateEvent(id: string, updates: Partial<Omit<AppCalendarEvent, 'id' | 'source'>>): Promise<boolean> {
    return this.firestoreService.updateDocument<AppCalendarEvent>(this.COLLECTION_NAME, id, updates);
  }

  async deleteEvent(id: string): Promise<boolean> {
    return this.firestoreService.deleteDocument(this.COLLECTION_NAME, id);
  }
}
