import { Component, OnInit, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import {
  RemiScheduleService,
  RemiScheduleSettings,
  RemiScheduleException,
  RemiLunchMenuEntry,
  RemiLunchMenuSource
} from '../../services/remi-schedule.service';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface UpcomingDay {
  date: string;
  label: string;
  lunch: string;
  source: 'auto-pdf' | 'manual' | null;
}

@Component({
  selector: 'app-remi-schedule',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatRadioModule,
    MatTooltipModule,
    MatSnackBarModule
  ],
  templateUrl: './remi-schedule.component.html',
  styleUrl: './remi-schedule.component.scss'
})
export class RemiScheduleComponent implements OnInit {
  readonly weekdayLabels = WEEKDAY_LABELS;

  settingsForm: RemiScheduleSettings = {
    schoolDays: [1, 2, 3, 4, 5],
    schoolStartTime: '08:00',
    schoolEndTime: '14:30',
    defaultLunchPlan: 'hot',
    calendarIcalUrls: []
  };
  isSavingSettings = signal(false);

  exceptions = signal<RemiScheduleException[]>([]);
  showAddException = signal(false);
  exceptionForm: RemiScheduleException = this.emptyExceptionForm();
  /** Lunch choice for the form: '' means "use the regular plan". */
  lunchChoice: '' | 'hot' | 'pack' = '';
  isParsingException = signal(false);
  /** Set after Claude fills the form, so the parent knows to double-check the detected details. */
  exceptionParsed = signal(false);

  // Upcoming first (soonest at the top), then past days, most recent first.
  upcomingExceptions = computed(() => {
    const today = this.todayStr();
    return this.exceptions().filter(e => e.date >= today);
  });
  pastExceptions = computed(() => {
    const today = this.todayStr();
    return this.exceptions().filter(e => e.date < today).reverse();
  });

  upcomingDays = signal<UpcomingDay[]>([]);
  editingLunchDate = signal<string | null>(null);
  lunchEditValue = '';

  menuSource = signal<RemiLunchMenuSource | null>(null);
  showMenuSource = signal(false);

  constructor(
    public remiScheduleService: RemiScheduleService,
    private snackBar: MatSnackBar
  ) {}

  async ngOnInit(): Promise<void> {
    await this.remiScheduleService.loadSettings();
    this.settingsForm = {
      ...this.remiScheduleService.settings(),
      calendarIcalUrls: [...(this.remiScheduleService.settings().calendarIcalUrls ?? [])]
    };

    await this.loadExceptions();
    await this.loadUpcomingLunchMenu();

    this.menuSource.set(await this.remiScheduleService.getLatestLunchMenuSource());
  }

  trackByIndex(index: number): number {
    return index;
  }

  addCalendarUrl(): void {
    this.settingsForm.calendarIcalUrls = [...(this.settingsForm.calendarIcalUrls ?? []), ''];
  }

  updateCalendarUrl(index: number, url: string): void {
    const urls = [...(this.settingsForm.calendarIcalUrls ?? [])];
    urls[index] = url;
    this.settingsForm.calendarIcalUrls = urls;
  }

  removeCalendarUrl(index: number): void {
    this.settingsForm.calendarIcalUrls = (this.settingsForm.calendarIcalUrls ?? []).filter((_, i) => i !== index);
  }

  isSchoolDay(day: number): boolean {
    return this.settingsForm.schoolDays.includes(day);
  }

  toggleSchoolDay(day: number): void {
    const days = new Set(this.settingsForm.schoolDays);
    if (days.has(day)) {
      days.delete(day);
    } else {
      days.add(day);
    }
    this.settingsForm.schoolDays = Array.from(days).sort();
  }

  async saveSettings(): Promise<void> {
    this.isSavingSettings.set(true);
    try {
      const { calendarIcalUrl, ...rest } = this.settingsForm;
      const settings: RemiScheduleSettings = {
        ...rest,
        calendarIcalUrls: (rest.calendarIcalUrls ?? []).map(url => url.trim()).filter(Boolean)
      };
      const ok = await this.remiScheduleService.saveSettings(settings);
      if (ok) {
        this.settingsForm = { ...settings, calendarIcalUrls: [...settings.calendarIcalUrls!] };
      }
      this.snackBar.open(ok ? 'Schedule settings saved' : 'Failed to save settings', 'Close', { duration: 3000 });
      if (ok) {
        await this.loadUpcomingLunchMenu();
      }
    } finally {
      this.isSavingSettings.set(false);
    }
  }

  private async loadExceptions(): Promise<void> {
    this.exceptions.set(await this.remiScheduleService.getExceptions());
  }

  private todayStr(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  }

  private emptyExceptionForm(): RemiScheduleException {
    return {
      date: this.todayStr(),
      noSchool: false,
      title: '',
      note: '',
      startTimeOverride: '',
      endTimeOverride: ''
    };
  }

  /** Exceptions saved before lunchPlan existed carry a packLunch boolean instead. */
  private lunchChoiceOf(exception: RemiScheduleException): '' | 'hot' | 'pack' {
    return exception.lunchPlan ?? (exception.packLunch ? 'pack' : '');
  }

  openAddException(): void {
    this.exceptionForm = this.emptyExceptionForm();
    this.lunchChoice = '';
    this.exceptionParsed.set(false);
    this.showAddException.set(true);
  }

  editException(exception: RemiScheduleException): void {
    this.exceptionForm = { ...exception };
    this.lunchChoice = this.lunchChoiceOf(exception);
    this.exceptionParsed.set(false);
    this.showAddException.set(true);
  }

  cancelExceptionForm(): void {
    this.showAddException.set(false);
  }

  /** Asks Claude to read the free-text description into the fields below it; the parent confirms or corrects. */
  async fillExceptionFromText(): Promise<void> {
    const text = (this.exceptionForm.note ?? '').trim();
    if (!text) return;
    const settings = this.remiScheduleService.settings();
    this.isParsingException.set(true);
    try {
      const parsed = await this.remiScheduleService.parseExceptionText(text, {
        startTime: settings.schoolStartTime,
        endTime: settings.schoolEndTime,
        lunchPlan: settings.defaultLunchPlan
      });
      this.exceptionForm = {
        ...this.exceptionForm,
        date: parsed.date ?? this.exceptionForm.date,
        title: parsed.title,
        noSchool: parsed.noSchool,
        startTimeOverride: parsed.startTime ?? '',
        endTimeOverride: parsed.endTime ?? ''
      };
      this.lunchChoice = parsed.lunchPlan ?? '';
      this.exceptionParsed.set(true);
    } catch (err: any) {
      console.error('parseExceptionText error:', err);
      this.snackBar.open("Couldn't read that — fill in the details below instead", 'Close', { duration: 4000 });
    } finally {
      this.isParsingException.set(false);
    }
  }

  async saveException(): Promise<void> {
    if (!this.exceptionForm.date) return;
    const settings = this.remiScheduleService.settings();
    const { packLunch, ...form } = this.exceptionForm;
    // A time equal to the regular one isn't an exception, and storing it would only
    // make the day look changed when it isn't.
    const exception: RemiScheduleException = {
      ...form,
      title: (form.title ?? '').trim(),
      note: (form.note ?? '').trim(),
      startTimeOverride: form.startTimeOverride === settings.schoolStartTime ? '' : form.startTimeOverride,
      endTimeOverride: form.endTimeOverride === settings.schoolEndTime ? '' : form.endTimeOverride
    };
    if (this.lunchChoice && this.lunchChoice !== settings.defaultLunchPlan) {
      exception.lunchPlan = this.lunchChoice;
    } else {
      delete exception.lunchPlan;
    }
    if (exception.noSchool) {
      exception.startTimeOverride = '';
      exception.endTimeOverride = '';
    }

    const ok = await this.remiScheduleService.saveException(exception);
    if (ok) {
      this.showAddException.set(false);
      await this.loadExceptions();
      await this.loadUpcomingLunchMenu();
    } else {
      this.snackBar.open('Failed to save exception', 'Close', { duration: 3000 });
    }
  }

  async deleteException(date: string): Promise<void> {
    if (!confirm('Remove this schedule exception?')) return;
    await this.remiScheduleService.deleteException(date);
    await this.loadExceptions();
    await this.loadUpcomingLunchMenu();
  }

  /**
   * Plain-language tags for how a day differs from the regular schedule. Compared against
   * the regular times so a start that's earlier or later isn't mislabeled "early release",
   * and a setting that matches the default produces no tag at all.
   */
  exceptionTags(exception: RemiScheduleException): string[] {
    if (exception.noSchool) return ['No school'];
    const settings = this.remiScheduleService.settings();
    const tags: string[] = [];

    const start = exception.startTimeOverride;
    if (start && start !== settings.schoolStartTime) {
      const diff = this.minutesOf(start) - this.minutesOf(settings.schoolStartTime);
      tags.push(`Starts ${this.formatDuration(Math.abs(diff))} ${diff < 0 ? 'earlier' : 'later'} (${this.formatTime(start)})`);
    }
    const end = exception.endTimeOverride;
    if (end && end !== settings.schoolEndTime) {
      const early = this.minutesOf(end) < this.minutesOf(settings.schoolEndTime);
      tags.push(`${early ? 'Early' : 'Late'} dismissal (${this.formatTime(end)})`);
    }
    const lunch = this.lunchChoiceOf(exception);
    if (lunch && lunch !== settings.defaultLunchPlan) {
      tags.push(lunch === 'pack' ? 'Pack lunch' : 'Hot lunch');
    }
    return tags;
  }

  formatExceptionDate(date: string): string {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }

  private minutesOf(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
  }

  private formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes} min`;
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return m ? `${h} hr ${m} min` : `${h} hr`;
  }

  private formatTime(hhmm: string): string {
    const [h, m] = hhmm.split(':').map(Number);
    return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
  }

  private nextSchoolDates(count: number): string[] {
    const dates: string[] = [];
    const cursor = new Date();
    cursor.setHours(0, 0, 0, 0);
    // Look ahead up to 21 calendar days to gather `count` school days
    for (let i = 0; i < 21 && dates.length < count; i++) {
      if (this.settingsForm.schoolDays.includes(cursor.getDay())) {
        dates.push(cursor.toISOString().split('T')[0]);
      }
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  private async loadUpcomingLunchMenu(): Promise<void> {
    const dates = this.nextSchoolDates(7);
    const menuMap = await this.remiScheduleService.getUpcomingLunchMenu(dates);
    this.upcomingDays.set(dates.map(date => {
      const entry = menuMap.get(date);
      const d = new Date(`${date}T00:00:00`);
      const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
      return {
        date,
        label,
        lunch: entry?.lunch || '',
        source: entry?.source || null
      };
    }));
  }

  startEditLunch(day: UpcomingDay): void {
    this.editingLunchDate.set(day.date);
    this.lunchEditValue = day.lunch;
  }

  cancelEditLunch(): void {
    this.editingLunchDate.set(null);
    this.lunchEditValue = '';
  }

  async saveLunch(date: string): Promise<void> {
    const ok = await this.remiScheduleService.saveLunchMenuEntry(date, this.lunchEditValue.trim());
    if (ok) {
      this.editingLunchDate.set(null);
      await this.loadUpcomingLunchMenu();
    } else {
      this.snackBar.open('Failed to save lunch menu', 'Close', { duration: 3000 });
    }
  }
}
