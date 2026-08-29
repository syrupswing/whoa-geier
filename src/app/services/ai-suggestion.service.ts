import { Injectable, inject, signal } from '@angular/core';
import { FirestoreService } from './firestore.service';

export type AiSuggestionStatus = 'pending' | 'accepted' | 'edited' | 'rejected';

export interface AiSuggestion {
  id: string;
  featureType: string;
  memberId?: string;
  generatedContent: Record<string, any>;
  contextSnapshot: Record<string, any>;
  status: AiSuggestionStatus;
  editedContent?: Record<string, any> | null;
  createdAt?: string;
}

// Reads the log of AI-generated suggestions and records the family's reaction to them
// (accepted/edited/rejected), so learned patterns can later be inferred from this history
// instead of asserted as fact. Suggestion docs are created server-side only, via the Admin
// SDK in the orchestrator (see firestore.rules) — this service never creates one.
@Injectable({
  providedIn: 'root'
})
export class AiSuggestionService {
  private firestoreService = inject(FirestoreService);
  private readonly COLLECTION_NAME = 'aiSuggestions';

  suggestions = signal<AiSuggestion[]>([]);

  constructor() {
    if (this.firestoreService.isInitialized()) {
      this.firestoreService.subscribeToCollection<AiSuggestion>(
        this.COLLECTION_NAME, (items) => this.suggestions.set(items)
      );
    }
  }

  forFeature(featureType: string): AiSuggestion[] {
    return this.suggestions().filter(s => s.featureType === featureType);
  }

  async markAccepted(id: string): Promise<boolean> {
    return this.firestoreService.updateDocument<AiSuggestion>(
      this.COLLECTION_NAME, id, { status: 'accepted' }
    );
  }

  async markEdited(id: string, editedContent: Record<string, any>): Promise<boolean> {
    return this.firestoreService.updateDocument<AiSuggestion>(
      this.COLLECTION_NAME, id, { status: 'edited', editedContent }
    );
  }

  async markRejected(id: string): Promise<boolean> {
    return this.firestoreService.updateDocument<AiSuggestion>(
      this.COLLECTION_NAME, id, { status: 'rejected' }
    );
  }
}
