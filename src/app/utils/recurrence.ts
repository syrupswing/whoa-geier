import { CalendarEvent, RepeatRule, TaskCompletion } from '../services/google-calendar.service';

/** Amber for tasks everywhere on the calendar: item tints and edges, and the count badges. */
export const TASK_COLOR = '#F2A900';

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

/**
 * The day an item is next on the calendar from `from` on: a repeating item's next occurrence
 * (its first one if the series hasn't started), a one-off item's own first day. Null when a
 * repeating item has no occurrence in the next few years.
 */
export function nextOccurrenceOnOrAfter(event: CalendarEvent, from: Date): Date | null {
  const seriesStart = firstDay(event);
  if (!event.repeat) return seriesStart;
  const day = startOfDay(from);
  for (let i = 0; i <= 366 * 3; i++) {
    const candidate = new Date(day.getFullYear(), day.getMonth(), day.getDate() + i);
    if (occurrenceStartsOn(seriesStart, event.repeat, candidate)) return candidate;
  }
  return null;
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

/** The occurrence of a (single-day) task that falls on `day`, if any. */
function taskOccurrenceOn(task: CalendarEvent, day: Date): CalendarEvent | null {
  const occurrence = expandRecurringForDay([task], day, day)[0];
  return occurrence && toIsoDate(firstDay(occurrence)) === toIsoDate(day) ? occurrence : null;
}

/**
 * How a repeating task treats a missed occurrence. Only all-day tasks can be 'rolling' (keep it
 * until it's done, then repeat one interval after it was completed); everything else follows its
 * fixed schedule and a missed occurrence is dropped.
 */
export function taskRepeatMode(task: CalendarEvent): 'schedule' | 'rolling' {
  if (!task.repeat || task.start.dateTime) return 'schedule';
  return task.repeat.mode ?? 'rolling';
}

/** A day plus one repeat interval (a month-end clamps to the shorter month's last day). */
function addInterval(day: Date, rule: RepeatRule): Date {
  const n = Math.max(1, Math.floor(rule.interval) || 1);
  if (rule.unit === 'month') {
    const target = new Date(day.getFullYear(), day.getMonth() + n, 1);
    const lastOfMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    return new Date(target.getFullYear(), target.getMonth(), Math.min(day.getDate(), lastOfMonth));
  }
  return new Date(day.getFullYear(), day.getMonth(), day.getDate() + (rule.unit === 'week' ? 7 * n : n));
}

/** A rolling task's occurrence dated to `day`. */
function occurrenceOn(task: CalendarEvent, day: Date): CalendarEvent {
  return { ...task, ...shiftDays(task, daysBetween(firstDay(task), day)), occurrenceDate: toIsoDate(day) };
}

/** The day a rolling task is next due: its first day until it's completed, then one interval after the latest completion. */
function rollingDueDay(task: CalendarEvent): Date {
  const completions = Object.values(task.completions ?? {});
  if (!completions.length) return firstDay(task);
  const latest = completions.reduce((a, b) => (new Date(a.at) > new Date(b.at) ? a : b));
  return addInterval(startOfDay(new Date(latest.at)), task.repeat!);
}

/**
 * The checklist for one calendar day. Its tasks are the all-day ones due that day (time-specific
 * ones sit on the timeline), plus:
 * - a task completed that day, shown checked off there even if it was due on another day, so it
 *   can be un-completed from the day it was done (a fixed-schedule repeat stays on its own day);
 * - on today, every unfinished one-off task from earlier days, carried over until it's ticked off;
 * - a rolling repeat has just one open occurrence, due one interval after it was last completed,
 *   and it's carried over once it's overdue. A fixed-schedule repeat isn't carried over.
 */
export function buildTaskChecklist(events: CalendarEvent[], day: Date, now: Date = new Date()): TaskChecklistRow[] {
  const dayStart = startOfDay(day);
  const dayIso = toIsoDate(dayStart);
  const today = startOfDay(now);
  const isToday = dayIso === toIsoDate(today);
  const carried: TaskChecklistRow[] = [];
  const onDay: TaskChecklistRow[] = [];

  for (const task of events) {
    if (task.kind !== 'task') continue;
    const mode = taskRepeatMode(task);
    const timed = !!task.start.dateTime;
    const movable = !task.repeat || mode === 'rolling';

    // Open (or fixed-schedule) rows dated to this day.
    if (!timed) {
      if (mode === 'rolling') {
        const due = rollingDueDay(task);
        const occurrence = occurrenceOn(task, due);
        if (!completionFor(occurrence) && !isSnoozedOccurrence(occurrence, now)) {
          if (toIsoDate(due) === dayIso) onDay.push({ event: occurrence, done: false, daysOverdue: 0 });
          else if (isToday && due < today) carried.push({ event: occurrence, done: false, daysOverdue: daysBetween(due, today) });
        }
      } else {
        const occurrence = taskOccurrenceOn(task, dayStart);
        if (occurrence && !isSnoozedOccurrence(occurrence, now)) {
          const completion = completionFor(occurrence);
          // A one-off completed on another day is listed there instead.
          const movedAway = completion && movable && toIsoDate(startOfDay(new Date(completion.at))) !== dayIso;
          if (!movedAway) onDay.push({ event: occurrence, done: !!completion, daysOverdue: 0 });
        }
      }
    }

    if (!task.repeat) {
      // An unfinished one-off carries over to today until it's ticked off.
      if (isToday && firstDay(task) < today && !completionFor(task) && !isSnoozedOccurrence(task, now)) {
        carried.push({ event: task, done: false, daysOverdue: daysBetween(firstDay(task), today) });
      }
    }

    // Completed on this day but due on another — checked off here.
    if (movable) {
      for (const [key, completion] of Object.entries(task.completions ?? {})) {
        if (toIsoDate(startOfDay(new Date(completion.at))) !== dayIso) continue;
        if (!task.repeat) {
          // A one-off completed on its own day is already listed there (all-day) or on the timeline (timed).
          if (key === dayIso) continue;
          onDay.push({ event: task, done: true, daysOverdue: 0 });
        } else if (mode === 'rolling' && !timed) {
          onDay.push({ event: occurrenceOn(task, parseIso(key)), done: true, daysOverdue: 0 });
        }
      }
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
