import { Component, effect, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MemberKind, MemberRoutine } from '../../services/day-profile.service';
import { HouseholdService } from '../../services/household.service';
import { RemiScheduleService } from '../../services/remi-schedule.service';

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Sets whether a member is a child or an adult, and their regular week — what each day looks like unless the calendar says otherwise. */
@Component({
  selector: 'app-member-routine-editor',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatSnackBarModule],
  templateUrl: './member-routine-editor.component.html',
  styleUrl: './member-routine-editor.component.scss'
})
export class MemberRoutineEditorComponent {
  readonly household = inject(HouseholdService);
  private readonly remiSchedule = inject(RemiScheduleService);
  private readonly snackBar = inject(MatSnackBar);

  readonly weekdayLabels = WEEKDAY_LABELS;

  memberId = signal<string | null>(null);
  kind: MemberKind | '' = '';
  routine: MemberRoutine = {};
  isSaving = signal(false);

  constructor() {
    // Start on the first member once the household has loaded.
    effect(() => {
      const members = this.household.members();
      if (!this.memberId() && members.length) this.select(members[0].id);
    }, { allowSignalWrites: true });
  }

  select(id: string): void {
    this.memberId.set(id);
    const member = this.household.getMemberById(id);
    this.kind = member?.kind ?? '';
    const r = member?.routine ?? {};
    this.routine = { ...r, schoolDays: [...(r.schoolDays ?? [])], workDays: [...(r.workDays ?? [])], schoolMeals: { ...r.schoolMeals } };
  }

  days(key: 'schoolDays' | 'workDays'): number[] {
    return this.routine[key] ?? [];
  }

  toggleDay(key: 'schoolDays' | 'workDays', day: number): void {
    const days = this.days(key);
    this.routine[key] = days.includes(day) ? days.filter(d => d !== day) : [...days, day].sort();
  }

  async save(): Promise<void> {
    const id = this.memberId();
    if (!id || this.isSaving()) return;
    this.isSaving.set(true);
    try {
      const kind = this.kind || undefined;
      const routine = this.cleanRoutine();
      // Remi's regular schedule is also kept in the Remi page's settings; going through them keeps the two in step.
      const remi = this.remiSchedule.settings();
      if (kind === 'child' && remi.memberId === id) {
        await this.household.updateMember(id, { kind });
        await this.remiSchedule.saveSettings({
          ...remi,
          schoolDays: routine.schoolDays ?? remi.schoolDays,
          schoolStartTime: routine.dropOffTime || remi.schoolStartTime,
          schoolEndTime: routine.pickUpTime || remi.schoolEndTime,
          defaultLunchPlan: routine.schoolMeals?.lunch ?? remi.defaultLunchPlan
        });
        // saveSettings only carries school start/end/lunch into the routine; keep the rest of what was edited.
        await this.household.updateMember(id, { routine });
      } else {
        await this.household.updateMember(id, { kind, routine });
      }
      this.snackBar.open('Routine saved', 'Close', { duration: 2000 });
    } catch (err) {
      console.error('Saving routine failed:', err);
      this.snackBar.open('Failed to save routine', 'Close', { duration: 3000 });
    } finally {
      this.isSaving.set(false);
    }
  }

  /** Only the fields that belong to the chosen kind, with empty times stored as none. */
  private cleanRoutine(): MemberRoutine {
    const r = this.routine;
    if (this.kind === 'child') {
      return {
        schoolDays: r.schoolDays ?? [],
        dropOffTime: r.dropOffTime || null,
        pickUpTime: r.pickUpTime || null,
        schoolMeals: r.schoolMeals?.lunch ? { lunch: r.schoolMeals.lunch } : {}
      };
    }
    if (this.kind === 'adult') {
      return { workDays: r.workDays ?? [], workStartTime: r.workStartTime || null, workStopTime: r.workStopTime || null };
    }
    return {};
  }
}
