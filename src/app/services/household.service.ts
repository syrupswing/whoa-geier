import { Injectable, inject, signal, computed, effect } from '@angular/core';
import { Unsubscribe } from 'firebase/firestore';
import { FirestoreService } from './firestore.service';
import { LocalStorageService } from './local-storage.service';
import { AuthService } from './auth.service';
import { MemberKind, MemberRoutine } from './day-profile.service';

export interface FamilyMember {
  id: string;
  name: string;
  dietaryRestrictions: string[];
  preferences: Record<string, any>;
  /** Decides which day-profile fields apply (school vs. work); unset members get no day profile. */
  kind?: MemberKind;
  /** The member's regular week, which stored day-profile overrides sit on top of. */
  routine?: MemberRoutine;
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

/** A standing offer to link whoever signs in with `email` to a household member. Doc id is the lower-cased email. */
export interface MemberInvite {
  id: string;
  memberId: string;
  invitedByUid?: string;
  /** Set once that person has signed in and been linked. */
  claimedByUid?: string;
  claimedAt?: string;
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
  private readonly INVITES_COLLECTION = 'memberInvites';

  household = signal<Household | null>(null);
  members = computed(() => this.household()?.members ?? []);
  isLoading = signal<boolean>(false);

  /** The household member the currently signed-in account is linked to, if any. */
  myMemberId = signal<string | null>(null);
  /** Invitations by email, pending or claimed. Doc ids are the lower-cased emails. */
  invites = signal<MemberInvite[]>([]);
  private memberLinkUnsubscribe: Unsubscribe | null = null;

  constructor() {
    this.load();
    if (this.firestoreService.isInitialized()) {
      this.firestoreService.subscribeToCollection<MemberInvite>(this.INVITES_COLLECTION, items => this.invites.set(items));
    }
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
      (link) => {
        this.myMemberId.set(link?.memberId ?? null);
        // First sign-in of someone who was invited by email: link them without making them pick themselves.
        if (!link) void this.claimInvite(uid);
      }
    );
  }

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  /** The invitation for a member, if they have one. */
  inviteFor(memberId: string): MemberInvite | undefined {
    return this.invites().find(i => i.memberId === memberId);
  }

  /**
   * Offers to link whoever signs in with `email` to this member (replacing an unclaimed offer they already
   * had). The link happens on that person's first sign-in; a claimed invitation can't be reassigned.
   */
  async inviteMember(memberId: string, email: string): Promise<void> {
    const id = this.normalizeEmail(email);
    if (!/^\S+@\S+\.\S+$/.test(id)) throw new Error('Enter a valid email address');
    const taken = this.invites().find(i => i.id === id && i.memberId !== memberId);
    if (taken) throw new Error('That email is already invited as someone else');

    const previous = this.inviteFor(memberId);
    if (previous && previous.id !== id && !previous.claimedByUid) await this.cancelInvite(previous.id);
    const invite: Omit<MemberInvite, 'id'> = { memberId, invitedByUid: this.authService.currentUser()?.uid };
    await this.firestoreService.setDocument(this.INVITES_COLLECTION, id, invite);
  }

  async cancelInvite(email: string): Promise<void> {
    await this.firestoreService.deleteDocument(this.INVITES_COLLECTION, this.normalizeEmail(email));
  }

  private async claimInvite(uid: string): Promise<void> {
    const user = this.authService.currentUser();
    if (!user?.email || user.uid !== uid) return;
    const id = this.normalizeEmail(user.email);
    const invite = await this.firestoreService.getDocument<MemberInvite>(this.INVITES_COLLECTION, id);
    if (!invite || (invite.claimedByUid && invite.claimedByUid !== uid)) return;
    // The member may have been removed since the invitation was sent.
    const members = (await this.firestoreService.getDocument<Household>(this.COLLECTION_NAME, this.DOC_ID))?.members ?? [];
    if (!members.some(m => m.id === invite.memberId)) return;

    await this.linkCurrentUserToMember(invite.memberId);
    await this.firestoreService.setDocument(this.INVITES_COLLECTION, id, {
      memberId: invite.memberId,
      invitedByUid: invite.invitedByUid,
      claimedByUid: uid,
      claimedAt: new Date().toISOString()
    });
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

  async addMember(member: Omit<FamilyMember, 'id'>): Promise<string> {
    const newMember: FamilyMember = { ...member, id: crypto.randomUUID() };
    const current = this.household() ?? { id: this.DOC_ID, members: [] };
    await this.persist({ ...current, members: [...current.members, newMember] });
    return newMember.id;
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
