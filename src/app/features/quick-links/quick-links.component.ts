import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { RouterLink } from '@angular/router';
import { QuickLink, QuickLinkService } from '../../services/quick-link.service';
import { QuickLinkDialogComponent } from '../../components/quick-link-dialog/quick-link-dialog.component';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';
import { HomeLogoBtnComponent } from '../../shared/home-logo-btn/home-logo-btn.component';

@Component({
  selector: 'app-quick-links',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatTooltipModule,
    MatSnackBarModule,
    RouterLink,
    GlobalNavMenuComponent,
    HomeLogoBtnComponent
  ],
  templateUrl: './quick-links.component.html',
  styleUrls: ['./quick-links.component.scss']
})
export class QuickLinksComponent {
  constructor(
    public quickLinkService: QuickLinkService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {}

  openAddQuickLinkDialog(): void {
    const dialogRef = this.dialog.open(QuickLinkDialogComponent, {
      width: '500px',
      data: { mode: 'add' }
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result) {
        try {
          await this.quickLinkService.addLink(result);
          this.snackBar.open('Quick link added successfully', 'Close', { duration: 3000 });
        } catch (error) {
          console.error('Error adding quick link:', error);
          this.snackBar.open('Failed to add quick link', 'Close', { duration: 3000 });
        }
      }
    });
  }

  openEditQuickLinkDialog(link: QuickLink): void {
    const dialogRef = this.dialog.open(QuickLinkDialogComponent, {
      width: '500px',
      data: { mode: 'edit', link }
    });

    dialogRef.afterClosed().subscribe(async (result) => {
      if (result) {
        try {
          await this.quickLinkService.updateLink(link.id, result);
          this.snackBar.open('Quick link updated successfully', 'Close', { duration: 3000 });
        } catch (error) {
          console.error('Error updating quick link:', error);
          this.snackBar.open('Failed to update quick link', 'Close', { duration: 3000 });
        }
      }
    });
  }

  async deleteQuickLink(link: QuickLink): Promise<void> {
    if (confirm(`Are you sure you want to delete "${link.title}"?`)) {
      try {
        await this.quickLinkService.deleteLink(link.id);
        this.snackBar.open('Quick link deleted successfully', 'Close', { duration: 3000 });
      } catch (error) {
        console.error('Error deleting quick link:', error);
        this.snackBar.open('Failed to delete quick link', 'Close', { duration: 3000 });
      }
    }
  }
}
