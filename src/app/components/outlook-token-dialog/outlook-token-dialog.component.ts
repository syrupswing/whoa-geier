import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { OutlookCalendarService } from '../../services/outlook-calendar.service';

export const GRAPH_EXPLORER_URL = 'https://developer.microsoft.com/graph/graph-explorer';

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
      <div class="open-row">
        <a mat-stroked-button [href]="graphExplorerUrl" target="_blank" rel="noopener">
          Open Graph Explorer
        </a>
        <span>and copy Access Token</span>
      </div>

      <mat-form-field appearance="outline" class="full-width">
        <mat-label>Paste Access Token</mat-label>
        <input
          matInput
          cdkFocusInitial
          name="token"
          [(ngModel)]="token"
          [disabled]="connecting()"
          spellcheck="false"
          autocomplete="off"
          (paste)="onPaste($event)"
          (input)="onInput()"
          (keydown.enter)="connect()">
      </mat-form-field>

      <p class="status" *ngIf="connecting()">Connecting…</p>
      <p class="error" *ngIf="error()">{{ error() }}</p>
    </mat-dialog-content>

    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close [disabled]="connecting()">Cancel</button>
      <button mat-flat-button color="primary" (click)="connect()" [disabled]="connecting() || !token.trim()">
        Connect
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .full-width { width: 100%; }
    .open-row { display: flex; align-items: center; gap: 10px; margin-bottom: 16px; flex-wrap: wrap; }
    .status { margin: 0; font-size: 0.85rem; color: var(--color-text-secondary); }
    .error { margin: 0; font-size: 0.85rem; color: var(--color-warn-dark, #d32f2f); }
    h2[mat-dialog-title] { display: flex; align-items: center; gap: 8px; }
    h2[mat-dialog-title] mat-icon { color: var(--color-primary); }
  `]
})
export class OutlookTokenDialogComponent {
  private outlookService = inject(OutlookCalendarService);
  dialogRef = inject(MatDialogRef<OutlookTokenDialogComponent>);

  readonly graphExplorerUrl = GRAPH_EXPLORER_URL;

  token = '';
  connecting = signal(false);
  error = signal<string | null>(null);

  /** Pasting the token connects straight away; the Connect button covers anything else. */
  onPaste(event: ClipboardEvent): void {
    const text = event.clipboardData?.getData('text') ?? '';
    if (!text.trim()) return;
    event.preventDefault();
    this.token = text;
    void this.connect();
  }

  /**
   * Some mobile keyboards and autofill put the token in the field without a paste event,
   * so connect when the field suddenly holds something that looks like a whole token.
   */
  onInput(): void {
    if (/^(Bearer\s+)?"?eyJ[\w\-.\s]{100,}/i.test(this.token.trim())) void this.connect();
  }

  async connect(): Promise<void> {
    if (this.connecting() || !this.token.trim()) return;
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
