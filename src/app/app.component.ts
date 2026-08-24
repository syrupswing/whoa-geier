import { Component, OnInit, signal, effect, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { RouterOutlet, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { trigger, state, style, transition, animate } from '@angular/animations';
import { AuthService } from './services/auth.service';
import { LoadingAnimationComponent } from './components/loading-animation/loading-animation.component';
import { GithubAiService } from './services/github-ai.service';
import { PushNotificationService } from './services/push-notification.service';
import { TypewriterDirective } from './shared/typewriter/typewriter.directive';

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
    MatButtonModule,
    MatIconModule,
    MatTooltipModule,
    LoadingAnimationComponent,
    MatProgressSpinnerModule,
    MatFormFieldModule,
    MatInputModule,
    FormsModule,
    TypewriterDirective
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
  
  // Floating chat
  showChat = signal<boolean>(false);
  chatMessages = signal<ChatMessage[]>([]);
  chatInput = '';
  isChatLoading = signal(false);

  constructor(
    private router: Router,
    public authService: AuthService,
    public githubAiService: GithubAiService,
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
    // Initialize push notifications (no-op on unsupported browsers)
    this.pushNotificationService.initialize();

    // Clear the app icon badge whenever the user opens/returns to the app
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        this.pushNotificationService.clearBadge();
      }
    });
    this.pushNotificationService.clearBadge();

    // iOS WKWebView keeps stale env(safe-area-inset-*) values after a
    // portrait -> landscape -> portrait rotation, so the insets are measured
    // here and published as plain px custom properties instead.
    this.syncSafeAreaInsets();
    window.addEventListener('resize', this.scheduleSafeAreaSync);
    window.addEventListener('orientationchange', this.scheduleSafeAreaSync);
  }

  private scheduleSafeAreaSync = (): void => {
    // Rotation settles over several frames; sample a few times and keep the last.
    [0, 150, 400].forEach(delay => setTimeout(() => this.syncSafeAreaInsets(), delay));
  };

  private syncSafeAreaInsets(): void {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;' +
      'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);';
    document.body.appendChild(probe);
    const styles = getComputedStyle(probe);
    const top = styles.paddingTop;
    const bottom = styles.paddingBottom;
    probe.remove();

    const root = document.documentElement;
    root.style.setProperty('--app-safe-area-top', top);
    root.style.setProperty('--app-safe-area-bottom', bottom);
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
