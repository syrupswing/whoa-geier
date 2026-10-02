import { CalendarEvent } from '../services/google-calendar.service';

/**
 * Where to edit a synced (Google or Outlook) event at its source, or null for an app-native item
 * (those are edited in the app) or an event with no link to build one from.
 */
export function externalEditUrl(event: CalendarEvent): string | null {
  if (event.source === 'app' || !event.htmlLink) return null;
  // Outlook's own link opens the item in Outlook on the web, where it can be edited.
  if (event.source === 'outlook') return event.htmlLink;
  // Google's htmlLink carries an `eid` that identifies this exact event (or recurring instance);
  // the same id opens its edit form directly instead of the read-only view.
  try {
    const eid = new URL(event.htmlLink).searchParams.get('eid');
    if (eid) return `https://calendar.google.com/calendar/r/eventedit/${eid}`;
  } catch {
    // Not a parseable URL — fall back to the link as given.
  }
  return event.htmlLink;
}

export function externalEditLabel(event: CalendarEvent): string {
  return event.source === 'outlook' ? 'Edit in Outlook' : 'Edit in Google Calendar';
}
