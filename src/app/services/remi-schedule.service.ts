import { Injectable, inject, signal } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FirestoreService } from './firestore.service';
import { HouseholdService } from './household.service';
import { DayProfile, DayProfileFields, DayProfileService } from './day-profile.service';

export interface RemiScheduleSettings {
  schoolDays: number[]; // 0-6, Sunday-Saturday
  schoolStartTime: string; // "HH:mm"
  schoolEndTime: string; // "HH:mm"
  defaultLunchPlan: 'hot' | 'pack';
  calendarIcalUrls?: string[];
  /** The household member this schedule belongs to. Set once the schedule has moved onto day profiles (see migrateToDayProfiles). */
  memberId?: string;
  /** Set once every saved exception has been copied onto day profiles; only then do readers switch to them. */
  exceptionsMigrated?: boolean;
  /** @deprecated superseded by calendarIcalUrls; still read for older saved settings. */
  calendarIcalUrl?: string;
}

export interface RemiScheduleException {
  date: string; // YYYY-MM-DD
  noSchool?: boolean;
  /** Short label for display lines ("School pride day"). */
  title?: string;
  /** Free-text description of the day, as the parent wrote it; also fed to the AI suggestion prompts. */
  note?: string;
  startTimeOverride?: string;
  endTimeOverride?: string;
  /** Overrides the default lunch plan for this day; unset means use the default. */
  lunchPlan?: 'hot' | 'pack';
  /** @deprecated superseded by lunchPlan; still read for exceptions saved before it existed. */
  packLunch?: boolean;
}

/** What Claude read out of a free-text description of a day — a suggestion to confirm, not a saved record. */
export interface ParsedScheduleException {
  date: string | null;
  title: string;
  noSchool: boolean;
  startTime: string | null;
  endTime: string | null;
  lunchPlan: 'hot' | 'pack' | null;
}

export interface RemiLunchMenuEntry {
  date: string; // YYYY-MM-DD
  lunch: string;
  source: 'auto-pdf' | 'manual';
}

export interface RemiLunchMenuSource {
  pdfUrl: string;
  extractedText: string;
  fetchedAt: string;
}

export interface RemiBriefingActivity {
  title: string;
  time: string | null;
}

export interface RemiBriefingWeather {
  tempF: number;
  feelsLike: number;
  conditions: string;
  description: string;
  fetchedAt?: string;
  highF?: number;
  lowF?: number;
  maxPrecipChance?: number;
  periods?: { part: string; tempF: number; pop: number; description: string }[];
}

export interface RemiDailyBriefing {
  date: string;
  schoolStatus: 'school' | 'no-school' | 'early-release';
  scheduleNote: string | null;
  /** The parent's full free-text note for the day, when they left one. */
  dayNote?: string | null;
  startTime: string | null;
  endTime: string | null;
  weather: RemiBriefingWeather | null;
  clothingIdea: string | null;
  clothingSuggestionId?: string | null;
  activities: RemiBriefingActivity[];
  lunchPlan: 'hot' | 'pack';
  lunchMenuText: string | null;
  packedLunchIdea: string | null;
  packedLunchSuggestionId?: string | null;
  breakfastIdea: string | null;
  breakfastSuggestionId?: string | null;
  dinnerIdea: string | null;
  dinnerSuggestionId?: string | null;
  generatedAt: string;
}

export type RemiBriefingFacet = 'clothing' | 'breakfast' | 'lunch' | 'dinner';

const SETTINGS_COLLECTION = 'remi-schedule';
const SETTINGS_DOC_ID = 'settings';
const EXCEPTIONS_COLLECTION = 'remi-schedule-exceptions';
const LUNCH_MENU_COLLECTION = 'remi-lunch-menu';
const LUNCH_MENU_SOURCE_COLLECTION = 'remi-lunch-menu-source';
const BRIEFING_COLLECTION = 'remi-daily-briefing';

const DEFAULT_SETTINGS: RemiScheduleSettings = {
  schoolDays: [1, 2, 3, 4, 5],
  schoolStartTime: '08:00',
  schoolEndTime: '14:30',
  defaultLunchPlan: 'hot',
  calendarIcalUrls: []
};

@Injectable({
  providedIn: 'root'
})
export class RemiScheduleService {
  private firestoreService = inject(FirestoreService);
  private household = inject(HouseholdService);
  private dayProfiles = inject(DayProfileService);
  private migrating = false;

  settings = signal<RemiScheduleSettings>(DEFAULT_SETTINGS);
  todayBriefing = signal<RemiDailyBriefing | null>(null);
  isLoadingBriefing = signal<boolean>(false);
  isRegeneratingBriefing = signal<boolean>(false);
  regeneratingFacet = signal<RemiBriefingFacet | null>(null);
  error = signal<string | null>(null);

  async loadSettings(): Promise<void> {
    const settings = await this.firestoreService.getDocument<RemiScheduleSettings>(SETTINGS_COLLECTION, SETTINGS_DOC_ID);
    if (!settings) {
      this.settings.set(DEFAULT_SETTINGS);
      return;
    }
    const merged = { ...DEFAULT_SETTINGS, ...settings };
    if (!merged.calendarIcalUrls?.length && merged.calendarIcalUrl) {
      merged.calendarIcalUrls = [merged.calendarIcalUrl];
    }
    this.settings.set(merged);
  }

  async saveSettings(settings: RemiScheduleSettings): Promise<boolean> {
    // The form that produced these settings may predate a migration, so keep what the service already knows.
    const current = this.settings();
    const toSave = {
      ...settings,
      memberId: settings.memberId ?? current.memberId,
      exceptionsMigrated: settings.exceptionsMigrated ?? current.exceptionsMigrated
    };
    const ok = await this.firestoreService.setDocument(SETTINGS_COLLECTION, SETTINGS_DOC_ID, toSave);
    if (ok) {
      this.settings.set(toSave);
      // The briefing reads the regular times from the member's routine, so keep it in step.
      if (toSave.memberId) await this.syncRoutine(toSave.memberId, toSave);
    }
    return ok;
  }

  /** Remi's member id once the schedule lives on day profiles, else null (the legacy exceptions apply). */
  private migratedMemberId(): string | null {
    const { memberId, exceptionsMigrated } = this.settings();
    return memberId && exceptionsMigrated ? memberId : null;
  }

  async getExceptions(): Promise<RemiScheduleException[]> {
    const memberId = this.migratedMemberId();
    if (memberId) {
      // A day stored only for its activities or meals isn't a schedule exception.
      return (await this.dayProfiles.fetchForMember(memberId))
        .filter(p => p.schoolDay === false || p.dayTitle || p.dayNote || p.dropOffTime !== undefined ||
          p.pickUpTime !== undefined || p.schoolMeals?.lunch)
        .map(profileToException);
    }
    const items = await this.firestoreService.getCollection<Omit<RemiScheduleException, 'date'> & { id: string }>(EXCEPTIONS_COLLECTION);
    return items
      .map(({ id, ...rest }) => ({ date: id, ...rest }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async parseExceptionText(
    text: string,
    defaults: { startTime: string; endTime: string; lunchPlan: 'hot' | 'pack' }
  ): Promise<ParsedScheduleException> {
    const parse = httpsCallable<{ text: string; defaults: typeof defaults }, ParsedScheduleException>(
      getFunctions(), 'parseScheduleException'
    );
    return (await parse({ text, defaults })).data;
  }

  async saveException(exception: RemiScheduleException): Promise<boolean> {
    const memberId = this.migratedMemberId();
    if (memberId) {
      try {
        const stored = await this.firestoreService.getDocument<DayProfile>('dayProfiles', `${memberId}_${exception.date}`);
        await this.dayProfiles.applyFields(
          memberId, exception.date, exceptionToFields(exception, stored), { by: 'manual' }
        );
        return true;
      } catch (err) {
        console.error('saveException error:', err);
        return false;
      }
    }
    const { date, ...data } = exception;
    return this.firestoreService.setDocument(EXCEPTIONS_COLLECTION, date, data);
  }

  async deleteException(date: string): Promise<boolean> {
    const memberId = this.migratedMemberId();
    if (memberId) return this.dayProfiles.clearManual(memberId, date);
    return this.firestoreService.deleteDocument(EXCEPTIONS_COLLECTION, date);
  }

  /**
   * One-time move onto day profiles: finds (or creates) Remi in the household as a child with the
   * regular schedule as his routine, copies each saved exception into his day profiles, then records
   * his member id on the settings doc. That last write is what switches readers (this service and
   * the briefing function) over, so a failure part-way just retries on the next launch. The old
   * exceptions collection is left in place as a backup. Returns whether the schedule is now migrated.
   */
  async migrateToDayProfiles(): Promise<boolean> {
    if (this.migrating) return false;
    this.migrating = true;
    try {
      await this.loadSettings();
      const settings = this.settings();
      if (settings.memberId && settings.exceptionsMigrated) return true;
      // Without a saved schedule there's nothing to move, and creating a member for it would be premature.
      if (!(await this.firestoreService.getDocument(SETTINGS_COLLECTION, SETTINGS_DOC_ID))) return false;

      let memberId = settings.memberId;
      if (!memberId) {
        const routine = routineFromSettings(settings);
        const member = this.household.members().find(m => m.name.trim().toLowerCase() === 'remi');
        if (member) {
          memberId = member.id;
          await this.household.updateMember(memberId, { kind: 'child', routine: { ...member.routine, ...routine } });
        } else {
          memberId = await this.household.addMember({
            name: 'Remi', dietaryRestrictions: [], preferences: {}, kind: 'child', routine
          });
        }
      }

      // A day that already has a profile was edited after an earlier attempt, so the saved exception doesn't replace it.
      // applyFields throws if a write fails, which stops here before the schedule is marked migrated.
      for (const exception of await this.legacyExceptions()) {
        if (await this.dayProfiles.hasStored(memberId, exception.date)) continue;
        await this.dayProfiles.applyFields(
          memberId, exception.date, exceptionToFields(exception, null), { by: 'manual' }
        );
      }
      return await this.saveSettings({ ...settings, memberId, exceptionsMigrated: true });
    } catch (err) {
      console.error('migrateToDayProfiles error:', err);
      return false;
    } finally {
      this.migrating = false;
    }
  }

  private async legacyExceptions(): Promise<RemiScheduleException[]> {
    const items = await this.firestoreService.getCollection<Omit<RemiScheduleException, 'date'> & { id: string }>(EXCEPTIONS_COLLECTION);
    return items.map(({ id, ...rest }) => ({ date: id, ...rest }));
  }

  private async syncRoutine(memberId: string, settings: RemiScheduleSettings): Promise<void> {
    const member = this.household.getMemberById(memberId);
    if (!member) return;
    await this.household.updateMember(memberId, { routine: { ...member.routine, ...routineFromSettings(settings) } });
  }

  async getUpcomingLunchMenu(dates: string[]): Promise<Map<string, RemiLunchMenuEntry>> {
    const entries = await Promise.all(
      dates.map(date => this.firestoreService.getDocument<RemiLunchMenuEntry>(LUNCH_MENU_COLLECTION, date))
    );
    const map = new Map<string, RemiLunchMenuEntry>();
    entries.forEach((entry, i) => {
      if (entry) {
        map.set(dates[i], entry);
      }
    });
    return map;
  }

  async saveLunchMenuEntry(date: string, lunch: string): Promise<boolean> {
    const entry: RemiLunchMenuEntry = { date, lunch, source: 'manual' };
    const { date: _date, ...data } = entry;
    return this.firestoreService.setDocument(LUNCH_MENU_COLLECTION, date, data);
  }

  async getLatestLunchMenuSource(): Promise<RemiLunchMenuSource | null> {
    const now = new Date();
    const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return this.firestoreService.getDocument<RemiLunchMenuSource>(LUNCH_MENU_SOURCE_COLLECTION, monthKey);
  }

  async loadTodayBriefing(): Promise<void> {
    this.isLoadingBriefing.set(true);
    this.error.set(null);
    try {
      const today = this.todayDateStr();
      const briefing = await this.firestoreService.getDocument<RemiDailyBriefing>(BRIEFING_COLLECTION, today);
      this.todayBriefing.set(briefing);
    } finally {
      this.isLoadingBriefing.set(false);
    }
  }

  async regenerateBriefing(): Promise<void> {
    this.isRegeneratingBriefing.set(true);
    this.error.set(null);
    try {
      const functions = getFunctions();
      const regenerate = httpsCallable(functions, 'regenerateBriefing');
      const result: any = await regenerate({ date: this.todayDateStr() });
      if (result.data?.success) {
        this.todayBriefing.set(result.data.briefing as RemiDailyBriefing);
      } else {
        this.error.set('Failed to generate briefing');
      }
    } catch (err: any) {
      console.error('regenerateBriefing error:', err);
      this.error.set(err.message || 'Failed to generate briefing');
    } finally {
      this.isRegeneratingBriefing.set(false);
    }
  }

  async regenerateFacet(facet: RemiBriefingFacet): Promise<void> {
    this.regeneratingFacet.set(facet);
    this.error.set(null);
    try {
      const functions = getFunctions();
      const regenerate = httpsCallable(functions, 'regenerateBriefingFacet');
      const result: any = await regenerate({ date: this.todayDateStr(), facet });
      const current = this.todayBriefing();
      if (result.data?.success && current) {
        const { success, ...fields } = result.data;
        this.todayBriefing.set({ ...current, ...fields });
      } else if (!result.data?.success) {
        this.error.set('Failed to regenerate');
      }
    } catch (err: any) {
      console.error('regenerateFacet error:', err);
      this.error.set(err.message || 'Failed to regenerate');
    } finally {
      this.regeneratingFacet.set(null);
    }
  }

  private todayDateStr(): string {
    // Must match the functions' America/Chicago date key, not the UTC one.
    return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
  }
}

/** The regular schedule as a member routine. School start/end double as drop-off/pick-up until a family sets them apart. */
function routineFromSettings(settings: RemiScheduleSettings) {
  return {
    schoolDays: settings.schoolDays,
    dropOffTime: settings.schoolStartTime,
    pickUpTime: settings.schoolEndTime,
    schoolMeals: { lunch: settings.defaultLunchPlan }
  };
}

/** Exception fields as day-profile fields. Anything unset comes back `undefined`, which clears it on write. */
function exceptionToFields(exception: RemiScheduleException, stored: DayProfile | null) {
  const lunch = exception.lunchPlan ?? (exception.packLunch ? 'pack' : undefined);
  const { lunch: _old, ...otherMeals } = stored?.schoolMeals ?? {};
  const meals = lunch ? { ...otherMeals, lunch } : otherMeals;
  const noSchool = exception.noSchool === true;
  return {
    schoolDay: noSchool ? false : undefined,
    dropOffTime: noSchool ? undefined : exception.startTimeOverride || undefined,
    pickUpTime: noSchool ? undefined : exception.endTimeOverride || undefined,
    dayTitle: exception.title?.trim() || undefined,
    dayNote: exception.note?.trim() || undefined,
    schoolMeals: Object.keys(meals).length ? meals : undefined
  } satisfies DayProfileFields;
}

function profileToException(profile: DayProfile): RemiScheduleException {
  return {
    date: profile.date,
    noSchool: profile.schoolDay === false,
    title: profile.dayTitle,
    note: profile.dayNote,
    startTimeOverride: profile.dropOffTime ?? undefined,
    endTimeOverride: profile.pickUpTime ?? undefined,
    lunchPlan: profile.schoolMeals?.lunch
  };
}
