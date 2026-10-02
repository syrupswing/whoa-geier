import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

interface SkeletonBlock {
  /** Percent of the column height. */
  top: number;
  height: number;
  /** Percent of the column width this block takes (a quarter of them sit half-width, as overlapping events do). */
  width: number;
  /** Sits against the right edge (the second of two side-by-side events). */
  right?: boolean;
}

/** A few typical days' worth of events, so neighboring columns don't look identical. */
const DAY_PATTERNS: SkeletonBlock[][] = [
  [
    { top: 6, height: 9, width: 100 },
    { top: 22, height: 17, width: 100 },
    { top: 46, height: 8, width: 100 },
    { top: 61, height: 14, width: 100 },
    { top: 84, height: 7, width: 100 }
  ],
  [
    { top: 10, height: 13, width: 100 },
    { top: 30, height: 8, width: 52 },
    { top: 30, height: 12, width: 44, right: true },
    { top: 54, height: 18, width: 100 },
    { top: 80, height: 9, width: 100 }
  ],
  [
    { top: 4, height: 8, width: 100 },
    { top: 18, height: 10, width: 100 },
    { top: 36, height: 15, width: 100 },
    { top: 68, height: 11, width: 100 }
  ]
];

/**
 * Placeholder shown in place of the calendar while events are still loading: shimmering blocks
 * shaped like an ordinary day (or week) of events, plus faint hour labels down the side.
 */
@Component({
  selector: 'app-calendar-skeleton',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="skeleton" [style.height.px]="height" role="status" aria-label="Loading calendar events">
      <div class="skeleton-hours" *ngIf="showHours">
        <span class="skeleton-hour" *ngFor="let h of hourMarks"></span>
      </div>
      <div class="skeleton-col" *ngFor="let day of dayColumns">
        <span
          class="skeleton-block"
          *ngFor="let b of day"
          [style.top.%]="b.top"
          [style.height.%]="b.height"
          [style.width.%]="b.width"
          [class.right]="b.right"></span>
      </div>
    </div>
  `,
  styles: [`
    :host { display: block; }

    .skeleton {
      position: relative;
      display: flex;
      gap: 8px;
      padding: 8px 12px;
      box-sizing: border-box;
      overflow: hidden;
    }

    .skeleton-hours {
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      width: 28px;
      flex-shrink: 0;
      padding: 4px 0;
    }

    .skeleton-hour {
      height: 8px;
      width: 22px;
      border-radius: 4px;
      background: rgba(61, 53, 80, 0.07);
    }

    .skeleton-col {
      position: relative;
      flex: 1;
      min-width: 0;
    }

    .skeleton-block {
      position: absolute;
      left: 0;
      border-radius: 6px;
      background-color: rgba(61, 53, 80, 0.07);
      background-image: linear-gradient(
        100deg,
        transparent 20%,
        rgba(255, 255, 255, 0.65) 50%,
        transparent 80%
      );
      background-size: 220% 100%;
      background-repeat: no-repeat;
      animation: skeleton-shimmer 1.4s ease-in-out infinite;
    }

    // The second of two side-by-side blocks sits against the right edge.
    .skeleton-block.right {
      left: auto;
      right: 0;
    }

    @keyframes skeleton-shimmer {
      from { background-position: 160% 0; }
      to { background-position: -60% 0; }
    }

    @media (prefers-reduced-motion: reduce) {
      .skeleton-block { animation: none; }
    }
  `]
})
export class CalendarSkeletonComponent {
  /** How many day columns to draw — 1 for the day widget, 7 for the week. */
  @Input() set columns(count: number) {
    this.dayColumns = Array.from({ length: Math.max(1, count) }, (_, i) => DAY_PATTERNS[i % DAY_PATTERNS.length]);
  }
  @Input() height = 420;
  @Input() showHours = true;

  dayColumns: SkeletonBlock[][] = [DAY_PATTERNS[0]];
  readonly hourMarks = Array.from({ length: 7 });
}
