import { Component, inject, signal } from '@angular/core';
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
import { HouseholdService } from '../../services/household.service';
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

@Component({
  selector: 'app-backlog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatIconModule, MatCheckboxModule, MatFormFieldModule,
    MatInputModule, MatMenuModule, MatSnackBarModule, GlobalNavMenuComponent, LoadingAnimationComponent
  ],
  templateUrl: './backlog.component.html',
  styleUrls: ['./backlog.component.scss']
})
export class BacklogComponent {
  backlog = inject(BacklogService);
  private calendarEvents = inject(AppCalendarEventService);
  private household = inject(HouseholdService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private confirmService = inject(ConfirmService);

  newTitle = '';
  showDone = signal(false);

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
    const memberId = this.household.myMemberId() ?? undefined;
    await this.backlog.addItem({ title, scope: 'family', memberId });
  }

  memberName(item: BacklogItem): string | null {
    return item.memberId ? this.household.members().find(m => m.id === item.memberId)?.name ?? null : null;
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
        title: result.title, notes: result.notes, memberId: result.memberId, scope: result.scope
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
          defaultDate: new Date(),
          prefill: { title: item.title, itemKind: 'task', memberId: item.memberId ?? null, scope: item.scope }
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

  async remove(item: BacklogItem): Promise<void> {
    const ok = await this.confirmService.confirm({
      title: 'Delete task?',
      message: `"${item.title}" will be removed from the backlog.`,
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

  async importOldTodos(): Promise<void> {
    const count = await this.backlog.importFromTodos();
    this.snackBar.open(`Imported ${count} task${count === 1 ? '' : 's'} from the old to-do list`, 'Close', { duration: 4000 });
  }
}
