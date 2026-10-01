import { Component, ElementRef, NgZone, OnDestroy, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-global-nav-menu',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule
  ],
  templateUrl: './global-nav-menu.component.html',
  styleUrl: './global-nav-menu.component.scss'
})
export class GlobalNavMenuComponent implements OnInit, OnDestroy {
  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly zone = inject(NgZone);

  /** Gap kept between the pinned button and the top of the screen (below the status bar). */
  private static readonly STICKY_TOP_GAP = 10;

  /** True once the page has scrolled the button's resting place off the top — it then pins to the top of the screen. */
  stuck = signal(false);
  /** Horizontal position the pinned button keeps — the same column it rests in. */
  stuckLeft = signal(0);
  stuckTop = signal(0);

  private frame = 0;

  ngOnInit(): void {
    // The page scrolls inside .app-container, and scroll events don't bubble, so listen in the
    // capture phase. Outside Angular's zone: scrolling shouldn't trigger change detection on its
    // own — only a change in the pinned state (a signal) re-renders.
    this.zone.runOutsideAngular(() => {
      window.addEventListener('scroll', this.scheduleUpdate, true);
      window.addEventListener('resize', this.scheduleUpdate);
    });
    this.update();
  }

  ngOnDestroy(): void {
    window.removeEventListener('scroll', this.scheduleUpdate, true);
    window.removeEventListener('resize', this.scheduleUpdate);
    cancelAnimationFrame(this.frame);
  }

  private scheduleUpdate = (): void => {
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.update());
  };

  private update(): void {
    // The host keeps its 46px footprint in the header even while the button is pinned, so its
    // rect is always the button's natural (unpinned) position.
    const rect = this.host.nativeElement.getBoundingClientRect();
    const safeTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--app-safe-area-top')) || 0;
    const top = safeTop + GlobalNavMenuComponent.STICKY_TOP_GAP;
    const stuck = rect.top < top;
    if (stuck !== this.stuck()) this.stuck.set(stuck);
    if (stuck) {
      this.stuckTop.set(top);
      this.stuckLeft.set(rect.left);
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.authService.signOut();
      this.router.navigate(['/login']);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }
}
