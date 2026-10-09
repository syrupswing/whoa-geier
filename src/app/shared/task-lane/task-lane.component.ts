import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AppCalendarEventService } from '../../services/app-calendar-event.service';
import { CalendarEvent } from '../../services/google-calendar.service';
import { buildSnoozedTasks, buildTaskChecklist, occurrenceKey, SnoozedTaskRow, TaskChecklistRow } from '../../utils/recurrence';
import { formatSnoozeEnd } from '../../utils/snooze';

/** A click on a task, with the DOM event so the host can anchor a popover to what was clicked. */
export interface TaskLaneClick {
  event: CalendarEvent;
  domEvent: Event;
}

const COLLAPSED_KEY = 'taskLaneCollapsed';

/**
 * The checklist of tasks for one calendar day, shown above the day's timeline. Today's list also
 * carries forward every unfinished task from earlier days until it's ticked off.
 */
@Component({
  selector: 'app-task-lane',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatTooltipModule],
  templateUrl: './task-lane.component.html',
  styleUrl: './task-lane.component.scss'
})
export class TaskLaneComponent {
  private readonly appCalendarEventService = inject(AppCalendarEventService);

  date = input.required<Date>();

  constructor() {
    const timer = window.setInterval(() => this.now.set(Date.now()), 60_000);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  /** The task's body was clicked — the host shows its details. */
  taskSelect = output<TaskLaneClick>();
  /** The task's checkbox was clicked — the host asks whether to complete (or un-complete) it. */
  taskToggle = output<TaskLaneClick>();

  /** Whether the lane is folded down to its header; remembered between visits. */
  collapsed = signal(TaskLaneComponent.loadCollapsed());

  /** Ticks each minute, so a task whose snooze has ended comes back without a reload. */
  private now = signal(Date.now());

  rows = computed(() => buildTaskChecklist(this.appCalendarEventService.events(), this.date(), new Date(this.now())));

  /** Snoozed tasks, listed on today's view only so they can be woken early (they're hidden everywhere else). */
  snoozedRows = computed<SnoozedTaskRow[]>(() =>
    this.isToday() ? buildSnoozedTasks(this.appCalendarEventService.events(), new Date(this.now())) : []
  );
  showSnoozed = signal(false);
  openCount = computed(() => this.rows().filter(r => !r.done).length);
  isToday = computed(() => new Date().toDateString() === this.date().toDateString());

  private static loadCollapsed(): boolean {
    try {
      return localStorage.getItem(COLLAPSED_KEY) === 'true';
    } catch {
      // localStorage unavailable (e.g. private browsing) — just start expanded
      return false;
    }
  }

  toggleCollapsed(): void {
    const next = !this.collapsed();
    this.collapsed.set(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, String(next));
    } catch {
      // Not persisted, but it still works for this visit
    }
  }

  trackBySnoozed(_: number, row: SnoozedTaskRow): string {
    return row.event.id + occurrenceKey(row.event);
  }

  snoozeEnds(row: SnoozedTaskRow): string {
    return formatSnoozeEnd(row.until);
  }

  /** Brings a snoozed task back to the calendar now. */
  wake(row: SnoozedTaskRow): void {
    this.appCalendarEventService.unsnoozeOccurrence(row.event.id, occurrenceKey(row.event));
  }

  trackByRow(_: number, row: TaskChecklistRow): string {
    return row.event.id + occurrenceKey(row.event);
  }

  /** "Every 2 weeks" — the repeat details, shown in the repeat icon's tooltip. */
  repeatText(row: TaskChecklistRow): string {
    const repeat = row.event.repeat;
    if (!repeat) return '';
    return repeat.interval === 1 ? `Every ${repeat.unit}` : `Every ${repeat.interval} ${repeat.unit}s`;
  }

  /** "from 3 days ago" — shown for tasks carried over from an earlier day. */
  meta(row: TaskChecklistRow): string {
    if (row.daysOverdue <= 0) return '';
    return row.daysOverdue === 1 ? 'from yesterday' : `from ${row.daysOverdue} days ago`;
  }
}
