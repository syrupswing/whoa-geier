import { Injectable, inject, signal } from '@angular/core';
import { FirestoreService } from './firestore.service';

export interface ExplicitFact {
  id: string;
  memberId?: string;
  factText: string;
  category: string;
  createdAt?: string;
}

export interface LearnedPattern {
  id: string;
  memberId?: string;
  patternDescription: string;
  confidenceScore: number;
  supportingEventCount: number;
  lastObservedAt?: string;
}

export interface RecentContextEntry {
  id: string;
  description: string;
  relevantDateStart: string;
  relevantDateEnd: string;
  archivedAt?: string | null;
}

// This memory system exists to be read by server-side Cloud Functions (nightly smart
// alerts, briefing generation), so it deliberately has no localStorage fallback like other
// services here — data that only lives on-device can't inform a job that runs on a schedule.
@Injectable({
  providedIn: 'root'
})
export class MemoryService {
  private firestoreService = inject(FirestoreService);

  private readonly FACTS_COLLECTION = 'explicitFacts';
  private readonly PATTERNS_COLLECTION = 'learnedPatterns';
  private readonly CONTEXT_COLLECTION = 'recentContext';

  explicitFacts = signal<ExplicitFact[]>([]);
  learnedPatterns = signal<LearnedPattern[]>([]);
  recentContext = signal<RecentContextEntry[]>([]);

  constructor() {
    if (this.firestoreService.isInitialized()) {
      this.firestoreService.subscribeToCollection<ExplicitFact>(
        this.FACTS_COLLECTION, (items) => this.explicitFacts.set(items)
      );
      this.firestoreService.subscribeToCollection<LearnedPattern>(
        this.PATTERNS_COLLECTION, (items) => this.learnedPatterns.set(items)
      );
      this.firestoreService.subscribeToCollection<RecentContextEntry>(
        this.CONTEXT_COLLECTION, (items) => this.recentContext.set(items)
      );
    }
  }

  factsForMember(memberId: string): ExplicitFact[] {
    return this.explicitFacts().filter(f => f.memberId === memberId || !f.memberId);
  }

  activeRecentContext(asOf: Date = new Date()): RecentContextEntry[] {
    return this.recentContext().filter(entry =>
      !entry.archivedAt && new Date(entry.relevantDateEnd) >= asOf
    );
  }

  async addExplicitFact(fact: Omit<ExplicitFact, 'id' | 'createdAt'>): Promise<string | null> {
    return this.firestoreService.addDocument<ExplicitFact>(this.FACTS_COLLECTION, fact);
  }

  async updateExplicitFact(id: string, updates: Partial<ExplicitFact>): Promise<boolean> {
    return this.firestoreService.updateDocument<ExplicitFact>(this.FACTS_COLLECTION, id, updates);
  }

  async deleteExplicitFact(id: string): Promise<boolean> {
    return this.firestoreService.deleteDocument(this.FACTS_COLLECTION, id);
  }

  async addRecentContext(entry: Omit<RecentContextEntry, 'id' | 'archivedAt'>): Promise<string | null> {
    return this.firestoreService.addDocument<RecentContextEntry>(
      this.CONTEXT_COLLECTION, { ...entry, archivedAt: null }
    );
  }

  async archiveRecentContext(id: string): Promise<boolean> {
    return this.firestoreService.updateDocument<RecentContextEntry>(
      this.CONTEXT_COLLECTION, id, { archivedAt: new Date().toISOString() }
    );
  }

  async deleteRecentContext(id: string): Promise<boolean> {
    return this.firestoreService.deleteDocument(this.CONTEXT_COLLECTION, id);
  }

  // learnedPatterns has no client write path here — it's populated by the nightly
  // smart-alerts Cloud Function via the Admin SDK (see firestore.rules).
}
