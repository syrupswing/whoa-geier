// Pure parser for the district's monthly On-Site lunch PDF text (kept free of Firebase so it can be tested).
// Run tests with: node --test functions/lunch-menu.test.js
//
// The PDF is a Monday-Friday calendar. Its extracted text lists each day's number followed by that day's
// items (entrees, the alternate, "Served with" sides), sometimes with the number on its own line and
// sometimes glued to the first word ("14Chicken/"). Day numbers are only trusted when they match the next
// weekdays in the calendar's sequence, so a stray number inside a dish name can't start a new day, and
// anything that doesn't fit is skipped rather than guessed: a missing lunch beats the wrong day's lunch.

const MONTH_PREFIXES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Lines at which the page footer begins; nothing from there on belongs to a day. */
const FOOTER_START = /^(ON-SITE\b|ENHANCE YOUR MEAL|For nutrition facts|WE DO NOT SERVE)/i;

/** A day's text this long means the footer wasn't cut off, so it can't be trusted. */
const MAX_DAY_CHARS = 300;
/** Fewer days than this means the text isn't the calendar we expect. */
const MIN_DAYS = 5;
/** How many weekdays ahead a day number may jump (a calendar cell with no number extracted). */
const MAX_SKIP_WEEKDAYS = 4;

/** The { year, month (1-12) } a menu covers, from the PDF's file name ("Menu_Lunch_Sept2026_OS.pdf"), else its text. */
function menuMonthFromSource(pdfUrl, text) {
  const fileName = String(pdfUrl || '').split('?')[0].split('/').pop() || '';
  const fromName = /(?<![a-z])(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*[_\s-]?(20\d{2})/i.exec(fileName);
  if (fromName) return { year: Number(fromName[2]), month: MONTH_PREFIXES.indexOf(fromName[1].toLowerCase()) + 1 };
  const name = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+Lunch/i.exec(text || '');
  const year = /ON-SITE\s+(20\d{2})/i.exec(text || '');
  if (name && year) return { year: Number(year[1]), month: MONTH_PREFIXES.indexOf(name[1].slice(0, 3).toLowerCase()) + 1 };
  return null;
}

const toIso = d => d.toISOString().slice(0, 10);
const isWeekday = d => d.getUTCDay() >= 1 && d.getUTCDay() <= 5;

/** The next `count` Monday-Friday dates after `date`. */
function nextWeekdays(date, count) {
  const out = [];
  const d = new Date(date);
  while (out.length < count) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (isWeekday(d)) out.push(new Date(d));
  }
  return out;
}

/**
 * Splits the PDF text into per-day lunches.
 * Returns { entries: [{ date, lunch }], skipped: [{ date, reason }], warnings: [string] }; entries is empty when
 * the text doesn't look like the expected calendar.
 */
function parseLunchMenuText(text, { year, month }) {
  const empty = reason => ({ entries: [], skipped: [], warnings: [reason] });
  let lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const footerAt = lines.findIndex(l => FOOTER_START.test(l));
  if (footerAt >= 0) lines = lines.slice(0, footerAt);

  const dayStart = l => {
    const m = /^(\d{1,2})(?!\d)\s*(.*)$/.exec(l);
    if (!m || /^[%/.]/.test(m[2])) return null;
    const day = Number(m[1]);
    return day >= 1 && day <= 31 ? { day, rest: m[2] } : null;
  };

  // The calendar's first number anchors the sequence. One late in a month is a leading day of the previous month.
  const first = lines.map(dayStart).find(Boolean);
  if (!first) return empty('no day numbers found');
  const firstDate = new Date(Date.UTC(year, month - 1 - (first.day > 20 ? 1 : 0), first.day));
  if (firstDate.getUTCDate() !== first.day || !isWeekday(firstDate)) return empty(`first day number ${first.day} is not a weekday`);

  const warnings = [];
  const blocks = [];
  let cursor = null; // date of the last block started
  for (const line of lines) {
    const start = dayStart(line);
    let date = null;
    if (start) {
      if (!cursor) {
        if (start.day === first.day) date = firstDate;
      } else {
        const ahead = nextWeekdays(cursor, MAX_SKIP_WEEKDAYS + 1);
        const at = ahead.findIndex(d => d.getUTCDate() === start.day);
        if (at >= 0) {
          date = ahead[at];
          if (at > 0) warnings.push(`no day number found for ${ahead.slice(0, at).map(toIso).join(', ')}`);
        }
      }
    }
    if (date) {
      cursor = date;
      blocks.push({ date: toIso(date), parts: start.rest ? [start.rest] : [] });
    } else if (blocks.length) {
      blocks[blocks.length - 1].parts.push(line);
    }
  }

  const entries = [];
  const skipped = [];
  for (const b of blocks) {
    const lunch = b.parts.join(' ').replace(/\s+/g, ' ').trim();
    if (!lunch) skipped.push({ date: b.date, reason: 'empty' });
    else if (/^no school\b/i.test(lunch)) skipped.push({ date: b.date, reason: 'no school' });
    else if (lunch.length > MAX_DAY_CHARS) skipped.push({ date: b.date, reason: 'text too long to trust' });
    else entries.push({ date: b.date, lunch });
  }
  if (entries.length < MIN_DAYS) return { entries: [], skipped, warnings: [...warnings, `only ${entries.length} day(s) parsed`] };
  return { entries, skipped, warnings };
}

module.exports = { menuMonthFromSource, parseLunchMenuText };
