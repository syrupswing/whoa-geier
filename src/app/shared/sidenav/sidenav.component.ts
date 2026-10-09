import { Component, ElementRef, HostListener, effect, inject } from '@angular/core';
import { NgFor } from '@angular/common';
import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../../services/auth.service';
import { NavDrawerService } from '../nav-drawer/nav-drawer.service';

interface NavItem { path: string; icon: string; label: string; }

@Component({
  selector: 'app-sidenav',
  standalone: true,
  imports: [NgFor, RouterLink, RouterLinkActive, MatIconModule, MatButtonModule],
  templateUrl: './sidenav.component.html',
  styleUrl: './sidenav.component.scss'
})
export class SidenavComponent {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
  /** What had focus (the page's hamburger) before the drawer opened, so closing can give it back. */
  private returnFocusTo: HTMLElement | null = null;
  private wasOpen = false;

  private readonly router = inject(Router);
  private readonly authService = inject(AuthService);
  readonly drawer = inject(NavDrawerService);

  readonly items: NavItem[] = [
    { path: '/', icon: 'home', label: 'Home' },
    { path: '/grocery-list', icon: 'shopping_cart', label: 'Shopping list' },
    { path: '/todos', icon: 'checklist', label: 'To-do list' },
    { path: '/quick-links', icon: 'link', label: 'Quick links' },
    { path: '/recipes', icon: 'menu_book', label: 'Food: recipes' },
    { path: '/restaurants', icon: 'restaurant', label: 'Food: restaurants' },
    { path: '/calendar', icon: 'calendar_month', label: 'Calendar' },
    { path: '/vehicles', icon: 'directions_car', label: 'Vehicles' },
    { path: '/remi-world', icon: 'sports_esports', label: 'Remi world' },
    { path: '/settings', icon: 'settings', label: 'Settings' }
  ];

  constructor() {
    effect(() => {
      const open = this.drawer.isOpen() && !this.drawer.isDesktop();
      if (open === this.wasOpen) return;
      this.wasOpen = open;
      if (open) {
        this.returnFocusTo = document.activeElement as HTMLElement | null;
        // After the drawer has become visible; a hidden element can't take focus.
        setTimeout(() => this.focusables()[0]?.focus(), 50);
      } else {
        // Only if focus is still in the drawer — don't steal it from somewhere the user has since gone.
        if (this.host.contains(document.activeElement)) this.returnFocusTo?.focus();
        this.returnFocusTo = null;
      }
    });
  }

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.drawer.isOpen() && !this.drawer.isDesktop()) this.drawer.close();
  }

  /** Keeps Tab / Shift+Tab cycling inside the open drawer. */
  @HostListener('keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Tab' || !this.drawer.isOpen() || this.drawer.isDesktop()) return;
    const items = this.focusables();
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }

  private focusables(): HTMLElement[] {
    return Array.from(this.host.querySelectorAll<HTMLElement>('a[href], button:not([disabled])'));
  }

  async signOut(): Promise<void> {
    try {
      this.drawer.close();
      await this.authService.signOut();
      this.router.navigate(['/login']);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }
}
