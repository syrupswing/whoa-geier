// Pure helpers for the family-chat context (calendar and alert filtering). Kept free of Firebase so they can be tested.
// Run tests with: node --test functions/chat-context.test.js

/** Titles a calendar gives to an event whose details are hidden from us (a free/busy-only share or import). */
const GENERIC_TITLE = /^(busy|free|tentative|out of office|oof|working elsewhere)$/i;

const isGenericBusy = e => GENERIC_TITLE.test(String(e?.summary || '').trim());

/**
 * Cleans the Google calendar events for the chat. Generic free/busy blocks (a work calendar imported
 * with its details hidden) are unreliable: they can outlive the real event they came from, and say nothing
 * about whose they are or what happens. So when the asker's own Outlook data is fresh (`outlookFresh`),
 * it is the source of truth and every such block is dropped. Without it they're kept, titled so the
 * answer treats them as availability only; "Free" markers are always dropped.
 */
function cleanGoogleEvents(googleEvents, outlookFresh) {
  const out = [];
  for (const e of googleEvents || []) {
    if (!isGenericBusy(e)) { out.push(e); continue; }
    if (outlookFresh || /^free$/i.test(e.summary.trim())) continue;
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
