import { Directive, ElementRef, NgZone, OnDestroy, OnInit, inject } from '@angular/core';
import { NavDrawerService } from './nav-drawer.service';

/**
 * Where a drag may start on a page that already uses sideways swipes (the calendar's day/week
 * navigation): a strip clear of the browser's own back-swipe zone at the very edge.
 */
const EDGE_ZONE_MIN_PX = 20;
const EDGE_ZONE_MAX_PX = 90;
/** Touches that begin on these never pull the drawer (typing, sliders, popovers). */
const IGNORED_TARGETS = 'input, textarea, select, mat-slider, .cal-popover, [data-no-swipe]';
/** Pages with their own day/week swipe mark that region with this attribute (see SwipeNavDirective). */
const SWIPE_NAV_SELECTOR = '[data-swipe-nav]';
/** Movement before the gesture decides between a sideways drag and a vertical scroll. */
const LOCK_DISTANCE_PX = 8;
/** A flick this fast (px per ms) opens/closes the drawer regardless of how far it travelled. */
const FLICK_SPEED = 0.4;
/** A little longer than the stylesheet's 0.28s slide, so the inline position is only dropped once it has finished. */
const SETTLE_MS = 340;

/**
 * Lets touch screens drag the page sideways to reveal or hide the navigation drawer. Goes on the
 * shell that holds both the drawer and `.app-container`; the container follows the finger and
 * settles open or closed on release. A rightward drag starting anywhere on the page opens it,
 * except inside a day/week swipe region, where it has to start in an edge strip instead. Once
 * open, a leftward drag anywhere (page or drawer) closes it. Does nothing at desktop widths.
 */
@Directive({
  selector: '[appDrawerGesture]',
  standalone: true,
  host: { '[style.touch-action]': "'pan-y pinch-zoom'" }
})
export class DrawerGestureDirective implements OnInit, OnDestroy {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** The page, which is what slides. */
  private el!: HTMLElement;
  private readonly zone = inject(NgZone);
  private readonly drawer = inject(NavDrawerService);

  private start: { x: number; y: number; time: number; base: number } | null = null;
  private locked: 'drag' | 'scroll' | null = null;
  private offset = 0;
  private lastX = 0;
  private lastTime = 0;
  private velocity = 0;
  private frame = 0;
  private settleTimer = 0;

  ngOnInit(): void {
    this.el = this.host.querySelector<HTMLElement>('.app-container') ?? this.host;
    // Outside the zone: touchmove fires constantly and only the open/closed result matters to Angular.
    this.zone.runOutsideAngular(() => {
      this.host.addEventListener('touchstart', this.onStart, { passive: true, capture: true });
      this.host.addEventListener('touchmove', this.onMove, { passive: true });
      this.host.addEventListener('touchend', this.onEnd, { passive: true });
      this.host.addEventListener('touchcancel', this.onCancel, { passive: true });
    });
  }

  ngOnDestroy(): void {
    cancelAnimationFrame(this.frame);
    clearTimeout(this.settleTimer);
    this.host.removeEventListener('touchstart', this.onStart, true);
    this.host.removeEventListener('touchmove', this.onMove);
    this.host.removeEventListener('touchend', this.onEnd);
    this.host.removeEventListener('touchcancel', this.onCancel);
  }

  /** How far the content travels when open: the drawer's width (the stylesheet sets it in vw, so it has to be measured, not parsed). */
  private get travel(): number {
    return this.host.querySelector<HTMLElement>('.sidenav')?.offsetWidth || window.innerWidth * 0.9;
  }

  private onStart = (e: TouchEvent): void => {
    // A new touch while the last release is still settling takes over from wherever the page is.
    this.cancelSettle();
    this.reset();
    if (this.drawer.isDesktop() || e.touches.length !== 1) return;
    const t = e.touches[0];
    const open = this.drawer.isOpen();
    const target = e.target as Element | null;
    if (!open) {
      if (target?.closest(IGNORED_TARGETS) || this.scrollsSideways(target)) return;
      // Inside a day/week swipe region only the edge strip opens the drawer; claiming the touch keeps that swipe from also changing the day.
      if (target?.closest(SWIPE_NAV_SELECTOR)) {
        if (t.clientX < EDGE_ZONE_MIN_PX || t.clientX > EDGE_ZONE_MAX_PX) return;
        this.drawer.gestureClaimed = true;
      }
    }
    this.start = { x: t.clientX, y: t.clientY, time: Date.now(), base: open ? this.travel : 0 };
    this.lastX = t.clientX;
    this.lastTime = Date.now();
  };

  private onMove = (e: TouchEvent): void => {
    if (!this.start || this.locked === 'scroll') return;
    const t = e.touches[0];
    const dx = t.clientX - this.start.x;
    const dy = t.clientY - this.start.y;

    if (!this.locked) {
      if (Math.hypot(dx, dy) < LOCK_DISTANCE_PX) return;
      if (Math.abs(dx) <= Math.abs(dy) * 1.2) { this.locked = 'scroll'; this.reset(); return; }
      // Closed, only a rightward drag opens it; leftward belongs to the page.
      if (this.start.base === 0 && dx < 0) { this.locked = 'scroll'; this.reset(); return; }
      this.locked = 'drag';
      // Straight on the DOM, not a signal: no change detection at the start of a drag.
      this.host.classList.add('dragging');
      this.el.style.transition = 'none';
    }

    const now = Date.now();
    if (now > this.lastTime) this.velocity = (t.clientX - this.lastX) / (now - this.lastTime);
    this.lastX = t.clientX;
    this.lastTime = now;

    this.offset = Math.min(Math.max(this.start.base + dx, 0), this.travel);
    // One write per frame, however many touchmove events arrive.
    if (!this.frame) {
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        this.el.style.transform = `translate3d(${this.offset}px, 0, 0)`;
      });
    }
  };

  private onEnd = (): void => {
    if (this.locked !== 'drag') { this.reset(); return; }
    const travel = this.travel;
    const open = Math.abs(this.velocity) >= FLICK_SPEED ? this.velocity > 0 : this.offset > travel / 2;
    this.finish(open);
  };

  private onCancel = (): void => {
    if (this.locked === 'drag') this.finish(this.drawer.isOpen());
    else this.reset();
  };

  /** True when the touch began inside something that scrolls sideways (a carousel, a wide table). */
  private scrollsSideways(node: Element | null): boolean {
    for (let el = node; el && el !== this.host; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 1 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) return true;
    }
    return false;
  }

  /**
   * Animates from the finger's last position straight to the settled position. The inline
   * transform stays until the transition ends, so the stylesheet's open/closed state (which
   * Angular applies a moment later) never pulls the page toward the old state mid-release.
   */
  private finish(open: boolean): void {
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.el.style.transition = '';
    this.el.style.transform = `translate3d(${open ? this.travel : 0}px, 0, 0)`;
    // The visual state goes on the DOM now so the slide starts at once; Angular is told a frame
    // later, since its change-detection pass would otherwise stall the first frames of the animation.
    this.host.classList.remove('dragging');
    this.host.classList.toggle('drawer-open', open);
    requestAnimationFrame(() => this.zone.run(() => this.drawer.isOpen.set(open)));
    this.settleTimer = window.setTimeout(() => this.cancelSettle(), SETTLE_MS);
    this.reset();
  }

  /** Hands the transform back to the stylesheet; the state it describes now matches where the page already is. */
  private cancelSettle(): void {
    if (!this.settleTimer) return;
    clearTimeout(this.settleTimer);
    this.settleTimer = 0;
    this.el.style.transform = '';
  }

  private reset(): void {
    this.start = null;
    this.locked = null;
    this.velocity = 0;
    this.drawer.gestureClaimed = false;
  }
}
