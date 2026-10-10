import { Component, OnInit, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { HomeLocationService } from '../../services/home-location.service';
import { ActivatedRoute } from '@angular/router';
import { highlightWhenPresent } from '../../utils/highlight';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PushNotificationService } from '../../services/push-notification.service';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';
import { RemiScheduleComponent } from '../remi-schedule/remi-schedule.component';
import { FamilyMemoryComponent } from '../family-memory/family-memory.component';

const NOTIFICATION_PROMPT_KEY = 'notificationPromptDismissed';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    FormsModule,
    MatFormFieldModule,
    MatInputModule,
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatSnackBarModule,
    GlobalNavMenuComponent,
    RemiScheduleComponent,
    FamilyMemoryComponent
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit {
  isRequestingPermission = signal(false);
  isSavingHome = signal(false);
  homeAddressDraft = '';

  constructor(
    public pushNotificationService: PushNotificationService,
    private snackBar: MatSnackBar,
    private route: ActivatedRoute,
    public homeLocation: HomeLocationService
  ) {
    // Fill the field once the saved address has loaded.
    effect(() => {
      this.homeAddressDraft = this.homeLocation.address();
    });
  }

  async saveHomeAddress(): Promise<void> {
    this.isSavingHome.set(true);
    try {
      await this.homeLocation.save(this.homeAddressDraft);
      this.snackBar.open('Home address saved', 'Close', { duration: 2500 });
    } catch {
      this.snackBar.open('Could not save the address — try again', 'Close', { duration: 3000 });
    } finally {
      this.isSavingHome.set(false);
    }
  }

  ngOnInit(): void {
    // A link such as /settings?section=family-memory (from a chat confirmation) scrolls to that section.
    const section = this.route.snapshot.queryParamMap.get('section');
    const highlight = this.route.snapshot.queryParamMap.get('highlight');
    if (highlight) {
      highlightWhenPresent(highlight);
    } else if (section) {
      // Wait for the page (and the nested sections) to render before looking for the target.
      setTimeout(() => document.getElementById(section)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 400);
    }
  }

  async enableNotifications(): Promise<void> {
    this.isRequestingPermission.set(true);
    try {
      const granted = await this.pushNotificationService.requestPermission();
      if (granted) {
        localStorage.removeItem(NOTIFICATION_PROMPT_KEY);
        this.snackBar.open('Notifications enabled!', 'Close', { duration: 3000 });
      } else {
        this.snackBar.open('Notifications blocked — you can enable them in browser settings.', 'Close', { duration: 5000 });
      }
    } finally {
      this.isRequestingPermission.set(false);
    }
  }
}
