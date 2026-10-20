import {
  computeRegistrationStatus, computeServiceStatus, defaultSchedule, describeStatus, drivingRate, estimateOdometer,
  StatusRecord, suggestedTaskTitle
} from './vehicle-maintenance';

const d = (iso: string) => new Date(iso + 'T12:00:00');
const NOW = d('2026-10-19');

describe('odometer estimate', () => {
  it('has no rate from a single reading', () => {
    expect(drivingRate([{ date: d('2026-09-01'), miles: 10000 }], NOW)).toBeNull();
  });

  it('has no rate when readings are under 30 days apart', () => {
    expect(drivingRate([
      { date: d('2026-10-01'), miles: 10000 }, { date: d('2026-10-15'), miles: 10300 }
    ], NOW)).toBeNull();
  });

  it('derives miles per day from recent history', () => {
    const rate = drivingRate([
      { date: d('2026-01-01'), miles: 10000 }, { date: d('2026-07-01'), miles: 16000 }
    ], NOW)!;
    expect(rate).toBeCloseTo(6000 / 181, 1); // loose: the span crosses a DST change
  });

  it('projects forward from the last reading', () => {
    const est = estimateOdometer({
      readings: [{ date: d('2026-01-01'), miles: 10000 }, { date: d('2026-07-01'), miles: 16000 }],
      currentMileage: 16000
    }, NOW);
    expect(est.isEstimated).toBeTrue();
    expect(est.miles).toBeGreaterThan(16000);
    expect(est.lastReading!.miles).toBe(16000);
  });

  it('uses the vehicle guess when history is thin', () => {
    const est = estimateOdometer({
      readings: [{ date: d('2026-09-19'), miles: 20000 }], currentMileage: 20000, milesPerYear: 12000
    }, NOW);
    expect(est.miles).toBe(20000 + Math.round((12000 / 365) * 30));
  });

  it('falls back to current mileage with no readings', () => {
    const est = estimateOdometer({ readings: [], currentMileage: 5000 }, NOW);
    expect(est.miles).toBe(5000);
    expect(est.isEstimated).toBeFalse();
  });
});

describe('service status', () => {
  const oil = defaultSchedule('car').find(i => i.type === 'oil_change')!; // 5,000 mi / 6 mo
  const est = (miles: number, perDay: number | null = 30) =>
    ({ miles, lastReading: null, milesPerDay: perDay, isEstimated: true });
  const record = (extra: Partial<StatusRecord> = {}): StatusRecord =>
    ({ type: 'oil_change', date: d('2026-09-01'), mileage: 40000, ...extra });

  it('is untracked with no matching record', () => {
    expect(computeServiceStatus(oil, [], est(41000), NOW).status).toBe('untracked');
  });

  it('is ok when far from both limits', () => {
    const s = computeServiceStatus(oil, [record()], est(40500), NOW);
    expect(s.status).toBe('ok');
    expect(s.dueMiles).toBe(45000);
  });

  it('is overdue when the estimate passes the due mileage', () => {
    const s = computeServiceStatus(oil, [record()], est(45200), NOW);
    expect(s.status).toBe('overdue');
  });

  it('is soon when within 500 miles', () => {
    expect(computeServiceStatus(oil, [record()], est(44600, null), NOW).status).toBe('soon');
  });

  it('is overdue by date even if mileage is fine', () => {
    const s = computeServiceStatus(oil, [record({ date: d('2026-03-01') })], est(40100), NOW);
    expect(s.status).toBe('overdue');
  });

  it('takes the earlier of the date and projected-mileage deadlines', () => {
    // 2,000 mi left at 30 mi/day ≈ 67 days; the 6-month date is ~134 days out.
    const s = computeServiceStatus(oil, [record()], est(43000), NOW);
    expect(s.daysRemaining).toBe(67);
  });

  it('prefers a record-level override over the interval', () => {
    const s = computeServiceStatus(oil, [record({ nextDueMileage: 41000 })], est(40500, null), NOW);
    expect(s.dueMiles).toBe(41000);
    expect(s.status).toBe('soon');
  });

  it('uses the most recent record of the type', () => {
    const s = computeServiceStatus(oil, [record({ date: d('2026-01-01'), mileage: 30000 }), record()], est(40100), NOW);
    expect(s.lastMiles).toBe(40000);
  });
});

describe('registration status', () => {
  it('is null without an expiry', () => {
    expect(computeRegistrationStatus(undefined, NOW)).toBeNull();
  });
  it('flags expired, soon and ok', () => {
    expect(computeRegistrationStatus(d('2026-10-01'), NOW)!.status).toBe('overdue');
    expect(computeRegistrationStatus(d('2026-11-05'), NOW)!.status).toBe('soon');
    expect(computeRegistrationStatus(d('2027-03-01'), NOW)!.status).toBe('ok');
  });
});

describe('status wording', () => {
  const oil = defaultSchedule('car').find(i => i.type === 'oil_change')!;
  const describe_ = (miles: number) => describeStatus(computeServiceStatus(
    oil, [{ type: 'oil_change', date: d('2026-09-01'), mileage: 40000 }],
    { miles, lastReading: null, milesPerDay: 30, isEstimated: true }, NOW));

  it('matches the server wording', () => {
    expect(describe_(45200)).toBe('200 mi overdue');
    expect(describe_(44400)).toBe('Due in 20 days · 600 mi');
  });

  it('titles suggested tasks', () => {
    expect(suggestedTaskTitle('Subaru', 'oil_change')).toBe('Oil change – Subaru');
    expect(suggestedTaskTitle('Subaru', 'registration')).toBe('Renew registration – Subaru');
  });
});
