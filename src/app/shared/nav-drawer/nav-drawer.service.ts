import { Injectable, NgZone, inject, signal } from '@angular/core';

/** Same breakpoint as the CSS in app.component.scss: at this width and up the navigation is a fixed sidebar. */
const DESKTOP_QUERY = '(min-width: 1024px)';

/** Open/closed state of the navigation drawer, which only exists below the desktop breakpoint. */
@Injectable({ providedIn: 'root' })
export class NavDrawerService {
  private readonly query = window.matchMedia(DESKTOP_QUERY);

  readonly isDesktop = signal(this.query.matches);
  readonly isOpen = signal(false);
  /** True while a finger is dragging the content sideways. */
  readonly dragging = signal(false);
  /** Set while a touch that began at the left edge belongs to the drawer, so day-swipe handlers stay out of it. */
  gestureClaimed = false;

  constructor() {
    inject(NgZone).runOutsideAngular(() =>
      this.query.addEventListener('change', e => {
        this.isDesktop.set(e.matches);
        if (e.matches) this.isOpen.set(false);
      })
    );
  }

  open(): void { this.isOpen.set(true); }
  close(): void { this.isOpen.set(false); }
  toggle(): void { this.isOpen.update(v => !v); }
}
