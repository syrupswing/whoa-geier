import { Injectable } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';

interface OrchestratorResponse<T> {
  success: boolean;
  result: T;
  suggestionId: string | null;
  error?: string;
}

// Shared entry point for AI features that have been migrated off the old per-feature
// GithubAiService prompt-building. The prompt template, memory lookup, and structured-JSON
// parsing all live server-side in the orchestratedGenerate Cloud Function — this service
// just sends a featureType + payload and gets the parsed result back.
@Injectable({
  providedIn: 'root'
})
export class AiOrchestratorService {
  async generate<T = any>(featureType: string, payload: Record<string, any> = {}, memberId?: string): Promise<T> {
    const functions = getFunctions();
    const call = httpsCallable<
      { featureType: string; payload: Record<string, any>; memberId?: string },
      OrchestratorResponse<T>
    >(functions, 'orchestratedGenerate');

    const response = await call({ featureType, payload, memberId });
    if (!response.data?.success) {
      throw new Error(response.data?.error || 'Failed to generate suggestion');
    }
    return response.data.result;
  }
}
