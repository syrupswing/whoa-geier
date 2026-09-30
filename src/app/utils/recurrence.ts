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

export function completionFor(event: CalendarEvent): TaskCompletion | null {
  return event.completions?.[occurrenceKey(event)] ?? null;
}
