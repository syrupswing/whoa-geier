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

/**
 * How a person's next day starts, worded for the chat. A stored day profile (a drop-off or work time found
 * from the calendar or set by hand) wins over the regular routine, and when it differs the routine time is
 * named as replaced, so the answer doesn't offer both. Without a profile it's the routine, said as "usually".
 */
function tomorrowStartPhrase(member, stored, weekday, formatTime) {
  const r = member.routine || {};
  const s = stored || {};
  const pick = (key, fallback) => (s[key] !== undefined ? s[key] : fallback);
  const timeText = (time, usual) => {
    if (!time) return '';
    if (s.dropOffTime !== undefined || s.startTime !== undefined) {
      return usual && usual !== time ? `${formatTime(time)} instead of the usual ${formatTime(usual)}` : formatTime(time);
    }
    return `${formatTime(time)} (usually)`;
  };
  if (member.kind === 'child') {
    const schoolDay = pick('schoolDay', (r.schoolDays || [1, 2, 3, 4, 5]).includes(weekday));
    if (!schoolDay) return s.schoolDay === false ? ', no school tomorrow' : '';
    const drop = pick('dropOffTime', r.dropOffTime);
    return drop ? `, tomorrow's school drop-off is ${timeText(drop, r.dropOffTime)}` : '';
  }
  const workDay = pick('workDay', (r.workDays || []).includes(weekday));
  if (!workDay) return s.workDay === false ? ', not working tomorrow' : '';
  const start = pick('startTime', r.workStartTime);
  return start ? `, tomorrow work starts at ${timeText(start, r.workStartTime)}` : '';
}

/**
 * Turns the "[Doc 2]" markers the model puts after facts from reference documents into links to those
 * documents in the library (Settings, Family memory), where the doc is highlighted and can be opened.
 * `docs` is the numbered list given to the model, in order. Numbers it invented are dropped, not linked.
 */
function linkDocCitations(text, docs) {
  const label = title => {
    const clean = String(title || 'Document').replace(/[\[\]]/g, '').trim();
    return clean.length > 40 ? `${clean.slice(0, 39)}…` : clean;
  };
  return String(text || '').replace(/\[\s*docs?\s*(\d+(?:\s*(?:,|&|and)\s*(?:docs?\s*)?\d+)*)\s*\]/gi, (_, list) =>
    [...new Set(list.match(/\d+/g))]
      .map(n => (docs || [])[Number(n) - 1])
      .filter(d => d && d.id)
      .map(d => `[${label(d.title)}](#/settings?section=family-memory&highlight=${encodeURIComponent(d.id)})`)
      .join(' ')
  );
}

/** "YYYY-MM-DD" strings for `today` and the following days (calendar arithmetic, so no time-zone drift). */
function upcomingDateStrs(today, days) {
  const [y, m, d] = today.split('-').map(Number);
  return Array.from({ length: days }, (_, i) => new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10));
}

const weekdayShort = dateStr => new Date(`${dateStr}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });

/** A weekday-to-date reference for the next `days` days, so "this Friday" or "next Monday" resolves to one exact date. */
function upcomingDatesLine(today, days = 14) {
  return upcomingDateStrs(today, days)
    .map((d, i) => `${weekdayShort(d)} ${d}${i === 0 ? ' (today)' : i === 1 ? ' (tomorrow)' : ''}`)
    .join(', ');
}

/** Lunch-menu entries ({ date, lunch }) as "Fri 2026-11-06: pizza" strings, in date order, skipping blanks. */
function summarizeLunchMenuForChat(entries) {
  return (entries || [])
    .filter(e => e?.date && e.lunch)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => `${weekdayShort(e.date)} ${e.date}: ${e.lunch}`);
}

// Mirrors the Food page (src/app/services/restaurant.service.ts), so the chat and the page agree.
const DIRECT_ORDER = 'Restaurant website';
const PHONE_ORDER = 'Call in';
const APP_SEARCH = {
  'DoorDash': q => `https://www.doordash.com/search/store/${encodeURIComponent(q)}/`,
  'Uber Eats': q => `https://www.ubereats.com/search?q=${encodeURIComponent(q)}`,
  'Grubhub': q => `https://www.grubhub.com/search?queryText=${encodeURIComponent(q)}`
};
const SAFE_LINK = /^(https?:|tel:)/i;

const offersDelivery = r => r.delivery ?? ((r.deliveryApps || []).length > 0 || (r.orderLinks || []).length > 0);
const offersTakeout = r => r.takeout ?? false;

/** The restaurants the chat is told about: named ones, A to Z, capped. Both the prompt lines and the order links index into this. */
function restaurantsForChat(restaurants, limit = 80) {
  return (restaurants || [])
    .filter(r => r && String(r.name || '').trim())
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
    .slice(0, limit);
}

/**
 * The one-click way to order from a restaurant, as { label, url }, or null when it isn't one to order from
 * (dine-in only) or has no usable way: a saved link for its best app, else that app's search page, else its
 * website or phone when that is the best way. Only http(s) and tel: links are ever produced.
 */
function restaurantOrderLink(r) {
  const app = String(r?.bestApp || '').trim();
  if (!app || !(offersDelivery(r) || offersTakeout(r))) return null;
  const site = String(r.website || '').trim();
  const siteUrl = site ? (/^https?:\/\//i.test(site) ? site : `https://${site}`) : null;
  const phone = String(r.phone || '').trim();
  let label, url;
  if (app === PHONE_ORDER) {
    label = 'Call to order'; url = phone ? `tel:${phone.replace(/[^\d+]/g, '')}` : null;
  } else if (app === DIRECT_ORDER) {
    label = 'Order on their website'; url = siteUrl;
  } else {
    label = `Order on ${app}`;
    const lower = app.toLowerCase();
    const saved = (r.orderLinks || []).find(l => l && l.url && SAFE_LINK.test(String(l.url).trim()) &&
      (String(l.text || '').toLowerCase().includes(lower) || String(l.url).toLowerCase().includes(lower.replace(/\s+/g, ''))));
    url = saved ? String(saved.url).trim() : (APP_SEARCH[app] ? APP_SEARCH[app](String(r.name).trim()) : null);
  }
  return url && SAFE_LINK.test(url) ? { label, url } : null;
}

/**
 * One compact line per saved restaurant for the chat prompt: the ways the family eats from it (dine in, delivery,
 * takeout), the best way to order and why, other apps it's on, a phone number, and the notes they wrote down.
 * A restaurant with a one-click order link starts with its marker, like "[Order 3]", which the model repeats after
 * suggesting it and linkOrderCitations turns into the link. Dine in unless switched off, delivery when marked or
 * when it has apps or order links, takeout only when marked.
 */
function summarizeRestaurantsForChat(restaurants, { limit = 80, notesMax = 200 } = {}) {
  return restaurantsForChat(restaurants, limit).map((r, i) => {
    const ways = [];
    if (r.dineOut ?? true) ways.push('dine in');
    if (offersDelivery(r)) ways.push('delivery');
    if (offersTakeout(r)) ways.push('takeout');
    const parts = [String(r.name).trim() + (r.cuisine ? ` (${String(r.cuisine).trim()})` : '')];
    parts.push(ways.length ? `good for ${ways.join(', ')}` : 'no way of eating marked');
    if (r.bestApp && (ways.includes('delivery') || ways.includes('takeout'))) {
      parts.push(`best way to order: ${r.bestApp}${r.bestAppNote ? ` (${String(r.bestAppNote).trim()})` : ''}`);
    }
    const others = (r.deliveryApps || []).filter(a => a !== r.bestApp);
    if (others.length) parts.push(`also on ${others.join(', ')}`);
    if (r.phone) parts.push(`phone ${r.phone}`);
    if (r.notes) {
      const notes = String(r.notes).replace(/\s+/g, ' ').trim();
      if (notes) parts.push(`notes: ${notes.length > notesMax ? notes.slice(0, notesMax) + '…' : notes}`);
    }
    return `${restaurantOrderLink(r) ? `[Order ${i + 1}] ` : ''}${parts.join(', ')}`;
  });
}

/** Order links lined up with summarizeRestaurantsForChat's lines: entry i is for "[Order i+1]" (null when it has none). */
function restaurantOrderLinks(restaurants, { limit = 80 } = {}) {
  return restaurantsForChat(restaurants, limit).map(restaurantOrderLink);
}

/**
 * Turns the "[Order 2]" markers the model puts after a suggested restaurant into markdown links to order from it.
 * `links` is restaurantOrderLinks' list. A marker for a number that has no link (invented, or dine-in only) is dropped.
 */
function linkOrderCitations(text, links) {
  return String(text || '')
    .replace(/[ \t]*\[\s*order\s*(\d+)\s*\]/gi, (_, n) => {
      const link = (links || [])[Number(n) - 1];
      return link ? ` [${link.label}](${link.url})` : '';
    });
}

module.exports = { summarizeRestaurantsForChat, restaurantOrderLinks, restaurantOrderLink, linkOrderCitations, upcomingDateStrs, upcomingDatesLine, summarizeLunchMenuForChat, linkDocCitations, tomorrowStartPhrase, isGenericBusy, cleanGoogleEvents, alertExpiresOn, alertIsCurrent, summarizeNotebookForChat };
