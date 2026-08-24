import { Injectable, inject, signal } from '@angular/core';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { FirestoreService } from './firestore.service';

export interface RemiScheduleSettings {
  schoolDays: number[]; // 0-6, Sunday-Saturday
  schoolStartTime: string; // "HH:mm"
  schoolEndTime: string; // "HH:mm"
  defaultLunchPlan: 'hot' | 'pack';
  calendarIcalUrls?: string[];
  /** @deprecated superseded by calendarIcalUrls; still read for older saved settings. */
  calendarIcalUrl?: string;
}

export interface RemiScheduleException {
  date: string; // YYYY-MM-DD
  noSchool?: boolean;
  note?: string;
  startTimeOverride?: string;
  endTimeOverride?: string;
  packLunch?: boolean;
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

export interface RemiDailyBriefing {
  date: string;
  schoolStatus: 'school' | 'no-school' | 'early-release';
  scheduleNote: string | null;
  startTime: string | null;
  endTime: string | null;
  weather: { tempF: number; feelsLike: number; conditions: string; description: string } | null;
  clothingIdea: string | null;
  activities: RemiBriefingActivity[];
  lunchPlan: 'hot' | 'pack';
  lunchMenuText: string | null;
  packedLunchIdea: string | null;
  breakfastIdea: string | null;
  dinnerIdea: string | null;
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
    const ok = await this.firestoreService.setDocument(SETTINGS_COLLECTION, SETTINGS_DOC_ID, settings);
    if (ok) {
      this.settings.set(settings);
    }
    return ok;
  }

  async getExceptions(): Promise<RemiScheduleException[]> {
    const items = await this.firestoreService.getCollection<Omit<RemiScheduleException, 'date'> & { id: string }>(EXCEPTIONS_COLLECTION);
    return items
      .map(({ id, ...rest }) => ({ date: id, ...rest }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  async saveException(exception: RemiScheduleException): Promise<boolean> {
    const { date, ...data } = exception;
    return this.firestoreService.setDocument(EXCEPTIONS_COLLECTION, date, data);
  }

  async deleteException(date: string): Promise<boolean> {
    return this.firestoreService.deleteDocument(EXCEPTIONS_COLLECTION, date);
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
