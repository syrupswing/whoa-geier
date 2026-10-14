import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AuthService } from './auth.service';
import { FirestoreService } from './firestore.service';
import { HomeLocationService } from './home-location.service';
import { HouseholdService } from './household.service';

describe('HomeLocationService.originAddress', () => {
  const FAMILY = '100 Family Way';

  function setup(members: any[], myMemberId: string | null) {
    const membersSig = signal(members);
    TestBed.configureTestingModule({
      providers: [
        { provide: FirestoreService, useValue: { isInitialized: () => true, getDocument: async () => ({ address: FAMILY }) } },
        { provide: AuthService, useValue: { currentUser: signal({ uid: 'u1', email: 'me@example.com' }) } },
        {
          provide: HouseholdService,
          useValue: { myMemberId: signal(myMemberId), getMemberById: (id: string) => membersSig().find(m => m.id === id) }
        }
      ]
    });
    return TestBed.inject(HomeLocationService);
  }

  async function loaded(service: HomeLocationService) {
    TestBed.flushEffects();
    await Promise.resolve();
    await Promise.resolve();
    expect(service.address()).toBe(FAMILY);
  }

  it('is the signed-in person\'s own home address when they have one', async () => {
    const s = setup([{ id: 'm1', name: 'Nathan', homeAddress: '5 Oak St' }], 'm1');
    await loaded(s);
    expect(s.originAddress()).toBe('5 Oak St');
  });

  it('falls back to the family address when they have none', async () => {
    const s = setup([{ id: 'm1', name: 'Nathan' }], 'm1');
    await loaded(s);
    expect(s.originAddress()).toBe(FAMILY);
  });

  it('falls back to the family address when their login is not linked to anyone', async () => {
    const s = setup([{ id: 'm1', name: 'Nathan', homeAddress: '5 Oak St' }], null);
    await loaded(s);
    expect(s.originAddress()).toBe(FAMILY);
  });
});
