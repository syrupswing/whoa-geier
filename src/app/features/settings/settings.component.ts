import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { highlightWhenPresent } from '../../utils/highlight';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { PushNotificationService } from '../../services/push-notification.service';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';
import { FamilyMemoryComponent } from '../family-memory/family-memory.component';
import { AuthService } from '../../services/auth.service';
import { HouseholdService } from '../../services/household.service';
import { PersonTab, buildPeopleTabs } from './people-tabs';
import { AddMemberDialogComponent, AddMemberResult } from '../../components/add-member-dialog/add-member-dialog.component';
import { MemberSettingsService } from '../../services/member-settings.service';
import { MemberSettingsComponent } from './member-settings/member-settings.component';
import { PendingDaySuggestionsComponent } from '../../shared/pending-day-suggestions/pending-day-suggestions.component';
import { SettingRowComponent } from '../../shared/setting-row/setting-row.component';

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
    MatTabsModule,
    MatTooltipModule,
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
  private readonly dialog = inject(MatDialog);
  private readonly memberSettings = inject(MemberSettingsService);

  /** Which person's tab is showing. */
  selectedTab = 0;

  readonly tabs = computed<PersonTab[]>(() =>
    buildPeopleTabs(this.household.members(), this.household.myMemberId(), this.auth.currentUser()?.email));

  /** The + beside People: asks for the basics, adds the person, and opens their tab to fill in the rest. */
  openAddPerson(): void {
    this.dialog
      .open<AddMemberDialogComponent, void, AddMemberResult>(AddMemberDialogComponent, { width: '420px', maxWidth: '95vw' })
      .afterClosed()
      .subscribe(async result => {
        if (!result) return;
        try {
          const { id, inviteError } = await this.memberSettings.addMember(result.name, result.kind, result.email);
          const index = this.tabs().findIndex(t => t.memberId === id);
          if (index >= 0) this.selectedTab = index;
          this.snackBar.open(
            inviteError ? `${result.name} was added, but the invite failed: ${inviteError}` : `${result.name} added`,
            'Close', { duration: inviteError ? 6000 : 2500 }
          );
        } catch {
          this.snackBar.open('Could not add them — try again', 'Close', { duration: 3000 });
        }
      });
  }

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

  constructor(
    public pushNotificationService: PushNotificationService,
    private snackBar: MatSnackBar,
    private route: ActivatedRoute
  ) {}

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
