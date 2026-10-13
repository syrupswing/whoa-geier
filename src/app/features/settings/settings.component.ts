import { Component, OnInit, computed, inject, signal } from '@angular/core';
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
import { MatTabsModule } from '@angular/material/tabs';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PushNotificationService } from '../../services/push-notification.service';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';
import { FamilyMemoryComponent } from '../family-memory/family-memory.component';
import { AuthService } from '../../services/auth.service';
import { HouseholdService } from '../../services/household.service';
import { MemberSettingsComponent } from './member-settings/member-settings.component';
import { PendingDaySuggestionsComponent } from '../../shared/pending-day-suggestions/pending-day-suggestions.component';
import { SettingRowComponent } from '../../shared/setting-row/setting-row.component';

const NOTIFICATION_PROMPT_KEY = 'notificationPromptDismissed';

interface PersonTab {
  /** Stable across the signed-in person naming themselves, so their tab doesn't reset when it gains a member. */
  key: string;
  memberId: string | null;
  isMe: boolean;
  label: string;
}

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
    MatTabsModule,
    GlobalNavMenuComponent,
    FamilyMemoryComponent,
    MemberSettingsComponent,
    PendingDaySuggestionsComponent,
    SettingRowComponent
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss'
})
export class SettingsComponent implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly household = inject(HouseholdService);

  /**
   * The signed-in person first (labelled with their first name, else their email), then everyone else in
   * the household, so one adult can add or edit things for another adult or a child.
   */
  readonly tabs = computed<PersonTab[]>(() => {
    const members = this.household.members();
    const meId = this.household.myMemberId();
    const me = members.find(m => m.id === meId) ?? null;
    const mine: PersonTab = {
      key: 'me', memberId: me?.id ?? null, isMe: true,
      label: me?.name || this.auth.currentUser()?.email || 'Me'
    };
    const others = members
      .filter(m => m.id !== me?.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map<PersonTab>(m => ({ key: m.id, memberId: m.id, isMe: false, label: m.name }));
    return [mine, ...others];
  });

  trackTab(_: number, tab: PersonTab): string {
    return tab.key;
  }

  /** One line for the Notifications row, from this device's permission state. */
  notificationStatus(): string {
    if (!this.pushNotificationService.isSupported()) return "This device or browser doesn't support push notifications";
    switch (this.pushNotificationService.permissionState()) {
      case 'granted': return 'Enabled on this device';
      case 'denied': return 'Blocked — turn notifications back on for this site in your browser settings';
      default: return 'Not enabled on this device';
    }
  }

  isRequestingPermission = signal(false);
  isSavingHome = signal(false);
  homeAddressDraft = '';

  constructor(
    public pushNotificationService: PushNotificationService,
    private snackBar: MatSnackBar,
    private route: ActivatedRoute,
    public homeLocation: HomeLocationService
  ) {
  }

  async saveHomeAddress(row: SettingRowComponent): Promise<void> {
    this.isSavingHome.set(true);
    try {
      await this.homeLocation.save(this.homeAddressDraft);
      row.close();
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
