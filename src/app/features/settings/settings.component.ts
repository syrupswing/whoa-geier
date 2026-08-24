import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PushNotificationService } from '../../services/push-notification.service';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';
import { HomeLogoBtnComponent } from '../../shared/home-logo-btn/home-logo-btn.component';
import { RemiScheduleComponent } from '../remi-schedule/remi-schedule.component';

const NOTIFICATION_PROMPT_KEY = 'notificationPromptDismissed';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatSnackBarModule,
    GlobalNavMenuComponent,
    HomeLogoBtnComponent,
    RemiScheduleComponent
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent {
  isRequestingPermission = signal(false);

  constructor(
    public pushNotificationService: PushNotificationService,
    private snackBar: MatSnackBar
  ) {}

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
