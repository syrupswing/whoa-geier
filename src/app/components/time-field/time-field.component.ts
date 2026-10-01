import { Component, EventEmitter, Input, OnChanges, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';

interface TimeOption {
  value: string;
  label: string;
}

/** "HH:mm" → "9:05 AM". */
function timeLabel(value: string): string {
  const [h, m] = value.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}

/** Every 15 minutes across the day. */
const TIME_OPTIONS: TimeOption[] = Array.from({ length: 96 }, (_, i) => {
  const minutes = i * 15;
  const value = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  return { value, label: timeLabel(value) };
});

/**
 * A time-of-day field bound to an "HH:mm" string. The hour, minute and AM/PM segments can each be
 * typed into (so any exact minute works), and the arrow opens a list of 15-minute choices.
 */
@Component({
  selector: 'app-time-field',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatMenuModule],
  template: `
    <div class="time-field" [class.is-disabled]="disabled">
      <span class="time-field-label">{{ label }}</span>
      <div class="time-field-box">
        <mat-icon class="time-field-icon">schedule</mat-icon>
        <input
          class="seg seg-hour"
          type="text"
          inputmode="numeric"
          maxlength="2"
          autocomplete="off"
          [attr.aria-label]="label + ' hour'"
          [value]="hourText"
          [disabled]="disabled"
          (focus)="$any($event.target).select()"
          (change)="onHourChange($any($event.target))"
          (keydown.enter)="$any($event.target).blur()">
        <span class="colon">:</span>
        <input
          class="seg seg-minute"
          type="text"
          inputmode="numeric"
          maxlength="2"
          autocomplete="off"
          [attr.aria-label]="label + ' minute'"
          [value]="minuteText"
          [disabled]="disabled"
          (focus)="$any($event.target).select()"
          (change)="onMinuteChange($any($event.target))"
          (keydown.enter)="$any($event.target).blur()">
        <button
          type="button"
          class="seg seg-meridiem"
          [attr.aria-label]="label + ' AM or PM'"
          [disabled]="disabled"
          (click)="toggleMeridiem()"
          (keydown)="onMeridiemKey($event)">{{ meridiem }}</button>
        <button
          type="button"
          class="menu-trigger"
          [attr.aria-label]="'Choose ' + label.toLowerCase()"
          [disabled]="disabled"
          [matMenuTriggerFor]="timeMenu"
          (menuOpened)="scrollToSelected()">
          <mat-icon>arrow_drop_down</mat-icon>
        </button>
      </div>
    </div>

    <mat-menu #timeMenu="matMenu" class="time-field-menu">
      <button
        mat-menu-item
        *ngFor="let t of options"
        [class.is-selected]="t.value === value"
        (click)="select(t.value)">{{ t.label }}</button>
    </mat-menu>
  `,
  styles: [`
    :host {
      display: block;
    }

    .time-field-label {
      display: block;
      margin: 0 0 2px 4px;
      font-size: 0.7rem;
      color: var(--color-text-secondary);
    }

    .time-field-box {
      display: flex;
      align-items: center;
      gap: 2px;
      height: 40px;
      padding: 0 4px 0 12px;
      border: 1px solid rgba(0, 0, 0, 0.38);
      border-radius: 4px;
      box-sizing: border-box;

      &:hover {
        border-color: rgba(0, 0, 0, 0.87);
      }

      &:focus-within {
        border-color: var(--color-primary);
        box-shadow: 0 0 0 1px var(--color-primary);
      }
    }

    .is-disabled .time-field-box {
      opacity: 0.5;
    }

    .time-field-icon {
      margin-right: 6px;
      font-size: 20px;
      width: 20px;
      height: 20px;
      color: var(--color-text-secondary);
    }

    .seg {
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: inherit;
      font: inherit;
      text-align: center;
      padding: 4px 0;
      outline: none;

      &:focus {
        background: rgba(0, 0, 0, 0.08);
      }
    }

    .seg-hour,
    .seg-minute {
      width: 2ch;
      box-sizing: content-box;
      padding: 4px 4px;
    }

    .seg-meridiem {
      min-width: 2.6ch;
      margin-left: 4px;
      padding: 4px 6px;
      cursor: pointer;
    }

    .menu-trigger {
      display: flex;
      align-items: center;
      margin-left: auto;
      padding: 0;
      border: 0;
      border-radius: 50%;
      background: transparent;
      color: var(--color-text-secondary);
      cursor: pointer;
    }
  `]
})
export class TimeFieldComponent implements OnChanges {
  @Input() label = 'Time';
  /** "HH:mm" (24-hour). */
  @Input() value = '09:00';
  @Input() disabled = false;
  @Output() valueChange = new EventEmitter<string>();

  options = TIME_OPTIONS;
  hourText = '';
  minuteText = '';
  meridiem: 'AM' | 'PM' = 'AM';

  ngOnChanges(): void {
    this.syncFromValue();
  }

  onHourChange(input: HTMLInputElement): void {
    const parsed = parseInt(input.value, 10);
    if (!isNaN(parsed)) {
      const hour12 = Math.min(Math.max(parsed, 1), 12);
      this.emit(hour12, this.currentMinute(), this.meridiem);
    }
    this.syncFromValue();
    input.value = this.hourText;
  }

  onMinuteChange(input: HTMLInputElement): void {
    const parsed = parseInt(input.value, 10);
    if (!isNaN(parsed)) {
      this.emit(this.currentHour12(), Math.min(Math.max(parsed, 0), 59), this.meridiem);
    }
    this.syncFromValue();
    input.value = this.minuteText;
  }

  toggleMeridiem(): void {
    this.emit(this.currentHour12(), this.currentMinute(), this.meridiem === 'AM' ? 'PM' : 'AM');
  }

  onMeridiemKey(event: KeyboardEvent): void {
    const key = event.key.toLowerCase();
    if (key === 'a' || key === 'p') {
      event.preventDefault();
      this.emit(this.currentHour12(), this.currentMinute(), key === 'a' ? 'AM' : 'PM');
    }
  }

  select(value: string): void {
    this.valueChange.emit(value);
  }

  scrollToSelected(): void {
    // The menu panel renders after the open event; wait a tick before looking for the selected row.
    setTimeout(() => {
      document.querySelector('.time-field-menu .is-selected')?.scrollIntoView({ block: 'center' });
    });
  }

  private currentHour12(): number {
    const [h] = this.value.split(':').map(Number);
    return h % 12 || 12;
  }

  private currentMinute(): number {
    return Number(this.value.split(':')[1]);
  }

  private emit(hour12: number, minute: number, meridiem: 'AM' | 'PM'): void {
    const hour24 = (hour12 % 12) + (meridiem === 'PM' ? 12 : 0);
    this.valueChange.emit(`${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
  }

  private syncFromValue(): void {
    const [h, m] = (this.value || '00:00').split(':').map(Number);
    this.hourText = String(h % 12 || 12);
    this.minuteText = String(m).padStart(2, '0');
    this.meridiem = h >= 12 ? 'PM' : 'AM';
  }
}
