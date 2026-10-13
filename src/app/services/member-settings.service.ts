import { Injectable, inject } from '@angular/core';
import { MemberKind, MemberRoutine } from './day-profile.service';
import { FamilyMember, HouseholdService } from './household.service';
import { RemiScheduleService } from './remi-schedule.service';

/** Edits to one household member, as the Settings page makes them. Only the fields present are changed. */
export interface MemberChanges {
  name?: string;
  kind?: MemberKind | undefined;
  dietaryRestrictions?: string[];
  routine?: Partial<MemberRoutine>;
}

/** Saves a member's settings, keeping Remi's separate schedule settings in step with his routine. */
@Injectable({ providedIn: 'root' })
export class MemberSettingsService {
  private readonly household = inject(HouseholdService);
  private readonly remiSchedule = inject(RemiScheduleService);

  async save(memberId: string, changes: MemberChanges): Promise<void> {
    const member = this.household.getMemberById(memberId);
    if (!member) throw new Error('That family member no longer exists');

    const routine = changes.routine ? { ...member.routine, ...changes.routine } : undefined;
    await this.household.updateMember(memberId, {
      ...('name' in changes && { name: changes.name }),
      ...('kind' in changes && { kind: changes.kind }),
      ...(changes.dietaryRestrictions && { dietaryRestrictions: changes.dietaryRestrictions }),
      ...(routine && { routine })
    });

    // Remi's regular schedule also lives in the Remi page's settings (they carry his calendar links and
    // are what the briefing falls back to), so a routine edit goes through them to keep the two matching.
    const remi = this.remiSchedule.settings();
    if (routine && remi.memberId === memberId && (member.kind === 'child' || changes.kind === 'child')) {
      await this.remiSchedule.saveSettings({
        ...remi,
        schoolDays: routine.schoolDays ?? remi.schoolDays,
        schoolStartTime: routine.dropOffTime || remi.schoolStartTime,
        schoolEndTime: routine.pickUpTime || remi.schoolEndTime,
        defaultLunchPlan: routine.schoolMeals?.lunch ?? remi.defaultLunchPlan
      });
    }
  }

  /**
   * Sets the first name of the person signed in. If their login is linked to a member, that member is
   * renamed; otherwise it links to the existing member with that name, or creates one (as an adult)
   * and links to it, so the name immediately works for matching events and attributing changes.
   */
  async setMyFirstName(name: string): Promise<string> {
    const first = name.trim();
    if (!first) throw new Error('A first name is required');

    const linked = this.household.myMemberId();
    if (linked && this.household.getMemberById(linked)) {
      await this.household.updateMember(linked, { name: first });
      return linked;
    }
    const existing = this.household.members().find((m: FamilyMember) => m.name.trim().toLowerCase() === first.toLowerCase());
    const id = existing
      ? existing.id
      : await this.household.addMember({ name: first, dietaryRestrictions: [], preferences: {}, kind: 'adult' });
    await this.household.linkCurrentUserToMember(id);
    return id;
  }
}
