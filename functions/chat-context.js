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

/**
 * One compact line per family-notebook entry (providers, places, warranties, how-tos, notes) for the chat
 * prompt. Facts are left out: they are already included in full in every conversation. At family scale the
 * whole notebook fits in the prompt, so the model picks what's relevant instead of the server searching;
 * entries beyond `limit` (newest kept) and long bodies are cut so one big note can't crowd out the rest.
 */
function summarizeNotebookForChat(notes, { limit = 150, bodyMax = 240, memberNames = new Map() } = {}) {
  return (notes || [])
    .filter(n => n && n.kind !== 'fact' && (n.title || n.body))
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, limit)
    .map(n => {
      const parts = [`${n.kind || 'note'}: ${n.title || String(n.body).slice(0, 60)}`];
      if (n.category) parts.push(`category ${n.category}`);
      if (n.memberId && memberNames.get(n.memberId)) parts.push(`for ${memberNames.get(n.memberId)}`);
      for (const [key, value] of Object.entries(n.data || {})) if (value) parts.push(`${key} ${value}`);
      if (n.tags && n.tags.length) parts.push(`tags ${n.tags.join('/')}`);
      if (n.body) {
        const body = String(n.body).replace(/\s+/g, ' ').trim();
        parts.push(`notes: ${body.length > bodyMax ? body.slice(0, bodyMax) + '…' : body}`);
      }
      return parts.join(', ');
    });
}

module.exports = { isGenericBusy, cleanGoogleEvents, alertExpiresOn, alertIsCurrent, summarizeNotebookForChat };
