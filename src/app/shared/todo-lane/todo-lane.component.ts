import { Component, computed, inject, input, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { CalendarTodo, TodoService } from '../../services/todo.service';

const COLLAPSED_KEY = 'todoLaneCollapsed';

/** Most rows shown before the rest collapse into a "+N more" link to the to-do list. */
const MAX_ROWS = 6;

/**
 * The to-dos for one calendar day, shown above the day's timeline. Today's lane also carries
 * forward anything overdue until it's ticked off; ticking a recurring item rolls it to its next date.
 */
@Component({
  selector: 'app-todo-lane',
  standalone: true,
  imports: [CommonModule, RouterLink, MatIconModule],
  templateUrl: './todo-lane.component.html',
  styleUrl: './todo-lane.component.scss'
})
export class TodoLaneComponent {
  private readonly todoService = inject(TodoService);

  date = input.required<Date>();

  /** Whether the lane is folded down to its header; remembered between visits. */
  collapsed = signal(TodoLaneComponent.loadCollapsed());

  private allRows = computed(() => this.todoService.getCalendarTodos(this.date()));
  rows = computed(() => this.allRows().slice(0, MAX_ROWS));
  hiddenCount = computed(() => Math.max(0, this.allRows().length - MAX_ROWS));
  openCount = computed(() => this.allRows().filter(r => r.state !== 'done').length);
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

  trackById(_: number, row: CalendarTodo): string {
    return row.item.id;
  }

  async complete(row: CalendarTodo): Promise<void> {
    if (row.state === 'done') return;
    await this.todoService.toggleComplete(row.item.id);
  }

  /** "Every 2 weeks on Tue · from 3 days ago" — recurrence and carry-over, whichever apply. */
  meta(row: CalendarTodo): string {
    const parts: string[] = [];
    const recurrence = this.todoService.getRecurrenceLabel(row.item);
    if (recurrence) parts.push(recurrence);
    if (row.state === 'carried') {
      parts.push(row.daysOverdue === 1 ? 'from yesterday' : `from ${row.daysOverdue} days ago`);
    }
    return parts.join(' · ');
  }
}
