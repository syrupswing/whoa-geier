import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { Unsubscribe } from 'firebase/firestore';
import { FirestoreService } from './firestore.service';
import { LocalStorageService } from './local-storage.service';
import { AuthService } from './auth.service';

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

/** Links one Firebase Auth account to the household member it belongs to — lets security
 * rules recognize "this login is Remi" for things like private, self-only calendar events.
 * Keyed by the account's own uid so a person can only ever claim/write their own link. */
interface MemberLink {
  memberId: string;
  linkedAt: string;
}

@Injectable({
  providedIn: 'root'
})
export class HouseholdService {
  private firestoreService = inject(FirestoreService);
  private localStorageService = inject(LocalStorageService);
  private authService = inject(AuthService);

  private readonly COLLECTION_NAME = 'household';
  private readonly DOC_ID = 'main';
  private readonly LOCAL_STORAGE_KEY = 'household';
  private readonly MEMBER_LINKS_COLLECTION = 'memberLinks';

  household = signal<Household | null>(null);
  members = computed(() => this.household()?.members ?? []);
  isLoading = signal<boolean>(false);

  /** The household member the currently signed-in account is linked to, if any. */
  myMemberId = signal<string | null>(null);
  private memberLinkUnsubscribe: Unsubscribe | null = null;

  constructor() {
    this.load();
    // AuthService.currentUser resolves asynchronously (onAuthStateChanged), so this must
    // react to it rather than check once — re-subscribing to the right uid's link doc
    // whenever sign-in state actually changes.
    effect(() => {
      const uid = this.authService.currentUser()?.uid;
      this.watchMyMemberLink(uid);
    }, { allowSignalWrites: true });
  }

  private watchMyMemberLink(uid: string | undefined): void {
    if (this.memberLinkUnsubscribe) {
      this.memberLinkUnsubscribe();
      this.memberLinkUnsubscribe = null;
    }
    if (!uid || !this.firestoreService.isInitialized()) {
      this.myMemberId.set(null);
      return;
    }
    this.memberLinkUnsubscribe = this.firestoreService.subscribeToDocument<MemberLink>(
      this.MEMBER_LINKS_COLLECTION,
      uid,
      (link) => this.myMemberId.set(link?.memberId ?? null)
    );
  }

  /** Claims a household member profile as "me" for the currently signed-in account. */
  async linkCurrentUserToMember(memberId: string): Promise<void> {
    const uid = this.authService.currentUser()?.uid;
    if (!uid) return;
    const link: MemberLink = { memberId, linkedAt: new Date().toISOString() };
    await this.firestoreService.setDocument(this.MEMBER_LINKS_COLLECTION, uid, link);
    this.myMemberId.set(memberId);
  }

  async unlinkCurrentUser(): Promise<void> {
    const uid = this.authService.currentUser()?.uid;
    if (!uid) return;
    await this.firestoreService.deleteDocument(this.MEMBER_LINKS_COLLECTION, uid);
    this.myMemberId.set(null);
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
