import { Injectable, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { Unsubscribe } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import { TodoService } from './todo.service';

/** A task waiting for its turn: like a calendar task, but with no day or timing. */
export interface BacklogItem {
  id: string;
  title: string;
  notes?: string;
  /** The household member it's for; unset means the whole family. */
  memberId?: string;
  /** 'private' items are readable only by their creator. */
  scope: 'family' | 'private';
  createdByUid: string;
  createdByName?: string;
  completed: boolean;
  completedAt?: string;
  completedByName?: string;
  /** The old to-do this was imported from, so an import never copies the same one twice. */
  importedFromTodoId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export type NewBacklogItem = Pick<BacklogItem, 'title'> & Partial<Pick<BacklogItem, 'notes' | 'memberId' | 'scope'>>;

// The family's backlog, in Firestore. Two equality queries rather than one: the rules only let a
// person read family items and their own, and a query must provably stay inside that.
@Injectable({ providedIn: 'root' })
export class BacklogService implements OnDestroy {
  private firestore = inject(FirestoreService);
  private auth = inject(AuthService);
  private todoService = inject(TodoService);

  private readonly COLLECTION_NAME = 'backlog';

  private familyItems = signal<BacklogItem[]>([]);
  private ownItems = signal<BacklogItem[]>([]);
  isLoading = signal(true);
  private unsubscribes: Unsubscribe[] = [];

  /** Every item this person can see, newest first. */
  items = computed(() => {
    const byId = new Map<string, BacklogItem>();
    [...this.familyItems(), ...this.ownItems()].forEach(item => byId.set(item.id, item));
    return [...byId.values()].sort((a, b) => (b.createdAt ?? '').localeCompare(a.createdAt ?? ''));
  });

  open = computed(() => this.items().filter(item => !item.completed));
  done = computed(() =>
    this.items()
      .filter(item => item.completed)
      .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
  );

  /** Open to-dos from the old to-do list that haven't been copied into the backlog yet. */
  importableTodos = computed(() => {
    const imported = new Set(this.items().map(item => item.importedFromTodoId).filter(Boolean));
    const uid = this.auth.currentUser()?.uid;
    return this.todoService.items().filter(todo =>
      !todo.completed && !imported.has(todo.id) && (!todo.isPrivate || todo.userId === uid)
    );
  });

  constructor() {
    effect(() => {
      const uid = this.auth.currentUser()?.uid;
      this.unsubscribes.forEach(u => u());
      this.unsubscribes = [];
      this.familyItems.set([]);
      this.ownItems.set([]);
      if (!uid || !this.firestore.isInitialized()) {
        this.isLoading.set(false);
        return;
      }
      this.isLoading.set(true);
      const family = this.firestore.subscribeToWhereEquals<BacklogItem>(
        this.COLLECTION_NAME, 'scope', 'family', items => { this.familyItems.set(items); this.isLoading.set(false); }
      );
      const own = this.firestore.subscribeToWhereEquals<BacklogItem>(
        this.COLLECTION_NAME, 'createdByUid', uid, items => this.ownItems.set(items)
      );
      this.unsubscribes = [family, own].filter((u): u is Unsubscribe => !!u);
    });
  }

  ngOnDestroy(): void {
    this.unsubscribes.forEach(u => u());
  }

  async addItem(item: NewBacklogItem & { importedFromTodoId?: string }): Promise<string | null> {
    const user = this.auth.currentUser();
    if (!user) return null;
    const data: Partial<BacklogItem> = {
      title: item.title.trim() || 'Untitled',
      scope: item.scope ?? 'family',
      createdByUid: user.uid,
      createdByName: user.displayName || user.email || 'Someone',
      completed: false
    };
    if (item.notes?.trim()) data.notes = item.notes.trim();
    if (item.memberId) data.memberId = item.memberId;
    if (item.importedFromTodoId) data.importedFromTodoId = item.importedFromTodoId;
    return this.firestore.addDocument<BacklogItem>(this.COLLECTION_NAME, data);
  }

  /** Edits an item; an undefined field is removed from it. */
  async updateItem(id: string, updates: Partial<Pick<BacklogItem, 'title' | 'notes' | 'memberId' | 'scope'>>): Promise<boolean> {
    return this.firestore.updateDocument<BacklogItem>(this.COLLECTION_NAME, id, updates);
  }

  async setCompleted(id: string, completed: boolean): Promise<boolean> {
    const user = this.auth.currentUser();
    return this.firestore.updateDocument<BacklogItem>(this.COLLECTION_NAME, id, completed
      ? { completed: true, completedAt: new Date().toISOString(), completedByName: user?.displayName || user?.email || 'Someone' }
      : { completed: false, completedAt: undefined, completedByName: undefined });
  }

  async deleteItem(id: string): Promise<boolean> {
    return this.firestore.deleteDocument(this.COLLECTION_NAME, id);
  }

  /** Copies the old to-do list's open items in, minus their due dates and recurrence. Returns how many. */
  async importFromTodos(): Promise<number> {
    const todos = this.importableTodos();
    const results = await Promise.all(todos.map(todo => this.addItem({
      title: todo.title,
      notes: todo.description,
      memberId: todo.memberId,
      scope: todo.isPrivate ? 'private' : 'family',
      importedFromTodoId: todo.id
    })));
    return results.filter(Boolean).length;
  }
}
