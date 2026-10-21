import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ChatIdea } from '../../services/chat-idea.service';
import { MATERIAL_ICONS } from '../../shared/material-icons';

export interface ChatIdeaDialogData {
  /** The idea being edited; omit to add a new one. */
  idea?: ChatIdea;
}

/** What the dialog closes with: a saved idea, or `delete` for an existing one. */
export type ChatIdeaDialogResult = { icon: string; label: string; prompt: string } | 'delete';

const SUGGESTED = [
  'lightbulb', 'today', 'date_range', 'event_available', 'add_task', 'inventory', 'shopping_cart', 'restaurant',
  'directions_car', 'school', 'child_care', 'pets', 'home', 'build', 'celebration', 'favorite', 'cake', 'sports_soccer',
  'flight', 'local_hospital', 'account_balance', 'star'
];

@Component({
  selector: 'app-chat-idea-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatAutocompleteModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>lightbulb</mat-icon>
      {{ data.idea ? 'Edit idea' : 'New idea' }}
    </h2>

    <mat-dialog-content>
      <div class="dialog-form">
        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full-width">
          <mat-label>Label</mat-label>
          <input matInput name="label" [(ngModel)]="label" placeholder="e.g., Plan the week" required autocomplete="off">
        </mat-form-field>

        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full-width">
          <mat-label>Prompt</mat-label>
          <textarea matInput name="prompt" [(ngModel)]="prompt" rows="4" required
            placeholder="What gets put in the chat box when someone picks this idea"></textarea>
          <mat-hint>Picking the idea fills the chat box with this; nothing is sent until you press send.</mat-hint>
        </mat-form-field>

        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="full-width">
          <mat-label>Icon</mat-label>
          <input matInput name="icon" [(ngModel)]="icon" [matAutocomplete]="iconList" autocomplete="off"
            placeholder="e.g., lightbulb" autocapitalize="none" spellcheck="false">
          <mat-icon matPrefix>{{ iconName() }}</mat-icon>
          <mat-autocomplete #iconList="matAutocomplete">
            <mat-option *ngFor="let name of suggestions()" [value]="name"><mat-icon>{{ name }}</mat-icon> {{ name }}</mat-option>
          </mat-autocomplete>
          <mat-hint>Pick one, or type any name from fonts.google.com/icons (like "snowboarding").</mat-hint>
        </mat-form-field>
        <p class="hint">Shared with the whole family.</p>
      </div>
    </mat-dialog-content>

    <mat-dialog-actions class="dialog-actions">
      <button mat-button color="warn" *ngIf="data.idea" (click)="dialogRef.close('delete')">Delete</button>
      <span class="spacer"></span>
      <button mat-button (click)="dialogRef.close()">Cancel</button>
      <button mat-raised-button color="primary" (click)="save()" [disabled]="!label.trim() || !prompt.trim()">
        <mat-icon>{{ data.idea ? 'save' : 'add' }}</mat-icon>
        {{ data.idea ? 'Save changes' : 'Add idea' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-form { display: flex; flex-direction: column; gap: 16px; padding-top: 8px; }
    .full-width { width: 100%; }
    .hint { margin: -8px 0 0; font-size: 0.8rem; color: var(--color-text-secondary); }
    .dialog-actions { display: flex; gap: 8px; }
    .spacer { flex: 1; }
  `]
})
export class ChatIdeaDialogComponent {
  label: string;
  prompt: string;
  icon: string;

  constructor(
    public dialogRef: MatDialogRef<ChatIdeaDialogComponent, ChatIdeaDialogResult>,
    @Inject(MAT_DIALOG_DATA) public data: ChatIdeaDialogData
  ) {
    this.label = data.idea?.label ?? '';
    this.prompt = data.idea?.prompt ?? '';
    this.icon = data.idea?.icon ?? 'lightbulb';
  }

  /** The typed icon as a Material icon name: lowercase, with spaces as underscores. Empty falls back to the default. */
  iconName(): string {
    return this.icon.trim().toLowerCase().replace(/\s+/g, '_') || 'lightbulb';
  }

  /** Matches from the known icon names while typing; with nothing typed, the short list of common ones. */
  suggestions(): string[] {
    const typed = this.iconName();
    if (!this.icon.trim()) return SUGGESTED;
    return MATERIAL_ICONS.filter(n => n.includes(typed)).slice(0, 40);
  }

  save(): void {
    if (!this.label.trim() || !this.prompt.trim()) return;
    this.dialogRef.close({ icon: this.iconName(), label: this.label.trim(), prompt: this.prompt.trim() });
  }
}
