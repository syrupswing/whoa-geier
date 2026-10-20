// Run with: node --test functions/vehicle-maintenance.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('./vehicle-maintenance');

const d = iso => new Date(iso + 'T12:00:00');
const NOW = d('2026-10-19');
const oil = vm.defaultSchedule('car').find(i => i.type === 'oil_change'); // 5,000 mi / 6 mo
const est = (miles, perDay = 30) => ({ miles, lastReading: null, milesPerDay: perDay, isEstimated: true });
const record = (extra = {}) => ({ type: 'oil_change', date: d('2026-09-01'), mileage: 40000, ...extra });

test('rate needs two readings at least 30 days apart', () => {
  assert.equal(vm.drivingRate([{ date: d('2026-09-01'), miles: 10000 }], NOW), null);
  assert.equal(vm.drivingRate([{ date: d('2026-10-01'), miles: 10000 }, { date: d('2026-10-15'), miles: 10300 }], NOW), null);
  const rate = vm.drivingRate([{ date: d('2026-01-01'), miles: 10000 }, { date: d('2026-07-01'), miles: 16000 }], NOW);
  assert.ok(Math.abs(rate - 6000 / 181) < 0.1);
});

test('estimate projects forward, falls back to miles per year, then to current mileage', () => {
  const projected = vm.estimateOdometer({
    readings: [{ date: d('2026-01-01'), miles: 10000 }, { date: d('2026-07-01'), miles: 16000 }], currentMileage: 16000
  }, NOW);
  assert.ok(projected.isEstimated && projected.miles > 16000);

  const guessed = vm.estimateOdometer({
    readings: [{ date: d('2026-09-19'), miles: 20000 }], currentMileage: 20000, milesPerYear: 12000
  }, NOW);
  assert.equal(guessed.miles, 20000 + Math.round((12000 / 365) * 30));

  assert.equal(vm.estimateOdometer({ readings: [], currentMileage: 5000 }, NOW).miles, 5000);
});

test('status levels match the client', () => {
  assert.equal(vm.computeServiceStatus(oil, [], est(41000), NOW).status, 'untracked');
  assert.equal(vm.computeServiceStatus(oil, [record()], est(40500), NOW).status, 'ok');
  assert.equal(vm.computeServiceStatus(oil, [record()], est(45200), NOW).status, 'overdue');
  assert.equal(vm.computeServiceStatus(oil, [record()], est(44600, null), NOW).status, 'soon');
  assert.equal(vm.computeServiceStatus(oil, [record({ date: d('2026-03-01') })], est(40100), NOW).status, 'overdue');
  assert.equal(vm.computeServiceStatus(oil, [record()], est(43000), NOW).daysRemaining, 67);
  const override = vm.computeServiceStatus(oil, [record({ nextDueMileage: 41000 })], est(40500, null), NOW);
  assert.equal(override.dueMiles, 41000);
  assert.equal(override.status, 'soon');
});

test('describeStatus wording', () => {
  const describe = miles => vm.describeStatus(vm.computeServiceStatus(oil, [record()], est(miles), NOW));
  assert.equal(describe(45200), '200 mi overdue');
  assert.equal(describe(44400), 'Due in 20 days · 600 mi');
});

const vehicle = { id: 'v1', name: 'Subaru', type: 'car', currentMileage: 40000 };
const plan = (over = {}) => vm.planVehicleAlerts({
  vehicles: [vehicle],
  records: [{ id: 'r1', vehicleId: 'v1', type: 'oil_change', date: '2026-04-01T12:00:00.000Z', mileage: 38000 }],
  readings: [], state: {}, now: NOW, ...over
});

test('planVehicleAlerts: a due item alerts once, with a suggested task', () => {
  const first = plan();
  assert.equal(first.length, 1);
  assert.equal(first[0].title, 'Oil change · Subaru');
  assert.equal(first[0].level, 'overdue');
  assert.equal(first[0].suggestedTask.title, 'Oil change – Subaru');

  const state = { [first[0].stateId]: { cycleKey: first[0].cycleKey, level: 'overdue', alertedAt: NOW.toISOString() } };
  assert.equal(plan({ state }).length, 0);
});

test('planVehicleAlerts: re-reminds an overdue item after two weeks, not before', () => {
  const [p] = plan();
  const alerted = (daysAgo) => ({ [p.stateId]: { cycleKey: p.cycleKey, level: 'overdue', alertedAt: new Date(NOW - daysAgo * 86400000).toISOString() } });
  assert.equal(plan({ state: alerted(13) }).length, 0);
  assert.equal(plan({ state: alerted(15) }).length, 1);
});

test('planVehicleAlerts: soon escalates to overdue; a new service cycle resets', () => {
  const [p] = plan();
  assert.equal(plan({ state: { [p.stateId]: { cycleKey: p.cycleKey, level: 'soon', alertedAt: NOW.toISOString() } } }).length, 1);
  assert.equal(plan({ state: { [p.stateId]: { cycleKey: 'older-cycle', level: 'overdue', alertedAt: NOW.toISOString() } } }).length, 1);
});

test('planVehicleAlerts: registration and quiet vehicles', () => {
  const expiring = plan({ vehicles: [{ ...vehicle, registrationExpiry: '2026-11-05T00:00:00.000Z' }], records: [] });
  assert.equal(expiring.length, 1);
  assert.equal(expiring[0].title, 'Registration · Subaru');
  assert.equal(expiring[0].suggestedTask.title, 'Renew registration – Subaru');
  assert.equal(plan({ records: [] }).length, 0); // nothing logged, nothing tracked
});

test('summarizePush caps at three lines', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map(n => ({ title: n, body: 'Due soon' }));
  const out = vm.summarizePush(items);
  assert.equal(out.body.split('\n').length, 4);
  assert.ok(out.body.endsWith('+2 more'));
});
