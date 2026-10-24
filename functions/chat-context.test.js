const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanGoogleEvents, alertExpiresOn, alertIsCurrent, summarizeNotebookForChat } = require('./chat-context');

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
