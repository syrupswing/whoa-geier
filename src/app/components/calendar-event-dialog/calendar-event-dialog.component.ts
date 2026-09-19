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

export interface CalendarEventDialogData {
  /** Pre-fills the date field — typically whatever day the calendar widget is currently showing. */
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
      Add Event
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

    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button
        mat-raised-button
        color="primary"
        (click)="onSave()"
        [disabled]="!isValid()">
        <mat-icon>add</mat-icon>
        Add Event
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
    this.dialogRef.close(this.buildResult());
  }

  private toDateInputValue(d: Date): string {
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
