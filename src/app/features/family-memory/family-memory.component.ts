import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MemoryService, ExplicitFact } from '../../services/memory.service';
import { HouseholdService, FamilyMember } from '../../services/household.service';

const CATEGORIES = ['dietary', 'preference', 'maintenance', 'medical', 'schedule', 'other'] as const;

@Component({
  selector: 'app-family-memory',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatChipsModule,
    MatTooltipModule,
    MatSnackBarModule
  ],
  templateUrl: './family-memory.component.html',
  styleUrl: './family-memory.component.scss'
})
export class FamilyMemoryComponent {
  readonly categories = CATEGORIES;

  factText = '';
  category: string = 'other';
  memberId: string | null = null;
  isSaving = signal(false);

  memberNameInput = '';
  memberDietaryInput = '';
  isSavingMember = signal(false);

  constructor(
    public memoryService: MemoryService,
    public householdService: HouseholdService,
    private snackBar: MatSnackBar
  ) {}

  memberName(memberId: string | undefined): string {
    if (!memberId) return 'Whole household';
    return this.householdService.getMemberById(memberId)?.name ?? 'Whole household';
  }

  async addMember(): Promise<void> {
    const name = this.memberNameInput.trim();
    if (!name) return;

    this.isSavingMember.set(true);
    try {
      const dietaryRestrictions = this.memberDietaryInput
        .split(',')
        .map(s => s.trim())
        .filter(Boolean);

      await this.householdService.addMember({ name, dietaryRestrictions, preferences: {} });
      this.memberNameInput = '';
      this.memberDietaryInput = '';
    } finally {
      this.isSavingMember.set(false);
    }
  }

  async removeMember(member: FamilyMember): Promise<void> {
    if (!confirm(`Remove ${member.name} from the household?`)) return;
    await this.householdService.removeMember(member.id);
  }

  async addFact(): Promise<void> {
    const factText = this.factText.trim();
    if (!factText) return;

    this.isSaving.set(true);
    try {
      const fact: Omit<ExplicitFact, 'id' | 'createdAt'> = {
        factText,
        category: this.category
      };
      if (this.memberId) {
        fact.memberId = this.memberId;
      }
      const id = await this.memoryService.addExplicitFact(fact);
      if (id) {
        this.factText = '';
        this.category = 'other';
        this.memberId = null;
      } else {
        this.snackBar.open('Failed to save — try again', 'Close', { duration: 3000 });
      }
    } finally {
      this.isSaving.set(false);
    }
  }

  async deleteFact(fact: ExplicitFact): Promise<void> {
    if (!confirm(`Forget "${fact.factText}"?`)) return;
    const ok = await this.memoryService.deleteExplicitFact(fact.id);
    if (!ok) {
      this.snackBar.open('Failed to delete', 'Close', { duration: 3000 });
    }
  }
}
