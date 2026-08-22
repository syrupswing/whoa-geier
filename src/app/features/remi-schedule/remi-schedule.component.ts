import { Component, OnInit, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatRadioModule } from '@angular/material/radio';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import {
  RemiScheduleService,
  RemiScheduleSettings,
  RemiScheduleException,
  RemiLunchMenuEntry,
  RemiLunchMenuSource
} from '../../services/remi-schedule.service';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';
import { HomeLogoBtnComponent } from '../../shared/home-logo-btn/home-logo-btn.component';

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
    MatSnackBarModule,
    GlobalNavMenuComponent,
    HomeLogoBtnComponent
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
    calendarIcalUrl: ''
  };
  isSavingSettings = signal(false);

  exceptions = signal<RemiScheduleException[]>([]);
  showAddException = signal(false);
  exceptionForm: RemiScheduleException = this.emptyExceptionForm();

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
    this.settingsForm = { ...this.remiScheduleService.settings() };

    await this.loadExceptions();
    await this.loadUpcomingLunchMenu();

    this.menuSource.set(await this.remiScheduleService.getLatestLunchMenuSource());
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
      const ok = await this.remiScheduleService.saveSettings(this.settingsForm);
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

  private emptyExceptionForm(): RemiScheduleException {
    return {
      date: new Date().toISOString().split('T')[0],
      noSchool: false,
      note: '',
      startTimeOverride: '',
      endTimeOverride: '',
      packLunch: false
    };
  }

  openAddException(): void {
    this.exceptionForm = this.emptyExceptionForm();
    this.showAddException.set(true);
  }

  editException(exception: RemiScheduleException): void {
    this.exceptionForm = { ...exception };
    this.showAddException.set(true);
  }

  cancelExceptionForm(): void {
    this.showAddException.set(false);
  }

  async saveException(): Promise<void> {
    if (!this.exceptionForm.date) return;
    const ok = await this.remiScheduleService.saveException(this.exceptionForm);
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
