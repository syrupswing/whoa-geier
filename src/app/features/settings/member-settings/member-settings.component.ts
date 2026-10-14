import { Component, Input, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { AuthService } from '../../../services/auth.service';
import { MemberKind, SchoolMeals } from '../../../services/day-profile.service';
import { HouseholdService } from '../../../services/household.service';
import { MemberChanges, MemberSettingsService } from '../../../services/member-settings.service';
import { RemiScheduleService } from '../../../services/remi-schedule.service';
import { HomeLocationService } from '../../../services/home-location.service';
import { MemberDayEditorComponent } from '../../../shared/member-day-editor/member-day-editor.component';
import { AddressFieldComponent } from '../../../shared/address-field/address-field.component';
import { SettingRowComponent } from '../../../shared/setting-row/setting-row.component';
import { formatTime12h } from '../../../shared/time-format';
import { RemiScheduleComponent } from '../../remi-schedule/remi-schedule.component';

type AddressKey = 'homeAddress' | 'schoolAddress' | 'workAddress';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const LUNCH_LABEL: Record<string, string> = { hot: 'Hot lunch', pack: 'Packed lunch' };

/** One person's settings as a list of editable rows. With no `memberId` it's the signed-in person who hasn't set a first name yet. */
@Component({
  selector: 'app-member-settings',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule, MatSnackBarModule,
    SettingRowComponent, AddressFieldComponent, MemberDayEditorComponent, RemiScheduleComponent
  ],
  templateUrl: './member-settings.component.html',
  styleUrl: './member-settings.component.scss'
})
export class MemberSettingsComponent {
  private readonly household = inject(HouseholdService);
  private readonly settings = inject(MemberSettingsService);
  private readonly remiSchedule = inject(RemiScheduleService);
  private readonly homeLocation = inject(HomeLocationService);
  private readonly snackBar = inject(MatSnackBar);
  readonly auth = inject(AuthService);

  readonly weekdays = WEEKDAYS;

  private readonly memberIdSig = signal<string | null>(null);
  @Input() set memberId(value: string | null) { this.memberIdSig.set(value); }
  get memberId(): string | null { return this.memberIdSig(); }
  /** Whether this is the signed-in person's own tab (adds their login email). */
  @Input() isMe = false;

  readonly member = computed(() => {
    const id = this.memberIdSig();
    return id ? this.household.getMemberById(id) ?? null : null;
  });
  /** Remi's schedule has extras (school calendar links, exceptions, lunch menu) that no other child has. */
  readonly isRemi = computed(() => !!this.member() && this.remiSchedule.settings().memberId === this.member()!.id);

  saving = signal(false);

  // Drafts, reset from the saved value whenever a row opens for editing.
  nameDraft = '';
  kindDraft: MemberKind | '' = '';
  dietaryDraft = '';
  daysDraft: number[] = [];
  timeADraft = '';
  timeBDraft = '';
  lunchDraft: SchoolMeals['lunch'] | '' = '';
  calendarsDraft = '';
  addressDraft = '';
  emailDraft = '';

  // ── Display ──────────────────────────────────────────────────

  roleLabel = computed(() => {
    const kind = this.member()?.kind;
    return kind === 'child' ? 'Child' : kind === 'adult' ? 'Adult' : '';
  });
  dietaryLabel = computed(() => (this.member()?.dietaryRestrictions ?? []).join(', '));
  schoolDaysLabel = computed(() => this.daysLabel(this.member()?.routine?.schoolDays));
  workDaysLabel = computed(() => this.daysLabel(this.member()?.routine?.workDays));
  /** Where this person's login stands: signed in and linked, invited by email, or neither. */
  loginLabel = computed(() => {
    const id = this.memberIdSig();
    const invite = id ? this.household.invites().find(i => i.memberId === id) : undefined;
    if (!invite) return '';
    return invite.claimedByUid ? `${invite.id} · signed in` : `${invite.id} · invited, not signed in yet`;
  });
  /** Their own home address, or else the family's saved one (which is what drive times use for them until they set theirs). */
  homeAddressLabel = computed(() => this.member()?.homeAddress?.trim() || this.homeLocation.address());
  homeAddressInherited = computed(() => !this.member()?.homeAddress?.trim() && !!this.homeLocation.address());
  schoolTimesLabel = computed(() => {
    const r = this.member()?.routine;
    const parts = [r?.dropOffTime && `Drop-off ${this.time(r.dropOffTime)}`, r?.pickUpTime && `Pick-up ${this.time(r.pickUpTime)}`];
    return parts.filter(Boolean).join(' · ');
  });
  workTimesLabel = computed(() => {
    const r = this.member()?.routine;
    return r?.workStartTime || r?.workStopTime ? `${this.time(r.workStartTime) || '—'} to ${this.time(r.workStopTime) || '—'}` : '';
  });
  calendarsLabel = computed(() => (this.remiSchedule.settings().calendarIcalUrls ?? []).join('\n'));

  time(hhmm: string | null | undefined): string {
    return hhmm ? formatTime12h(hhmm) : '';
  }

  lunch(value: string | undefined): string {
    return value ? LUNCH_LABEL[value] ?? value : '';
  }

  private daysLabel(days: number[] | undefined): string {
    return (days ?? []).slice().sort().map(d => WEEKDAYS[d]).join(', ');
  }

  // ── Editing ──────────────────────────────────────────────────

  beginLogin(): void {
    this.emailDraft = this.household.invites().find(i => i.memberId === this.memberIdSig())?.id ?? '';
  }

  beginAddress(key: AddressKey): void {
    const own = this.member()?.[key]?.trim();
    this.addressDraft = own || (key === 'homeAddress' ? this.homeLocation.address() : '');
  }

  beginName(): void { this.nameDraft = this.member()?.name ?? ''; }
  beginRole(): void { this.kindDraft = this.member()?.kind ?? ''; }
  beginDietary(): void { this.dietaryDraft = this.dietaryLabel(); }
  beginDays(key: 'schoolDays' | 'workDays'): void { this.daysDraft = [...(this.member()?.routine?.[key] ?? [])]; }
  beginTimes(a: 'dropOffTime' | 'workStartTime', b: 'pickUpTime' | 'workStopTime'): void {
    const routine = this.member()?.routine;
    this.timeADraft = routine?.[a] ?? '';
    this.timeBDraft = routine?.[b] ?? '';
  }
  beginLunch(): void { this.lunchDraft = this.member()?.routine?.schoolMeals?.lunch ?? ''; }
  beginCalendars(): void { this.calendarsDraft = this.calendarsLabel(); }

  toggleDay(day: number): void {
    this.daysDraft = this.daysDraft.includes(day) ? this.daysDraft.filter(d => d !== day) : [...this.daysDraft, day].sort();
  }

  /** Runs a save, closes the row on success, and reports failure without losing the draft. */
  private async run(row: SettingRowComponent, work: () => Promise<unknown>): Promise<void> {
    if (this.saving()) return;
    this.saving.set(true);
    try {
      await work();
      row.close();
    } catch (err) {
      console.error('Saving setting failed:', err);
      this.snackBar.open('Could not save — try again', 'Close', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }

  private change(row: SettingRowComponent, changes: MemberChanges): Promise<void> {
    const id = this.memberIdSig();
    return this.run(row, () => this.settings.save(id!, changes));
  }

  saveName(row: SettingRowComponent): Promise<void> {
    const name = this.nameDraft.trim();
    if (!name) return Promise.resolve();
    // Without a member yet this is the signed-in person naming themselves, which also links their login.
    return this.memberIdSig()
      ? this.change(row, { name })
      : this.run(row, async () => this.memberIdSig.set(await this.settings.setMyFirstName(name)));
  }

  /** Sets, changes or (when emptied) removes the email whose sign-in is linked to this person. */
  saveLogin(row: SettingRowComponent): Promise<void> {
    const id = this.memberIdSig()!;
    const email = this.emailDraft.trim();
    return this.run(row, async () => {
      const current = this.household.invites().find(i => i.memberId === id);
      if (email) await this.household.inviteMember(id, email);
      else if (current && !current.claimedByUid) await this.household.cancelInvite(current.id);
    });
  }

  saveAddress(row: SettingRowComponent, key: AddressKey): Promise<void> {
    return this.change(row, { [key]: this.addressDraft.trim() });
  }

  /** Takes someone out of the family: their member, and any invitation for their email. Their own login is unaffected. */
  async remove(): Promise<void> {
    const member = this.member();
    if (!member || this.saving()) return;
    if (!confirm(`Remove ${member.name} from the family? Their settings and day-by-day details will no longer be shown.`)) return;
    this.saving.set(true);
    try {
      const invite = this.household.invites().find(i => i.memberId === member.id);
      if (invite && !invite.claimedByUid) await this.household.cancelInvite(invite.id);
      await this.household.removeMember(member.id);
    } catch (err) {
      console.error('Removing member failed:', err);
      this.snackBar.open('Could not remove them — try again', 'Close', { duration: 3000 });
    } finally {
      this.saving.set(false);
    }
  }

  saveRole(row: SettingRowComponent): Promise<void> {
    return this.change(row, { kind: this.kindDraft || undefined });
  }

  saveDietary(row: SettingRowComponent): Promise<void> {
    const dietaryRestrictions = this.dietaryDraft.split(',').map(s => s.trim()).filter(Boolean);
    return this.change(row, { dietaryRestrictions });
  }

  saveDays(row: SettingRowComponent, key: 'schoolDays' | 'workDays'): Promise<void> {
    return this.change(row, { routine: { [key]: this.daysDraft } });
  }

  saveTimes(row: SettingRowComponent, a: 'dropOffTime' | 'workStartTime', b: 'pickUpTime' | 'workStopTime'): Promise<void> {
    return this.change(row, { routine: { [a]: this.timeADraft || null, [b]: this.timeBDraft || null } });
  }

  saveLunch(row: SettingRowComponent): Promise<void> {
    const lunch = this.lunchDraft || undefined;
    const meals = { ...this.member()?.routine?.schoolMeals, lunch };
    return this.change(row, { routine: { schoolMeals: meals } });
  }

  saveCalendars(row: SettingRowComponent): Promise<void> {
    const calendarIcalUrls = this.calendarsDraft.split('\n').map(s => s.trim()).filter(Boolean);
    return this.run(row, () => this.remiSchedule.saveSettings({ ...this.remiSchedule.settings(), calendarIcalUrls }));
  }
}
