// Server copy of src/app/services/vehicle-maintenance.ts (the nightly job can't import from the
// Angular app). Keep the two in step: the same cases are covered in vehicle-maintenance.spec.ts
// and functions/vehicle-maintenance.test.js. Also holds planVehicleAlerts, the pure rule for
// which due items deserve a push, so it can be tested without Firestore.

const DAY_MS = 24 * 60 * 60 * 1000;
const RATE_WINDOW_DAYS = 365;
const MIN_RATE_SPAN_DAYS = 30;
const SOON_DAYS = 30;
const SOON_MILES = 500;
/** An overdue item that's still overdue gets re-pushed this often, so it isn't forgotten. */
const OVERDUE_REMINDER_DAYS = 14;

const SERVICE_LABELS = {
  oil_change: 'Oil change',
  tire_rotation: 'Tire rotation',
  brakes: 'Brake inspection',
  engine_air_filter: 'Engine air filter',
  cabin_air_filter: 'Cabin air filter',
  battery: 'Battery',
  coolant: 'Coolant',
  transmission_fluid: 'Transmission fluid',
  wipers: 'Wiper blades',
  inspection: 'Inspection',
  wheel_bearings: 'Wheel bearings',
  registration: 'Registration',
  other: 'Other'
};

const DRIVEN_DEFAULTS = [
  { type: 'oil_change', everyMiles: 5000, everyMonths: 6 },
  { type: 'tire_rotation', everyMiles: 7500, everyMonths: 6 },
  { type: 'brakes', everyMiles: 12000, everyMonths: 12 },
  { type: 'cabin_air_filter', everyMiles: 15000, everyMonths: 12 },
  { type: 'engine_air_filter', everyMiles: 20000, everyMonths: 24 },
  { type: 'wipers', everyMonths: 12 },
  { type: 'battery', everyMonths: 48 },
  { type: 'coolant', everyMiles: 60000, everyMonths: 60 },
  { type: 'transmission_fluid', everyMiles: 60000 },
  { type: 'inspection', everyMonths: 12 }
];

const TRAILER_DEFAULTS = [
  { type: 'wheel_bearings', everyMonths: 12 },
  { type: 'brakes', everyMonths: 12 },
  { type: 'tire_rotation', everyMonths: 12 },
  { type: 'inspection', everyMonths: 12 }
];

function defaultSchedule(vehicleType) {
  return (vehicleType === 'trailer' ? TRAILER_DEFAULTS : DRIVEN_DEFAULTS).map(i => ({ ...i }));
}

function drivingRate(readings, now) {
  const sorted = [...readings].sort((a, b) => a.date - b.date);
  const cutoff = now.getTime() - RATE_WINDOW_DAYS * DAY_MS;
  const recent = sorted.filter(r => r.date.getTime() >= cutoff);
  const basis = recent.length >= 2 ? recent : sorted.slice(-2);
  if (basis.length < 2) return null;
  const first = basis[0];
  const last = basis[basis.length - 1];
  const spanDays = (last.date - first.date) / DAY_MS;
  if (spanDays < MIN_RATE_SPAN_DAYS) return null;
  const rate = (last.miles - first.miles) / spanDays;
  return rate > 0 ? rate : null;
}

function estimateOdometer({ readings, currentMileage, milesPerYear }, now) {
  const sorted = [...readings].sort((a, b) => a.date - b.date);
  const last = sorted.length ? sorted[sorted.length - 1] : null;
  if (!last) {
    return { miles: currentMileage, lastReading: null, milesPerDay: milesPerYear ? milesPerYear / 365 : null, isEstimated: false };
  }
  const rate = drivingRate(sorted, now) ?? (milesPerYear ? milesPerYear / 365 : null);
  const daysSince = Math.max(0, (now - last.date) / DAY_MS);
  const projected = rate ? Math.round(last.miles + rate * daysSince) : last.miles;
  return {
    miles: Math.max(projected, last.miles),
    lastReading: { miles: last.miles, date: last.date },
    milesPerDay: rate,
    isEstimated: projected > last.miles
  };
}

function addMonths(date, months) {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

function computeServiceStatus(interval, records, estimate, now) {
  const last = records
    .filter(r => r.type === interval.type)
    .sort((a, b) => b.date - a.date)[0] ?? null;

  const base = {
    type: interval.type, interval,
    lastDate: last?.date ?? null, lastMiles: last?.mileage ?? null,
    dueDate: null, dueMiles: null, effectiveDueDate: null,
    daysRemaining: null, milesRemaining: null, status: 'untracked'
  };
  if (!last) return base;

  const dueDate = last.nextDueDate
    ? new Date(last.nextDueDate)
    : interval.everyMonths ? addMonths(last.date, interval.everyMonths) : null;
  const dueMiles = last.nextDueMileage ?? (interval.everyMiles ? last.mileage + interval.everyMiles : null);
  if (!dueDate && dueMiles == null) return base;

  const milesRemaining = dueMiles != null ? dueMiles - estimate.miles : null;
  let mileageDate = null;
  if (milesRemaining != null) {
    mileageDate = milesRemaining <= 0
      ? now
      : estimate.milesPerDay ? new Date(now.getTime() + (milesRemaining / estimate.milesPerDay) * DAY_MS) : null;
  }
  const candidates = [dueDate, mileageDate].filter(Boolean);
  const effectiveDueDate = candidates.length ? new Date(Math.min(...candidates.map(d => d.getTime()))) : null;
  const daysRemaining = effectiveDueDate ? Math.ceil((effectiveDueDate - now) / DAY_MS) : null;

  const overdue = (dueDate != null && dueDate < now) || (milesRemaining != null && milesRemaining <= 0);
  const soon = (daysRemaining != null && daysRemaining <= SOON_DAYS)
    || (milesRemaining != null && milesRemaining <= SOON_MILES);

  return {
    ...base, dueDate, dueMiles, effectiveDueDate, daysRemaining, milesRemaining,
    status: overdue ? 'overdue' : soon ? 'soon' : 'ok'
  };
}

function computeRegistrationStatus(registrationExpiry, now) {
  if (!registrationExpiry) return null;
  const due = new Date(registrationExpiry);
  const daysRemaining = Math.ceil((due - now) / DAY_MS);
  return {
    type: 'registration', interval: null,
    lastDate: null, lastMiles: null,
    dueDate: due, dueMiles: null, effectiveDueDate: due,
    daysRemaining, milesRemaining: null,
    status: daysRemaining < 0 ? 'overdue' : daysRemaining <= SOON_DAYS ? 'soon' : 'ok'
  };
}

function roundMiles(miles) {
  return (miles >= 1000 ? Math.round(miles / 100) * 100 : Math.round(miles / 10) * 10).toLocaleString('en-US');
}

function describeStatus(s) {
  if (s.status === 'untracked') return 'Not logged yet';
  const miles = s.milesRemaining;
  if (s.status === 'overdue') {
    if (miles != null && miles <= 0) return `${roundMiles(-miles)} mi overdue`;
    const days = Math.abs(s.daysRemaining ?? 0);
    return days === 0 ? 'Due today' : `${days} ${days === 1 ? 'day' : 'days'} overdue`;
  }
  const parts = [];
  if (s.effectiveDueDate) {
    const days = s.daysRemaining ?? 0;
    parts.push(days <= 0 ? 'today' : days <= 60
      ? `in ${days} ${days === 1 ? 'day' : 'days'}`
      : s.effectiveDueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/Chicago' }));
  }
  if (miles != null && miles > 0) parts.push(`${roundMiles(miles)} mi`);
  return 'Due ' + parts.join(' · ');
}

function suggestedTaskTitle(vehicleName, type) {
  const what = type === 'registration' ? 'Renew registration' : (SERVICE_LABELS[type] || 'Service');
  return `${what} – ${vehicleName}`;
}

/** Firestore stores dates as ISO strings; the calculation wants Date objects. */
function hydrateRecord(r) {
  return {
    ...r,
    date: new Date(r.date),
    nextDueDate: r.nextDueDate ? new Date(r.nextDueDate) : undefined
  };
}

/**
 * Decides which due items to alert about. `state` maps "vehicleId:type" to what was last alerted
 * ({ cycleKey, level, alertedAt }). An item alerts when it first turns due-soon/overdue in a
 * service cycle, when it worsens from soon to overdue, and every OVERDUE_REMINDER_DAYS while
 * it stays overdue. Logging the service starts a new cycle, which resets it.
 */
function planVehicleAlerts({ vehicles, records, readings, state, now }) {
  const planned = [];
  for (const vehicle of vehicles) {
    const vehicleRecords = records.filter(r => r.vehicleId === vehicle.id).map(hydrateRecord);
    const vehicleReadings = [
      ...readings.filter(r => r.vehicleId === vehicle.id).map(r => ({ date: new Date(r.date), miles: r.miles })),
      ...vehicleRecords.filter(r => r.mileage > 0).map(r => ({ date: r.date, miles: r.mileage }))
    ];
    const estimate = estimateOdometer({
      readings: vehicleReadings,
      currentMileage: vehicle.currentMileage || 0,
      milesPerYear: vehicle.milesPerYear
    }, now);

    const statuses = (vehicle.schedule || defaultSchedule(vehicle.type))
      .map(i => computeServiceStatus(i, vehicleRecords, estimate, now));
    const registration = computeRegistrationStatus(vehicle.registrationExpiry, now);
    if (registration) statuses.push(registration);

    for (const s of statuses) {
      if (s.status !== 'soon' && s.status !== 'overdue') continue;
      const cycleKey = s.type === 'registration' ? s.dueDate.toISOString() : s.lastDate.toISOString();
      const stateId = `${vehicle.id}:${s.type}`;
      const prev = state[stateId];
      const due = !prev
        || prev.cycleKey !== cycleKey
        || (s.status === 'overdue' && prev.level === 'soon')
        || (s.status === 'overdue' && (now - new Date(prev.alertedAt)) >= OVERDUE_REMINDER_DAYS * DAY_MS);
      if (!due) continue;

      const label = SERVICE_LABELS[s.type] || 'Service';
      planned.push({
        stateId,
        cycleKey,
        level: s.status,
        vehicleId: vehicle.id,
        vehicleName: vehicle.name,
        serviceType: s.type,
        title: `${label} · ${vehicle.name}`,
        body: describeStatus(s),
        suggestedTask: { title: suggestedTaskTitle(vehicle.name, s.type), notes: describeStatus(s) }
      });
    }
  }
  // Most urgent first so the push summary leads with what matters.
  return planned.sort((a, b) => (a.level === b.level ? 0 : a.level === 'overdue' ? -1 : 1));
}

/** One push for a whole run, so a handful of due items isn't a handful of buzzes. */
function summarizePush(planned) {
  const lines = planned.slice(0, 3).map(p => `${p.title} – ${p.body.toLowerCase()}`);
  const more = planned.length - lines.length;
  return {
    title: 'Vehicle maintenance',
    body: lines.join('\n') + (more > 0 ? `\n+${more} more` : '')
  };
}

module.exports = {
  defaultSchedule, drivingRate, estimateOdometer, computeServiceStatus, computeRegistrationStatus,
  describeStatus, suggestedTaskTitle, planVehicleAlerts, summarizePush
};
