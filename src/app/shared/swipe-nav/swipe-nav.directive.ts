import { NavDrawerService } from '../nav-drawer/nav-drawer.service';
import { Directive, ElementRef, EventEmitter, HostListener, Input, Output, inject } from '@angular/core';

/** Farthest-left/right strip of the screen where a touch is left alone (iOS uses it for "go back"). */
const EDGE_GUARD_PX = 24;
/** A deliberate swipe: this far sideways, and clearly more sideways than vertical… */
const MIN_DISTANCE_PX = 56;
const MIN_HORIZONTAL_RATIO = 1.5;
/** …or a quick flick covering at least this much, at least this fast (px per ms). */
const FLICK_DISTANCE_PX = 32;
const FLICK_SPEED = 0.45;
/** Touches that begin on these are never a swipe (typing, dragging a popover's content, …). */
const IGNORED_TARGETS = 'input, textarea, select, button, a, .cal-popover, [data-no-swipe]';

/**
 * Horizontal swipe on touch screens: swiping left emits `swipeNext`, swiping right emits
 * `swipePrev`, and the matching parts of the page slide in from that side. Vertical scrolling and
 * pinch-zoom are untouched, and nothing happens for mouse input.
 */
@Directive({
  selector: '[appSwipeNav]',
  standalone: true,
  host: { '[style.touch-action]': "'pan-y pinch-zoom'" }
})
export class SwipeNavDirective {
  private host = inject<ElementRef<HTMLElement>>(ElementRef);
  private drawer = inject(NavDrawerService);

  @Output() swipePrev = new EventEmitter<void>();
  @Output() swipeNext = new EventEmitter<void>();
  /** CSS selector for the descendants that slide when a swipe changes the day — the content, not the header. */
  @Input() swipeAnimate = '';

  private start: { x: number; y: number; time: number } | null = null;

  @HostListener('touchstart', ['$event'])
  onTouchStart(event: TouchEvent): void {
    const touch = event.touches[0];
    const target = event.target as Element | null;
    const nearEdge = touch && (touch.clientX < EDGE_GUARD_PX || touch.clientX > window.innerWidth - EDGE_GUARD_PX);
    // A second finger (pinch) or a start on an interactive control means this isn't a swipe.
    // A touch that began at the left edge belongs to the navigation drawer's open gesture.
    this.start = event.touches.length !== 1 || nearEdge || this.drawer.gestureClaimed || target?.closest(IGNORED_TARGETS)
      ? null
      : { x: touch.clientX, y: touch.clientY, time: Date.now() };
  }

  @HostListener('touchcancel')
  onTouchCancel(): void {
    this.start = null;
  }

  @HostListener('touchend', ['$event'])
  onTouchEnd(event: TouchEvent): void {
    const start = this.start;
    this.start = null;
    const touch = event.changedTouches[0];
    if (!start || !touch) return;

    const dx = touch.clientX - start.x;
    const dy = touch.clientY - start.y;
    const elapsed = Math.max(Date.now() - start.time, 1);
    const sideways = Math.abs(dx) > Math.abs(dy) * MIN_HORIZONTAL_RATIO;
    const longEnough = Math.abs(dx) >= MIN_DISTANCE_PX;
    const flick = Math.abs(dx) >= FLICK_DISTANCE_PX && Math.abs(dx) / elapsed >= FLICK_SPEED;
    if (!sideways || !(longEnough || flick)) return;

    // Finger moving left means "next": the new content arrives from the right.
    const next = dx < 0;
    (next ? this.swipeNext : this.swipePrev).emit();
    this.slideIn(next ? 1 : -1);
  }

  /** Slides the animated parts in from the swipe's direction — a quick cue that the day changed. */
  private slideIn(direction: 1 | -1): void {
    if (!this.swipeAnimate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.host.nativeElement.querySelectorAll<HTMLElement>(this.swipeAnimate).forEach(el => {
      el.animate(
        [
          { transform: `translateX(${direction * 28}px)`, opacity: 0.25 },
          { transform: 'translateX(0)', opacity: 1 }
        ],
        { duration: 220, easing: 'ease-out' }
      );
    });
  }
}
