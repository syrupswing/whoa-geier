import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { DayDetectionService, PendingSuggestion } from '../../services/day-detection.service';
import { formatShortDate, formatTime12h } from '../time-format';

/** Calendar events the app thinks change a child's day but wasn't sure enough to apply — one tap to confirm or ignore. */
@Component({
  selector: 'app-pending-day-suggestions',
  standalone: true,
  imports: [CommonModule, MatIconModule, MatButtonModule],
  templateUrl: './pending-day-suggestions.component.html',
  styleUrl: './pending-day-suggestions.component.scss'
})
export class PendingDaySuggestionsComponent {
  readonly detection = inject(DayDetectionService);

  trackByKey(_: number, s: PendingSuggestion): string {
    return s.key;
  }

  headline(s: PendingSuggestion): string {
    if (s.kind === 'noSchool') return `No school for ${s.memberName}`;
    const what = s.kind === 'dropoff' ? 'drop-off' : 'pick-up';
    return `${s.memberName}'s ${what} at ${s.time ? formatTime12h(s.time) : '—'}`;
  }

  when(s: PendingSuggestion): string {
    const first = formatShortDate(s.dates[0]);
    return s.dates.length > 1 ? `${first} – ${formatShortDate(s.dates[s.dates.length - 1])}` : first;
  }
}
