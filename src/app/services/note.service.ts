import { Injectable, computed, inject, signal } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { NoteKind } from './note-kinds';

export type { NoteKind } from './note-kinds';

/**
 * One entry in the family notebook. Everything has a `title` and `body`, so anything the app can't
 * classify still saves losslessly as a plain note; kind-specific details (a provider's phone, a
 * warranty's expiry) live in `data` so adding a kind needs no migration.
 */
export interface Note {
  id: string;
  kind: NoteKind;
  title: string;
  body?: string;
  /** Open list (house, vehicle, medical, …), lower-case. */
  category?: string;
  tags?: string[];
  /** The household member it's about; unset means the whole household. */
  memberId?: string;
  data?: Record<string, string>;
  /** Optional links to other records, e.g. a vehicle. */
  links?: { type: 'vehicle' | 'member'; id: string }[];
  source?: 'chat' | 'manual' | 'migrated';
  createdByName?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type NewNote = Omit<Note, 'id' | 'createdAt' | 'updatedAt'>;

// The family notebook, in Firestore and shared by the whole household. It is read by the Cloud
// Functions too (facts feed every briefing, the rest feed chat answers), so like the memory
// service it has no localStorage fallback.
@Injectable({ providedIn: 'root' })
export class NoteService {
  private firestore = inject(FirestoreService);

  private readonly COLLECTION = 'notes';

  /** Newest first. */
  notes = signal<Note[]>([]);
  isLoading = signal(true);

  facts = computed(() => this.notes().filter(n => n.kind === 'fact'));

  /** Every category in use, for filter chips and suggestions. */
  categories = computed(() => {
    const set = new Set<string>();
    this.notes().forEach(n => n.category && set.add(n.category));
    return [...set].sort();
  });

  constructor() {
    if (this.firestore.isInitialized()) {
      this.firestore.subscribeToCollection<Note>(this.COLLECTION, (items) => {
        this.notes.set(items.sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? '')));
        this.isLoading.set(false);
      });
    } else {
      this.isLoading.set(false);
    }
  }

  add(note: NewNote): Promise<string | null> {
    // addDoc rejects undefined values, so empty optional fields are dropped (update turns them into deletes).
    const cleaned = Object.fromEntries(
      Object.entries(this.clean(note)).filter(([, value]) => value !== undefined)
    ) as NewNote;
    if (cleaned.kind === 'service') void this.markProviderUsed(cleaned);
    return this.firestore.addDocument<Note>(this.COLLECTION, cleaned);
  }

  /**
   * A logged service means its provider (matched by name, or business name, in the provider entries) was
   * last used on that date. Never moves the date backwards, and does nothing if no provider matches.
   */
  private async markProviderUsed(service: NewNote): Promise<void> {
    const name = service.data?.['provider']?.trim().toLowerCase();
    const doneOn = service.data?.['doneOn'];
    if (!name || !doneOn) return;
    const provider = this.notes().find(n => n.kind === 'provider' &&
      [n.title, n.data?.['business']].some(v => v?.trim().toLowerCase() === name));
    if (!provider || (provider.data?.['lastUsed'] ?? '') >= doneOn) return;
    await this.update(provider.id, { data: { ...provider.data, lastUsed: doneOn } });
  }

  update(id: string, updates: Partial<NewNote>): Promise<boolean> {
    return this.firestore.updateDocument<Note>(this.COLLECTION, id, this.clean(updates));
  }

  remove(id: string): Promise<boolean> {
    return this.firestore.deleteDocument(this.COLLECTION, id);
  }

  /** Lower-cases the category and tags, and drops empty detail fields so the stored doc stays tidy. */
  private clean<T extends Partial<NewNote>>(note: T): T {
    const out: Partial<NewNote> = { ...note };
    if (out.category !== undefined) out.category = out.category.trim().toLowerCase() || undefined;
    if (out.tags) out.tags = [...new Set(out.tags.map(t => t.trim().toLowerCase()).filter(Boolean))];
    if (out.data) {
      const entries = Object.entries(out.data).filter(([, v]) => v && String(v).trim());
      out.data = Object.fromEntries(entries.map(([k, v]) => [k, String(v).trim()]));
    }
    return out as T;
  }
}
