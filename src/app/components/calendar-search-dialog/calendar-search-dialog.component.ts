import { ChangeDetectionStrategy, Component, Inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { CalendarEvent } from '../../services/google-calendar.service';
import { nextOccurrenceOnOrAfter } from '../../utils/recurrence';

export interface CalendarSearchData {
  /** Every event from every calendar, whether or not its calendar is currently shown. */
  events: CalendarEvent[];
  colorFor: (event: CalendarEvent) => string;
}

/** What the dialog closes with: the chosen event and the day to show it on. */
export interface CalendarSearchResult {
  event: CalendarEvent;
  date: Date;
}

interface SearchRow {
  event: CalendarEvent;
  date: Date;
  color: string;
  dateLabel: string;
  timeLabel: string;
}

const MAX_RESULTS = 50;

/** Search box over all calendar items; picking one closes the dialog with where to find it. */
@Component({
  selector: 'app-calendar-search-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatIconModule, MatButtonModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="search-box">
      <mat-icon>search</mat-icon>
      <input
        type="search"
        cdkFocusInitial
        placeholder="Search all calendars"
        aria-label="Search all calendars"
        autocomplete="off"
        [ngModel]="query()"
        (ngModelChange)="query.set($event)"
        (keydown.enter)="results()[0] && choose(results()[0])" />
      <button mat-icon-button type="button" mat-dialog-close aria-label="Close"><mat-icon>close</mat-icon></button>
    </div>

    <mat-dialog-content class="search-results">
      <p class="hint" *ngIf="!trimmed()">Search by title, location or notes.</p>
      <p class="hint" *ngIf="trimmed() && !results().length">No matching items.</p>
      <button type="button" class="result" *ngFor="let row of results()" (click)="choose(row)">
        <span class="swatch" [style.backgroundColor]="row.color"></span>
        <span class="text">
          <span class="title">{{ row.event.summary }}</span>
          <span class="meta">
            {{ row.dateLabel }} · {{ row.timeLabel }}
            <mat-icon *ngIf="row.event.repeat" class="repeat" aria-label="Repeats">repeat</mat-icon>
          </span>
        </span>
      </button>
      <p class="hint" *ngIf="capped()">Showing the first {{ max }} matches — keep typing to narrow it down.</p>
    </mat-dialog-content>
  `,
  styles: [`
    :host { display: block; }
    .search-box { display: flex; align-items: center; gap: 8px; padding: 12px 12px 8px 20px; }
    .search-box mat-icon { color: var(--color-text-secondary); flex-shrink: 0; }
    .search-box input {
      flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
      font: inherit; font-size: 1.1rem; color: inherit; padding: 8px 0;
    }
    .search-results { min-height: 80px; max-height: 60vh; padding: 0 12px 12px; }
    .hint { margin: 12px 8px; color: var(--color-text-secondary); font-size: 0.9rem; }
    .result {
      display: flex; align-items: center; gap: 12px; width: 100%; text-align: left;
      border: 0; border-radius: 8px; background: transparent; color: inherit; font: inherit;
      padding: 10px 8px; cursor: pointer;
    }
    .result:hover, .result:focus-visible { background: rgba(127, 127, 127, 0.14); outline: 0; }
    .swatch { width: 6px; align-self: stretch; border-radius: 3px; flex-shrink: 0; }
    .text { display: flex; flex-direction: column; min-width: 0; }
    .title { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .meta { display: flex; align-items: center; gap: 4px; font-size: 0.85rem; color: var(--color-text-secondary); }
    .repeat { font-size: 16px; width: 16px; height: 16px; }
  `]
})
export class CalendarSearchDialogComponent {
  readonly max = MAX_RESULTS;
  query = signal('');
  trimmed = computed(() => this.query().trim().toLowerCase());

  private matches = computed<SearchRow[]>(() => {
    const q = this.trimmed();
    if (!q) return [];
    const today = new Date();
    const rows: SearchRow[] = [];
    for (const event of this.data.events) {
      const haystack = `${event.summary ?? ''}\n${event.location ?? ''}\n${event.description ?? ''}`.toLowerCase();
      if (!haystack.includes(q)) continue;
      const date = nextOccurrenceOnOrAfter(event, today);
      if (!date) continue;
      rows.push({
        event,
        date,
        color: this.data.colorFor(event),
        dateLabel: this.formatDate(date, today, !!event.repeat),
        timeLabel: this.formatTime(event)
      });
    }
    // Soonest first from today, then what's already passed, most recent first.
    const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
    const rank = (r: SearchRow) => (r.date.getTime() >= startOfToday ? 0 : 1);
    return rows.sort((a, b) =>
      rank(a) - rank(b) || (rank(a) === 0 ? a.date.getTime() - b.date.getTime() : b.date.getTime() - a.date.getTime()));
  });

  results = computed(() => this.matches().slice(0, MAX_RESULTS));
  capped = computed(() => this.matches().length > MAX_RESULTS);

  constructor(
    @Inject(MAT_DIALOG_DATA) private data: CalendarSearchData,
    private dialogRef: MatDialogRef<CalendarSearchDialogComponent, CalendarSearchResult>
  ) {}

  choose(row: SearchRow): void {
    this.dialogRef.close({ event: row.event, date: row.date });
  }

  private formatDate(date: Date, today: Date, repeats: boolean): string {
    const label = date.toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric',
      ...(date.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {})
    });
    return repeats ? `Next: ${label}` : label;
  }

  private formatTime(event: CalendarEvent): string {
    if (!event.start.dateTime) return 'All day';
    return new Date(event.start.dateTime).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
}
