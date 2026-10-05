import { Injectable, inject, signal } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { CalendarEvent } from './google-calendar.service';
import { HomeLocationService } from './home-location.service';
import { LocalStorageService } from './local-storage.service';

export interface DriveEntry {
  minutes: number;
  /** ISO time to leave home so the drive ends right as the event starts. */
  leaveByIso: string;
  distanceMeters: number;
  /** What the lookup was for — an entry only applies while all three still match the event. */
  origin: string;
  destination: string;
  startIso: string;
}

const STORAGE_KEY = 'drive-time-entries';

/**
 * Drive times from home to events that have a location, requested one event at a time. Results
 * are remembered on this device (so showing one again costs nothing) until the event changes.
 */
@Injectable({
  providedIn: 'root'
})
export class DriveTimeService {
  private home = inject(HomeLocationService);
  private storage = inject(LocalStorageService);

  entries = signal<Record<string, DriveEntry>>(this.load());
  /** Keys of events whose drive time is being looked up right now. */
  loading = signal<ReadonlySet<string>>(new Set());

  /** Whether an event can have a drive time at all: it needs a location and a start time. */
  canShow(event: CalendarEvent): boolean {
    return !!event.location?.trim() && !!event.start.dateTime;
  }

  keyFor(event: CalendarEvent): string {
    return `${event.id}|${event.start.dateTime ?? ''}`;
  }

  /** The event's drive time, if it's being shown and the lookup still matches the event and home address. */
  get(event: CalendarEvent): DriveEntry | null {
    const entry = this.entries()[this.keyFor(event)];
    if (!entry) return null;
    const matches = entry.destination === event.location?.trim() &&
      entry.startIso === event.start.dateTime &&
      entry.origin === this.home.address();
    return matches ? entry : null;
  }

  isLoading(event: CalendarEvent): boolean {
    return this.loading().has(this.keyFor(event));
  }

  /** Looks up and shows the drive time. Resolves with an error message to display, or null on success. */
  async show(event: CalendarEvent): Promise<string | null> {
    const origin = this.home.address();
    const destination = event.location?.trim();
    if (!origin) return 'Add your home address in Settings first.';
    if (!destination || !event.start.dateTime) return 'This event has no location to drive to.';

    const key = this.keyFor(event);
    this.loading.update(set => new Set(set).add(key));
    try {
      const call = httpsCallable<
        { origin: string; destination: string; arriveAtIso: string },
        { minutes: number; leaveByIso: string; distanceMeters: number }
      >(getFunctions(), 'driveTime');
      const { data } = await call({ origin, destination, arriveAtIso: new Date(event.start.dateTime).toISOString() });
      this.entries.update(all => ({
        ...all,
        [key]: { ...data, origin, destination, startIso: event.start.dateTime! }
      }));
      this.save();
      return null;
    } catch (err: any) {
      return err?.message || 'Couldn\'t work out the drive time — try again.';
    } finally {
      this.loading.update(set => {
        const next = new Set(set);
        next.delete(key);
        return next;
      });
    }
  }

  hide(event: CalendarEvent): void {
    const key = this.keyFor(event);
    this.entries.update(all => {
      const { [key]: _removed, ...rest } = all;
      return rest;
    });
    this.save();
  }

  private load(): Record<string, DriveEntry> {
    const saved = this.storage.getItem<Record<string, DriveEntry>>(STORAGE_KEY) ?? {};
    // Drop entries for events that started more than a day ago.
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return Object.fromEntries(Object.entries(saved).filter(([, e]) => new Date(e.startIso).getTime() > cutoff));
  }

  private save(): void {
    this.storage.setItem(STORAGE_KEY, this.entries());
  }
}
