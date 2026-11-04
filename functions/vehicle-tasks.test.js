// Run with: node --test functions/vehicle-tasks.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { syncVehicleTasks } = require('./vehicle-tasks');

const d = iso => new Date(iso + 'T12:00:00Z');
const NOW = d('2026-10-19');
const toDateStr = date => date.toISOString().slice(0, 10);

/** Just enough of Firestore's Admin API for syncVehicleTasks: collections of plain objects, dotted-key updates. */
function fakeDb() {
  const store = new Map();
  const coll = name => { if (!store.has(name)) store.set(name, new Map()); return store.get(name); };
  const setPath = (obj, path, value) => {
    const keys = path.split('.');
    let o = obj;
    keys.slice(0, -1).forEach(k => { o = o[k] = o[k] ?? {}; });
    o[keys[keys.length - 1]] = value;
  };
  const docRef = (name, id) => ({
    get: async () => ({ exists: coll(name).has(id), id, data: () => coll(name).get(id) }),
    set: async data => { coll(name).set(id, structuredClone(data)); },
    update: async fields => {
      const cur = coll(name).get(id);
      for (const [k, v] of Object.entries(fields)) setPath(cur, k, v);
    },
    delete: async () => { coll(name).delete(id); }
  });
  return {
    coll,
    collection: name => ({
      doc: id => docRef(name, id),
      where: (field, _op, value) => ({
        get: async () => ({
          docs: [...coll(name)].filter(([, v]) => v[field] === value)
            .map(([id, v]) => ({ id, data: () => v, ref: docRef(name, id) }))
        })
      })
    })
  };
}

const vehicle = { id: 'v1', name: 'Subaru', type: 'car', currentMileage: 40000 };
const oilRecord = { id: 'r1', vehicleId: 'v1', type: 'oil_change', date: '2026-04-01T12:00:00.000Z', mileage: 38000 };
const readings = [{ id: 'o0', vehicleId: 'v1', date: '2026-10-10T12:00:00.000Z', miles: 40000 }];
const run = (db, over = {}) => syncVehicleTasks(db, { vehicles: [vehicle], records: [oilRecord], readings, now: NOW, toDateStr, ...over });
const tasks = db => [...db.coll('calendarEvents')].map(([id, v]) => ({ id, ...v }));

test('a due item gets one calendar task, due on its due date, shared with the family', async () => {
  const db = fakeDb();
  assert.deepEqual(await run(db), { created: 1, completed: 0, removed: 0 });
  const [t] = tasks(db);
  assert.equal(t.summary, 'Oil change – Subaru');
  assert.equal(t.kind, 'task');
  assert.equal(t.source, 'app');
  assert.equal(t.isPrivate, false);
  assert.deepEqual(t.start, { date: '2026-10-19' });
  assert.deepEqual(t.end, { date: '2026-10-20' });
  assert.match(t.hardDeadline, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(t.vehicleTask, true);
  assert.equal(t.vehicleId, 'v1');
  assert.equal(t.serviceType, 'oil_change');
  assert.match(t.description, /Log it under Vehicles/);
  assert.equal(db.coll('vehicleTaskState').size, 1);
});

test('running again the next morning does not make a second task', async () => {
  const db = fakeDb();
  await run(db);
  assert.deepEqual(await run(db, { now: d('2026-10-20') }), { created: 0, completed: 0, removed: 0 });
  assert.equal(tasks(db).length, 1);
});

test('a task someone deletes on purpose is not brought back', async () => {
  const db = fakeDb();
  await run(db);
  db.coll('calendarEvents').clear();
  assert.deepEqual(await run(db, { now: d('2026-10-20') }), { created: 0, completed: 0, removed: 0 });
  assert.equal(tasks(db).length, 0);
});

test('logging the service completes the task, credited to Vehicle maintenance', async () => {
  const db = fakeDb();
  await run(db);
  const logged = { id: 'r2', vehicleId: 'v1', type: 'oil_change', date: '2026-10-19T12:00:00.000Z', mileage: 40100 };
  assert.deepEqual(await run(db, { records: [oilRecord, logged] }), { created: 0, completed: 1, removed: 0 });
  const [t] = tasks(db);
  assert.equal(t.completions['2026-10-19'].byName, 'Vehicle maintenance');
  assert.equal(t.completions['2026-10-19'].byUid, 'system');
});

test('a task already ticked off by a person is left alone and not recreated', async () => {
  const db = fakeDb();
  await run(db);
  const [t] = tasks(db);
  db.coll('calendarEvents').get(t.id).completions = { '2026-10-19': { byUid: 'u1', byName: 'Nathan', at: NOW.toISOString() } };
  assert.deepEqual(await run(db, { now: d('2026-10-20') }), { created: 0, completed: 0, removed: 0 });
  assert.equal(tasks(db)[0].completions['2026-10-19'].byName, 'Nathan');
});

test('an edited title does not break the link, so the task still closes', async () => {
  const db = fakeDb();
  await run(db);
  const [t] = tasks(db);
  db.coll('calendarEvents').get(t.id).summary = 'Get the Subaru oiled (call Jiffy first)';
  const logged = { id: 'r2', vehicleId: 'v1', type: 'oil_change', date: '2026-10-19T12:00:00.000Z', mileage: 40100 };
  assert.equal((await run(db, { records: [oilRecord, logged] })).completed, 1);
});

test('deleting a vehicle removes its open tasks', async () => {
  const db = fakeDb();
  await run(db);
  assert.deepEqual(await run(db, { vehicles: [], records: [], readings: [] }), { created: 0, completed: 0, removed: 1 });
  assert.equal(tasks(db).length, 0);
});

test('ordinary calendar tasks are never touched', async () => {
  const db = fakeDb();
  db.coll('calendarEvents').set('plain', { summary: 'Buy milk', kind: 'task', source: 'app', isPrivate: false });
  await run(db, { vehicles: [], records: [], readings: [] });
  assert.equal(db.coll('calendarEvents').get('plain').summary, 'Buy milk');
});

test('registration: a due renewal makes a task, marking it renewed closes it', async () => {
  const db = fakeDb();
  const expiring = { ...vehicle, registrationExpiry: '2026-11-05T00:00:00.000Z' };
  const base = { vehicles: [expiring], records: [], readings };
  assert.equal((await run(db, base)).created, 1);
  assert.equal(tasks(db)[0].summary, 'Renew registration – Subaru');
  assert.equal(tasks(db)[0].hardDeadline, '2026-11-05');
  const renewed = { ...base, vehicles: [{ ...vehicle, registrationExpiry: '2027-11-05T00:00:00.000Z' }] };
  assert.deepEqual(await run(db, renewed), { created: 0, completed: 1, removed: 0 });
});
