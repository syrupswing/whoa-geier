import { Injectable, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { Unsubscribe } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { DayResolverService } from './day-resolver.service';
import { FirestoreService } from './firestore.service';
import { HouseholdService } from './household.service';

export interface FactLine {
  id: string;
  who: string;
  text: string;
}

const COLLECTION = 'factDismissals';
/** Dismissed fact ids kept per person; older ones belong to days long past. */
const MAX_DISMISSED = 200;
const TIME_ZONE = 'America/Chicago';

const todayStr = (): string => new Date().toLocaleDateString('en-CA', { timeZone: TIME_ZONE });

/**
 * Today's special facts for everyone in the household that the signed-in person hasn't dismissed yet,
 * shown in the app-wide alert banner. A dismissal is stored per person (so it follows them across
 * devices) by fact id; a fact added afterwards has a new id and shows up again.
 */
@Injectable({ providedIn: 'root' })
export class SpecialFactsAlertService implements OnDestroy {
  private readonly household = inject(HouseholdService);
  private readonly resolver = inject(DayResolverService);
  private readonly firestore = inject(FirestoreService);
  private readonly auth = inject(AuthService);

  private readonly today = signal(todayStr());
  private readonly dismissed = signal<string[]>([]);
  private readonly clock = setInterval(() => this.today.set(todayStr()), 60_000);

  readonly lines = computed<FactLine[]>(() => {
    const today = this.today();
    const gone = new Set(this.dismissed());
    return this.household.members()
      .flatMap(m => (this.resolver.resolve(m.id, today)?.specialFacts ?? []).map(f => ({ id: f.id, who: m.name, text: f.text })))
      .filter(l => !gone.has(l.id));
  });

  constructor() {
    effect(onCleanup => {
      const uid = this.auth.currentUser()?.uid;
      this.dismissed.set([]);
      if (!uid || !this.firestore.isInitialized()) return;
      const unsubscribe: Unsubscribe | null = this.firestore.subscribeToDocument<{ ids?: string[] }>(
        COLLECTION, uid, doc => this.dismissed.set(doc?.ids ?? [])
      );
      onCleanup(() => unsubscribe?.());
    }, { allowSignalWrites: true });
  }

  ngOnDestroy(): void {
    clearInterval(this.clock);
  }

  /** Hides everything currently shown, for this person only. */
  async dismiss(): Promise<void> {
    const uid = this.auth.currentUser()?.uid;
    if (!uid) return;
    const ids = [...this.dismissed(), ...this.lines().map(l => l.id)].slice(-MAX_DISMISSED);
    // Optimistic: the snapshot listener would otherwise leave them showing until the write round-trips.
    this.dismissed.set(ids);
    await this.firestore.setDocument(COLLECTION, uid, { ids });
  }
}
