import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '../../services/auth.service';
import { FirestoreService } from '../../services/firestore.service';
import { HouseholdService } from '../../services/household.service';
import { LocalStorageService } from '../../services/local-storage.service';
import { MemberSettingsService } from '../../services/member-settings.service';
import { RemiScheduleService } from '../../services/remi-schedule.service';
import { buildPeopleTabs } from './people-tabs';

/** Just enough of Firestore: documents in memory, with snapshot callbacks fired synchronously on local writes. */
class FakeFirestore {
  docs = new Map<string, any>();
  private listeners = new Map<string, Array<(d: any) => void>>();
  private colListeners = new Map<string, Array<(items: any[]) => void>>();
  isInitialized = () => true;
  private key = (c: string, id: string) => `${c}/${id}`;
  private emit(c: string, id: string) {
    const d = this.docs.get(this.key(c, id));
    (this.listeners.get(this.key(c, id)) ?? []).forEach(cb => cb(d ? { id, ...d } : null));
    const items = [...this.docs.entries()].filter(([k]) => k.startsWith(c + '/')).map(([k, v]) => ({ id: k.slice(c.length + 1), ...v }));
    (this.colListeners.get(c) ?? []).forEach(cb => cb(items));
  }
  /** Collections whose writes are rejected, as a security rule would do (setDocument reports it by returning false). */
  denied = new Set<string>();
  /** Real Firestore refuses `undefined` anywhere in a document, including nested values. */
  private hasUndefined(v: any): boolean {
    if (v === undefined) return true;
    return v !== null && typeof v === 'object' && Object.values(v).some(x => this.hasUndefined(x));
  }
  async setDocument(c: string, id: string, data: any) { if (this.denied.has(c) || this.hasUndefined(data)) return false; this.docs.set(this.key(c, id), JSON.parse(JSON.stringify(data))); this.emit(c, id); return true; }
  async getDocument(c: string, id: string) { const d = this.docs.get(this.key(c, id)); return d ? { id, ...d } : null; }
  async deleteDocument(c: string, id: string) { this.docs.delete(this.key(c, id)); this.emit(c, id); return true; }
  subscribeToDocument(c: string, id: string, cb: (d: any) => void) {
    const k = this.key(c, id);
    this.listeners.set(k, [...(this.listeners.get(k) ?? []), cb]);
    const d = this.docs.get(k); cb(d ? { id, ...d } : null);
    return () => {};
  }
  subscribeToCollection(c: string, cb: (items: any[]) => void) {
    this.colListeners.set(c, [...(this.colListeners.get(c) ?? []), cb]); cb([]);
    return () => {};
  }
}

describe('People tabs when the signed-in person sets a first name', () => {
  const EMAIL = 'me@example.com';

  function setup(existingMembers: any[] = []) {
    const fs = new FakeFirestore();
    if (existingMembers.length) fs.docs.set('household/main', { id: 'main', members: existingMembers });
    TestBed.configureTestingModule({
      providers: [
        { provide: FirestoreService, useValue: fs },
        { provide: AuthService, useValue: { currentUser: signal({ uid: 'u1', email: EMAIL, displayName: null }) } },
        { provide: LocalStorageService, useValue: { getItem: () => null, setItem: () => {}, removeItem: () => {} } },
        { provide: RemiScheduleService, useValue: { settings: signal({}) } }
      ]
    });
    const household = TestBed.inject(HouseholdService);
    const labels = () => buildPeopleTabs(household.members(), household.myMemberId(), EMAIL).map(t => t.label);
    return { fs, household, labels, memberSettings: TestBed.inject(MemberSettingsService) };
  }

  it('starts with one tab, labelled with the email', () => {
    expect(setup().labels()).toEqual([EMAIL]);
  });

  it('after naming themselves, has one tab labelled with the first name — not a duplicate', async () => {
    const { memberSettings, household, fs, labels } = setup();
    await memberSettings.setMyFirstName('Nathan');
    expect(fs.docs.get('memberLinks/u1')).withContext('the link should be stored').toBeDefined();
    expect(household.myMemberId()).withContext('login should be linked to the new member').not.toBeNull();
    expect(labels()).toEqual(['Nathan']);
  });

  it('reuses an existing member of the same name instead of adding a second one', async () => {
    const { memberSettings, household, labels } = setup([{ id: 'm9', name: 'Nathan', dietaryRestrictions: [], preferences: {} }]);
    await memberSettings.setMyFirstName('nathan');
    expect(household.members().length).toBe(1);
    expect(household.myMemberId()).toBe('m9');
    expect(labels()).toEqual(['Nathan']);
  });

  it('fails loudly, rather than leaving an unlinked login, when the link cannot be saved — and a retry reuses the member', async () => {
    const { memberSettings, household, fs, labels } = setup();
    fs.denied.add('memberLinks');
    await expectAsync(memberSettings.setMyFirstName('Nathan')).toBeRejected();
    expect(household.myMemberId()).toBeNull();

    // The link works on the next try; the member added the first time is reused, not added again.
    fs.denied.clear();
    await memberSettings.setMyFirstName('Nathan');
    expect(household.members().length).toBe(1);
    expect(labels()).toEqual(['Nathan']);
  });

  it('can clear a member\'s role without Firestore rejecting an undefined value', async () => {
    const { memberSettings, household, fs } = setup([{ id: 'm1', name: 'Remi', kind: 'child', dietaryRestrictions: [], preferences: {} }]);
    await memberSettings.save('m1', { kind: undefined });
    expect(household.getMemberById('m1')?.kind).toBeUndefined();
    expect(fs.docs.get('household/main').members[0].kind).toBeUndefined();
  });

  it('reports a household save that Firestore rejected, instead of pretending it worked', async () => {
    const { memberSettings, fs } = setup([{ id: 'm1', name: 'Remi', dietaryRestrictions: [], preferences: {} }]);
    fs.denied.add('household');
    await expectAsync(memberSettings.save('m1', { name: 'Remy' })).toBeRejected();
  });

  it('stores per-person addresses on the member', async () => {
    const { memberSettings, household, fs } = setup([{ id: 'm1', name: 'Remi', kind: 'child', dietaryRestrictions: [], preferences: {} }]);
    await memberSettings.save('m1', { homeAddress: '1 Home St', schoolAddress: '2 School Ave' });
    expect(household.getMemberById('m1')?.homeAddress).toBe('1 Home St');
    expect(fs.docs.get('household/main').members[0].schoolAddress).toBe('2 School Ave');
  });

  it('adds a person with no dietary info, and offers their email an invitation', async () => {
    const { memberSettings, household, fs } = setup();
    const { id, inviteError } = await memberSettings.addMember('  Sam ', 'adult', 'Sam@Example.com');
    expect(inviteError).toBeUndefined();
    const member = household.getMemberById(id)!;
    expect(member.name).toBe('Sam');
    expect(member.kind).toBe('adult');
    expect(member.dietaryRestrictions).toEqual([]);
    expect(fs.docs.get('memberInvites/sam@example.com')?.memberId).toBe(id);
  });

  it('still adds the person when the email is unusable, and says so', async () => {
    const { memberSettings, household } = setup();
    const { id, inviteError } = await memberSettings.addMember('Sam', 'child', 'not-an-email');
    expect(household.getMemberById(id)?.name).toBe('Sam');
    expect(inviteError).toContain('valid email');
  });

  it('adds a person with no email without trying to invite anyone', async () => {
    const { memberSettings, household, fs } = setup();
    const { id, inviteError } = await memberSettings.addMember('Remi', 'child');
    expect(inviteError).toBeUndefined();
    expect(household.getMemberById(id)?.kind).toBe('child');
    expect([...fs.docs.keys()].some(k => k.startsWith('memberInvites/'))).toBeFalse();
  });

  it('lists everyone else after the signed-in person, by name', () => {
    const members: any[] = [
      { id: 'a', name: 'Zed', dietaryRestrictions: [], preferences: {} },
      { id: 'b', name: 'Remi', dietaryRestrictions: [], preferences: {}, kind: 'child' },
      { id: 'c', name: 'Nathan', dietaryRestrictions: [], preferences: {}, kind: 'adult' }
    ];
    expect(buildPeopleTabs(members, 'c', EMAIL).map(t => t.label)).toEqual(['Nathan', 'Remi', 'Zed']);
  });

  it('treats a link to a deleted member as no link', () => {
    const members: any[] = [{ id: 'b', name: 'Remi', dietaryRestrictions: [], preferences: {} }];
    expect(buildPeopleTabs(members, 'gone', EMAIL).map(t => t.label)).toEqual([EMAIL, 'Remi']);
  });
});
