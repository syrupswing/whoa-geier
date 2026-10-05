import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';

/**
 * The family's home address — the starting point for drive times to events. Shared by everyone
 * in the household, so it lives in Firestore (the `household` collection) rather than on a device.
 */
@Injectable({
  providedIn: 'root'
})
export class HomeLocationService {
  private firestoreService = inject(FirestoreService);
  private authService = inject(AuthService);
  private readonly COLLECTION = 'household';
  private readonly DOC_ID = 'home';

  address = signal<string>('');
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
