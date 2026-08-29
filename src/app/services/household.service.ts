import { Injectable, inject, signal, computed } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { LocalStorageService } from './local-storage.service';

export interface FamilyMember {
  id: string;
  name: string;
  dietaryRestrictions: string[];
  preferences: Record<string, any>;
}

export interface Household {
  id: string;
  members: FamilyMember[];
  createdAt?: string;
}

@Injectable({
  providedIn: 'root'
})
export class HouseholdService {
  private firestoreService = inject(FirestoreService);
  private localStorageService = inject(LocalStorageService);

  private readonly COLLECTION_NAME = 'household';
  private readonly DOC_ID = 'main';
  private readonly LOCAL_STORAGE_KEY = 'household';

  household = signal<Household | null>(null);
  members = computed(() => this.household()?.members ?? []);
  isLoading = signal<boolean>(false);

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    this.isLoading.set(true);

    if (this.firestoreService.isInitialized()) {
      this.firestoreService.subscribeToDocument<Household>(
        this.COLLECTION_NAME,
        this.DOC_ID,
        (data) => {
          if (data) {
            this.household.set(data);
            this.saveToLocalStorage(data);
          } else {
            this.loadFromLocalStorage();
          }
          this.isLoading.set(false);
        }
      );
    } else {
      this.loadFromLocalStorage();
      this.isLoading.set(false);
    }
  }

  private loadFromLocalStorage(): void {
    const saved = this.localStorageService.getItem<Household>(this.LOCAL_STORAGE_KEY);
    this.household.set(saved ?? { id: this.DOC_ID, members: [] });
  }

  private saveToLocalStorage(household: Household): void {
    this.localStorageService.setItem(this.LOCAL_STORAGE_KEY, household);
  }

  getMemberById(memberId: string): FamilyMember | undefined {
    return this.members().find(m => m.id === memberId);
  }

  async addMember(member: Omit<FamilyMember, 'id'>): Promise<void> {
    const newMember: FamilyMember = { ...member, id: crypto.randomUUID() };
    const current = this.household() ?? { id: this.DOC_ID, members: [] };
    await this.persist({ ...current, members: [...current.members, newMember] });
  }

  async updateMember(memberId: string, updates: Partial<Omit<FamilyMember, 'id'>>): Promise<void> {
    const current = this.household();
    if (!current) return;
    await this.persist({
      ...current,
      members: current.members.map(m => m.id === memberId ? { ...m, ...updates } : m)
    });
  }

  async removeMember(memberId: string): Promise<void> {
    const current = this.household();
    if (!current) return;
    await this.persist({
      ...current,
      members: current.members.filter(m => m.id !== memberId)
    });
  }

  private async persist(household: Household): Promise<void> {
    this.household.set(household);
    if (this.firestoreService.isInitialized()) {
      await this.firestoreService.setDocument(this.COLLECTION_NAME, this.DOC_ID, household);
    } else {
      this.saveToLocalStorage(household);
    }
  }
}
