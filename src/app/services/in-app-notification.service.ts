import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Unsubscribe } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';

/** The in-app twin of a push alert, created by the server alongside it (see taskPushAlerts). */
export interface InAppNotification {
  id: string;
  title: string;
  itemId: string;
  itemKind: 'task' | 'event';
  /** "YYYY-MM-DD" of the occurrence that alerted. */
  date: string;
  /** A uid for a private alert, or 'family' for everyone's. */
  targetUid: string;
  dismissedBy: string[];
  createdAt: string;
}

/** How long a notification stays in the banner if never dismissed. */
const MAX_AGE_MS = 2 * 24 * 60 * 60 * 1000;

@Injectable({ providedIn: 'root' })
export class InAppNotificationService {
  private firestore = inject(FirestoreService);
  private auth = inject(AuthService);
  private router = inject(Router);

  private private_ = signal<InAppNotification[]>([]);
  private family = signal<InAppNotification[]>([]);

  /** Undismissed notifications for the signed-in user, newest first. */
  active = computed(() => {
    const uid = this.auth.currentUser()?.uid;
    const cutoff = Date.now() - MAX_AGE_MS;
    return [...this.private_(), ...this.family()]
      .filter(n => !!uid && !n.dismissedBy?.includes(uid) && new Date(n.createdAt).getTime() > cutoff)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  constructor() {
    let unsubscribes: Unsubscribe[] = [];
    effect(() => {
      const uid = this.auth.currentUser()?.uid;
      unsubscribes.forEach(u => u());
      unsubscribes = [];
      this.private_.set([]);
      this.family.set([]);
      if (!uid || !this.firestore.isInitialized()) return;
      // Two equality queries rather than one filter: the rules only allow a read that's provably
      // limited to this user's own and the family's alerts.
      const own = this.firestore.subscribeToWhereEquals<InAppNotification>('notifications', 'targetUid', uid, items => this.private_.set(items));
      const shared = this.firestore.subscribeToWhereEquals<InAppNotification>('notifications', 'targetUid', 'family', items => this.family.set(items));
      unsubscribes = [own, shared].filter((u): u is Unsubscribe => !!u);
    });
  }

  /** Hides a notification for this user only (a family one stays for everyone else). */
  async dismiss(notification: InAppNotification): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;
    const dismissedBy = [...(notification.dismissedBy ?? []), uid];
    // Optimistic: the snapshot listener would otherwise leave it showing until the write round-trips.
    const hide = (list: InAppNotification[]) => list.map(n => n.id === notification.id ? { ...n, dismissedBy } : n);
    this.private_.update(hide);
    this.family.update(hide);
    await this.firestore.updateDocument<InAppNotification>('notifications', notification.id, { dismissedBy });
  }

  /** Opens the calendar on the alerted day with the item highlighted, and clears the notification. */
  async open(notification: InAppNotification): Promise<void> {
    void this.dismiss(notification);
    await this.router.navigate(['/calendar'], {
      queryParams: { date: notification.date, highlight: notification.itemId }
    });
  }
}
