export interface SnoozeOption {
  label: string;
  /** When the snooze ends and the item comes back. */
  until: Date;
}

/** The snooze choices offered on a task — the same set the to-do list has. */
export function getSnoozeOptions(now: Date = new Date()): SnoozeOption[] {
  const inHours = (hours: number) => new Date(now.getTime() + hours * 3600000);

  const tonight = new Date(now);
  tonight.setHours(21, 0, 0, 0);
  if (tonight <= now) tonight.setDate(tonight.getDate() + 1);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);

  return [
    { label: '1 hour', until: inHours(1) },
    { label: '3 hours', until: inHours(3) },
    { label: 'Tonight', until: tonight },
    { label: 'Tomorrow', until: tomorrow },
    { label: '3 days', until: inHours(72) },
    { label: '1 week', until: inHours(168) }
  ];
}

/** "Tue, Oct 6 at 8:00 AM" — for telling someone when a snoozed item returns. */
export function formatSnoozeEnd(until: Date): string {
  const day = until.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  const time = until.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${day} at ${time}`;
}
