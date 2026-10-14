import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MemberKind } from '../../services/day-profile.service';

export interface AddMemberResult {
  name: string;
  kind: MemberKind;
  /** Empty when none was entered. */
  email: string;
}

/** The few things needed to add someone to the family; everything else about them is set on their tab afterwards. */
@Component({
  selector: 'app-add-member-dialog',
  standalone: true,
  imports: [CommonModule, FormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSelectModule],
  template: `
    <h2 mat-dialog-title><mat-icon>person_add</mat-icon> Add a person</h2>
    <form (submit)="submit($event)">
      <mat-dialog-content>
        <div class="dialog-form">
          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>First name</mat-label>
            <input matInput name="name" [(ngModel)]="name" autocomplete="off" required cdkFocusInitial>
          </mat-form-field>

          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Role</mat-label>
            <mat-select name="kind" [(ngModel)]="kind">
              <mat-option value="adult">Adult (work days)</mat-option>
              <mat-option value="child">Child (school days)</mat-option>
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" subscriptSizing="dynamic">
            <mat-label>Login email (optional)</mat-label>
            <input matInput type="email" name="email" [(ngModel)]="email" autocomplete="off" placeholder="name@example.com">
            <mat-hint *ngIf="!emailInvalid()">They're linked automatically when they sign in with it.</mat-hint>
            <mat-hint class="invalid" *ngIf="emailInvalid()">Enter a valid email address.</mat-hint>
          </mat-form-field>
        </div>
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close>Cancel</button>
        <button mat-flat-button color="primary" type="submit" [disabled]="!canAdd()">Add</button>
      </mat-dialog-actions>
    </form>
  `,
  styles: [`
    .dialog-form { display: flex; flex-direction: column; gap: 16px; padding-top: 8px; min-width: min(360px, 80vw); }
    .invalid { color: var(--mat-sys-error, #b3261e); }
    h2 mat-icon { vertical-align: middle; margin-right: 6px; }
  `]
})
export class AddMemberDialogComponent {
  private readonly ref = inject<MatDialogRef<AddMemberDialogComponent, AddMemberResult>>(MatDialogRef);

  name = '';
  kind: MemberKind = 'adult';
  email = '';

  emailInvalid(): boolean {
    const email = this.email.trim();
    return !!email && !/^\S+@\S+\.\S+$/.test(email);
  }

  canAdd(): boolean {
    return !!this.name.trim() && !this.emailInvalid();
  }

  submit(event: Event): void {
    event.preventDefault();
    if (!this.canAdd()) return;
    this.ref.close({ name: this.name.trim(), kind: this.kind, email: this.email.trim() });
  }
}
