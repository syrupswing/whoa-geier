import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { AiOrchestratorService } from './ai-orchestrator.service';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import { AppCalendarEventService, nextDayIso } from './app-calendar-event.service';
import { DayProfileFields, DayProfileService } from './day-profile.service';
import { weekday } from './day-resolver.service';
import { CalendarEvent, GoogleCalendarService } from './google-calendar.service';
import { FamilyMember, HouseholdService } from './household.service';
import { LocalStorageService } from './local-storage.service';
import { OutlookCalendarService } from './outlook-calendar.service';

const TIME_ZONE = 'America/Chicago';
const CACHE_KEY = 'day-detection-cache-v1';
const COLLECTION = 'dayDetection';
const WINDOW_DAYS = 14;
/** Wait for the calendar sources to settle (cache, then live sync) before looking. */
const DEBOUNCE_MS = 2500;
const BATCH_SIZE = 30;
/** After a failed AI call, leave the unclassified events alone this long instead of retrying on every calendar change. */
const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;
/** At or above this, an event that names the child is applied without asking. */
const AUTO_APPLY_CONFIDENCE = 0.85;
/** Below this the model is guessing; the event is ignored rather than put in front of a parent. */
const SUGGEST_CONFIDENCE = 0.5;
/** Cheap pre-filter: only events that look school-related are sent to the model at all. */
const SCHOOL_HINT = /drop[\s-]?off|pick[\s-]?up|dismiss|early (release|out)|late start|no school|school|class|teacher|conference|holiday|break\b|snow day/i;
/** Meetings earlier than this aren't taken as the start of a work day. */
const EARLIEST_WORK_START = '05:00';

type Kind = 'dropoff' | 'pickup' | 'noSchool';
const KINDS: readonly string[] = ['dropoff', 'pickup', 'noSchool'];

interface Classified {
  eventId: string;
  memberId: string | null;
  kind: Kind;
  time: string | null;
  confidence: number;
}

/** What was decided about one calendar event, remembered so it isn't classified again until it changes. */
interface CacheEntry {
  sig: string;
  status: 'none' | 'applied' | 'pending' | 'dismissed';
  dates: string[];
  summary: string;
  eventId: string;
  memberId?: string;
  kind?: Kind;
  time?: string | null;
  confidence?: number;
  /** Who classified it. Another person's Outlook events can't be seen from a different login, so only this user may drop one. */
  ownerUid?: string;
}

/** An event the model thinks changes a child's day but that isn't clear enough to apply on its own. */
export interface PendingSuggestion {
  key: string;
  memberId: string;
  memberName: string;
  kind: Kind;
  time: string | null;
  dates: string[];
  summary: string;
}

interface WindowedEvent {
  key: string;
  event: CalendarEvent;
  dates: string[];
  sig: string;
}

/**
 * Looks at the next two weeks of calendar events (Google, Outlook and in-app) whenever they load and
 * keeps the day profiles in step with them:
 *  - a school-related event that clearly concerns a child (it names them, and the model is sure) sets
 *    that day's drop-off, pick-up or no-school without asking;
 *  - a less certain one becomes a pending suggestion to confirm (see `pending`);
 *  - an adult's own work calendar sets their start time when a meeting falls before the usual start.
 * Every value it writes carries the event it came from, so it is removed again if that event moves or goes.
 *
 * What was decided about each event is stored in Firestore (`dayDetection`), shared by the whole family:
 * one device classifies an event, and every other device sees the same applied/pending/dismissed state
 * instead of asking again. Without Firestore it falls back to this device's own storage.
 */
@Injectable({ providedIn: 'root' })
export class DayDetectionService {
  private readonly google = inject(GoogleCalendarService);
  private readonly outlook = inject(OutlookCalendarService);
  private readonly appEvents = inject(AppCalendarEventService);
  private readonly household = inject(HouseholdService);
  private readonly profiles = inject(DayProfileService);
  private readonly ai = inject(AiOrchestratorService);
  private readonly storage = inject(LocalStorageService);
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);

  private readonly cache = signal<Record<string, CacheEntry>>({});
  /** False until the shared decisions have arrived; classifying before then would ask again about events already decided. */
  private loaded = false;
  private timer?: ReturnType<typeof setTimeout>;
  private running = false;
  private rerun = false;
  private retryAt = 0;

  readonly pending = computed<PendingSuggestion[]>(() => {
    const out: PendingSuggestion[] = [];
    for (const [key, e] of Object.entries(this.cache())) {
      if (e.status !== 'pending' || !e.memberId || !e.kind) continue;
      const member = this.household.getMemberById(e.memberId);
      if (!member) continue;
      out.push({ key, memberId: e.memberId, memberName: member.name, kind: e.kind, time: e.time ?? null, dates: e.dates, summary: e.summary });
    }
    return out.sort((a, b) => a.dates[0].localeCompare(b.dates[0]));
  });

  constructor() {
    effect(onCleanup => {
      const uid = this.auth.currentUser()?.uid;
      if (!this.firestore.isInitialized()) {
        this.cache.set(this.storage.getItem(CACHE_KEY) ?? {});
        this.loaded = true;
        return;
      }
      this.loaded = false;
      if (!uid) return;
      const unsubscribe = this.firestore.subscribeToCollection<CacheEntry & { id: string; key: string }>(COLLECTION, items => {
        const next: Record<string, CacheEntry> = {};
        for (const { id: _id, key, ...entry } of items) next[key] = entry;
        this.cache.set(next);
        const first = !this.loaded;
        this.loaded = true;
        if (first) this.schedule();
      });
      onCleanup(() => unsubscribe?.());
    }, { allowSignalWrites: true });

    effect(() => {
      // Re-run whenever the events or the people they're matched against change.
      this.google.events();
      this.outlook.events();
      this.appEvents.events();
      this.household.members();
      untracked(() => this.schedule());
    });
  }

  /** Applies a pending suggestion after a parent confirms it. */
  async accept(key: string): Promise<void> {
    const entry = this.cache()[key];
    if (!entry || entry.status !== 'pending') return;
    await this.apply(entry, 1);
    this.setEntry(key, { ...entry, status: 'applied' });
  }

  dismiss(key: string): void {
    const entry = this.cache()[key];
    if (entry) this.setEntry(key, { ...entry, status: 'dismissed' });
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.run(), DEBOUNCE_MS);
  }

  private async run(): Promise<void> {
    if (!this.loaded) return;
    if (this.running) { this.rerun = true; return; }
    this.running = true;
    try {
      const windowed = this.windowedEvents();
      await this.dropStale(windowed);
      await this.classifyNew(windowed);
      await this.detectAdultStart();
      this.prune();
    } catch (err) {
      console.error('Day detection failed:', err);
    } finally {
      this.running = false;
      if (this.rerun) { this.rerun = false; this.schedule(); }
    }
  }

  // ── Events in the window ───────────────────────────────────────

  private windowedEvents(): WindowedEvent[] {
    const today = dateOf(new Date());
    const last = addDays(today, WINDOW_DAYS);
    const all: CalendarEvent[] = [
      ...this.google.events().map(e => ({ ...e, source: e.source ?? ('google' as const) })),
      ...this.outlook.events().map(e => ({ ...e, source: e.source ?? ('outlook' as const) })),
      ...this.appEvents.events()
    ];
    const out: WindowedEvent[] = [];
    for (const event of all) {
      if (event.kind === 'task' || event.repeat) continue;
      const dates = eventDates(event).filter(d => d >= today && d <= last);
      if (!dates.length) continue;
      const sig = hash([event.summary, event.start.dateTime ?? event.start.date, event.end.dateTime ?? event.end.date,
        event.description ?? '', event.location ?? ''].join('|'));
      out.push({ key: `${event.source}:${event.id}`, event, dates, sig });
    }
    return out;
  }

  /** Whether a source has delivered its events this session, so a missing event really means it's gone. */
  private sourceSettled(source: string): boolean {
    if (source === 'google') return this.google.hasLiveSync();
    if (source === 'outlook') return this.outlook.isSignedIn();
    return this.appEvents.events().length > 0;
  }

  /** Forgets decisions about events that changed or disappeared, taking back what they wrote. */
  private async dropStale(windowed: WindowedEvent[]): Promise<void> {
    const current = new Map(windowed.map(w => [w.key, w.sig]));
    const uid = this.auth.currentUser()?.uid;
    const drop: string[] = [];
    for (const [key, entry] of Object.entries(this.cache())) {
      const sig = current.get(key);
      if (sig === entry.sig) continue;
      const source = key.split(':')[0];
      // Gone, rather than just not loaded yet.
      if (sig === undefined && !this.sourceSettled(source)) continue;
      // Someone else's work calendar isn't visible here, so its absence proves nothing.
      if (sig === undefined && source === 'outlook' && entry.ownerUid && entry.ownerUid !== uid) continue;
      if (entry.status === 'applied' && entry.memberId) {
        for (const date of entry.dates) await this.profiles.clearFromEvent(entry.memberId, date, entry.eventId);
      }
      drop.push(key);
    }
    this.removeEntries(drop);
  }

  // ── Children: model classification ─────────────────────────────

  private async classifyNew(windowed: WindowedEvent[]): Promise<void> {
    const children = this.household.members().filter(m => m.kind === 'child');
    if (!children.length || Date.now() < this.retryAt) return;
    const known = this.cache();
    const candidates = windowed.filter(w => !known[w.key] && looksSchoolRelated(w.event, children));
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      const batch = candidates.slice(i, i + BATCH_SIZE);
      let items: Classified[];
      try {
        const res = await this.ai.generate<{ items?: Classified[] }>('day-profile-classify', {
          children: children.map(c => ({ id: c.id, name: c.name })),
          events: batch.map(w => describe(w))
        });
        items = Array.isArray(res?.items) ? res.items : [];
      } catch (err) {
        console.error('day-profile-classify failed:', err);
        this.retryAt = Date.now() + RETRY_AFTER_FAILURE_MS;
        return;
      }
      for (const w of batch) await this.record(w, items.find(it => it.eventId === w.event.id), children);
    }
  }

  private async record(w: WindowedEvent, item: Classified | undefined, children: FamilyMember[]): Promise<void> {
    const base: CacheEntry = {
      sig: w.sig, status: 'none', dates: w.dates, summary: w.event.summary, eventId: w.event.id,
      ownerUid: this.auth.currentUser()?.uid
    };
    const member = item ? resolveChild(item, children) : undefined;
    const hasTime = !!item?.time && /^\d{2}:\d{2}$/.test(item.time);
    const usable = !!item && !!member && KINDS.includes(item.kind) && (item.kind === 'noSchool' || hasTime);
    if (!usable || !item || !member || item.confidence < SUGGEST_CONFIDENCE) {
      this.setEntry(w.key, base);
      return;
    }
    const entry: CacheEntry = {
      ...base, memberId: member.id, kind: item.kind, time: item.kind === 'noSchool' ? null : item.time, confidence: item.confidence
    };
    if (item.confidence >= AUTO_APPLY_CONFIDENCE && namesChild(w.event, member)) {
      await this.apply(entry, item.confidence);
      this.setEntry(w.key, { ...entry, status: 'applied' });
    } else {
      this.setEntry(w.key, { ...entry, status: 'pending' });
    }
  }

  /** Writes an entry's change into the child's day profiles, skipping days where it wouldn't differ from the routine. */
  private async apply(entry: CacheEntry, confidence: number): Promise<void> {
    const member = entry.memberId ? this.household.getMemberById(entry.memberId) : undefined;
    if (!member || !entry.kind) return;
    const routine = member.routine ?? {};
    for (const date of entry.dates) {
      // Not a school day anyway: a drop-off or "no school" there says nothing about school.
      if (!(routine.schoolDays ?? []).includes(weekday(date))) continue;
      let fields: DayProfileFields;
      if (entry.kind === 'noSchool') {
        fields = { schoolDay: false };
      } else if (entry.kind === 'dropoff') {
        if (entry.time === routine.dropOffTime) continue;
        fields = { dropOffTime: entry.time };
      } else {
        if (entry.time === routine.pickUpTime) continue;
        fields = { pickUpTime: entry.time };
      }
      await this.profiles.applyFields(member.id, date, fields, { by: 'calendar', eventId: entry.eventId, confidence });
    }
  }

  // ── Adults: earliest work meeting ──────────────────────────────

  /**
   * For the signed-in adult, an Outlook meeting earlier than their usual start moves that day's start to
   * it. A later first meeting changes nothing: they still start at the usual time.
   */
  private async detectAdultStart(): Promise<void> {
    const meId = this.household.myMemberId();
    const me = meId ? this.household.getMemberById(meId) : undefined;
    const usual = me?.routine?.workStartTime;
    if (!me || me.kind !== 'adult' || !usual || !this.outlook.events().length) return;

    const earliest = new Map<string, { time: string; id: string }>();
    for (const event of this.outlook.events()) {
      const start = event.start.dateTime;
      if (!start || event.isPointInTime || event.kind === 'task') continue;
      const date = dateOf(new Date(start));
      const time = timeOf(new Date(start));
      if (time < EARLIEST_WORK_START || time >= usual) continue;
      const best = earliest.get(date);
      if (!best || time < best.time) earliest.set(date, { time, id: event.id });
    }

    const today = dateOf(new Date());
    for (let i = 0; i <= WINDOW_DAYS; i++) {
      const date = addDays(today, i);
      if (!(me.routine?.workDays ?? []).includes(weekday(date))) continue;
      const found = earliest.get(date);
      const stored = this.profiles.getStored(me.id, date);
      if (found) {
        if (stored?.startTime === found.time && stored.sources.startTime?.eventId === found.id) continue;
        await this.profiles.applyFields(me.id, date, { startTime: found.time }, { by: 'calendar', eventId: found.id, confidence: 1 });
      } else if (stored?.sources.startTime?.by === 'calendar' && stored.sources.startTime.eventId) {
        await this.profiles.clearFromEvent(me.id, date, stored.sources.startTime.eventId);
      }
    }
  }

  // ── Cache ──────────────────────────────────────────────────────

  private setEntry(key: string, entry: CacheEntry): void {
    // Optimistic: the snapshot listener would otherwise leave the old state showing until the write round-trips.
    this.cache.update(c => ({ ...c, [key]: entry }));
    if (this.firestore.isInitialized()) {
      void this.firestore.setDocument(COLLECTION, docId(key), { ...entry, key });
    } else {
      this.storage.setItem(CACHE_KEY, this.cache());
    }
  }

  private removeEntries(keys: string[]): void {
    if (!keys.length) return;
    this.cache.update(c => Object.fromEntries(Object.entries(c).filter(([k]) => !keys.includes(k))));
    if (this.firestore.isInitialized()) {
      keys.forEach(key => void this.firestore.deleteDocument(COLLECTION, docId(key)));
    } else {
      this.storage.setItem(CACHE_KEY, this.cache());
    }
  }

  /** Drops entries for events that are entirely in the past. */
  private prune(): void {
    const today = dateOf(new Date());
    this.removeEntries(Object.entries(this.cache()).filter(([, e]) => !e.dates.some(d => d >= today)).map(([k]) => k));
  }
}

// ── Helpers ──────────────────────────────────────────────────────

/** Event ids can hold characters (a "/" in an Outlook id) that a Firestore document id can't. */
function docId(key: string): string {
  return encodeURIComponent(key);
}

function dateOf(d: Date): string {
  return d.toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
}

function timeOf(d: Date): string {
  return d.toLocaleTimeString('en-GB', { timeZone: TIME_ZONE, hour: '2-digit', minute: '2-digit', hour12: false });
}

function addDays(date: string, n: number): string {
  let d = date;
  for (let i = 0; i < n; i++) d = nextDayIso(d);
  return d;
}

/** Every calendar date an event covers (all-day end dates are exclusive); a timed event counts for the day it starts. */
function eventDates(event: CalendarEvent): string[] {
  if (event.start.date && !event.start.dateTime) {
    const end = event.end.date && event.end.date > event.start.date ? event.end.date : nextDayIso(event.start.date);
    const dates: string[] = [];
    for (let d = event.start.date; d < end && dates.length < 60; d = nextDayIso(d)) dates.push(d);
    return dates;
  }
  return event.start.dateTime ? [dateOf(new Date(event.start.dateTime))] : [];
}

function describe(w: WindowedEvent) {
  const { event } = w;
  const allDay = !event.start.dateTime;
  return {
    id: event.id,
    summary: event.summary,
    description: event.description,
    location: event.location,
    date: w.dates[0],
    allDay,
    startTime: allDay ? null : timeOf(new Date(event.start.dateTime!)),
    endTime: allDay || !event.end.dateTime ? null : timeOf(new Date(event.end.dateTime))
  };
}

function eventText(event: CalendarEvent): string {
  return [event.summary, event.description, event.location].filter(Boolean).join(' ');
}

function namesChild(event: CalendarEvent, child: FamilyMember): boolean {
  if (event.memberId === child.id) return true;
  return new RegExp(`\\b${escapeRegExp(child.name.trim())}\\b`, 'i').test(eventText(event));
}

function looksSchoolRelated(event: CalendarEvent, children: FamilyMember[]): boolean {
  return SCHOOL_HINT.test(eventText(event)) || children.some(c => namesChild(event, c));
}

/** The child an entry is about: the one the model named, or the only child there is. */
function resolveChild(item: Classified, children: FamilyMember[]): FamilyMember | undefined {
  return children.find(c => c.id === item.memberId) ?? (children.length === 1 ? children[0] : undefined);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Small stable string hash, so the cache stores a few characters per event rather than its whole text. */
function hash(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h.toString(36);
}
