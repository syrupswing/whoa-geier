import { Injectable, inject } from '@angular/core';
import { DayProfileFields, DayProfileService, FieldSource, MemberKind, DayProfileField, SchoolMeals } from './day-profile.service';
import { HouseholdService } from './household.service';

/** One member's day with the regular routine and any stored overrides combined. */
export interface ResolvedDay extends DayProfileFields {
  memberId: string;
  date: string;
  kind: MemberKind;
  /** Per field: where the value in effect came from. Fields filled from the routine are 'default'. */
  sources: Partial<Record<DayProfileField, FieldSource>>;
}

/**
 * The one place that answers "what does this person's day look like?" — the briefing, dashboard
 * and alerts should all read through here rather than from the routine settings directly.
 * Reads signals only, so it can be called inside a `computed`.
 */
@Injectable({ providedIn: 'root' })
export class DayResolverService {
  private readonly household = inject(HouseholdService);
  private readonly profiles = inject(DayProfileService);

  /** Null for a member with no `kind` (nothing to resolve) or an unknown member. */
  resolve(memberId: string, date: string): ResolvedDay | null {
    const member = this.household.getMemberById(memberId);
    if (!member?.kind) return null;

    const routine = member.routine ?? {};
    const stored = this.profiles.getStored(memberId, date);
    const dow = weekday(date);
    const sources: ResolvedDay['sources'] = { ...(stored?.sources ?? {}) };
    const out: ResolvedDay = { memberId, date, kind: member.kind, sources };

    /** Stored value if the day has one (even an explicit null), else the routine's. */
    const pick = <K extends DayProfileField>(key: K, fallback: DayProfileFields[K]): DayProfileFields[K] => {
      if (stored && stored[key] !== undefined) return stored[key];
      if (fallback !== undefined) sources[key] = { by: 'default' };
      return fallback;
    };

    out.homeMeals = stored?.homeMeals;
    out.dayTitle = stored?.dayTitle;
    out.dayNote = stored?.dayNote;

    if (member.kind === 'child') {
      out.schoolDay = pick('schoolDay', (routine.schoolDays ?? []).includes(dow));
      if (out.schoolDay) {
        out.dropOffTime = pick('dropOffTime', routine.dropOffTime ?? null);
        out.pickUpTime = pick('pickUpTime', routine.pickUpTime ?? null);
        out.schoolMeals = mergeSchoolMeals(routine.schoolMeals, stored?.schoolMeals);
      } else {
        out.dropOffTime = stored?.dropOffTime ?? null;
        out.pickUpTime = stored?.pickUpTime ?? null;
      }
      out.schoolActivities = stored?.schoolActivities ?? [];
      out.schoolClasses = stored?.schoolClasses ?? [];
    } else {
      out.workDay = pick('workDay', (routine.workDays ?? []).includes(dow));
      if (out.workDay) {
        out.startTime = pick('startTime', routine.workStartTime ?? null);
        out.stopTime = pick('stopTime', routine.workStopTime ?? null);
      } else {
        out.startTime = stored?.startTime ?? null;
        out.stopTime = stored?.stopTime ?? null;
      }
      out.onCall = stored?.onCall ?? false;
    }
    return out;
  }
}

function mergeSchoolMeals(routine?: SchoolMeals, stored?: SchoolMeals): SchoolMeals {
  return { ...routine, ...stored };
}

/** Day of week (0 = Sunday) of a "YYYY-MM-DD" date, read as a calendar date with no time-zone shift. */
export function weekday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y, m - 1, d).getDay();
}
