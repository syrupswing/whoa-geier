import { Component, OnInit, signal, effect, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { trigger, state, style, transition, animate } from '@angular/animations';
import { WeatherService } from './services/weather.service';
import { AuthService } from './services/auth.service';
import { GithubAiService } from './services/github-ai.service';
import { FirestoreService } from './services/firestore.service';
import { PushNotificationService } from './services/push-notification.service';

interface ChatMessage {
  text: string;
  isUser: boolean;
  timestamp: Date;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    MatDividerModule,
    MatMenuModule,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss'],
  animations: [
    trigger('slideUp', [
      transition(':enter', [
        style({ transform: 'translateY(100%)', opacity: 0 }),
        animate('300ms ease-out', style({ transform: 'translateY(0)', opacity: 1 }))
      ]),
      transition(':leave', [
        animate('300ms ease-in', style({ transform: 'translateY(100%)', opacity: 0 }))
      ])
    ])
  ]
})
export class AppComponent implements OnInit, AfterViewChecked {
  @ViewChild('floatingChatContainer') private chatContainer!: ElementRef<HTMLDivElement>;
  private shouldScrollChat = false;
  private statsUnsubscribe: (() => void) | null = null;
  
  title = 'Whoa Geier App';
  
  // API call counter
  githubApiCalls = signal<number>(0);
  
  // AI connection status
  isAIConnected = signal<boolean>(false);
  showAISetupPrompt = signal<boolean>(false);
  
  // Monitoring dashboard
  showMonitoringBar = signal<boolean>(false);
  
  // Floating chat
  showChat = signal<boolean>(false);
  chatMessages = signal<ChatMessage[]>([]);
  chatInput = '';
  isChatLoading = signal(false);

  constructor(
    private router: Router,
    public weatherService: WeatherService,
    public authService: AuthService,
    public githubAiService: GithubAiService,
    public firestoreService: FirestoreService,
    public pushNotificationService: PushNotificationService
  ) {
    // Redirect to dashboard if authenticated and on login page
    effect(() => {
      if (this.authService.isAuthenticated() && this.router.url === '/login') {
        this.router.navigate(['/']);
      }
    });
  }
  
  ngOnInit(): void {
    // Check AI connection status
    this.isAIConnected.set(this.githubAiService.isConfigured());

    // Initialize push notifications (no-op on unsupported browsers)
    this.pushNotificationService.initialize();

    // Clear the app icon badge whenever the user opens/returns to the app
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.pushNotificationService.clearBadge();
      }
    });
    this.pushNotificationService.clearBadge();
    
    // Subscribe to Firestore for API counter if initialized
    if (this.firestoreService.isInitialized()) {
      this.statsUnsubscribe = this.firestoreService.subscribeToAppStats((count) => {
        this.githubApiCalls.set(count);
      });
    } else {
      // Fallback to localStorage if Firestore not available
      const githubCount = localStorage.getItem('githubApiCallCount');
      if (githubCount) {
        this.githubApiCalls.set(parseInt(githubCount, 10));
      }
      // Listen for storage changes to update counter in real-time
      window.addEventListener('storage', this.handleStorageChange.bind(this));
    }
  }
  
  handleStorageChange(event: StorageEvent): void {
    if (event.key === 'githubApiCallCount' && event.newValue) {
      this.githubApiCalls.set(parseInt(event.newValue, 10));
    }
  }

  async signOut(): Promise<void> {
    try {
      await this.authService.signOut();
      // Explicitly navigate to login page
      this.router.navigate(['/login']);
    } catch (error) {
      console.error('Error signing out:', error);
    }
  }
  
  toggleAISetupPrompt(): void {
    this.showAISetupPrompt.update(v => !v);
  }
  
  navigateToAISetup(): void {
    this.showAISetupPrompt.set(false);
    // Token must be configured in src/environments/environment.local.ts
    alert('To configure GitHub AI:\n\n1. Get a token from: https://github.com/settings/tokens\n2. Add it to: src/environments/environment.local.ts\n3. Restart the dev server');
  }
  
  async resetApiCounter(): Promise<void> {
    this.githubApiCalls.set(0);
    
    if (this.firestoreService.isInitialized()) {
      await this.firestoreService.resetApiCounter();
    } else {
      // Fallback to localStorage
      localStorage.setItem('githubApiCallCount', '0');
    }
  }
  
  toggleMonitoringBar(): void {
    this.showMonitoringBar.update(v => !v);
  }
  
  ngAfterViewChecked(): void {
    if (this.shouldScrollChat) {
      this.scrollChatToBottom();
      this.shouldScrollChat = false;
    }
  }
  
  toggleChat(): void {
    this.showChat.update(v => !v);
  }
  
  async sendChatMessage(): Promise<void> {
    if (!this.chatInput.trim() || this.isChatLoading()) {
      return;
    }
    
    if (!this.githubAiService.isConfigured()) {
      this.chatMessages.update(messages => [...messages, {
        text: 'AI is not configured. Please add your GitHub token to use this feature.',
        isUser: false,
        timestamp: new Date()
      }]);
      this.shouldScrollChat = true;
      return;
    }

    const userMessage = this.chatInput.trim();
    this.chatInput = '';
    
    // Add user message
    this.chatMessages.update(messages => [...messages, {
      text: userMessage,
      isUser: true,
      timestamp: new Date()
    }]);
    this.shouldScrollChat = true;
    
    this.isChatLoading.set(true);
    
    try {
      const response = await this.githubAiService.generateContent(userMessage);
      
      if (response.success) {
        this.chatMessages.update(messages => [...messages, {
          text: response.text,
          isUser: false,
          timestamp: new Date()
        }]);
      } else {
        this.chatMessages.update(messages => [...messages, {
          text: `Error: ${response.error || 'Failed to get response'}`,
          isUser: false,
          timestamp: new Date()
        }]);
      }
    } catch (error: any) {
      this.chatMessages.update(messages => [...messages, {
        text: `Error: ${error.message || 'An unexpected error occurred'}`,
        isUser: false,
        timestamp: new Date()
      }]);
    } finally {
      this.isChatLoading.set(false);
      this.shouldScrollChat = true;
    }
  }
  
  clearChat(): void {
    this.chatMessages.set([]);
  }
  
  private scrollChatToBottom(): void {
    if (this.chatContainer) {
      try {
        this.chatContainer.nativeElement.scrollTop = this.chatContainer.nativeElement.scrollHeight;
      } catch (err) {
        console.error('Error scrolling chat:', err);
      }
    }
  }
}
