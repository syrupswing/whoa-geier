import { Injectable, computed, signal } from '@angular/core';

export interface LocalAlert {
  /** Stable per source, so a page re-posting its alert replaces the old one instead of stacking. */
  id: string;
  icon: string;
  text: string;
  /** An optional button on the card, e.g. "Connect". */
  actionLabel?: string;
  action?: () => void;
}

/**
 * Alerts raised by the app itself (a lost calendar connection, a failed sync), shown in the same
 * floating banner as the server's alerts. A page posts one with `show` while its condition holds and
 * withdraws it with `clear`. Dismissing hides it until its text changes.
 */
@Injectable({ providedIn: 'root' })
export class LocalAlertService {
  private readonly posted = signal<LocalAlert[]>([]);
  /** Alert id → the text that was dismissed. */
  private readonly dismissed = signal<Record<string, string>>({});

  readonly active = computed(() => this.posted().filter(a => this.dismissed()[a.id] !== a.text));

  show(alert: LocalAlert): void {
    this.posted.update(list => [...list.filter(a => a.id !== alert.id), alert]);
  }

  clear(id: string): void {
    this.posted.update(list => list.filter(a => a.id !== id));
  }

  dismiss(alert: LocalAlert): void {
    this.dismissed.update(map => ({ ...map, [alert.id]: alert.text }));
  }
}
