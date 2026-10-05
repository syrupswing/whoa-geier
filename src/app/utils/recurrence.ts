import { CalendarEvent, RepeatRule, TaskCompletion } from '../services/google-calendar.service';

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseIso(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export function toIsoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole calendar days from a to b (calendar arithmetic, so a DST change doesn't skew it). */
function daysBetween(a: Date, b: Date): number {
  return Math.round((Date.UTC(b.getFullYear(), b.getMonth(), b.getDate()) - Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())) / MS_PER_DAY);
}

/** The local start of an item's first day. */
function firstDay(event: CalendarEvent): Date {
  return event.start.dateTime ? startOfDay(new Date(event.start.dateTime)) : parseIso(event.start.date!);
}

/** The local day an item's last moment falls on (an all-day end date is exclusive, so it's the day before). */
function lastDay(event: CalendarEvent): Date {
  if (event.end.dateTime) return startOfDay(new Date(event.end.dateTime));
  const end = parseIso(event.end.date ?? event.start.date!);
  end.setDate(end.getDate() - 1);
  const start = firstDay(event);
  return end < start ? start : end;
}

/**
 * Whether a series that first starts on `seriesStart` has an occurrence starting on `day`.
 * A weekly repeat keeps the start date's weekday and a monthly one its day of the month
 * (skipping months that lack that day, as Google Calendar does).
 */
export function occurrenceStartsOn(seriesStart: Date, rule: RepeatRule, day: Date): boolean {
  const diff = daysBetween(seriesStart, day);
  if (diff < 0) return false;
  const interval = Math.max(1, Math.floor(rule.interval) || 1);
  switch (rule.unit) {
    case 'day':
      return diff % interval === 0;
    case 'week':
      return diff % (7 * interval) === 0;
    case 'month': {
      const months = (day.getFullYear() - seriesStart.getFullYear()) * 12 + (day.getMonth() - seriesStart.getMonth());
      return months % interval === 0 && day.getDate() === seriesStart.getDate();
    }
  }
}

function shiftDays(event: CalendarEvent, days: number): Pick<CalendarEvent, 'start' | 'end'> {
  const shift = (value: { dateTime?: string; date?: string }) => {
    if (value.dateTime) {
      const d = new Date(value.dateTime);
      d.setDate(d.getDate() + days);   // local setDate keeps the wall-clock time across a DST change
      return { dateTime: d.toISOString() };
    }
    const d = parseIso(value.date!);
    d.setDate(d.getDate() + days);
    return { date: toIsoDate(d) };
  };
  return { start: shift(event.start), end: shift(event.end) };
}

/**
 * Replaces each repeating item with the occurrence (if any) that overlaps the given day, dated to
 * that day so the rest of the calendar code can treat it like any one-off item. Non-repeating
 * items pass through untouched.
 */
export function expandRecurringForDay(events: CalendarEvent[], dayStart: Date, dayEnd: Date): CalendarEvent[] {
  const day = startOfDay(dayStart);
  const out: CalendarEvent[] = [];
  for (const event of events) {
    if (!event.repeat) {
      out.push(event);
      continue;
    }
    const seriesStart = firstDay(event);
    const span = daysBetween(seriesStart, lastDay(event));
    // An occurrence that started up to `span` days ago can still be running today.
    for (let back = 0; back <= span; back++) {
      const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate() - back);
      if (occurrenceStartsOn(seriesStart, event.repeat, candidate)) {
        out.push({ ...event, ...shiftDays(event, daysBetween(seriesStart, candidate)), occurrenceDate: toIsoDate(candidate) });
        break;
      }
    }
  }
  return out;
}

/** The key a task's completion is stored under: the date its occurrence starts on. */
export function occurrenceKey(event: CalendarEvent): string {
  return event.occurrenceDate ?? toIsoDate(firstDay(event));
}

/** When a snoozed task occurrence returns to the calendar, or null if it isn't snoozed. */
export function snoozedUntilFor(event: CalendarEvent): Date | null {
  const iso = event.snoozes?.[occurrenceKey(event)];
  return iso ? new Date(iso) : null;
}

/** Whether this occurrence is snoozed right now (and so hidden from the calendar). */
export function isSnoozedOccurrence(event: CalendarEvent, now: Date = new Date()): boolean {
  const until = snoozedUntilFor(event);
  return !!until && until > now;
}

export function completionFor(event: CalendarEvent): TaskCompletion | null {
  return event.completions?.[occurrenceKey(event)] ?? null;
}

export interface TaskChecklistRow {
  /** The task occurrence (dated to the day it falls on). */
  event: CalendarEvent;
  done: boolean;
  /** Whole days since the occurrence's day, for a task carried over from an earlier day; otherwise 0. */
  daysOverdue: number;
}

/** How far back a repeating task is searched for an unfinished occurrence to carry over. */
const CARRY_LOOKBACK_DAYS = 60;

/** The occurrence of a (single-day) task that falls on `day`, if any. */
function taskOccurrenceOn(task: CalendarEvent, day: Date): CalendarEvent | null {
  const occurrence = expandRecurringForDay([task], day, day)[0];
  return occurrence && toIsoDate(firstDay(occurrence)) === toIsoDate(day) ? occurrence : null;
}

/** The most recent unfinished occurrence of a task before `today`. */
function latestOpenBefore(task: CalendarEvent, today: Date, now: Date): CalendarEvent | null {
  if (!task.repeat) {
    return firstDay(task) < today && !completionFor(task) && !isSnoozedOccurrence(task, now) ? task : null;
  }
  for (let back = 1; back <= CARRY_LOOKBACK_DAYS; back++) {
    const occurrence = taskOccurrenceOn(task, new Date(today.getFullYear(), today.getMonth(), today.getDate() - back));
    if (occurrence && !completionFor(occurrence) && !isSnoozedOccurrence(occurrence, now)) return occurrence;
  }
  return null;
}

/**
 * The checklist for one calendar day: that day's tasks with no specific time (time-specific ones
 * sit on the timeline), plus — on today — every unfinished task from earlier days, carried over
 * until it's ticked off. A repeating task carries over only its most recent unfinished occurrence.
 */
export function buildTaskChecklist(events: CalendarEvent[], day: Date, now: Date = new Date()): TaskChecklistRow[] {
  const dayStart = startOfDay(day);
  const today = startOfDay(now);
  const isToday = toIsoDate(dayStart) === toIsoDate(today);
  const carried: TaskChecklistRow[] = [];
  const onDay: TaskChecklistRow[] = [];

  for (const task of events) {
    if (task.kind !== 'task') continue;
    if (!task.start.dateTime) {
      const occurrence = taskOccurrenceOn(task, dayStart);
      if (occurrence && !isSnoozedOccurrence(occurrence, now)) onDay.push({ event: occurrence, done: !!completionFor(occurrence), daysOverdue: 0 });
    }
    if (isToday) {
      const open = latestOpenBefore(task, today, now);
      if (open) carried.push({ event: open, done: false, daysOverdue: daysBetween(firstDay(open), today) });
    }
  }

  carried.sort((a, b) => b.daysOverdue - a.daysOverdue);
  onDay.sort((a, b) => Number(a.done) - Number(b.done) || a.event.summary.localeCompare(b.event.summary));
  return [...carried, ...onDay];
}

export interface SnoozedTaskRow {
  /** The snoozed occurrence (dated to its own day, so completing or waking it targets the right one). */
  event: CalendarEvent;
  until: Date;
}

/** Every task occurrence that's snoozed right now, soonest to return first — so each can be woken early. */
export function buildSnoozedTasks(events: CalendarEvent[], now: Date = new Date()): SnoozedTaskRow[] {
  const rows: SnoozedTaskRow[] = [];
  for (const task of events) {
    if (task.kind !== 'task' || !task.snoozes) continue;
    for (const [key, iso] of Object.entries(task.snoozes)) {
      const until = new Date(iso);
      if (until > now) rows.push({ event: { ...task, occurrenceDate: key }, until });
    }
  }
  return rows.sort((a, b) => a.until.getTime() - b.until.getTime());
}
