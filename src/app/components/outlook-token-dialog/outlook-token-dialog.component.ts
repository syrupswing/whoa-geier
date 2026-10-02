import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { OutlookCalendarService } from '../../services/outlook-calendar.service';

/** Asks for an access token copied from Microsoft Graph Explorer and connects Outlook with it. */
@Component({
  selector: 'app-outlook-token-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>mail</mat-icon>
      Connect Outlook calendar
    </h2>

    <mat-dialog-content>
      <ol class="steps">
        <li>Open <a href="https://developer.microsoft.com/graph/graph-explorer" target="_blank" rel="noopener">Graph Explorer</a> and sign in with your Outlook account.</li>
        <li>Under <strong>Modify permissions</strong>, consent to <strong>Calendars.Read</strong>.</li>
        <li>Open the <strong>Access token</strong> tab, copy the token, and paste it below.</li>
      </ol>
      <p class="hint">The token lasts about an hour. After it lapses, your last-synced events stay on screen until you paste a new one.</p>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Access token</mat-label>
        <textarea matInput rows="4" name="token" [(ngModel)]="token" spellcheck="false" autocomplete="off"></textarea>
      </mat-form-field>

      <p class="error" *ngIf="error()">{{ error() }}</p>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">Cancel</button>
      <button mat-raised-button color="primary" (click)="connect()" [disabled]="!token.trim() || connecting()">
        {{ connecting() ? 'Connecting…' : 'Connect' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width { width: 100%; }
    .steps { margin: 0 0 8px; padding-left: 20px; font-size: 0.9rem; }
    .steps li { margin-bottom: 4px; }
    .hint { margin: 0 0 12px; font-size: 0.8rem; color: var(--color-text-secondary); }
    .error { margin: 0; font-size: 0.85rem; color: var(--color-warn-dark, #d32f2f); }
    h2[mat-dialog-title] { display: flex; align-items: center; gap: 8px; }
    h2[mat-dialog-title] mat-icon { color: var(--color-primary); }
    textarea { font-family: monospace; font-size: 0.75rem; word-break: break-all; }
  `]
})
export class OutlookTokenDialogComponent {
  private outlookService = inject(OutlookCalendarService);
  dialogRef = inject(MatDialogRef<OutlookTokenDialogComponent>);

  token = '';
  connecting = signal(false);
  error = signal<string | null>(null);

  async connect(): Promise<void> {
    this.connecting.set(true);
    this.error.set(null);
    const ok = await this.outlookService.connectWithToken(this.token);
    this.connecting.set(false);
    if (ok) {
      this.dialogRef.close(true);
    } else {
      this.error.set(this.outlookService.error() || 'Could not connect with that token.');
    }
  }
}
