import { Component, computed, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { AppCalendarEventService } from '../../services/app-calendar-event.service';
import { CalendarEvent } from '../../services/google-calendar.service';
import { buildTaskChecklist, occurrenceKey, TaskChecklistRow } from '../../utils/recurrence';

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
  imports: [CommonModule, MatIconModule],
  templateUrl: './task-lane.component.html',
  styleUrl: './task-lane.component.scss'
})
export class TaskLaneComponent {
  private readonly appCalendarEventService = inject(AppCalendarEventService);

  date = input.required<Date>();

  /** The task's body was clicked — the host shows its details. */
  taskSelect = output<TaskLaneClick>();
  /** The task's checkbox was clicked — the host asks whether to complete (or un-complete) it. */
  taskToggle = output<TaskLaneClick>();

  /** Whether the lane is folded down to its header; remembered between visits. */
  collapsed = signal(TaskLaneComponent.loadCollapsed());

  rows = computed(() => buildTaskChecklist(this.appCalendarEventService.events(), this.date()));
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

  trackByRow(_: number, row: TaskChecklistRow): string {
    return row.event.id + occurrenceKey(row.event);
  }

  /** "Every 2 weeks · from 3 days ago" — repeat and carry-over, whichever apply. */
  meta(row: TaskChecklistRow): string {
    const parts: string[] = [];
    const repeat = row.event.repeat;
    if (repeat) {
      parts.push(repeat.interval === 1 ? `Every ${repeat.unit}` : `Every ${repeat.interval} ${repeat.unit}s`);
    }
    if (row.daysOverdue > 0) {
      parts.push(row.daysOverdue === 1 ? 'from yesterday' : `from ${row.daysOverdue} days ago`);
    }
    return parts.join(' · ');
  }
}
