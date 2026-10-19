// Pure maintenance math for vehicles: the service catalog, generic default intervals, the
// odometer estimate, and per-item due status. No Angular or Firestore in here on purpose, so it
// is easy to test and to mirror in functions/index.js for the nightly job.

export type VehicleType = 'car' | 'truck' | 'trailer';

export type ServiceType =
  | 'oil_change'
  | 'tire_rotation'
  | 'brakes'
  | 'engine_air_filter'
  | 'cabin_air_filter'
  | 'battery'
  | 'coolant'
  | 'transmission_fluid'
  | 'wipers'
  | 'inspection'
  | 'wheel_bearings'
  | 'registration'
  | 'other';

/** How often one service repeats; either limit may be omitted (whichever comes first wins). */
export interface ServiceInterval {
  type: ServiceType;
  everyMiles?: number;
  everyMonths?: number;
}

export interface OdometerReading {
  id: string;
  vehicleId: string;
  date: Date;
  miles: number;
}

export const SERVICE_CATALOG: Record<ServiceType, { label: string; icon: string }> = {
  oil_change: { label: 'Oil change', icon: 'oil_barrel' },
  tire_rotation: { label: 'Tire rotation', icon: 'tire_repair' },
  brakes: { label: 'Brake inspection', icon: 'disc_full' },
  engine_air_filter: { label: 'Engine air filter', icon: 'air' },
  cabin_air_filter: { label: 'Cabin air filter', icon: 'filter_alt' },
  battery: { label: 'Battery', icon: 'battery_charging_full' },
  coolant: { label: 'Coolant', icon: 'water_drop' },
  transmission_fluid: { label: 'Transmission fluid', icon: 'settings' },
  wipers: { label: 'Wiper blades', icon: 'wiper' },
  inspection: { label: 'Inspection', icon: 'fact_check' },
  wheel_bearings: { label: 'Wheel bearings', icon: 'album' },
  registration: { label: 'Registration', icon: 'description' },
  other: { label: 'Other', icon: 'build' }
};

/** Generic starting points, not manufacturer specs; each vehicle can edit its own list. */
const DRIVEN_DEFAULTS: ServiceInterval[] = [
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

const TRAILER_DEFAULTS: ServiceInterval[] = [
  { type: 'wheel_bearings', everyMonths: 12 },
  { type: 'brakes', everyMonths: 12 },
  { type: 'tire_rotation', everyMonths: 12 },
  { type: 'inspection', everyMonths: 12 }
];

export function defaultSchedule(type: VehicleType): ServiceInterval[] {
  return (type === 'trailer' ? TRAILER_DEFAULTS : DRIVEN_DEFAULTS).map(i => ({ ...i }));
}

// --- Odometer estimate -------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const RATE_WINDOW_DAYS = 365;
const MIN_RATE_SPAN_DAYS = 30;

export interface OdometerEstimate {
  /** Best guess of the odometer right now. */
  miles: number;
  /** The last real reading this is based on, if any. */
  lastReading: { miles: number; date: Date } | null;
  /** Miles per day, from history or the vehicle's own guess; null when there's nothing to go on. */
  milesPerDay: number | null;
  /** True when `miles` projects past the last reading instead of being the reading itself. */
  isEstimated: boolean;
}

export interface OdometerInputs {
  readings: Array<{ date: Date; miles: number }>;
  /** Fallback when there's no reading history: whatever the vehicle record currently says. */
  currentMileage: number;
  milesPerYear?: number;
}

/** Miles/day between the oldest and newest recent reading; null if the history is too thin. */
export function drivingRate(readings: Array<{ date: Date; miles: number }>, now: Date): number | null {
  const sorted = [...readings].sort((a, b) => a.date.getTime() - b.date.getTime());
  const cutoff = now.getTime() - RATE_WINDOW_DAYS * DAY_MS;
  const recent = sorted.filter(r => r.date.getTime() >= cutoff);
  const basis = recent.length >= 2 ? recent : sorted.slice(-2);
  if (basis.length < 2) return null;
  const first = basis[0];
  const last = basis[basis.length - 1];
  const spanDays = (last.date.getTime() - first.date.getTime()) / DAY_MS;
  if (spanDays < MIN_RATE_SPAN_DAYS) return null;
  const rate = (last.miles - first.miles) / spanDays;
  return rate > 0 ? rate : null;
}

export function estimateOdometer(input: OdometerInputs, now: Date = new Date()): OdometerEstimate {
  const sorted = [...input.readings].sort((a, b) => a.date.getTime() - b.date.getTime());
  const last = sorted.length ? sorted[sorted.length - 1] : null;

  if (!last) {
    const fallbackRate = input.milesPerYear ? input.milesPerYear / 365 : null;
    return { miles: input.currentMileage, lastReading: null, milesPerDay: fallbackRate, isEstimated: false };
  }

  const rate = drivingRate(sorted, now) ?? (input.milesPerYear ? input.milesPerYear / 365 : null);
  const daysSince = Math.max(0, (now.getTime() - last.date.getTime()) / DAY_MS);
  const projected = rate ? Math.round(last.miles + rate * daysSince) : last.miles;
  return {
    miles: Math.max(projected, last.miles),
    lastReading: { miles: last.miles, date: last.date },
    milesPerDay: rate,
    isEstimated: projected > last.miles
  };
}

// --- Due status ---------------------------------------------------------------------------

export type ServiceStatusLevel = 'overdue' | 'soon' | 'ok' | 'untracked';

export interface ServiceStatus {
  type: ServiceType;
  interval: ServiceInterval | null;
  lastDate: Date | null;
  lastMiles: number | null;
  /** Date and mileage the next service falls due by, from the interval or a record's override. */
  dueDate: Date | null;
  dueMiles: number | null;
  /** Whichever deadline arrives first, with mileage projected to a date via the driving rate. */
  effectiveDueDate: Date | null;
  daysRemaining: number | null;
  milesRemaining: number | null;
  status: ServiceStatusLevel;
}

export interface StatusRecord {
  type: ServiceType;
  date: Date;
  mileage: number;
  nextDueDate?: Date;
  nextDueMileage?: number;
}

export const SOON_DAYS = 30;
export const SOON_MILES = 500;

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

export function computeServiceStatus(
  interval: ServiceInterval,
  records: StatusRecord[],
  estimate: OdometerEstimate,
  now: Date = new Date()
): ServiceStatus {
  const last = records
    .filter(r => r.type === interval.type)
    .sort((a, b) => b.date.getTime() - a.date.getTime())[0] ?? null;

  const base: ServiceStatus = {
    type: interval.type, interval,
    lastDate: last?.date ?? null, lastMiles: last?.mileage ?? null,
    dueDate: null, dueMiles: null, effectiveDueDate: null,
    daysRemaining: null, milesRemaining: null, status: 'untracked'
  };
  if (!last) return base;

  // A date/mileage typed on the record itself overrides the interval for that cycle.
  const dueDate = last.nextDueDate
    ? new Date(last.nextDueDate)
    : interval.everyMonths ? addMonths(last.date, interval.everyMonths) : null;
  const dueMiles = last.nextDueMileage ?? (interval.everyMiles ? last.mileage + interval.everyMiles : null);
  if (!dueDate && dueMiles == null) return base;

  const milesRemaining = dueMiles != null ? dueMiles - estimate.miles : null;
  let mileageDate: Date | null = null;
  if (milesRemaining != null) {
    mileageDate = milesRemaining <= 0
      ? now
      : estimate.milesPerDay ? new Date(now.getTime() + (milesRemaining / estimate.milesPerDay) * DAY_MS) : null;
  }
  const candidates = [dueDate, mileageDate].filter((d): d is Date => !!d);
  const effectiveDueDate = candidates.length
    ? new Date(Math.min(...candidates.map(d => d.getTime())))
    : null;
  const daysRemaining = effectiveDueDate ? Math.ceil((effectiveDueDate.getTime() - now.getTime()) / DAY_MS) : null;

  const overdue = (dueDate != null && dueDate < now) || (milesRemaining != null && milesRemaining <= 0);
  const soon = (daysRemaining != null && daysRemaining <= SOON_DAYS)
    || (milesRemaining != null && milesRemaining <= SOON_MILES);

  return {
    ...base, dueDate, dueMiles, effectiveDueDate, daysRemaining, milesRemaining,
    status: overdue ? 'overdue' : soon ? 'soon' : 'ok'
  };
}

/** Registration is date-only and lives on the vehicle, not in its service schedule. */
export function computeRegistrationStatus(registrationExpiry: Date | undefined, now: Date = new Date()): ServiceStatus | null {
  if (!registrationExpiry) return null;
  const due = new Date(registrationExpiry);
  const daysRemaining = Math.ceil((due.getTime() - now.getTime()) / DAY_MS);
  return {
    type: 'registration', interval: null,
    lastDate: null, lastMiles: null,
    dueDate: due, dueMiles: null, effectiveDueDate: due,
    daysRemaining, milesRemaining: null,
    status: daysRemaining < 0 ? 'overdue' : daysRemaining <= SOON_DAYS ? 'soon' : 'ok'
  };
}

const STATUS_ORDER: Record<ServiceStatusLevel, number> = { overdue: 0, soon: 1, ok: 2, untracked: 3 };

/** Overdue first, then soonest due; items with no due date sink to the bottom of their level. */
export function compareStatuses(a: ServiceStatus, b: ServiceStatus): number {
  if (a.status !== b.status) return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
  return (a.effectiveDueDate?.getTime() ?? Infinity) - (b.effectiveDueDate?.getTime() ?? Infinity);
}
