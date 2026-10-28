const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanGoogleEvents, alertExpiresOn, alertIsCurrent, summarizeNotebookForChat, tomorrowStartPhrase, linkDocCitations } = require('./chat-context');

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
