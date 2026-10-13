import { Component, computed, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { DayProfileField, DayProfileFields, DayProfileService } from '../../services/day-profile.service';
import { DayResolverService, ResolvedDay } from '../../services/day-resolver.service';
import { HouseholdService } from '../../services/household.service';

type MealChoice = '' | 'hot' | 'pack';

interface DayForm {
  schoolDay: boolean;
  dropOffTime: string;
  pickUpTime: string;
  schoolBreakfast: MealChoice;
  schoolSnack: MealChoice;
  schoolLunch: MealChoice;
  activities: string;
  classes: string;
  workDay: boolean;
  startTime: string;
  stopTime: string;
  onCall: boolean;
  dayTitle: string;
  dayNote: string;
  homeBreakfast: string;
  homeLunch: string;
  homeSnack: string;
  homeDinner: string;
}

/** Shows one person's day with where each value came from (regular routine, calendar, or typed in), and lets a parent override it. */
@Component({
  selector: 'app-member-day-editor',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatSnackBarModule
  ],
  templateUrl: './member-day-editor.component.html',
  styleUrl: './member-day-editor.component.scss'
})
export class MemberDayEditorComponent {
  readonly household = inject(HouseholdService);
  private readonly resolver = inject(DayResolverService);
  private readonly profiles = inject(DayProfileService);
  private readonly snackBar = inject(MatSnackBar);

  memberId = signal<string | null>(null);
  date = signal(todayStr());
  form: DayForm = emptyForm();
  isSaving = signal(false);

  /** Members who have a kind set — the only ones with a day to show. */
  readonly trackedMembers = computed(() => this.household.members().filter(m => m.kind));
  readonly resolved = computed<ResolvedDay | null>(() => {
    const id = this.memberId();
    return id ? this.resolver.resolve(id, this.date()) : null;
  });

  constructor() {
    effect(() => {
      const members = this.trackedMembers();
      if (!this.memberId() && members.length) this.memberId.set(members[0].id);
    }, { allowSignalWrites: true });
    // Refill the form from the resolved day when the person or date changes, not on every stored update (that would undo typing).
    effect(() => {
      this.memberId();
      this.date();
      this.loadForm();
    }, { allowSignalWrites: true });
  }

  private loadForm(): void {
    const day = this.resolved();
    this.form = day ? formFrom(day) : emptyForm();
  }

  /** Where the value in effect for a field came from, as a short label — empty when nothing is stored for it. */
  source(field: DayProfileField): string {
    const by = this.resolved()?.sources[field]?.by;
    if (!by) return '';
    return by === 'default' ? 'regular' : by === 'calendar' || by === 'ai' ? 'from calendar' : 'set by hand';
  }

  async save(): Promise<void> {
    const day = this.resolved();
    const id = this.memberId();
    if (!day || !id || this.isSaving()) return;
    this.isSaving.set(true);
    try {
      const changes = changedFields(day, this.form);
      if (Object.keys(changes).length) await this.profiles.applyFields(id, this.date(), changes, { by: 'manual' });
      this.snackBar.open('Day saved', 'Close', { duration: 2000 });
    } catch (err) {
      console.error('Saving day failed:', err);
      this.snackBar.open('Failed to save day', 'Close', { duration: 3000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Throws away everything stored for the day, so it follows the regular routine again. */
  async reset(): Promise<void> {
    const id = this.memberId();
    if (!id || !confirm('Reset this day to the regular routine?')) return;
    await this.profiles.deleteDay(id, this.date());
    // The stored copy arrives on the next snapshot; refill once it has.
    setTimeout(() => this.loadForm(), 400);
  }
}

function todayStr(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });
}

function emptyForm(): DayForm {
  return {
    schoolDay: false, dropOffTime: '', pickUpTime: '', schoolBreakfast: '', schoolSnack: '', schoolLunch: '',
    activities: '', classes: '', workDay: false, startTime: '', stopTime: '', onCall: false,
    dayTitle: '', dayNote: '', homeBreakfast: '', homeLunch: '', homeSnack: '', homeDinner: ''
  };
}

function formFrom(day: ResolvedDay): DayForm {
  return {
    schoolDay: day.schoolDay ?? false,
    dropOffTime: day.dropOffTime ?? '',
    pickUpTime: day.pickUpTime ?? '',
    schoolBreakfast: day.schoolMeals?.breakfast ?? '',
    schoolSnack: day.schoolMeals?.snack ?? '',
    schoolLunch: day.schoolMeals?.lunch ?? '',
    activities: (day.schoolActivities ?? []).join(', '),
    classes: (day.schoolClasses ?? []).join(', '),
    workDay: day.workDay ?? false,
    startTime: day.startTime ?? '',
    stopTime: day.stopTime ?? '',
    onCall: day.onCall ?? false,
    dayTitle: day.dayTitle ?? '',
    dayNote: day.dayNote ?? '',
    homeBreakfast: day.homeMeals?.breakfast ?? '',
    homeLunch: day.homeMeals?.lunch ?? '',
    homeSnack: day.homeMeals?.snack ?? '',
    homeDinner: day.homeMeals?.dinner ?? ''
  };
}

const list = (text: string): string[] => text.split(',').map(s => s.trim()).filter(Boolean);
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * What the form changed relative to the day as resolved. Only those fields are written, so saving
 * after touching one field doesn't pin every other field to its current routine value. A cleared
 * time is stored as "none", while a cleared label, note or meal list clears the stored value.
 */
function changedFields(day: ResolvedDay, f: DayForm): { [K in DayProfileField]?: DayProfileFields[K] | undefined } {
  const next = formFrom(day);
  const out: { [K in DayProfileField]?: DayProfileFields[K] | undefined } = {};

  if (day.kind === 'child') {
    if (f.schoolDay !== next.schoolDay) out.schoolDay = f.schoolDay;
    if (f.dropOffTime !== next.dropOffTime) out.dropOffTime = f.dropOffTime || null;
    if (f.pickUpTime !== next.pickUpTime) out.pickUpTime = f.pickUpTime || null;
    if (f.schoolBreakfast !== next.schoolBreakfast || f.schoolSnack !== next.schoolSnack || f.schoolLunch !== next.schoolLunch) {
      const meals = {
        ...(f.schoolBreakfast && { breakfast: f.schoolBreakfast }),
        ...(f.schoolSnack && { snack: f.schoolSnack }),
        ...(f.schoolLunch && { lunch: f.schoolLunch })
      };
      out.schoolMeals = Object.keys(meals).length ? meals : undefined;
    }
    if (!same(list(f.activities), list(next.activities))) out.schoolActivities = list(f.activities);
    if (!same(list(f.classes), list(next.classes))) out.schoolClasses = list(f.classes);
  } else {
    if (f.workDay !== next.workDay) out.workDay = f.workDay;
    if (f.startTime !== next.startTime) out.startTime = f.startTime || null;
    if (f.stopTime !== next.stopTime) out.stopTime = f.stopTime || null;
    if (f.onCall !== next.onCall) out.onCall = f.onCall;
  }

  if (f.dayTitle.trim() !== next.dayTitle) out.dayTitle = f.dayTitle.trim() || undefined;
  if (f.dayNote.trim() !== next.dayNote) out.dayNote = f.dayNote.trim() || undefined;
  if (f.homeBreakfast !== next.homeBreakfast || f.homeLunch !== next.homeLunch ||
      f.homeSnack !== next.homeSnack || f.homeDinner !== next.homeDinner) {
    const meals = {
      ...(f.homeBreakfast.trim() && { breakfast: f.homeBreakfast.trim() }),
      ...(f.homeLunch.trim() && { lunch: f.homeLunch.trim() }),
      ...(f.homeSnack.trim() && { snack: f.homeSnack.trim() }),
      ...(f.homeDinner.trim() && { dinner: f.homeDinner.trim() })
    };
    out.homeMeals = Object.keys(meals).length ? meals : undefined;
  }
  return out;
}
