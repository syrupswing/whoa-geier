import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { BacklogService, BacklogItem } from '../../services/backlog.service';
import { AppCalendarEventService } from '../../services/app-calendar-event.service';
import { AddButtonComponent } from '../../shared/add-button/add-button.component';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';
import { LoadingAnimationComponent } from '../../components/loading-animation/loading-animation.component';
import { ConfirmService } from '../../components/confirm-dialog/confirm-dialog.component';
import {
  BacklogItemDialogComponent, BacklogItemDialogData, BacklogItemDialogResult
} from '../../components/backlog-item-dialog/backlog-item-dialog.component';
import {
  CalendarEventDialogComponent, CalendarEventDialogData, CalendarEventDialogResult
} from '../../components/calendar-event-dialog/calendar-event-dialog.component';
import { highlightWhenPresent } from '../../utils/highlight';
import { buildScheduledTasks, hardDeadlineStatus, occurrenceKey, ScheduledTaskRow } from '../../utils/recurrence';

@Component({
  selector: 'app-backlog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatIconModule, MatCheckboxModule, MatFormFieldModule,
    MatInputModule, MatMenuModule, MatSnackBarModule, GlobalNavMenuComponent, LoadingAnimationComponent, AddButtonComponent
  ],
  templateUrl: './backlog.component.html',
  styleUrls: ['./backlog.component.scss']
})
export class BacklogComponent {
  backlog = inject(BacklogService);
  private calendarEvents = inject(AppCalendarEventService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private confirmService = inject(ConfirmService);

  newTitle = '';
  showUnscheduled = signal(true);
  showScheduled = signal(true);
  showDone = signal(false);

  /** Every task already on the calendar's schedule that isn't done, in the order it falls due. */
  scheduled = computed(() => buildScheduledTasks(this.calendarEvents.events(), new Date()));

  constructor() {
    // A link such as /backlog?highlight=<id> (from a chat confirmation) flashes that task.
    const highlight = inject(ActivatedRoute).snapshot.queryParamMap.get('highlight');
    if (highlight) highlightWhenPresent(highlight);
  }

  /** Quick add: a title and Enter, for the family; details can be added by editing. */
  async quickAdd(): Promise<void> {
    const title = this.newTitle.trim();
    if (!title) return;
    this.newTitle = '';
    await this.backlog.addItem({ title, scope: 'family' });
  }

  /** The full add form (notes, privacy); the field below it stays for one-line quick adds. */
  openAdd(): void {
    const ref = this.dialog.open<BacklogItemDialogComponent, BacklogItemDialogData, BacklogItemDialogResult>(
      BacklogItemDialogComponent, { width: '500px', maxWidth: '95vw', data: { title: this.newTitle.trim() } }
    );
    ref.afterClosed().subscribe(async result => {
      if (!result) return;
      this.newTitle = '';
      await this.backlog.addItem(result);
    });
  }

  toggle(item: BacklogItem): void {
    void this.backlog.setCompleted(item.id, !item.completed);
  }

  edit(item: BacklogItem): void {
    const ref = this.dialog.open<BacklogItemDialogComponent, BacklogItemDialogData, BacklogItemDialogResult>(
      BacklogItemDialogComponent, { width: '500px', maxWidth: '95vw', data: { item } }
    );
    ref.afterClosed().subscribe(async result => {
      if (!result) return;
      // Cleared optional fields are sent as undefined so they're removed from the item.
      await this.backlog.updateItem(item.id, {
        title: result.title, notes: result.notes, scope: result.scope
      });
    });
  }

  /** Opens the calendar's add form as a task, pre-filled; saving it moves the item off the backlog. */
  schedule(item: BacklogItem): void {
    const ref = this.dialog.open<CalendarEventDialogComponent, CalendarEventDialogData, CalendarEventDialogResult>(
      CalendarEventDialogComponent,
      {
        width: '500px',
        maxWidth: '95vw',
        data: {
          mode: 'add',
          scheduling: true,
          defaultDate: new Date(),
          prefill: { title: item.title, description: item.notes, itemKind: 'task', scope: item.scope }
        }
      }
    );
    ref.afterClosed().subscribe(async result => {
      if (!result || result.action !== 'save') return;
      const id = await this.calendarEvents.addEvent(result.event);
      if (!id) {
        this.snackBar.open('Couldn\'t schedule that task', 'Close', { duration: 3000 });
        return;
      }
      await this.backlog.deleteItem(item.id);
      this.snackBar.open('Moved to the calendar', 'Close', { duration: 3000 });
    });
  }

  // ----- Scheduled tasks -----

  trackScheduled = (_: number, row: ScheduledTaskRow) => row.event.id + occurrenceKey(row.event);

  /** "Fri, Oct 30", with the year once it's not this one. */
  dateLabel(row: ScheduledTaskRow): string {
    const sameYear = row.date.getFullYear() === new Date().getFullYear();
    return row.date.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' })
    });
  }

  repeatText(row: ScheduledTaskRow): string {
    const repeat = row.event.repeat;
    if (!repeat) return '';
    return repeat.interval === 1 ? `Every ${repeat.unit}` : `Every ${repeat.interval} ${repeat.unit}s`;
  }

  /** The hard-deadline wording ("Due Mar 1") for a task that has one and isn't already listed on that day. */
  deadlineLabel(row: ScheduledTaskRow): string {
    if (row.event.vehicleTask) return '';
    return hardDeadlineStatus(row.event, false)?.label ?? '';
  }

  async completeScheduled(row: ScheduledTaskRow): Promise<void> {
    const { id } = row.event;
    const key = occurrenceKey(row.event);
    const ok = await this.calendarEvents.completeOccurrence(id, key);
    if (!ok) {
      this.snackBar.open('Couldn\'t complete that task', 'Close', { duration: 3000 });
      return;
    }
    this.snackBar.open(`Done: ${row.event.summary}`, 'Undo', { duration: 5000 })
      .onAction().subscribe(() => void this.calendarEvents.clearCompletion(id, key));
  }

  editScheduled(row: ScheduledTaskRow): void {
    const event = row.event;
    const ref = this.dialog.open<CalendarEventDialogComponent, CalendarEventDialogData, CalendarEventDialogResult>(
      CalendarEventDialogComponent, { width: '500px', maxWidth: '95vw', data: { mode: 'edit', event } }
    );
    ref.afterClosed().subscribe(async result => {
      if (!result) return;
      try {
        if (result.action === 'delete') await this.calendarEvents.deleteEvent(event.id);
        else await this.calendarEvents.updateEvent(event.id, result.event);
      } catch {
        this.snackBar.open('Couldn\'t save that task', 'Close', { duration: 3000 });
      }
    });
  }

  async remove(item: BacklogItem): Promise<void> {
    const ok = await this.confirmService.confirm({
      title: 'Delete task?',
      message: `"${item.title}" will be removed from the task backlog.`,
      confirmLabel: 'Delete',
      destructive: true
    });
    if (ok) await this.backlog.deleteItem(item.id);
  }

  async clearDone(): Promise<void> {
    const done = this.backlog.done();
    const ok = await this.confirmService.confirm({
      title: 'Clear completed?',
      message: `Remove ${done.length} completed task${done.length === 1 ? '' : 's'}?`,
      confirmLabel: 'Clear',
      destructive: true
    });
    if (ok) await Promise.all(done.map(item => this.backlog.deleteItem(item.id)));
  }
}
