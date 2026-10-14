import { NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { AuthService } from '../../../services/auth.service';
import { HomeLocationService } from '../../../services/home-location.service';
import { HouseholdService } from '../../../services/household.service';
import { MemberSettingsService } from '../../../services/member-settings.service';
import { RemiScheduleService } from '../../../services/remi-schedule.service';
import { MemberDayEditorComponent } from '../../../shared/member-day-editor/member-day-editor.component';
import { RemiScheduleComponent } from '../../remi-schedule/remi-schedule.component';
import { MemberSettingsComponent } from './member-settings.component';

describe('MemberSettingsComponent — addresses', () => {
  function render(member: any, familyAddress = '', isMe = false) {
    TestBed.configureTestingModule({
      imports: [MemberSettingsComponent, NoopAnimationsModule],
      providers: [
        {
          provide: HouseholdService,
          useValue: {
            members: signal([member]), invites: signal([]), myMemberId: signal(null),
            getMemberById: (id: string) => (id === member.id ? member : undefined)
          }
        },
        { provide: MemberSettingsService, useValue: { save: jasmine.createSpy('save').and.resolveTo(), setMyFirstName: jasmine.createSpy() } },
        { provide: RemiScheduleService, useValue: { settings: signal({}) } },
        { provide: HomeLocationService, useValue: { address: signal(familyAddress) } },
        { provide: AuthService, useValue: { currentUser: signal({ uid: 'u1', email: 'me@example.com', displayName: null }) } }
      ]
    }).overrideComponent(MemberSettingsComponent, {
      remove: { imports: [MemberDayEditorComponent, RemiScheduleComponent] },
      add: { schemas: [NO_ERRORS_SCHEMA] }
    });
    const fixture = TestBed.createComponent(MemberSettingsComponent);
    fixture.componentInstance.memberId = member.id;
    fixture.componentInstance.isMe = isMe;
    fixture.detectChanges();
    return (fixture.nativeElement as HTMLElement).textContent ?? '';
  }

  const base = { dietaryRestrictions: [], preferences: {} };

  it('gives everyone a home address, and a child a school address but no work address', () => {
    const text = render({ id: 'c', name: 'Remi', kind: 'child', schoolAddress: '2 School Ave', ...base });
    expect(text).toContain('Home address');
    expect(text).toContain('School address');
    expect(text).toContain('2 School Ave');
    expect(text).not.toContain('Work address');
  });

  it('gives an adult a work address but no school address', () => {
    const text = render({ id: 'a', name: 'Sam', kind: 'adult', workAddress: '9 Office Rd', ...base });
    expect(text).toContain('Home address');
    expect(text).toContain('Work address');
    expect(text).toContain('9 Office Rd');
    expect(text).not.toContain('School address');
  });

  it('shows the family address, and says so, for someone who has not set their own', () => {
    const text = render({ id: 'a', name: 'Sam', kind: 'adult', ...base }, '100 Family Way');
    expect(text).toContain('100 Family Way');
    expect(text).toContain("Using the family's saved address");
  });

  it('shows their own home address, without the family-address note, once set', () => {
    const text = render({ id: 'a', name: 'Sam', kind: 'adult', homeAddress: '5 Oak St', ...base }, '100 Family Way');
    expect(text).toContain('5 Oak St');
    expect(text).not.toContain("Using the family's saved address");
  });

  it('offers to remove someone else from the family', () => {
    expect(render({ id: 'c', name: 'Remi', kind: 'child', ...base }, '', false)).toContain('Remove Remi from the family');
  });

  it('does not offer to remove yourself', () => {
    expect(render({ id: 'a', name: 'Sam', kind: 'adult', ...base }, '', true)).not.toContain('from the family');
  });
});
