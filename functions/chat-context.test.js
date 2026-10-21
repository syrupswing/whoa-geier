const test = require('node:test');
const assert = require('node:assert/strict');
const { cleanGoogleEvents, alertExpiresOn, alertIsCurrent } = require('./chat-context');

const g = (summary, dateTime) => ({ summary, start: { dateTime }, end: { dateTime } });

test('Busy block matching an Outlook event is dropped; unmatched Busy is relabeled; Free is dropped', () => {
  const outlook = [{ summary: 'Nate/Sam 1:1', start: { dateTime: '2026-10-22T18:30:00.000Z' } }];
  const out = cleanGoogleEvents([
    g('Busy', '2026-10-22T18:30:00Z'),
    g('Busy', '2026-10-22T19:00:00Z'),
    { summary: 'Free', start: { date: '2026-10-21' } },
    g('Remi swimmy', '2026-10-21T22:45:00Z')
  ], outlook);
  assert.deepEqual(out.map(e => e.summary), ['Busy (details hidden)', 'Remi swimmy']);
});

test('with no Outlook events every Busy stays, relabeled', () => {
  const out = cleanGoogleEvents([g('Busy', '2026-10-22T18:30:00Z')], []);
  assert.equal(out[0].summary, 'Busy (details hidden)');
});

test('alerts expire after the day in their rule key; ongoing ones never do', () => {
  const trip = { triggeringRule: 'field-trip-lunch:2026-09-25' };
  assert.equal(alertExpiresOn(trip), '2026-09-25');
  assert.equal(alertIsCurrent(trip, '2026-09-25'), true);
  assert.equal(alertIsCurrent(trip, '2026-10-21'), false);
  assert.equal(alertIsCurrent({ triggeringRule: 'vehicle-maintenance:1766548534467' }, '2026-10-21'), true);
  assert.equal(alertIsCurrent({ triggeringRule: 'x', expiresOn: '2026-10-01' }, '2026-10-21'), false);
});
