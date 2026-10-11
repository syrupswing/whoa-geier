import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatRadioModule } from '@angular/material/radio';
import { BacklogItem } from '../../services/backlog.service';
import { HouseholdService } from '../../services/household.service';
import { AuthService } from '../../services/auth.service';

export interface BacklogItemDialogData {
  /** The item being edited; omit to add a new one. */
  item?: BacklogItem;
  /** Starting title for a new item. */
  title?: string;
}

export interface BacklogItemDialogResult {
  title: string;
  notes?: string;
  memberId?: string;
  scope: 'family' | 'private';
}

@Component({
  selector: 'app-backlog-item-dialog',
  standalone: true,
  imports: [
    CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule,
    MatSelectModule, MatButtonModule, MatIconModule, MatRadioModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>inbox</mat-icon>
      {{ data.item ? 'Edit backlog task' : 'Add to backlog' }}
    </h2>

    <mat-dialog-content>
      <div class="dialog-form">
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full-width">
          <mat-label>Title</mat-label>
          <input matInput name="title" [(ngModel)]="title" placeholder="e.g., Clean out the garage" required autocomplete="off">
        </mat-form-field>

        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full-width">
          <mat-label>Notes</mat-label>
          <textarea matInput name="notes" [(ngModel)]="notes" rows="3"></textarea>
        </mat-form-field>

        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full-width" *ngIf="householdService.members().length">
          <mat-label>For</mat-label>
          <mat-select name="memberId" [(ngModel)]="memberId">
            <mat-option [value]="null">Whole household</mat-option>
            <mat-option *ngFor="let member of householdService.members()" [value]="member.id">{{ member.name }}</mat-option>
          </mat-select>
          <mat-icon matPrefix>person</mat-icon>
        </mat-form-field>

        <mat-radio-group class="scope-group" name="scope" [(ngModel)]="scope" [disabled]="!canChangeScope()">
          <mat-radio-button value="private"><span class="scope-label"><mat-icon>lock_person</mat-icon>Private</span></mat-radio-button>
          <mat-radio-button value="family"><span class="scope-label"><mat-icon>family_restroom</mat-icon>Shared with family</span></mat-radio-button>
        </mat-radio-group>
        <p class="hint">
          {{ !canChangeScope()
            ? 'Only the person who created this can change who sees it.'
            : scope === 'private' ? 'Only you will see this task.' : 'Everyone in the family will see this task.' }}
        </p>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions class="dialog-actions">
      <button mat-button (click)="dialogRef.close()">Cancel</button>
      <button mat-raised-button color="primary" (click)="save()" [disabled]="!title.trim()">
        <mat-icon>{{ data.item ? 'save' : 'add' }}</mat-icon>
        {{ data.item ? 'Save changes' : 'Add task' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-form { display: flex; flex-direction: column; gap: 16px; padding-top: 8px; }
    .full-width { width: 100%; }
    .scope-group { display: flex; flex-wrap: wrap; gap: 12px; }
    .scope-label { display: inline-flex; align-items: center; gap: 4px; }
    .scope-label mat-icon { font-size: 18px; width: 18px; height: 18px; }
    .hint { margin: -8px 0 0; font-size: 0.8rem; color: var(--color-text-secondary); }
    .dialog-actions { justify-content: flex-end; }
  `]
})
export class BacklogItemDialogComponent {
  title: string;
  notes: string;
  memberId: string | null;
  scope: 'family' | 'private';

  constructor(
    public dialogRef: MatDialogRef<BacklogItemDialogComponent, BacklogItemDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: BacklogItemDialogData,
    public householdService: HouseholdService,
    private authService: AuthService
  ) {
    const item = data.item;
    this.title = item?.title ?? data.title ?? '';
    this.notes = item?.notes ?? '';
    this.memberId = item?.memberId ?? this.householdService.myMemberId() ?? null;
    this.scope = item?.scope ?? 'family';
    if (item) this.memberId = item.memberId ?? null;
  }

  /** Who sees an item is fixed to its creator, so only they may flip it. */
  canChangeScope(): boolean {
    const creator = this.data.item?.createdByUid;
    return !creator || creator === this.authService.currentUser()?.uid;
  }

  save(): void {
    if (!this.title.trim()) return;
    this.dialogRef.close({
      title: this.title.trim(),
      notes: this.notes.trim() || undefined,
      memberId: this.memberId || undefined,
      scope: this.scope
    });
  }
}
