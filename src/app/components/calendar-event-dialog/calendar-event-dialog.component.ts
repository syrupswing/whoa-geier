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

type TimeType = 'timed' | 'all-day' | 'point';
type Scope = 'private' | 'family';
type RepeatUnit = RepeatRule['unit'];

interface TimeOption {
  value: string;
  label: string;
}

const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** "HH:mm" → "9:05 AM". */
function timeLabel(value: string): string {
  const [h, m] = value.split(':').map(Number);
  const suffix = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`;
}

/** Every 15 minutes across the day. */
function buildTimeOptions(): TimeOption[] {
  const options: TimeOption[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += 15) {
    const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
    options.push({ value, label: timeLabel(value) });
  }
  return options;
}

/**
 * Add/edit form for app-native calendar items (stored in Firestore, merged alongside Google
 * Calendar events since this app only has read access there). An item is either an Event
 * (timing only) or a Task (can be completed). Both can be all-day (the default), point-in-time,
 * or — events only — timed, including across several days; both can repeat, and both are
 * private to their creator (the default) or shared with the family.
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
    MatNativeDateModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>{{ formData.itemKind === 'task' ? 'task_alt' : 'event' }}</mat-icon>
      {{ data.mode === 'add' ? 'Add item' : 'Edit item' }}
    </h2>

    <mat-dialog-content>
      <div class="dialog-form">
        <mat-button-toggle-group
          class="item-kind-toggle"
          name="itemKind"
          [ngModel]="formData.itemKind"
          (ngModelChange)="onItemKindChange($event)"
          aria-label="Item type">
          <mat-button-toggle value="event">Event</mat-button-toggle>
          <mat-button-toggle value="task">Task</mat-button-toggle>
        </mat-button-toggle-group>
        <p class="kind-hint" *ngIf="formData.itemKind === 'task'">
          A task can be checked off. It can be all day or at a specific time.
        </p>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Title</mat-label>
          <input
            matInput
            name="title"
            [(ngModel)]="formData.title"
            [placeholder]="formData.itemKind === 'task' ? 'e.g., Renew car registration' : 'e.g., Dentist appointment'"
            required>
          <mat-icon matPrefix>title</mat-icon>
        </mat-form-field>

        <mat-radio-group class="kind-group" name="timeType" [(ngModel)]="formData.timeType">
          <mat-radio-button value="all-day">All day</mat-radio-button>
          <mat-radio-button value="timed" *ngIf="formData.itemKind === 'event'">Timed</mat-radio-button>
          <mat-radio-button value="point">Point in time</mat-radio-button>
        </mat-radio-group>
        <p class="kind-hint" *ngIf="formData.timeType === 'point'">
          A specific moment with no duration — a flight departure, a reminder to call someone.
        </p>

        <!-- All day and point in time: one date (plus one time for a point). -->
        <div class="time-row" *ngIf="formData.timeType !== 'timed'">
          <mat-form-field appearance="outline">
            <mat-label>Date</mat-label>
            <input matInput [matDatepicker]="datePicker" name="startDate" [(ngModel)]="formData.startDate" (dateChange)="onStartDateChange()" required>
            <mat-datepicker-toggle matIconSuffix [for]="datePicker"></mat-datepicker-toggle>
            <mat-datepicker #datePicker></mat-datepicker>
          </mat-form-field>
          <mat-form-field appearance="outline" *ngIf="formData.timeType === 'point'">
            <mat-label>Time</mat-label>
            <mat-select name="startTime" [(ngModel)]="formData.startTime" required>
              <mat-option *ngFor="let t of timeOptions" [value]="t.value">{{ t.label }}</mat-option>
            </mat-select>
          </mat-form-field>
        </div>

        <!-- Timed: a start and an end, each with its own date so it can span several days. -->
        <ng-container *ngIf="formData.timeType === 'timed'">
          <div class="time-row">
            <mat-form-field appearance="outline">
              <mat-label>Start date</mat-label>
              <input matInput [matDatepicker]="startPicker" name="startDate" [(ngModel)]="formData.startDate" (dateChange)="onStartDateChange()" required>
              <mat-datepicker-toggle matIconSuffix [for]="startPicker"></mat-datepicker-toggle>
              <mat-datepicker #startPicker></mat-datepicker>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Start time</mat-label>
              <mat-select name="startTime" [(ngModel)]="formData.startTime" required>
                <mat-option *ngFor="let t of timeOptions" [value]="t.value">{{ t.label }}</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
          <mat-checkbox name="startApproximate" [(ngModel)]="formData.startApproximate">~ Start time is approximate</mat-checkbox>
          <div class="time-row">
            <mat-form-field appearance="outline">
              <mat-label>End date</mat-label>
              <input matInput [matDatepicker]="endPicker" name="endDate" [(ngModel)]="formData.endDate" [min]="formData.startDate" required>
              <mat-datepicker-toggle matIconSuffix [for]="endPicker"></mat-datepicker-toggle>
              <mat-datepicker #endPicker></mat-datepicker>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>End time</mat-label>
              <mat-select name="endTime" [(ngModel)]="formData.endTime" required>
                <mat-option *ngFor="let t of timeOptions" [value]="t.value">{{ t.label }}</mat-option>
              </mat-select>
            </mat-form-field>
          </div>
          <mat-checkbox name="endApproximate" [(ngModel)]="formData.endApproximate">~ End time is approximate</mat-checkbox>
        </ng-container>

        <mat-checkbox name="repeats" [(ngModel)]="formData.repeats">Repeats</mat-checkbox>
        <ng-container *ngIf="formData.repeats">
          <div class="time-row repeat-row">
            <span class="repeat-label">Every</span>
            <mat-form-field appearance="outline" class="repeat-interval">
              <mat-label>Number</mat-label>
              <input matInput type="number" min="1" step="1" name="repeatInterval" [(ngModel)]="formData.repeatInterval">
            </mat-form-field>
            <mat-form-field appearance="outline">
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

        <mat-form-field appearance="outline" class="full-width" *ngIf="householdService.members().length">
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
          <mat-radio-button value="private">Private</mat-radio-button>
          <mat-radio-button value="family">Shared with family</mat-radio-button>
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
      gap: 16px;
      min-width: 400px;
      padding: 16px 0;

      @media (max-width: 600px) {
        min-width: 280px;
      }
    }

    .full-width {
      width: 100%;
    }

    .item-kind-toggle {
      align-self: flex-start;
    }

    .kind-group {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
    }

    .kind-hint {
      margin: -8px 0 0;
      font-size: 0.8rem;
      color: var(--color-text-secondary);
    }

    .time-row {
      display: flex;
      align-items: center;
      gap: 16px;

      mat-form-field {
        flex: 1;
        min-width: 0;
      }
    }

    .repeat-row {
      .repeat-label {
        padding-bottom: 22px;
      }

      .repeat-interval {
        flex: 0 0 96px;
      }
    }

    .dialog-actions {
      display: flex;
      align-items: center;
      width: 100%;
    }

    .dialog-actions-spacer {
      flex: 1;
    }

    h2[mat-dialog-title] {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 16px 12px 0 16px;

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
    timeType: TimeType;
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
  };

  timeOptions: TimeOption[] = buildTimeOptions();

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
      const endDate = event.end.dateTime ? new Date(event.end.dateTime) : startDate;
      this.formData = {
        itemKind: event.kind ?? 'event',
        title: event.summary,
        timeType: isAllDay ? 'all-day' : (event.isPointInTime ? 'point' : 'timed'),
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
        scope: event.isPrivate ? 'private' : 'family'
      };
    } else {
      const day = this.dateOnly(data.defaultDate || new Date());
      this.formData = {
        itemKind: 'event',
        title: '',
        // All day on the day being viewed, private to the creator, unless the user says otherwise.
        timeType: 'all-day',
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
        scope: 'private'
      };
    }

    // An existing time that isn't on the 15-minute grid still needs to be selectable.
    [this.formData.startTime, this.formData.endTime].forEach(value => this.ensureTimeOption(value));
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
    // Tasks can't be timed (yet), so fall back to all day rather than keep a hidden option selected.
    if (kind === 'task' && this.formData.timeType === 'timed') {
      this.formData.timeType = 'all-day';
    }
  }

  onStartDateChange(): void {
    // Keep the end from landing before the start when the start moves later.
    if (this.formData.startDate && this.formData.endDate < this.formData.startDate) {
      this.formData.endDate = this.formData.startDate;
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
    if (f.timeType === 'all-day') return true;
    if (!f.startTime) return false;
    if (f.timeType === 'point') return true;
    if (!f.endDate || !f.endTime) return false;
    return this.combine(f.endDate, f.endTime) > this.combine(f.startDate, f.startTime);
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

  private ensureTimeOption(value: string): void {
    if (value && !this.timeOptions.some(t => t.value === value)) {
      this.timeOptions = [...this.timeOptions, { value, label: timeLabel(value) }]
        .sort((a, b) => a.value.localeCompare(b.value));
    }
  }

  private dateOnly(d: Date): Date {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
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
    if (f.timeType === 'all-day') {
      const date = this.toIsoDate(f.startDate);
      // end.date is exclusive (the day after), like Google Calendar.
      result = { summary, start: { date }, end: { date: nextDayIso(date) } };
    } else {
      const startIso = this.combine(f.startDate, f.startTime).toISOString();
      if (f.timeType === 'point') {
        result = { summary, start: { dateTime: startIso }, end: { dateTime: startIso } };
      } else {
        const endIso = this.combine(f.endDate, f.endTime).toISOString();
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
    this.setOptionalField(result, 'isPointInTime', true, f.timeType === 'point', isEdit);
    this.setOptionalField(result, 'startApproximate', true, f.timeType === 'timed' && f.startApproximate, isEdit);
    this.setOptionalField(result, 'endApproximate', true, f.timeType === 'timed' && f.endApproximate, isEdit);
    this.setOptionalField(result, 'memberId', f.memberId as string, !!f.memberId, isEdit);
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
