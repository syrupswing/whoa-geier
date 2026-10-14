import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { HouseholdService } from './household.service';

/**
 * The family's saved home address, and the starting point for drive times. Each person can have their own
 * home address (see FamilyMember.homeAddress); this document is the family-wide default they fall back to,
 * so it lives in Firestore (the `household` collection) rather than on a device.
 */
@Injectable({
  providedIn: 'root'
})
export class HomeLocationService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);
  private household = inject(HouseholdService);
  private readonly COLLECTION = 'household';
  private readonly DOC_ID = 'home';

  /** The family-wide default address. */
  address = signal<string>('');
  /** Where drive times start from: the signed-in person's own home address, else the family default. */
  originAddress = computed(() => {
    const me = this.household.getMemberById(this.household.myMemberId() ?? '');
    return me?.homeAddress?.trim() || this.address();
  });
  private loadedForUid: string | null = null;

  constructor() {
    effect(() => {
      const uid = this.authService.currentUser()?.uid ?? null;
      untracked(() => {
        if (!uid || this.loadedForUid === uid) return;
        this.loadedForUid = uid;
        this.load();
      });
    });
  }

  private async load(): Promise<void> {
    if (!this.firestoreService.isInitialized()) return;
    try {
      const doc = await this.firestoreService.getDocument<{ address?: string }>(this.COLLECTION, this.DOC_ID);
      this.address.set(doc?.address ?? '');
    } catch {
      // No saved address yet — drive times simply stay unavailable until one is set.
    }
  }

  async save(address: string): Promise<void> {
    const trimmed = address.trim();
    await this.firestoreService.setDocument(this.COLLECTION, this.DOC_ID, { address: trimmed });
    this.address.set(trimmed);
  }
}
