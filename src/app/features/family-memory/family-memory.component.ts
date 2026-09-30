import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MemoryService, ExplicitFact } from '../../services/memory.service';
import { HouseholdService, FamilyMember } from '../../services/household.service';
import { ReferenceDocsService, ReferenceDoc } from '../../services/reference-docs.service';

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
    MatButtonToggleModule,
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

  // Reference library
  docMode: 'paste' | 'link' = 'paste';
  docTitle = '';
  docText = '';
  docUrl = '';
  isAddingDoc = signal(false);
  refreshingDocId = signal<string | null>(null);
  expandedDocId = signal<string | null>(null);

  constructor(
    public memoryService: MemoryService,
    public householdService: HouseholdService,
    public referenceDocs: ReferenceDocsService,
    private snackBar: MatSnackBar
  ) {}

  canAddDoc(): boolean {
    return this.docMode === 'paste' ? !!this.docText.trim() : !!this.docUrl.trim();
  }

  async addDoc(): Promise<void> {
    if (!this.canAddDoc() || this.isAddingDoc()) return;
    this.isAddingDoc.set(true);
    try {
      await this.referenceDocs.add({
        title: this.docTitle.trim() || undefined,
        text: this.docMode === 'paste' ? this.docText : undefined,
        url: this.docMode === 'link' ? this.docUrl.trim() : undefined
      });
      this.docTitle = '';
      this.docText = '';
      this.docUrl = '';
      this.snackBar.open('Added to the reference library', 'Close', { duration: 3000 });
    } catch (err: any) {
      this.snackBar.open(err?.message || 'Could not add that document', 'Close', { duration: 6000 });
    } finally {
      this.isAddingDoc.set(false);
    }
  }

  async refreshDoc(doc: ReferenceDoc): Promise<void> {
    this.refreshingDocId.set(doc.id);
    try {
      await this.referenceDocs.refresh(doc.id);
      this.snackBar.open('Refreshed from the link', 'Close', { duration: 3000 });
    } catch (err: any) {
      this.snackBar.open(err?.message || 'Could not refresh that link', 'Close', { duration: 6000 });
    } finally {
      this.refreshingDocId.set(null);
    }
  }

  async deleteDoc(doc: ReferenceDoc): Promise<void> {
    if (!confirm(`Remove "${doc.title}" from the reference library?`)) return;
    const ok = await this.referenceDocs.remove(doc.id);
    if (!ok) {
      this.snackBar.open('Failed to delete', 'Close', { duration: 3000 });
    }
  }

  toggleDocExpanded(id: string): void {
    this.expandedDocId.set(this.expandedDocId() === id ? null : id);
  }

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

  /** Links (or unlinks) this login to a household member — enables private, self-only reminders. */
  async setMyMember(memberId: string | null): Promise<void> {
    if (memberId) {
      await this.householdService.linkCurrentUserToMember(memberId);
    } else {
      await this.householdService.unlinkCurrentUser();
    }
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
