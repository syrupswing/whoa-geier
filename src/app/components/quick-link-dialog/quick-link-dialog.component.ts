import { Component, Inject, ChangeDetectorRef, AfterViewInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatDialogModule, MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { QuickLink, QuickLinkService } from '../../services/quick-link.service';

export interface QuickLinkDialogData {
  link?: QuickLink;
  mode: 'add' | 'edit';
}

@Component({
  selector: 'app-quick-link-dialog',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatSelectModule,
    MatCheckboxModule
  ],
  template: `
    <h2 mat-dialog-title>
      <mat-icon>{{ data.mode === 'add' ? 'add_link' : 'edit' }}</mat-icon>
      {{ data.mode === 'add' ? 'Add Quick Link' : 'Edit Quick Link' }}
    </h2>
    
    <mat-dialog-content>
      <div class="dialog-form">
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Title</mat-label>
          <input 
            matInput 
            name="title"
            [(ngModel)]="formData.title"
            placeholder="e.g., Google Drive"
            required>
          <mat-icon matPrefix>title</mat-icon>
        </mat-form-field>
        
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Subtitle (optional)</mat-label>
          <input 
            matInput
            name="subtitle" 
            [(ngModel)]="formData.subtitle"
            placeholder="e.g., Cloud storage">
          <mat-icon matPrefix>subtitles</mat-icon>
        </mat-form-field>
        
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>URL</mat-label>
          <input 
            matInput
            name="url" 
            [(ngModel)]="formData.url"
            placeholder="https://example.com or /path"
            required>
          <mat-icon matPrefix>link</mat-icon>
        </mat-form-field>
        
        <div class="checkbox-field">
          <mat-checkbox name="isExternal" [(ngModel)]="formData.isExternal">
            External link (opens in new tab)
          </mat-checkbox>
        </div>
        
        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Icon</mat-label>
          <mat-select name="icon" [(ngModel)]="formData.icon" required>
            <mat-option *ngFor="let icon of commonIcons" [value]="icon">
              <mat-icon>{{ icon }}</mat-icon>
              {{ icon }}
            </mat-option>
          </mat-select>
          <mat-icon matPrefix>{{ formData.icon || 'link' }}</mat-icon>
        </mat-form-field>
        
        <div class="icon-preview" *ngIf="formData.icon">
          <span class="preview-label">Preview:</span>
          <div class="preview-card">
            <mat-icon class="preview-icon">{{ formData.icon }}</mat-icon>
            <div class="preview-content">
              <div class="preview-title">{{ formData.title || 'Title' }}</div>
              <div class="preview-subtitle" *ngIf="formData.subtitle">{{ formData.subtitle }}</div>
            </div>
          </div>
        </div>
      </div>
    </mat-dialog-content>
    
    <mat-dialog-actions align="end">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button 
        mat-raised-button 
        color="primary"
        (click)="onSave()"
        [disabled]="!isValid()">
        <mat-icon>{{ data.mode === 'add' ? 'add' : 'save' }}</mat-icon>
        {{ data.mode === 'add' ? 'Add Link' : 'Save Changes' }}
      </button>
    </mat-dialog-actions>
  `,
  styles: [`
    .dialog-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
      min-width: 400px;
      padding: 16px 0;
      
      @media (max-width: 600px) {
        min-width: 280px;
      }
    }
    
    .full-width {
      width: 100%;
    }
    
    .checkbox-field {
      margin: 8px 0;
    }
    
    .icon-preview {
      margin-top: 16px;
      padding: 16px;
      background: var(--color-surface);
      border-radius: 8px;
      border: 1px solid rgba(255, 255, 255, 0.12);
      
      .preview-label {
        display: block;
        font-size: 12px;
        color: var(--color-text-secondary);
        margin-bottom: 12px;
        text-transform: uppercase;
        letter-spacing: 0.5px;
      }
      
      .preview-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 12px;
        background: var(--color-surface-light);
        border-radius: 8px;
        
        .preview-icon {
          color: #667eea;
          font-size: 28px;
          width: 28px;
          height: 28px;
        }
        
        .preview-content {
          flex: 1;
          
          .preview-title {
            font-size: 13px;
            font-weight: 600;
            color: var(--color-text-primary);
            margin-bottom: 2px;
          }
          
          .preview-subtitle {
            font-size: 10px;
            color: var(--color-text-secondary);
          }
        }
      }
    }
    
    h2[mat-dialog-title] {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 16px 12px 0 16px;
      
      mat-icon {
        color: var(--color-primary);
      }
    }
  `]
})
export class QuickLinkDialogComponent implements AfterViewInit {
  formData: {
    title: string;
    subtitle: string;
    url: string;
    icon: string;
    isExternal: boolean;
  };
  
  commonIcons: string[];

  constructor(
    public dialogRef: MatDialogRef<QuickLinkDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: QuickLinkDialogData,
    private quickLinkService: QuickLinkService,
    private cdr: ChangeDetectorRef
  ) {
    this.commonIcons = this.quickLinkService.COMMON_ICONS;
    
    // Initialize form with existing data or defaults
    if (data.link) {
      this.formData = {
        title: data.link.title,
        subtitle: data.link.subtitle || '',
        url: data.link.url,
        icon: data.link.icon,
        isExternal: data.link.isExternal
      };
    } else {
      this.formData = {
        title: '',
        subtitle: '',
        url: '',
        icon: 'link',
        isExternal: true
      };
    }
  }

  ngAfterViewInit(): void {
    // Use setTimeout to ensure the form fields are fully rendered
    // and the dialog animation is complete before updating
    setTimeout(() => {
      // Trigger change detection multiple times to ensure Material form fields 
      // properly detect their filled state and float labels
      this.cdr.detectChanges();
      
      // Force another round of change detection
      setTimeout(() => {
        this.cdr.detectChanges();
      }, 50);
    }, 150);
  }

  isValid(): boolean {
    return !!(this.formData.title.trim() && this.formData.url.trim() && this.formData.icon);
  }

  onCancel(): void {
    this.dialogRef.close();
  }

  onSave(): void {
    if (this.isValid()) {
      this.dialogRef.close(this.formData);
    }
  }
}
