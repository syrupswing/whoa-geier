// Pure helpers for the family-chat context (calendar and alert filtering). Kept free of Firebase so they can be tested.
// Run tests with: node --test functions/chat-context.test.js

/** Titles a calendar gives to an event whose details are hidden from us (a free/busy-only share or import). */
const GENERIC_TITLE = /^(busy|free|tentative|out of office|oof|working elsewhere)$/i;

const isGenericBusy = e => GENERIC_TITLE.test(String(e?.summary || '').trim());

const startMs = e => {
  const s = e?.start?.dateTime || e?.start?.date;
  return s ? new Date(s).getTime() : NaN;
};

/**
 * Cleans the Google calendar events for the chat: "Free" markers say nothing and are dropped; a
 * "Busy"/"Tentative" block is dropped when the asker's own Outlook calendar has a real event starting
 * at the same moment (it's that event, seen through a free/busy import); any other generic block is
 * kept but titled so the answer says details are hidden rather than presenting "Busy" as an activity.
 */
function cleanGoogleEvents(googleEvents, outlookEvents) {
  const outlookStarts = new Set((outlookEvents || []).map(startMs).filter(n => !Number.isNaN(n)));
  const out = [];
  for (const e of googleEvents || []) {
    if (!isGenericBusy(e)) { out.push(e); continue; }
    if (/^free$/i.test(e.summary.trim())) continue;
    if (outlookStarts.has(startMs(e))) continue;
    out.push({ ...e, summary: 'Busy (details hidden)' });
  }
  return out;
}

/** The day ("YYYY-MM-DD") an alert is about, after which it's history: an explicit expiresOn, else a trailing date in its rule key. */
function alertExpiresOn(alert) {
  if (alert?.expiresOn) return alert.expiresOn;
  const m = /:(\d{4}-\d{2}-\d{2})$/.exec(alert?.triggeringRule || '');
  return m ? m[1] : null;
}

/** Whether an alert still applies on `today`. Alerts with no date (an ongoing overdue item) always do. */
function alertIsCurrent(alert, today) {
  const expires = alertExpiresOn(alert);
  return !expires || expires >= today;
}

module.exports = { isGenericBusy, cleanGoogleEvents, alertExpiresOn, alertIsCurrent };
