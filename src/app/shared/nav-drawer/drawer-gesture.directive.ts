import { Directive, ElementRef, NgZone, OnDestroy, OnInit, inject } from '@angular/core';
import { NavDrawerService } from './nav-drawer.service';

/** A touch starting this close to the left edge can pull the drawer open. */
const EDGE_ZONE_PX = 40;
/** Movement before the gesture decides between a sideways drag and a vertical scroll. */
const LOCK_DISTANCE_PX = 8;
/** A flick this fast (px per ms) opens/closes the drawer regardless of how far it travelled. */
const FLICK_SPEED = 0.4;

/**
 * Lets touch screens drag the page sideways to reveal or hide the navigation drawer. The content
 * follows the finger and settles open or closed on release. Opening starts at the left edge; once
 * open, a drag anywhere on the content closes it. Does nothing at desktop widths or for a mouse.
 */
@Directive({
  selector: '[appDrawerGesture]',
  standalone: true,
  host: { '[style.touch-action]': "'pan-y pinch-zoom'" }
})
export class DrawerGestureDirective implements OnInit, OnDestroy {
  private readonly el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  private readonly zone = inject(NgZone);
  private readonly drawer = inject(NavDrawerService);

  private start: { x: number; y: number; time: number; base: number } | null = null;
  private locked: 'drag' | 'scroll' | null = null;
  private offset = 0;
  private lastX = 0;
  private lastTime = 0;
  private velocity = 0;

  ngOnInit(): void {
    // Outside the zone: touchmove fires constantly and only the open/closed result matters to Angular.
    this.zone.runOutsideAngular(() => {
      this.el.addEventListener('touchstart', this.onStart, { passive: true, capture: true });
      this.el.addEventListener('touchmove', this.onMove, { passive: true });
      this.el.addEventListener('touchend', this.onEnd, { passive: true });
      this.el.addEventListener('touchcancel', this.onCancel, { passive: true });
    });
  }

  ngOnDestroy(): void {
    this.el.removeEventListener('touchstart', this.onStart, true);
    this.el.removeEventListener('touchmove', this.onMove);
    this.el.removeEventListener('touchend', this.onEnd);
    this.el.removeEventListener('touchcancel', this.onCancel);
  }

  /** How far the content travels when open: the drawer's width. */
  private get travel(): number {
    return parseFloat(getComputedStyle(this.el).getPropertyValue('--drawer-travel')) || window.innerWidth * 0.9;
  }

  private onStart = (e: TouchEvent): void => {
    this.reset();
    if (this.drawer.isDesktop() || e.touches.length !== 1) return;
    const t = e.touches[0];
    const open = this.drawer.isOpen();
    if (!open && t.clientX > EDGE_ZONE_PX) return;
    if (!open) this.drawer.gestureClaimed = true;
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
      this.locked = 'drag';
      this.zone.run(() => this.drawer.dragging.set(true));
      this.el.style.transition = 'none';
    }

    const now = Date.now();
    if (now > this.lastTime) this.velocity = (t.clientX - this.lastX) / (now - this.lastTime);
    this.lastX = t.clientX;
    this.lastTime = now;

    this.offset = Math.min(Math.max(this.start.base + dx, 0), this.travel);
    this.el.style.transform = `translateX(${this.offset}px)`;
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

  /** Hands control back to the stylesheet, which animates from the finger's last position to the settled state. */
  private finish(open: boolean): void {
    this.el.style.transition = '';
    this.el.style.transform = '';
    this.zone.run(() => {
      this.drawer.isOpen.set(open);
      this.drawer.dragging.set(false);
    });
    this.reset();
  }

  private reset(): void {
    this.start = null;
    this.locked = null;
    this.velocity = 0;
    this.drawer.gestureClaimed = false;
  }
}
