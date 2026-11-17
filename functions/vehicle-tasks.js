// Keeps the calendar's task lane in step with the vehicle maintenance schedule. Kept apart from index.js, with
// the Firestore handle and date helper passed in, so it can be tested against an in-memory fake.
// Run tests with: node --test functions/vehicle-tasks.test.js
const vehicleMaintenance = require('./vehicle-maintenance');

/**
 * Keeps the calendar's task lane in step with the vehicles: every tracked item has one standing task for its current
 * service cycle, due on the item's due date (the task's hard deadline). The task starts showing on the calendar
 * 60 days before that (its start date); until then it's listed only on the backlog page. Each morning an open task's
 * due date and notes are refreshed, since a mileage item's date moves with the driving. A task whose cycle is over
 * (the service was logged, the renewal marked) is ticked off, and the next cycle's task is made at once. A task is
 * made once per cycle: vehicleTaskState remembers it, so deleting one on purpose doesn't bring it back.
 */
/** A known date is spelled out rather than counted down, so the text doesn't change (and get rewritten) every morning. */
function taskDescription(t) {
  const when = t.dateKnown
    ? `Due ${t.dueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/Chicago' })}`
    : t.notes;
  return `${when}. Log it under Vehicles when it's done, and this task closes by itself.`;
}

async function syncVehicleTasks(db, { vehicles, records, readings, now, toDateStr }) {
  const today = toDateStr(now);
  const nowIso = now.toISOString();
  const eventsRef = db.collection('calendarEvents');

  const openSnap = await eventsRef.where('vehicleTask', '==', true).get();
  const open = openSnap.docs.filter(d => !Object.keys(d.data().completions || {}).length);
  const { complete, remove } = vehicleMaintenance.planVehicleTaskClosures({
    vehicles, records, readings, now,
    openTasks: open.map(d => ({ id: d.id, ...d.data() }))
  });
  const plan = vehicleMaintenance.planVehicleTasks({ vehicles, records, readings, now });
  const planById = new Map(plan.map(t => [t.id, t]));
  let updated = 0;
  for (const doc of open) {
    if (!complete.includes(doc.id) && !remove.includes(doc.id)) {
      const t = planById.get(doc.id);
      if (!t) continue;
      const data = doc.data();
      const changes = {};
      if (data.description !== taskDescription(t)) changes.description = taskDescription(t);
      if (t.dateKnown) {
        const deadline = toDateStr(t.dueDate);
        if (data.hardDeadline !== deadline) changes.hardDeadline = deadline;
        // Once it has started showing it stays put; only a task still waiting for its day can move.
        const startDate = data.start?.date;
        const showFrom = toDateStr(t.showFrom);
        if (startDate && startDate > today && startDate !== showFrom) {
          changes.start = { date: showFrom };
          changes.end = { date: toDateStr(new Date(t.showFrom.getTime() + 24 * 60 * 60 * 1000)) };
        }
      }
      if (Object.keys(changes).length) {
        await doc.ref.update({ ...changes, updatedAt: nowIso });
        updated++;
      }
      continue;
    }
    if (complete.includes(doc.id)) {
      const key = doc.data().start?.date || today;
      await doc.ref.update({
        [`completions.${key}`]: { byUid: 'system', byName: 'Vehicle maintenance', at: nowIso },
        updatedAt: nowIso
      });
    } else if (remove.includes(doc.id)) {
      await doc.ref.delete();
    }
  }

  let created = 0;
  for (const t of plan) {
    const showFrom = toDateStr(t.showFrom);
    const marker = db.collection('vehicleTaskState').doc(t.id);
    if ((await marker.get()).exists) continue;
    // Marked first, so a retry after a partial failure can't make a second task.
    await marker.set({ vehicleId: t.vehicleId, serviceType: t.serviceType, cycleKey: t.cycleKey, createdAt: nowIso });
    await eventsRef.doc(t.id).set({
      summary: t.title,
      description: taskDescription(t),
      start: { date: showFrom },
      end: { date: toDateStr(new Date(t.showFrom.getTime() + 24 * 60 * 60 * 1000)) },
      kind: 'task',
      source: 'app',
      isPrivate: false,
      hardDeadline: toDateStr(t.dueDate),
      vehicleTask: true,
      vehicleId: t.vehicleId,
      serviceType: t.serviceType,
      cycleKey: t.cycleKey,
      createdByUid: 'system',
      createdByName: 'Vehicle maintenance',
      createdAt: nowIso,
      updatedAt: nowIso
    });
    created++;
  }
  return { created, updated, completed: complete.length, removed: remove.length };
}

module.exports = { syncVehicleTasks };
