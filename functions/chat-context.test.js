const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanGoogleEvents, alertExpiresOn, alertIsCurrent, summarizeNotebookForChat, tomorrowStartPhrase, linkDocCitations, upcomingDatesLine, summarizeLunchMenuForChat, summarizeRestaurantsForChat, restaurantOrderLinks, linkOrderCitations } = require('./chat-context');

const g = (summary, dateTime) => ({ summary, start: { dateTime }, end: { dateTime } });

test('with fresh Outlook data every generic block is dropped', () => {
  const out = cleanGoogleEvents([
    g('Busy', '2026-10-21T19:30:00Z'),
    { summary: 'Free', start: { date: '2026-10-21' } },
    g('Remi swimmy', '2026-10-21T22:45:00Z')
  ], true);
  assert.deepEqual(out.map(e => e.summary), ['Remi swimmy']);
});

test('without Outlook data Busy is kept and relabeled, Free is dropped', () => {
  const out = cleanGoogleEvents([
    g('Busy', '2026-10-22T18:30:00Z'),
    { summary: 'Free', start: { date: '2026-10-21' } },
    g('Remi swimmy', '2026-10-21T22:45:00Z')
  ], false);
  assert.deepEqual(out.map(e => e.summary), ['Busy (details hidden)', 'Remi swimmy']);
});

test('alerts expire after the day in their rule key; ongoing ones never do', () => {
  const trip = { triggeringRule: 'field-trip-lunch:2026-09-25' };
  assert.equal(alertExpiresOn(trip), '2026-09-25');
  assert.equal(alertIsCurrent(trip, '2026-09-25'), true);
  assert.equal(alertIsCurrent(trip, '2026-10-21'), false);
  assert.equal(alertIsCurrent({ triggeringRule: 'vehicle-maintenance:1766548534467' }, '2026-10-21'), true);
  assert.equal(alertIsCurrent({ triggeringRule: 'x', expiresOn: '2026-10-01' }, '2026-10-21'), false);
});

test('notebook summary skips facts, lists details, and trims long bodies', () => {
  const lines = summarizeNotebookForChat([
    { kind: 'fact', title: 'x', body: 'Remi is allergic to shellfish' },
    { kind: 'provider', title: 'Dave Plumbing', category: 'house', data: { phone: '555-1234', status: 'used' }, tags: ['plumbing'], createdAt: '2026-10-02' },
    { kind: 'howto', title: 'Reset the router', body: 'a'.repeat(500), createdAt: '2026-10-01' }
  ], { bodyMax: 20 });
  assert.equal(lines.length, 2);
  assert.equal(lines[0], 'provider: Dave Plumbing, category house, phone 555-1234, status used, tags plumbing');
  assert.match(lines[1], /^howto: Reset the router, notes: a{20}…$/);
});

test('notebook summary keeps only the newest entries past the limit', () => {
  const notes = [1, 2, 3].map(i => ({ kind: 'note', title: `n${i}`, createdAt: `2026-10-0${i}` }));
  assert.deepEqual(summarizeNotebookForChat(notes, { limit: 2 }), ['note: n3', 'note: n2']);
});

test('tomorrow start: a stored drop-off replaces the routine time and names it', () => {
  const remi = { kind: 'child', routine: { dropOffTime: '09:00', schoolDays: [1, 2, 3, 4, 5] } };
  const fmt = t => t;
  assert.equal(tomorrowStartPhrase(remi, { dropOffTime: '08:15' }, 1, fmt), ", tomorrow's school drop-off is 08:15 instead of the usual 09:00");
  assert.equal(tomorrowStartPhrase(remi, { dropOffTime: '09:00' }, 1, fmt), ", tomorrow's school drop-off is 09:00");
  assert.equal(tomorrowStartPhrase(remi, {}, 1, fmt), ", tomorrow's school drop-off is 09:00 (usually)");
  assert.equal(tomorrowStartPhrase(remi, { schoolDay: false }, 1, fmt), ', no school tomorrow');
  assert.equal(tomorrowStartPhrase(remi, {}, 6, fmt), '');
});

test('tomorrow start: adults use work start, and a profile can say they are off', () => {
  const kelly = { kind: 'adult', routine: { workDays: [1, 2, 3, 4, 5], workStartTime: '08:00' } };
  const fmt = t => t;
  assert.equal(tomorrowStartPhrase(kelly, {}, 2, fmt), ', tomorrow work starts at 08:00 (usually)');
  assert.equal(tomorrowStartPhrase(kelly, { startTime: '10:00' }, 2, fmt), ', tomorrow work starts at 10:00 instead of the usual 08:00');
  assert.equal(tomorrowStartPhrase(kelly, { workDay: false }, 2, fmt), ', not working tomorrow');
});

test('doc citations become links to the library, and invented numbers are dropped', () => {
  const docs = [{ id: 'abc123', title: 'Swim lesson flyer' }, { id: 'zzz', title: 'A very long document title that keeps going and going' }];
  const link = id => `(#/settings?section=family-memory&highlight=${id})`;
  assert.equal(linkDocCitations('Starts at 9:30 [Doc 1].', docs), `Starts at 9:30 [Swim lesson flyer]${link('abc123')}.`);
  assert.equal(linkDocCitations('Both say so [Doc 1, Doc 2]', docs).includes(link('zzz')), true);
  assert.equal(linkDocCitations('From the flyer [doc 2]', docs).includes('…]'), true);
  assert.equal(linkDocCitations('Made up [Doc 9].', docs), 'Made up .');
  assert.equal(linkDocCitations('No markers here [1] or (Doc 1)', docs), 'No markers here [1] or (Doc 1)');
  assert.equal(linkDocCitations('Title [with] brackets [Doc 1]', [{ id: 'q', title: 'A [b] c' }]).includes('[A b c]'), true);
});

test('upcoming dates line resolves this Friday from a Sunday, across a month end', () => {
  const line = upcomingDatesLine('2026-11-01', 14);
  assert.match(line, /^Sun 2026-11-01 \(today\), Mon 2026-11-02 \(tomorrow\), Tue 2026-11-03/);
  assert.match(line, /Fri 2026-11-06,/);
  assert.match(line, /Fri 2026-11-13/);
  assert.match(upcomingDatesLine('2026-10-30', 4), /Sat 2026-10-31 \(tomorrow\), Sun 2026-11-01, Mon 2026-11-02$/);
});

test('lunch menu entries are sorted, labeled with the weekday, and blanks dropped', () => {
  assert.deepEqual(summarizeLunchMenuForChat([
    { date: '2026-11-06', lunch: 'Pizza' },
    { date: '2026-11-04', lunch: 'Tacos' },
    { date: '2026-11-05', lunch: '' }
  ]), ['Wed 2026-11-04: Tacos', 'Fri 2026-11-06: Pizza']);
});

test('restaurants are summarized with their ways of eating, best app and notes', () => {
  const lines = summarizeRestaurantsForChat([
    { name: 'Zed Thai', cuisine: 'Thai', dineOut: false, delivery: true, takeout: true, bestApp: 'DoorDash', bestAppNote: 'no fee with DashPass',
      deliveryApps: ['DoorDash', 'Uber Eats'], phone: '555-0100', notes: 'Peanut-free\n  kitchen on request' },
    { name: 'Alpha Pizza', cuisine: '', orderLinks: [{ text: 'Menu', url: 'x' }] }
  ]);
  assert.deepEqual(lines, [
    'Alpha Pizza, good for dine in, delivery',
    '[Order 2] Zed Thai (Thai), good for delivery, takeout, best way to order: DoorDash (no fee with DashPass), also on Uber Eats, phone 555-0100, notes: Peanut-free kitchen on request'
  ]);
});

test('restaurants: the best app is left out when it is dine-in only, blank names are skipped, and long notes are cut', () => {
  const lines = summarizeRestaurantsForChat([
    { name: 'Diner', bestApp: 'Grubhub' },
    { name: '  ' },
    { name: 'Long', notes: 'x'.repeat(300) }
  ], { notesMax: 10 });
  assert.equal(lines[0], 'Diner, good for dine in');
  assert.equal(lines[1], 'Long, good for dine in, notes: xxxxxxxxxx…');
  assert.equal(lines.length, 2);
});

test('order links: a saved link wins, then the app search page, then website or phone; dine-in only has none', () => {
  const links = restaurantOrderLinks([
    { name: 'A Saved', bestApp: 'DoorDash', delivery: true, orderLinks: [{ text: 'DoorDash menu', url: 'https://doordash.com/store/a-1' }] },
    { name: 'B Search', bestApp: 'Uber Eats', delivery: true },
    { name: 'C Site', bestApp: 'Restaurant website', takeout: true, website: 'c.example.com' },
    { name: 'D Phone', bestApp: 'Call in', takeout: true, phone: '(555) 010-0100' },
    { name: 'E Dine', bestApp: 'Grubhub' },
    { name: 'F Custom', bestApp: 'Slice', delivery: true },
    { name: 'G Unsafe', bestApp: 'Slice', delivery: true, orderLinks: [{ text: 'Slice', url: 'javascript:alert(1)' }] }
  ]);
  assert.deepEqual(links[0], { label: 'Order on DoorDash', url: 'https://doordash.com/store/a-1' });
  assert.deepEqual(links[1], { label: 'Order on Uber Eats', url: 'https://www.ubereats.com/search?q=B%20Search' });
  assert.deepEqual(links[2], { label: 'Order on their website', url: 'https://c.example.com' });
  assert.deepEqual(links[3], { label: 'Call to order', url: 'tel:5550100100' });
  assert.equal(links[4], null);
  assert.equal(links[5], null);
  assert.equal(links[6], null);
});

test('order markers become links; unknown or link-less markers are dropped', () => {
  const links = [{ label: 'Order on DoorDash', url: 'https://x.test/a' }, null];
  assert.equal(
    linkOrderCitations('Try **Zed Thai** [Order 1]. Or Diner [Order 2] or Ghost [order 9].', links),
    'Try **Zed Thai** [Order on DoorDash](https://x.test/a). Or Diner or Ghost.'
  );
});

test('the order marker is only on lines that have a link, numbered by position', () => {
  const lines = summarizeRestaurantsForChat([
    { name: 'Beta', bestApp: 'DoorDash', delivery: true },
    { name: 'Alpha' }
  ]);
  assert.match(lines[0], /^Alpha, good for dine in$/);
  assert.match(lines[1], /^\[Order 2\] Beta,/);
});
