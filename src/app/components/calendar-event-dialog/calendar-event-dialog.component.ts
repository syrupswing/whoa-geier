import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { CalendarEvent } from '../../services/google-calendar.service';

export type AppCalendarEventFormResult = Omit<CalendarEvent, 'id' | 'source'>;

export type CalendarEventDialogResult =
  | { action: 'save'; event: AppCalendarEventFormResult }
  | { action: 'delete' };

export interface CalendarEventDialogData {
  mode: 'add' | 'edit';
  /** Required for 'edit' — the app-native event being edited, used to pre-fill the form. */
  event?: CalendarEvent;
  /** Pre-fills the date field on add — typically whatever day the calendar widget is currently showing. */
  defaultDate?: Date;
}

type EventKind = 'timed' | 'all-day' | 'point';

/**
 * Add-event form for app-native calendar events (stored in Firestore, merged alongside
 * Google Calendar events since this app only has read access there). Supports three kinds:
 * a normal timed event, an all-day event, and a "point in time" event with no duration
 * (a flight departure, a reminder to call someone) — plus optional "approximate" flags on
 * a timed event's start/end for schedules that are more of an estimate than a commitment.
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
    MatIconModule,
    MatRadioModule,
    MatCheckboxModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>event</mat-icon>
      {{ data.mode === 'add' ? 'Add Event' : 'Edit Event' }}
    </h2>

    <mat-dialog-content>
      <div class="dialog-form">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Title</mat-label>
          <input
            matInput
            name="title"
            [(ngModel)]="formData.title"
            placeholder="e.g., Dentist appointment"
            required>
          <mat-icon matPrefix>title</mat-icon>
        </mat-form-field>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Date</mat-label>
          <input matInput type="date" name="date" [(ngModel)]="formData.date" required>
        </mat-form-field>

        <mat-radio-group class="kind-group" name="kind" [(ngModel)]="formData.kind">
          <mat-radio-button value="timed">Timed</mat-radio-button>
          <mat-radio-button value="all-day">All day</mat-radio-button>
          <mat-radio-button value="point">Point in time</mat-radio-button>
        </mat-radio-group>
        <p class="kind-hint" *ngIf="formData.kind === 'point'">
          A specific moment with no duration — a flight departure, a reminder to call someone.
        </p>

        <ng-container *ngIf="formData.kind === 'timed'">
          <div class="time-row">
            <mat-form-field appearance="outline">
              <mat-label>Start time</mat-label>
              <input matInput type="time" name="startTime" [(ngModel)]="formData.startTime" required>
            </mat-form-field>
            <mat-checkbox name="startApproximate" [(ngModel)]="formData.startApproximate">~ Approximate</mat-checkbox>
          </div>
          <div class="time-row">
            <mat-form-field appearance="outline">
              <mat-label>End time</mat-label>
              <input matInput type="time" name="endTime" [(ngModel)]="formData.endTime" required>
            </mat-form-field>
            <mat-checkbox name="endApproximate" [(ngModel)]="formData.endApproximate">~ Approximate</mat-checkbox>
          </div>
        </ng-container>

        <mat-form-field appearance="outline" *ngIf="formData.kind === 'point'">
          <mat-label>Time</mat-label>
          <input matInput type="time" name="pointTime" [(ngModel)]="formData.startTime" required>
        </mat-form-field>
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
        {{ data.mode === 'add' ? 'Add Event' : 'Save Changes' }}
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
    title: string;
    date: string;
    kind: EventKind;
    startTime: string;
    endTime: string;
    startApproximate: boolean;
    endApproximate: boolean;
  };

  constructor(
    public dialogRef: MatDialogRef<CalendarEventDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: CalendarEventDialogData
  ) {
    const event = data.event;
    if (event) {
      const isAllDay = !!event.start.date && !event.start.dateTime;
      const startDate = event.start.dateTime ? new Date(event.start.dateTime) : null;
      const endDate = event.end.dateTime ? new Date(event.end.dateTime) : null;
      this.formData = {
        title: event.summary,
        date: isAllDay ? event.start.date! : this.toDateInputValue(startDate!),
        kind: isAllDay ? 'all-day' : (event.isPointInTime ? 'point' : 'timed'),
        startTime: startDate ? this.toTimeInputValue(startDate) : '09:00',
        endTime: endDate ? this.toTimeInputValue(endDate) : '10:00',
        startApproximate: !!event.startApproximate,
        endApproximate: !!event.endApproximate
      };
    } else {
      this.formData = {
        title: '',
        date: this.toDateInputValue(data.defaultDate || new Date()),
        kind: 'timed',
        startTime: '09:00',
        endTime: '10:00',
        startApproximate: false,
        endApproximate: false
      };
    }
  }

  isValid(): boolean {
    if (!this.formData.title.trim() || !this.formData.date) return false;
    if (this.formData.kind === 'all-day') return true;
    if (!this.formData.startTime) return false;
    if (this.formData.kind === 'point') return true;
    return !!this.formData.endTime && this.formData.endTime > this.formData.startTime;
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
    if (!confirm(`Delete "${this.formData.title || 'this event'}"?`)) return;
    const result: CalendarEventDialogResult = { action: 'delete' };
    this.dialogRef.close(result);
  }

  private toDateInputValue(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  private toTimeInputValue(d: Date): string {
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  private buildResult(): AppCalendarEventFormResult {
    const { title, date, kind, startTime, endTime, startApproximate, endApproximate } = this.formData;
    const summary = title.trim();

    if (kind === 'all-day') {
      return { summary, start: { date }, end: { date } };
    }

    const startIso = new Date(`${date}T${startTime}:00`).toISOString();

    if (kind === 'point') {
      return { summary, start: { dateTime: startIso }, end: { dateTime: startIso }, isPointInTime: true };
    }

    const endIso = new Date(`${date}T${endTime}:00`).toISOString();
    const result: AppCalendarEventFormResult = { summary, start: { dateTime: startIso }, end: { dateTime: endIso } };
    if (startApproximate) result.startApproximate = true;
    if (endApproximate) result.endApproximate = true;
    return result;
  }
}
