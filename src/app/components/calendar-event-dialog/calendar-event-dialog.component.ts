import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { CalendarEvent, CalendarItemKind, RepeatRule } from '../../services/google-calendar.service';
import { HouseholdService } from '../../services/household.service';
import { AuthService } from '../../services/auth.service';
import { TimeFieldComponent } from '../time-field/time-field.component';
import { nextDayIso } from '../../services/app-calendar-event.service';

export type AppCalendarEventFormResult = Omit<CalendarEvent, 'id' | 'source'>;

export type CalendarEventDialogResult =
  | { action: 'save'; event: AppCalendarEventFormResult }
  | { action: 'delete' };

export interface CalendarEventDialogData {
  mode: 'add' | 'edit';
  /** Required for 'edit' — the app-native item being edited, used to pre-fill the form. */
  event?: CalendarEvent;
  /** Pre-fills the date on add — typically whatever day the calendar widget is currently showing. */
  defaultDate?: Date;
}

type Scope = 'private' | 'family';
type RepeatUnit = RepeatRule['unit'];

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * Add/edit form for app-native calendar items (stored in Firestore, merged alongside Google
 * Calendar events since this app only has read access there). An item is either an Event
 * (timing only) or a Task (can be completed). Both can be all-day (the default) or have a time of
 * day (a point in time); events can also have a duration and span several days. Both can repeat,
 * and both are private to their creator (the default) or shared with the family.
 */
@Component({
  selector: 'app-calendar-event-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatIconModule,
    MatRadioModule,
    MatCheckboxModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    TimeFieldComponent
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>{{ formData.itemKind === 'task' ? 'task_alt' : 'event' }}</mat-icon>
      {{ data.mode === 'add' ? 'Add item' : 'Edit item' }}
    </h2>

    <mat-dialog-content>
      <div class="dialog-form">
        <div class="kind-row">
          <mat-button-toggle-group
            class="item-kind-toggle"
            name="itemKind"
            [ngModel]="formData.itemKind"
            (ngModelChange)="onItemKindChange($event)"
            aria-label="Item type">
            <mat-button-toggle value="event">Event</mat-button-toggle>
            <mat-button-toggle value="task">Task</mat-button-toggle>
          </mat-button-toggle-group>
          <!-- Not item types here: these open a new event in Google Calendar / Outlook (prefilled
               from this form), so it's created at that source instead of in the app. -->
          <ng-container *ngIf="data.mode === 'add'">
            <a class="external-btn" [href]="googleEventUrl()" target="_blank" rel="noopener">Google<mat-icon>open_in_new</mat-icon></a>
            <a class="external-btn" [href]="outlookEventUrl()" target="_blank" rel="noopener">Outlook<mat-icon>open_in_new</mat-icon></a>
          </ng-container>
        </div>
        <p class="kind-hint" *ngIf="formData.itemKind === 'task'">
          A task can be checked off. It can be all day or at a specific time.
        </p>

        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full-width title-field">
          <mat-label>Title</mat-label>
          <input
            matInput
            name="title"
            [(ngModel)]="formData.title"
            [placeholder]="formData.itemKind === 'task' ? 'e.g., Renew car registration' : 'e.g., Dentist appointment'"
            required>
        </mat-form-field>

        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full-width">
          <mat-label>{{ formData.multiDay ? 'Start date' : 'Date' }}</mat-label>
          <input matInput [matDatepicker]="datePicker" name="startDate" [(ngModel)]="formData.startDate" (dateChange)="onStartDateChange()" required>
          <mat-datepicker-toggle matIconSuffix [for]="datePicker"></mat-datepicker-toggle>
          <mat-datepicker #datePicker></mat-datepicker>
        </mat-form-field>

        <!-- With a start and end time on a multi-day item, the end date moves down between the two times. -->
        <ng-container *ngIf="formData.multiDay && !endDateBetweenTimes()">
          <ng-container *ngTemplateOutlet="endDateField"></ng-container>
        </ng-container>

        <div class="chip-row" *ngIf="!formData.hasTime || (!formData.multiDay && formData.itemKind === 'event')">
          <button mat-stroked-button type="button" *ngIf="!formData.hasTime" (click)="setHasTime(true)">
            <mat-icon>schedule</mat-icon>
            Time of day
          </button>
          <button mat-stroked-button type="button" *ngIf="!formData.multiDay && formData.itemKind === 'event'" (click)="setMultiDay(true)">
            <mat-icon>date_range</mat-icon>
            Multi-day
          </button>
        </div>

        <ng-container *ngIf="formData.hasTime">
          <div class="field-with-action">
            <app-time-field
              [label]="formData.hasDuration ? 'Start time' : 'Time of day'"
              [value]="formData.startTime"
              (valueChange)="onStartTimeChange($event)"></app-time-field>
            <button mat-button type="button" class="remove-action" (click)="setHasTime(false)">
              <mat-icon class="icon-remove">cancel</mat-icon>
              Cancel time-specificity
            </button>
          </div>
          <mat-checkbox class="approx-check" name="startApproximate" *ngIf="formData.hasDuration" [(ngModel)]="formData.startApproximate">~ Approximate time</mat-checkbox>

          <ng-container *ngIf="endDateBetweenTimes()">
            <ng-container *ngTemplateOutlet="endDateField"></ng-container>
          </ng-container>

          <ng-container *ngIf="formData.itemKind === 'event'">
            <div class="field-with-action" *ngIf="formData.hasDuration; else addDuration">
              <app-time-field
                label="End time"
                [value]="formData.endTime"
                (valueChange)="formData.endTime = $event"></app-time-field>
              <button mat-button type="button" class="remove-action" (click)="setHasDuration(false)">
                <mat-icon class="icon-remove">cancel</mat-icon>
                Cancel duration
              </button>
            </div>
            <mat-checkbox class="approx-check" name="endApproximate" *ngIf="formData.hasDuration" [(ngModel)]="formData.endApproximate">~ Approximate time</mat-checkbox>
            <ng-template #addDuration>
              <div class="chip-row">
                <button mat-button type="button" class="add-action" (click)="setHasDuration(true)">
                  <mat-icon class="icon-add">add_circle</mat-icon>
                  Add duration
                </button>
              </div>
            </ng-template>
          </ng-container>
        </ng-container>

        <ng-template #endDateField>
        <div class="field-with-action">
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>End date</mat-label>
            <input matInput [matDatepicker]="endPicker" name="endDate" [(ngModel)]="formData.endDate" [min]="formData.startDate" required>
            <mat-datepicker-toggle matIconSuffix [for]="endPicker"></mat-datepicker-toggle>
            <mat-datepicker #endPicker></mat-datepicker>
          </mat-form-field>
          <button mat-button type="button" class="remove-action" (click)="setMultiDay(false)">
            <mat-icon class="icon-remove">cancel</mat-icon>
            Cancel multi-day
          </button>
        </div>
        </ng-template>

        <mat-checkbox name="repeats" [(ngModel)]="formData.repeats"><span class="scope-label"><mat-icon>event_repeat</mat-icon>Repeats</span></mat-checkbox>
        <ng-container *ngIf="formData.repeats">
          <div class="time-row repeat-row">
            <span class="repeat-label">Every</span>
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="repeat-interval">
              <mat-label>Number</mat-label>
              <input matInput type="number" min="1" step="1" name="repeatInterval" [(ngModel)]="formData.repeatInterval">
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Unit</mat-label>
              <mat-select name="repeatUnit" [(ngModel)]="formData.repeatUnit">
                <mat-option value="day">{{ formData.repeatInterval == 1 ? 'day' : 'days' }}</mat-option>
                <mat-option value="week">{{ formData.repeatInterval == 1 ? 'week' : 'weeks' }}</mat-option>
                <mat-option value="month">{{ formData.repeatInterval == 1 ? 'month' : 'months' }}</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
          <p class="kind-hint">{{ repeatSummary() }}</p>
        </ng-container>

        <ng-container *ngIf="formData.itemKind === 'task'">
          <button mat-stroked-button type="button" *ngIf="formData.pushAlertTime === null; else alertField" (click)="formData.pushAlertTime = '17:00'">
            <mat-icon>notifications</mat-icon>
            Add notification
          </button>
          <ng-template #alertField>
            <div class="field-with-action">
              <app-time-field
                label="Push alert if not complete by"
                [value]="formData.pushAlertTime!"
                (valueChange)="formData.pushAlertTime = $event"></app-time-field>
              <button mat-button type="button" class="remove-action" (click)="formData.pushAlertTime = null">
                <mat-icon class="icon-remove">cancel</mat-icon>
                Remove notification
              </button>
            </div>
            <p class="kind-hint">
              {{ formData.scope === 'private' ? 'Only you are' : 'Whole family is' }} alerted if not checked off by this time.
            </p>
          </ng-template>
        </ng-container>

        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full-width" *ngIf="householdService.members().length">
          <mat-label>For</mat-label>
          <mat-select name="memberId" [(ngModel)]="formData.memberId">
            <mat-option [value]="null">Whole household</mat-option>
            <mat-option *ngFor="let member of householdService.members()" [value]="member.id">
              {{ member.name }}
            </mat-option>
          </mat-select>
          <mat-icon matPrefix>person</mat-icon>
        </mat-form-field>

        <mat-radio-group class="kind-group" name="scope" [(ngModel)]="formData.scope" [disabled]="!canChangeScope()">
          <mat-radio-button value="private"><span class="scope-label"><mat-icon>lock_person</mat-icon>Private</span></mat-radio-button>
          <mat-radio-button value="family"><span class="scope-label"><mat-icon>family_restroom</mat-icon>Shared with family</span></mat-radio-button>
        </mat-radio-group>
        <p class="kind-hint">
          {{ !canChangeScope()
            ? 'Only the person who created this can change who sees it.'
            : formData.scope === 'private'
              ? 'Only you can see this.'
              : 'Everyone in the family can see this.' }}
        </p>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions class="dialog-actions">
      <button mat-button color="warn" *ngIf="data.mode === 'edit'" (click)="onDelete()">
        <mat-icon>delete</mat-icon>
        Delete
      </button>
      <span class="dialog-actions-spacer"></span>
      <button mat-button (click)="onCancel()">Cancel</button>
      <button
        mat-raised-button
        color="primary"
        (click)="onSave()"
        [disabled]="!isValid()">
        <mat-icon>{{ data.mode === 'add' ? 'add' : 'save' }}</mat-icon>
        {{ data.mode === 'add' ? 'Add item' : 'Save Changes' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-form {
      display: flex;
      flex-direction: column;
      gap: 10px;
      min-width: 400px;
      max-width: 100%;
      box-sizing: border-box;
      padding: 6px 0;

      /* Compact: shorter inputs and dense buttons/checkboxes throughout the form. */
      --mat-form-field-container-height: 40px;
      --mat-form-field-container-vertical-padding: 8px;
      --mdc-text-button-container-height: 40px;
      --mdc-outlined-button-container-height: 40px;
      --mdc-checkbox-state-layer-size: 32px;

      // Small screens: no fixed minimum — the dialog is already narrower than 400px there, and a
      // minimum wider than its content area is what pushed the form past the screen edge.
      @media (max-width: 600px) {
        min-width: 0;
      }
    }

    .full-width {
      width: 100%;
    }

    .title-field {
      margin-bottom: 8px;
    }

    // One connected button bar: the Event/Task toggle plus the Google/Outlook links, sharing a
    // single outline and rounded ends, with a divider between each segment.
    .kind-row {
      --kind-bar-border: var(--mat-standard-button-toggle-divider-color, rgba(0, 0, 0, 0.12));
      display: inline-flex;
      align-items: stretch;
      align-self: flex-start;
      border: 1px solid var(--kind-bar-border);
      border-radius: 4px;
      overflow: hidden;
      max-width: 100%;

      // Narrow screens: tighter segments and no link icons, so all four still fit in one bar.
      @media (max-width: 420px) {
        .external-btn {
          padding: 0 8px;

          mat-icon {
            display: none;
          }
        }
      }
    }

    .item-kind-toggle {
      border: 0;
      border-radius: 0;
    }

    .external-btn {
      display: inline-flex;
      align-items: center;
      padding: 0 12px;
      border-left: 1px solid var(--kind-bar-border);
      text-decoration: none;
      white-space: nowrap;
      cursor: pointer;
      // The same type and colors the Event/Task toggles use.
      color: var(--mat-standard-button-toggle-text-color);
      background-color: var(--mat-standard-button-toggle-background-color);
      font-family: var(--mat-standard-button-toggle-label-text-font);
      font-size: var(--mat-standard-button-toggle-label-text-size);
      line-height: var(--mat-standard-button-toggle-height);
      font-weight: var(--mat-standard-button-toggle-label-text-weight);
      letter-spacing: var(--mat-standard-button-toggle-label-text-tracking);

      &:hover {
        background: rgba(0, 0, 0, 0.04);
      }

      mat-icon {
        margin-left: 4px;
        font-size: 16px;
        width: 16px;
        height: 16px;
        line-height: 16px;
      }
    }

    .kind-group {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }

    .kind-hint {
      margin: -4px 0 0;
      font-size: 0.8rem;
      color: var(--color-text-secondary);
    }

    .time-row {
      display: flex;
      align-items: center;
      gap: 8px;

      mat-form-field {
        flex: 1;
        min-width: 0;
      }
    }

    // A field with a button beside it (e.g. a time + "Cancel time-specificity"): when the row is
    // too narrow, the button drops below the field instead of squeezing or overflowing it.
    .field-with-action {
      display: flex;
      flex-wrap: wrap;
      align-items: flex-end;
      gap: 8px;

      mat-form-field,
      app-time-field {
        flex: 1 1 180px;
        min-width: 0;
      }

      .remove-action {
        flex: none;
      }
    }

    .chip-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
    }

    .approx-check {
      margin: -10px 0 0;
      font-size: 0.85rem;
    }

    .icon-remove {
      color: #d32f2f;
    }

    .icon-add {
      color: #2e7d32;
    }

    .scope-label {
      display: inline-flex;
      align-items: center;
      gap: 6px;

      mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }
    }

    .repeat-row {
      .repeat-label {
        padding-bottom: 0;
      }

      .repeat-interval {
        flex: 0 0 96px;
      }
    }

    .dialog-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px 8px;
      width: 100%;
    }

    .dialog-actions-spacer {
      flex: 1;
    }

    h2[mat-dialog-title] {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 12px 12px 0 16px;

      mat-icon {
        color: var(--color-primary);
      }
    }
  `]
})
export class CalendarEventDialogComponent {
  formData: {
    itemKind: CalendarItemKind;
    title: string;
    /** Off = all day. On without a duration = a point in time. */
    hasTime: boolean;
    hasDuration: boolean;
    multiDay: boolean;
    startDate: Date;
    endDate: Date;
    startTime: string;
    endTime: string;
    startApproximate: boolean;
    endApproximate: boolean;
    repeats: boolean;
    repeatInterval: number;
    repeatUnit: RepeatUnit;
    memberId: string | null;
    scope: Scope;
    /** "HH:mm" for a task's not-done-yet push alert, or null for none. */
    pushAlertTime: string | null;
  };

  constructor(
    public dialogRef: MatDialogRef<CalendarEventDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CalendarEventDialogData,
    public householdService: HouseholdService,
    private authService: AuthService
  ) {
    const event = data.event;
    if (event) {
      const isAllDay = !!event.start.date && !event.start.dateTime;
      const startDate = event.start.dateTime ? new Date(event.start.dateTime) : this.parseIsoDate(event.start.date!);
      let endDate = startDate;
      if (event.end.dateTime) {
        endDate = new Date(event.end.dateTime);
      } else if (event.end.date) {
        // An all-day end.date is exclusive (the day after the last day).
        endDate = this.parseIsoDate(event.end.date);
        endDate.setDate(endDate.getDate() - 1);
        if (endDate < startDate) endDate = startDate;
      }
      this.formData = {
        itemKind: event.kind ?? 'event',
        title: event.summary,
        hasTime: !isAllDay,
        hasDuration: !isAllDay && !event.isPointInTime,
        multiDay: this.dateOnly(endDate) > this.dateOnly(startDate),
        startDate: this.dateOnly(startDate),
        endDate: this.dateOnly(endDate),
        startTime: event.start.dateTime ? this.toTimeValue(startDate) : '09:00',
        endTime: event.end.dateTime ? this.toTimeValue(endDate) : '10:00',
        startApproximate: !!event.startApproximate,
        endApproximate: !!event.endApproximate,
        repeats: !!event.repeat,
        repeatInterval: event.repeat?.interval ?? 1,
        repeatUnit: event.repeat?.unit ?? 'week',
        memberId: event.memberId ?? null,
        scope: event.isPrivate ? 'private' : 'family',
        pushAlertTime: event.pushAlertTime ?? null
      };
    } else {
      const day = this.dateOnly(data.defaultDate || new Date());
      this.formData = {
        itemKind: 'event',
        title: '',
        // All day on the day being viewed, private to the creator, unless the user says otherwise.
        hasTime: false,
        hasDuration: false,
        multiDay: false,
        startDate: day,
        endDate: day,
        startTime: '09:00',
        endTime: '10:00',
        startApproximate: false,
        endApproximate: false,
        repeats: false,
        repeatInterval: 1,
        repeatUnit: 'week',
        memberId: this.householdService.myMemberId(),
        scope: 'private',
        pushAlertTime: null
      };
    }
  }

  /**
   * Who sees an item is fixed to its creator's account, so only the creator can flip it —
   * anyone else switching a shared item to private would lock themselves out of it.
   */
  canChangeScope(): boolean {
    if (this.data.mode === 'add') return true;
    const creator = this.data.event?.createdByUid;
    return !creator || creator === this.authService.currentUser()?.uid;
  }

  onItemKindChange(kind: CalendarItemKind): void {
    this.formData.itemKind = kind;
    // Tasks have no duration or multi-day span, so drop them rather than keep hidden state.
    if (kind === 'task') {
      this.formData.hasDuration = false;
      this.setMultiDay(false);
    }
  }

  endDateBetweenTimes(): boolean {
    const f = this.formData;
    return f.multiDay && f.hasTime && f.hasDuration;
  }

  setHasTime(on: boolean): void {
    const f = this.formData;
    f.hasTime = on;
    if (on) {
      f.hasDuration = f.itemKind === 'event';
      if (f.hasDuration) this.setEndOneHourAfterStart();
    } else {
      f.hasDuration = false;
    }
  }

  setHasDuration(on: boolean): void {
    this.formData.hasDuration = on;
    if (on) this.setEndOneHourAfterStart();
  }

  setMultiDay(on: boolean): void {
    const f = this.formData;
    f.multiDay = on;
    if (on) {
      if (f.endDate <= f.startDate) f.endDate = this.addDays(f.startDate, 1);
    } else {
      f.endDate = f.startDate;
    }
  }

  onStartTimeChange(value: string): void {
    this.formData.startTime = value;
    if (this.formData.hasDuration) this.setEndOneHourAfterStart();
  }

  onStartDateChange(): void {
    const f = this.formData;
    if (!f.startDate) return;
    // Keep the end from landing before the start when the start moves later.
    if (!f.multiDay || f.endDate < f.startDate) {
      f.endDate = f.startDate;
    }
  }

  /** The end time follows the start (one hour later); running past midnight makes the item multi-day. */
  private setEndOneHourAfterStart(): void {
    const f = this.formData;
    if (!f.startDate || !f.startTime) return;
    const end = new Date(this.combine(f.startDate, f.startTime).getTime() + 60 * 60 * 1000);
    f.endTime = this.toTimeValue(end);
    if (!f.multiDay) {
      f.endDate = f.startDate;
      if (this.dateOnly(end) > f.startDate) {
        f.multiDay = true;
        f.endDate = this.dateOnly(end);
      }
    }
  }

  /** e.g. "Repeats every week on Tuesday" — the weekday/day-of-month comes from the start date. */
  repeatSummary(): string {
    const { repeatInterval, repeatUnit, startDate } = this.formData;
    const n = Number(repeatInterval);
    if (!startDate || !n || n < 1) return '';
    const every = n === 1 ? `every ${repeatUnit}` : `every ${n} ${repeatUnit}s`;
    if (repeatUnit === 'week') return `Repeats ${every} on ${WEEKDAY_NAMES[startDate.getDay()]}.`;
    if (repeatUnit === 'month') return `Repeats ${every} on day ${startDate.getDate()}.`;
    return `Repeats ${every}.`;
  }

  isValid(): boolean {
    const f = this.formData;
    if (!f.title.trim() || !f.startDate) return false;
    if (f.repeats && !(Number.isInteger(Number(f.repeatInterval)) && Number(f.repeatInterval) >= 1)) return false;
    if (f.multiDay && (!f.endDate || f.endDate < f.startDate)) return false;
    if (!f.hasTime) return true;
    if (!f.startTime) return false;
    if (!f.hasDuration) return true;
    if (!f.endTime) return false;
    return this.combine(f.multiDay ? f.endDate : f.startDate, f.endTime) > this.combine(f.startDate, f.startTime);
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    if (!this.isValid()) return;
    const result: CalendarEventDialogResult = { action: 'save', event: this.buildResult() };
    this.dialogRef.close(result);
  }

  onDelete(): void {
    if (!confirm(`Delete "${this.formData.title || 'this item'}"?`)) return;
    const result: CalendarEventDialogResult = { action: 'delete' };
    this.dialogRef.close(result);
  }

  private dateOnly(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
  }

  private addDays(d: Date, days: number): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
  }

  private parseIsoDate(iso: string): Date {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  private toIsoDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  private toTimeValue(d: Date): string {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  /** The form's date/time as a range for another calendar's "new event" page. */
  private externalEventRange(): { allDay: boolean; start: Date; end: Date } {
    const f = this.formData;
    if (!f.hasTime) {
      // An all-day end is exclusive (the day after the last day), like Google Calendar's.
      return { allDay: true, start: f.startDate, end: this.addDays(f.multiDay ? f.endDate : f.startDate, 1) };
    }
    const start = this.combine(f.startDate, f.startTime);
    const end = f.hasDuration
      ? this.combine(f.multiDay ? f.endDate : f.startDate, f.endTime)
      : new Date(start.getTime() + 60 * 60 * 1000);
    return { allDay: false, start, end };
  }

  /** Opens Google Calendar's new-event form, prefilled with this form's title and date/time. */
  googleEventUrl(): string {
    const { allDay, start, end } = this.externalEventRange();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ymd = (d: Date) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
    const stamp = (d: Date) => `${ymd(d)}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
    const params = new URLSearchParams({
      action: 'TEMPLATE',
      text: this.formData.title.trim(),
      dates: allDay ? `${ymd(start)}/${ymd(end)}` : `${stamp(start)}/${stamp(end)}`
    });
    return `https://calendar.google.com/calendar/render?${params.toString()}`;
  }

  /** Opens Outlook's new-event form, prefilled with this form's title and date/time. */
  outlookEventUrl(): string {
    const { allDay, start, end } = this.externalEventRange();
    const pad = (n: number) => String(n).padStart(2, '0');
    const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const stamp = (d: Date) => `${ymd(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
    const params = new URLSearchParams({
      path: '/calendar/action/compose',
      rru: 'addevent',
      subject: this.formData.title.trim(),
      startdt: allDay ? ymd(start) : stamp(start),
      enddt: allDay ? ymd(end) : stamp(end),
      allday: String(allDay)
    });
    return `https://outlook.office.com/calendar/0/deeplink/compose?${params.toString()}`;
  }

  /** A local date plus an "HH:mm" time → a Date. */
  private combine(date: Date, time: string): Date {
    const [h, m] = time.split(':').map(Number);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), h, m, 0);
  }

  private buildResult(): AppCalendarEventFormResult {
    const f = this.formData;
    const summary = f.title.trim();
    const isEdit = this.data.mode === 'edit';

    let result: AppCalendarEventFormResult;
    if (!f.hasTime) {
      const date = this.toIsoDate(f.startDate);
      const lastDate = f.multiDay ? this.toIsoDate(f.endDate) : date;
      // end.date is exclusive (the day after the last day), like Google Calendar.
      result = { summary, start: { date }, end: { date: nextDayIso(lastDate) } };
    } else {
      const startIso = this.combine(f.startDate, f.startTime).toISOString();
      if (!f.hasDuration) {
        result = { summary, start: { dateTime: startIso }, end: { dateTime: startIso } };
      } else {
        const endIso = this.combine(f.multiDay ? f.endDate : f.startDate, f.endTime).toISOString();
        result = { summary, start: { dateTime: startIso }, end: { dateTime: endIso } };
      }
    }

    result.kind = f.itemKind;
    // Always written (true or false) so every item states its visibility explicitly.
    result.isPrivate = f.scope === 'private';

    // Editing must explicitly clear a field that's no longer set, not just omit it —
    // Firestore's partial update only touches keys present in the payload, and assigning
    // `undefined` here becomes a real field delete (see FirestoreService.updateDocument).
    // Adding has nothing to clear yet, and Firestore's create path rejects literal
    // `undefined` values outright, so a falsy field is simply left off the new document.
    this.setOptionalField(result, 'isPointInTime', true, f.hasTime && !f.hasDuration, isEdit);
    this.setOptionalField(result, 'startApproximate', true, f.hasTime && f.hasDuration && f.startApproximate, isEdit);
    this.setOptionalField(result, 'endApproximate', true, f.hasTime && f.hasDuration && f.endApproximate, isEdit);
    this.setOptionalField(result, 'memberId', f.memberId as string, !!f.memberId, isEdit);
    this.setOptionalField(result, 'pushAlertTime', f.pushAlertTime as string, f.itemKind === 'task' && !!f.pushAlertTime, isEdit);
    this.setOptionalField(
      result, 'repeat', { unit: f.repeatUnit, interval: Number(f.repeatInterval) }, f.repeats, isEdit
    );

    return result;
  }

  private setOptionalField<K extends keyof AppCalendarEventFormResult>(
    result: AppCalendarEventFormResult,
    key: K,
    value: AppCalendarEventFormResult[K],
    condition: boolean,
    isEdit: boolean
  ): void {
    if (condition) {
      result[key] = value;
    } else if (isEdit) {
      result[key] = undefined as AppCalendarEventFormResult[K];
    }
  }
}
