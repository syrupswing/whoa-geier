import { Injectable, inject, signal } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FirestoreService } from './firestore.service';

export interface ReferenceDoc {
  id: string;
  title: string;
  summary: string;
  text: string;
  source: 'paste' | 'url';
  url?: string | null;
  /** True when the text was cut at the per-document limit. */
  truncated?: boolean;
  fetchedAt?: string;
  createdAt?: string;
}

/**
 * The reference library — flyers, guides and notes the family chat can answer from. Reads
 * come straight from Firestore; adding and refreshing go through Cloud Functions because
 * they fetch links and summarize server-side.
 */
@Injectable({
  providedIn: 'root'
})
export class ReferenceDocsService {
  private firestoreService = inject(FirestoreService);
  private readonly COLLECTION = 'referenceDocs';

  docs = signal<ReferenceDoc[]>([]);

  constructor() {
    if (this.firestoreService.isInitialized()) {
      this.firestoreService.subscribeToCollection<ReferenceDoc>(
        this.COLLECTION,
        (items) => this.docs.set(items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')))
      );
    }
  }

  /** Adds a doc from pasted text or a public link; throws with the server's message if it can't be read. */
  async add(input: { title?: string; text?: string; url?: string }): Promise<void> {
    const call = httpsCallable(getFunctions(), 'addReferenceDoc');
    await call(input);
  }

  async refresh(id: string): Promise<void> {
    const call = httpsCallable(getFunctions(), 'refreshReferenceDoc');
    await call({ id });
  }

  async remove(id: string): Promise<boolean> {
    return this.firestoreService.deleteDocument(this.COLLECTION, id);
  }
}
