import { CalendarEvent } from '../services/google-calendar.service';
import { buildScheduledTasks } from './recurrence';

const NOW = new Date(2026, 9, 19, 12);

const task = (over: Partial<CalendarEvent> & { summary: string }): CalendarEvent => ({
  id: over.summary, kind: 'task', source: 'app',
  start: { date: '2026-10-25' }, end: { date: '2026-10-26' },
  ...over
});

describe('buildScheduledTasks', () => {
  it('lists open tasks in date order and skips events and done tasks', () => {
    const rows = buildScheduledTasks([
      task({ summary: 'Later', start: { date: '2026-11-10' }, end: { date: '2026-11-11' } }),
      task({ summary: 'Sooner', start: { date: '2026-10-22' }, end: { date: '2026-10-23' } }),
      task({ summary: 'Done', completions: { '2026-10-25': { byUid: 'u', byName: 'N', at: NOW.toISOString() } } }),
      { ...task({ summary: 'A party' }), kind: 'event' }
    ], NOW);
    expect(rows.map(r => r.event.summary)).toEqual(['Sooner', 'Later']);
  });

  it('puts an overdue task first and flags it', () => {
    const rows = buildScheduledTasks([
      task({ summary: 'Soon', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } }),
      task({ summary: 'Missed', start: { date: '2026-10-10' }, end: { date: '2026-10-11' } })
    ], NOW);
    expect(rows.map(r => [r.event.summary, r.overdue])).toEqual([['Missed', true], ['Soon', false]]);
  });

  it('lists a vehicle task on its due date rather than the day it starts showing', () => {
    const rows = buildScheduledTasks([
      task({ summary: 'Oil', vehicleTask: true, start: { date: '2026-12-31' }, end: { date: '2027-01-01' }, hardDeadline: '2027-03-01' }),
      task({ summary: 'Errand', start: { date: '2027-01-15' }, end: { date: '2027-01-16' } })
    ], NOW);
    expect(rows.map(r => r.event.summary)).toEqual(['Errand', 'Oil']);
    expect(rows[1].date).toEqual(new Date(2027, 2, 1));
  });

  it('lists a repeating task once, on its next open occurrence', () => {
    const rows = buildScheduledTasks([
      task({
        summary: 'Weekly', start: { date: '2026-10-05' }, end: { date: '2026-10-06' },
        repeat: { unit: 'week', interval: 1, mode: 'schedule' } as any
      })
    ], NOW);
    expect(rows.length).toBe(1);
    expect(rows[0].event.occurrenceDate).toBe('2026-10-19');
  });
});
