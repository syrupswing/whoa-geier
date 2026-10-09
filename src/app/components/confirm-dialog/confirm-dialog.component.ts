import { Component, Inject, Injectable, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialog, MatDialogModule, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

export interface ConfirmOptions {
  title: string;
  /** Supporting text under the title. */
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Styles the confirm button as a warning and uses the delete icon — for deletes and other permanent actions. */
  destructive?: boolean;
  /** Overrides the icon (a destructive dialog defaults to "delete"). */
  icon?: string;
}

/** An app-styled replacement for the browser's confirm() prompt. Use ConfirmService rather than opening it directly. */
@Component({
  selector: 'app-confirm-dialog',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <h2 mat-dialog-title [class.destructive]="data.destructive">
      <mat-icon>{{ data.icon || (data.destructive ? 'delete' : 'help_outline') }}</mat-icon>
      {{ data.title }}
    </h2>

    <mat-dialog-content *ngIf="data.message">
      <p class="message">{{ data.message }}</p>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button type="button" [mat-dialog-close]="false" cdkFocusInitial>{{ data.cancelLabel || 'Cancel' }}</button>
      <button
        mat-flat-button
        type="button"
        [color]="data.destructive ? 'warn' : 'primary'"
        [mat-dialog-close]="true">
        {{ data.confirmLabel || (data.destructive ? 'Delete' : 'Confirm') }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    h2[mat-dialog-title] { display: flex; align-items: center; gap: 8px; }
    h2[mat-dialog-title] mat-icon { color: var(--color-primary); }
    h2[mat-dialog-title].destructive mat-icon { color: var(--color-warn-dark, #d32f2f); }
    .message { margin: 0; color: var(--color-text-secondary); }
  `]
})
export class ConfirmDialogComponent {
  constructor(@Inject(MAT_DIALOG_DATA) public data: ConfirmOptions) {}
}

@Injectable({ providedIn: 'root' })
export class ConfirmService {
  private dialog = inject(MatDialog);

  /** Resolves true if the user confirms, false if they cancel or dismiss the dialog. */
  async confirm(options: ConfirmOptions): Promise<boolean> {
    const result = await this.dialog
      .open<ConfirmDialogComponent, ConfirmOptions, boolean>(ConfirmDialogComponent, {
        data: options,
        width: '360px',
        maxWidth: '90vw'
      })
      .afterClosed()
      .toPromise();
    return result === true;
  }
}
