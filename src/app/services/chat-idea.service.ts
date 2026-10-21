import { Injectable, OnDestroy, computed, inject, signal } from '@angular/core';
import { Unsubscribe } from 'firebase/firestore';
import { FirestoreService } from './firestore.service';

/** A saved starter prompt for the home chat, shared by the whole family. */
export interface ChatIdea {
  id: string;
  icon: string;
  label: string;
  prompt: string;
  createdAt?: string;
}

const COLLECTION = 'chatIdeas';

@Injectable({ providedIn: 'root' })
export class ChatIdeaService implements OnDestroy {
  private readonly firestore = inject(FirestoreService);
  private unsubscribe: Unsubscribe | null = null;
  private readonly all = signal<ChatIdea[]>([]);

  /** Oldest first, so a new idea lands at the end next to the add button. */
  readonly ideas = computed(() => [...this.all()].sort((a, b) => (a.createdAt ?? '').localeCompare(b.createdAt ?? '')));

  constructor() {
    if (this.firestore.isInitialized()) {
      this.unsubscribe = this.firestore.subscribeToCollection<ChatIdea>(COLLECTION, items => this.all.set(items));
    }
  }

  ngOnDestroy(): void {
    this.unsubscribe?.();
  }

  async add(idea: Pick<ChatIdea, 'icon' | 'label' | 'prompt'>): Promise<boolean> {
    return this.firestore.setDocument<ChatIdea>(COLLECTION, crypto.randomUUID(), idea);
  }

  async update(id: string, idea: Pick<ChatIdea, 'icon' | 'label' | 'prompt'>): Promise<boolean> {
    return this.firestore.updateDocument<ChatIdea>(COLLECTION, id, idea);
  }

  async remove(id: string): Promise<boolean> {
    return this.firestore.deleteDocument(COLLECTION, id);
  }
}
