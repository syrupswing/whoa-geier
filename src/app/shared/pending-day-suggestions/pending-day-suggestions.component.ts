import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { DayDetectionService, PendingSuggestion } from '../../services/day-detection.service';
import { HouseholdService } from '../../services/household.service';
import { formatShortDate, formatTime12h } from '../time-format';

/** Calendar events the app thinks change a child's day (or add a note to it) but wasn't sure enough to apply — one tap to confirm or ignore. */
@Component({
  selector: 'app-pending-day-suggestions',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  templateUrl: './pending-day-suggestions.component.html',
  styleUrl: './pending-day-suggestions.component.scss'
})
export class PendingDaySuggestionsComponent {
  readonly detection = inject(DayDetectionService);
  private readonly household = inject(HouseholdService);

  trackByKey(_: number, s: PendingSuggestion): string {
    return s.key;
  }

  /** "Mon, Nov 2", or "Mon, Nov 2 – Wed, Nov 4" for an event that spans days. */
  when(s: PendingSuggestion): string {
    const first = formatShortDate(s.dates[0]);
    return s.dates.length > 1 ? `${first} – ${formatShortDate(s.dates[s.dates.length - 1])}` : first;
  }

  /** "Confirm 8:15 AM drop-off Nov 2". With several children the name is added, so it's clear whose day changes. */
  confirmLabel(s: PendingSuggestion): string {
    const who = this.household.members().filter(m => m.kind === 'child').length > 1 ? `${s.memberName}'s ` : '';
    const days = s.dates.length > 1 ? `${monthDay(s.dates[0])} – ${monthDay(s.dates[s.dates.length - 1])}` : monthDay(s.dates[0]);
    if (s.kind === 'fact') return `Add note${who ? ` for ${s.memberName}` : ''} ${days}: “${s.text}”`;
    if (s.kind === 'noSchool') return `Confirm ${who}no school ${days}`;
    const what = s.kind === 'dropoff' ? 'drop-off' : 'pick-up';
    return `Confirm ${who}${s.time ? formatTime12h(s.time) + ' ' : ''}${what} ${days}`;
  }
}

/** "2026-11-02" as "Nov 2". */
function monthDay(date: string): string {
  return formatShortDate(date).replace(/^\w+, /, '');
}
