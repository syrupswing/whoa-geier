// Keeps the calendar's task lane in step with the vehicle maintenance schedule. Kept apart from index.js, with
// the Firestore handle and date helper passed in, so it can be tested against an in-memory fake.
// Run tests with: node --test functions/vehicle-tasks.test.js
const vehicleMaintenance = require('./vehicle-maintenance');

/**
 * Keeps the calendar's task lane in step with the vehicles: every item that is due soon or overdue gets one
 * task for its current service cycle, due on the item's due date (the task's hard deadline), and a task whose
 * item is no longer due (the service was logged, the renewal marked) is ticked off. A task is made once per
 * cycle: vehicleTaskState remembers it, so deleting one on purpose doesn't bring it back the next morning.
 */
async function syncVehicleTasks(db, { vehicles, records, readings, now, toDateStr }) {
  const today = toDateStr(now);
  const nextDay = toDateStr(new Date(now.getTime() + 24 * 60 * 60 * 1000));
  const nowIso = now.toISOString();
  const eventsRef = db.collection('calendarEvents');

  const openSnap = await eventsRef.where('vehicleTask', '==', true).get();
  const open = openSnap.docs.filter(d => !Object.keys(d.data().completions || {}).length);
  const { complete, remove } = vehicleMaintenance.planVehicleTaskClosures({
    vehicles, records, readings, now,
    openTasks: open.map(d => ({ id: d.id, ...d.data() }))
  });
  for (const doc of open) {
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
  for (const t of vehicleMaintenance.planVehicleTasks({ vehicles, records, readings, now })) {
    const marker = db.collection('vehicleTaskState').doc(t.id);
    if ((await marker.get()).exists) continue;
    // Marked first, so a retry after a partial failure can't make a second task.
    await marker.set({ vehicleId: t.vehicleId, serviceType: t.serviceType, cycleKey: t.cycleKey, createdAt: nowIso });
    await eventsRef.doc(t.id).set({
      summary: t.title,
      description: `${t.notes}. Log it under Vehicles when it's done, and this task closes by itself.`,
      start: { date: today },
      end: { date: nextDay },
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
  return { created, completed: complete.length, removed: remove.length };
}

module.exports = { syncVehicleTasks };
