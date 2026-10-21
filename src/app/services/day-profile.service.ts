import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Unsubscribe } from 'firebase/firestore';
import { FirestoreService } from './firestore.service';

export type MemberKind = 'child' | 'adult';

/** Where a stored value came from. Higher-ranked sources win when two disagree (see SOURCE_RANK). */
export type ProfileSource = 'default' | 'calendar' | 'ai' | 'manual';

export interface FieldSource {
  by: ProfileSource;
  /** The calendar event this value was read from, so it can be recomputed if that event moves or goes away. */
  eventId?: string;
  confidence?: number;
}

export interface HomeMeals {
  breakfast?: string;
  lunch?: string;
  snack?: string;
  dinner?: string;
}

export interface SchoolMeals {
  breakfast?: 'hot' | 'pack';
  snack?: 'hot' | 'pack';
  lunch?: 'hot' | 'pack';
}

/** A member's regular week: what a day looks like when nothing on the calendar says otherwise. */
export interface MemberRoutine {
  // Children
  schoolDays?: number[]; // 0-6, Sunday-Saturday
  dropOffTime?: string | null; // "HH:mm"
  pickUpTime?: string | null;
  schoolMeals?: SchoolMeals;

  // Adults
  workDays?: number[];
  workStartTime?: string | null;
  workStopTime?: string | null;
}

/**
 * Something about the day that must not be missed and belongs in every alert and summary ("Wear orange for
 * Unity Day", "Bring a signed permission slip"). Each fact carries its own provenance because several
 * calendar events can each contribute one to the same day.
 */
export interface SpecialFact {
  id: string;
  text: string;
  by: 'calendar' | 'manual';
  /** The calendar event this fact was read from, so it goes away if that event does. */
  eventId?: string;
}

/** The stored fields of one member's day. Everything is optional: an absent field means "use the member's regular routine". */
export interface DayProfileFields {
  /** Short label for display lines ("School pride day"). */
  dayTitle?: string;
  /** The parent's free-text description of the day; also fed to the AI suggestion prompts. */
  dayNote?: string;
  homeMeals?: HomeMeals;
  /** Special instructions, memos and reminders for the day; included in the daily push and the in-app alert. */
  specialFacts?: SpecialFact[];

  // Children
  schoolDay?: boolean;
  dropOffTime?: string | null; // "HH:mm"
  pickUpTime?: string | null;
  schoolMeals?: SchoolMeals;
  schoolActivities?: string[]; // field trip, picture day, assembly
  schoolClasses?: string[]; // gym, music, art, library

  // Adults
  workDay?: boolean;
  startTime?: string | null;
  stopTime?: string | null;
  onCall?: boolean;
}

export type DayProfileField = keyof DayProfileFields;

export interface DayProfile extends DayProfileFields {
  memberId: string;
  date: string; // YYYY-MM-DD, America/Chicago
  /** Provenance of each stored field. A field with no entry counts as 'manual'. */
  sources: Partial<Record<DayProfileField, FieldSource>>;
}

export const SOURCE_RANK: Record<ProfileSource, number> = { default: 0, calendar: 1, ai: 1, manual: 2 };

const COLLECTION = 'dayProfiles';

export function dayProfileId(memberId: string, date: string): string {
  return `${memberId}_${date}`;
}

/**
 * Raw storage for per-member, per-date overrides. Documents are sparse: one exists only for a day
 * that has something other than the member's regular routine, so changing the routine never leaves
 * stale copies behind. Reading a day with the routine applied is the job of the resolver layered on top.
 */
@Injectable({ providedIn: 'root' })
export class DayProfileService implements OnDestroy {
  private readonly firestoreService = inject(FirestoreService);
  private unsubscribe: Unsubscribe | null = null;

  readonly profiles = signal<DayProfile[]>([]);
  private readonly byId = computed(() => new Map(this.profiles().map(p => [dayProfileId(p.memberId, p.date), p])));

  constructor() {
    if (this.firestoreService.isInitialized()) {
      this.unsubscribe = this.firestoreService.subscribeToCollection<DayProfile & { id: string }>(
        COLLECTION,
        items => this.profiles.set(items)
      );
    }
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

  /** The stored overrides for one member's day, or null when that day follows the regular routine. */
  getStored(memberId: string, date: string): DayProfile | null {
    return this.byId().get(dayProfileId(memberId, date)) ?? null;
  }

  /**
   * Writes fields into a day's profile. A field already held by a higher-ranked source is left alone
   * (a calendar guess never overwrites what a parent typed); pass `by: 'manual'` for a deliberate edit.
   * A field given as `undefined` is cleared, so the day falls back to the routine for it.
   * Returns the fields that were actually written or cleared. Throws if the write fails, so a
   * caller can't mistake a denied or failed save for "nothing to change".
   */
  async applyFields(
    memberId: string,
    date: string,
    fields: { [K in DayProfileField]?: DayProfileFields[K] | undefined },
    source: FieldSource
  ): Promise<DayProfileField[]> {
    // Read from the server rather than the signal, which may not have received its first snapshot yet.
    const existing = await this.fetch(memberId, date);
    const sources = { ...(existing?.sources ?? {}) };
    const merged: DayProfileFields = { ...stripMeta(existing) };
    const written: DayProfileField[] = [];

    for (const key of Object.keys(fields) as DayProfileField[]) {
      const held = sources[key];
      if (held && SOURCE_RANK[held.by] > SOURCE_RANK[source.by]) continue;
      if (fields[key] === undefined) {
        delete merged[key];
        delete sources[key];
      } else {
        (merged as Record<string, unknown>)[key] = fields[key];
        sources[key] = source;
      }
      written.push(key);
    }
    if (!written.length) return written;
    if (!(await this.save(memberId, date, merged, sources))) {
      throw new Error(`Could not save the day profile for ${date}`);
    }
    return written;
  }

  /** Drops stored overrides that came from a calendar event no longer present, so those fields fall back to the routine. */
  async clearFromEvent(memberId: string, date: string, eventId: string): Promise<void> {
    await this.clearWhere(memberId, date, src => src.eventId === eventId);
  }

  /** Drops every field a person set by hand for the day — what "remove this exception" means. Calendar-derived fields stay. */
  async clearManual(memberId: string, date: string): Promise<boolean> {
    return this.clearWhere(memberId, date, src => src.by === 'manual');
  }

  private async clearWhere(memberId: string, date: string, match: (src: FieldSource) => boolean): Promise<boolean> {
    const existing = await this.fetch(memberId, date);
    if (!existing) return true;
    const sources = { ...existing.sources };
    const merged: DayProfileFields = { ...stripMeta(existing) };
    for (const key of Object.keys(sources) as DayProfileField[]) {
      // Facts carry their own provenance and are managed through the special-fact methods below.
      if (key === 'specialFacts') continue;
      if (match(sources[key]!)) {
        delete sources[key];
        delete merged[key];
      }
    }
    return this.save(memberId, date, merged, sources);
  }

  /**
   * Adds facts read from a calendar event to a day. A fact with the same text already there (typed by
   * hand or from another event) isn't added twice. Returns whether anything was added.
   */
  async addSpecialFacts(memberId: string, date: string, texts: string[], by: SpecialFact['by'], eventId?: string): Promise<boolean> {
    return this.changeFacts(memberId, date, facts => {
      const next = [...facts];
      for (const raw of texts) {
        const text = raw.trim();
        if (!text || next.some(f => sameText(f.text, text))) continue;
        next.push({ id: newFactId(), text, by, ...(eventId && { eventId }) });
      }
      return next;
    });
  }

  /** Replaces the hand-typed facts of a day with `texts`; calendar-derived facts are left alone. */
  async setManualFacts(memberId: string, date: string, texts: string[]): Promise<boolean> {
    return this.changeFacts(memberId, date, facts => {
      const kept = facts.filter(f => f.by === 'calendar');
      const manual = facts.filter(f => f.by === 'manual');
      const next = [...kept];
      for (const raw of texts) {
        const text = raw.trim();
        if (!text || next.some(f => sameText(f.text, text))) continue;
        // Keep the id of an unchanged fact so its identity is stable across edits.
        next.push(manual.find(f => sameText(f.text, text)) ?? { id: newFactId(), text, by: 'manual' });
      }
      return next;
    });
  }

  async removeSpecialFact(memberId: string, date: string, factId: string): Promise<boolean> {
    return this.changeFacts(memberId, date, facts => facts.filter(f => f.id !== factId));
  }

  /** Drops the facts a calendar event contributed, once that event moves or goes away. */
  async clearFactsFromEvent(memberId: string, date: string, eventId: string): Promise<boolean> {
    return this.changeFacts(memberId, date, facts => facts.filter(f => f.eventId !== eventId));
  }

  /** Reads the day from the server, lets `change` produce its new fact list, and writes it if it differs. */
  private async changeFacts(memberId: string, date: string, change: (facts: SpecialFact[]) => SpecialFact[]): Promise<boolean> {
    const existing = await this.fetch(memberId, date);
    const before = existing?.specialFacts ?? [];
    const after = change(before);
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    const sources = { ...(existing?.sources ?? {}) };
    const merged: DayProfileFields = { ...stripMeta(existing) };
    if (after.length) {
      merged.specialFacts = after;
      sources.specialFacts = { by: after.some(f => f.by === 'manual') ? 'manual' : 'calendar' };
    } else {
      delete merged.specialFacts;
      delete sources.specialFacts;
    }
    if (!(await this.save(memberId, date, merged, sources))) {
      throw new Error(`Could not save the day profile for ${date}`);
    }
    return true;
  }

  /** Stored profiles of one member, read directly (for callers that can't wait on the subscription). */
  async fetchForMember(memberId: string): Promise<DayProfile[]> {
    const all = await this.firestoreService.getCollection<DayProfile>(COLLECTION);
    return all.filter(p => p.memberId === memberId).sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Whether anything is stored for the day, read straight from the server. */
  async hasStored(memberId: string, date: string): Promise<boolean> {
    return (await this.fetch(memberId, date)) !== null;
  }

  private fetch(memberId: string, date: string): Promise<DayProfile | null> {
    return this.firestoreService.getDocument<DayProfile>(COLLECTION, dayProfileId(memberId, date));
  }

  /** Writes the day, or deletes it once nothing is left to override. */
  private async save(
    memberId: string,
    date: string,
    fields: DayProfileFields,
    sources: DayProfile['sources']
  ): Promise<boolean> {
    const id = dayProfileId(memberId, date);
    if (!Object.keys(sources).length) return this.firestoreService.deleteDocument(COLLECTION, id);
    return this.firestoreService.setDocument<DayProfile>(COLLECTION, id, { ...fields, memberId, date, sources });
  }

  async deleteDay(memberId: string, date: string): Promise<boolean> {
    return this.firestoreService.deleteDocument(COLLECTION, dayProfileId(memberId, date));
  }
}

const sameText = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

function newFactId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function stripMeta(profile: DayProfile | null): DayProfileFields {
  if (!profile) return {};
  const { memberId: _m, date: _d, sources: _s, ...fields } = profile as DayProfile & {
    id?: string; createdAt?: string; updatedAt?: string;
  };
  const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = fields as DayProfileFields & {
    id?: string; createdAt?: string; updatedAt?: string;
  };
  return rest;
}
