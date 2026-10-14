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

describe('MemberSettingsComponent — signed-in person without a member yet', () => {
  const setFirstName = jasmine.createSpy('setMyFirstName').and.resolveTo('m1');

  function setup() {
    setFirstName.calls.reset();
    TestBed.configureTestingModule({
      imports: [MemberSettingsComponent, NoopAnimationsModule],
      providers: [
        { provide: HouseholdService, useValue: { members: signal([]), invites: signal([]), getMemberById: () => undefined, myMemberId: signal(null) } },
        { provide: MemberSettingsService, useValue: { setMyFirstName: setFirstName, save: jasmine.createSpy('save').and.resolveTo() } },
        { provide: RemiScheduleService, useValue: { settings: signal({}) } },
        { provide: HomeLocationService, useValue: { address: signal('') } },
        { provide: AuthService, useValue: { currentUser: signal({ uid: 'u1', email: 'me@example.com', displayName: null }) } }
      ]
    })
      // The day editor and Remi page only render for a person who exists, and pull in unrelated services.
      .overrideComponent(MemberSettingsComponent, {
        remove: { imports: [MemberDayEditorComponent, RemiScheduleComponent] },
        add: { schemas: [NO_ERRORS_SCHEMA] }
      });
    const fixture = TestBed.createComponent(MemberSettingsComponent);
    fixture.componentInstance.memberId = null;
    fixture.componentInstance.isMe = true;
    fixture.detectChanges();
    return { fixture, el: fixture.nativeElement as HTMLElement };
  }

  it('shows First name as not set and the login email', () => {
    const { el } = setup();
    const text = el.textContent ?? '';
    expect(text).toContain('First name');
    expect(text).toContain('Not set');
    expect(text).toContain('me@example.com');
  });

  it('lets them edit and save a first name', async () => {
    const { fixture, el } = setup();
    const row = el.querySelector('app-setting-row') as HTMLElement;
    (row.querySelector('.edit-btn') as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const input = el.querySelector('input[name="firstName"]') as HTMLInputElement;
    expect(input).withContext('the first-name editor should open').not.toBeNull();
    input.value = 'Nathan';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    (row.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(setFirstName).toHaveBeenCalledOnceWith('Nathan');
    expect(el.querySelector('input[name="firstName"]')).withContext('the editor should close after saving').toBeNull();
  });
});
