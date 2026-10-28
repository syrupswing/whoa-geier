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
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MemoryService, ExplicitFact } from '../../services/memory.service';
import { HouseholdService } from '../../services/household.service';
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
    MatProgressBarModule,
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


  // Reference library
  docMode: 'paste' | 'link' | 'file' = 'file';
  docTitle = '';
  docText = '';
  docUrl = '';
  docSearch = '';
  selectedFile = signal<File | null>(null);
  uploadPercent = signal(0);
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
    if (this.docMode === 'file') return !!this.selectedFile();
    return this.docMode === 'paste' ? !!this.docText.trim() : !!this.docUrl.trim();
  }

  /** The library, narrowed by the search box (title, summary, file name and the saved text). */
  filteredDocs(): ReferenceDoc[] {
    const terms = this.docSearch.toLowerCase().split(/\s+/).filter(Boolean);
    return this.referenceDocs.docs().filter(d => {
      if (!terms.length) return true;
      const haystack = [d.title, d.summary, d.fileName, d.text].join(' ').toLowerCase();
      return terms.every(t => haystack.includes(t));
    });
  }

  onFilePicked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';   // so picking the same file again still fires
    if (file && !this.referenceDocs.uploadTypeFor(file)) {
      this.snackBar.open('Upload a PDF, a photo (JPEG, PNG, WebP) or a text file', 'Close', { duration: 5000 });
      return;
    }
    this.selectedFile.set(file);
  }

  fileSizeLabel(bytes: number | undefined): string {
    if (!bytes) return '';
    return bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  async openDoc(doc: ReferenceDoc): Promise<void> {
    try {
      await this.referenceDocs.openFile(doc);
    } catch (err: any) {
      this.snackBar.open(err?.message || "Couldn't open that file", 'Close', { duration: 5000 });
    }
  }

  async addDoc(): Promise<void> {
    if (!this.canAddDoc() || this.isAddingDoc()) return;
    this.isAddingDoc.set(true);
    this.uploadPercent.set(0);
    try {
      if (this.docMode === 'file') {
        await this.referenceDocs.upload(this.selectedFile()!, this.docTitle.trim() || undefined, p => this.uploadPercent.set(p));
        this.selectedFile.set(null);
      } else {
        await this.referenceDocs.add({
          title: this.docTitle.trim() || undefined,
          text: this.docMode === 'paste' ? this.docText : undefined,
          url: this.docMode === 'link' ? this.docUrl.trim() : undefined
        });
      }
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
    const ok = await this.referenceDocs.remove(doc);
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
