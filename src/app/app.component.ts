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
import { AiOrchestratorService } from './services/ai-orchestrator.service';
import { PushNotificationService } from './services/push-notification.service';
import { TypewriterDirective } from './shared/typewriter/typewriter.directive';
import { QuickAddComponent } from './shared/quick-add/quick-add.component';

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
    TypewriterDirective,
    QuickAddComponent
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
  private wasPortrait = window.matchMedia('(orientation: portrait)').matches;
  
  // Floating chat
  showChat = signal<boolean>(false);
  chatMessages = signal<ChatMessage[]>([]);
  chatInput = '';
  isChatLoading = signal(false);

  constructor(
    private router: Router,
    public authService: AuthService,
    private aiOrchestrator: AiOrchestratorService,
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

    // Safe-area insets are republished as plain px custom properties; WebKit
    // caches env() values inside custom properties across orientation changes.
    this.syncSafeAreaInsets();
    window.addEventListener('resize', this.scheduleSafeAreaSync);
    window.addEventListener('orientationchange', this.scheduleSafeAreaSync);
    window.addEventListener('pageshow', this.scheduleSafeAreaSync);
    window.visualViewport?.addEventListener('resize', this.scheduleSafeAreaSync);
    window.screen.orientation?.addEventListener('change', this.scheduleSafeAreaSync);
  }

  private scheduleSafeAreaSync = (): void => {
    const isPortrait = window.matchMedia('(orientation: portrait)').matches;
    const orientationChanged = isPortrait !== this.wasPortrait;
    this.wasPortrait = isPortrait;

    if (orientationChanged) {
      // Only a viewport re-declaration makes WebKit re-read the insets after a
      // rotation; a plain reflow or re-measure still returns the stale values.
      [0, 250, 600].forEach(delay => setTimeout(() => this.refreshViewport(), delay));
    }

    // Rotation settles over several frames; sample repeatedly and keep the last.
    [0, 150, 400, 800].forEach(delay => setTimeout(() => this.syncSafeAreaInsets(), delay));
  };

  /**
   * Rewrites the viewport meta and forces the layout root to re-attach, which is
   * what a page refresh or route change does implicitly to fix the stale inset.
   */
  private refreshViewport(): void {
    const meta = document.querySelector('meta[name="viewport"]');
    if (meta) {
      const content = meta.getAttribute('content') || '';
      meta.setAttribute('content', `${content}, minimal-ui`);
      requestAnimationFrame(() => {
        meta.setAttribute('content', content);
        this.syncSafeAreaInsets();
      });
    }

    const container = document.querySelector('.app-container') as HTMLElement | null;
    if (container) {
      container.style.display = 'none';
      void container.offsetHeight;
      container.style.display = '';
    }
  }

  private syncSafeAreaInsets(): void {
    const probe = document.createElement('div');
    probe.style.cssText =
      'position:fixed;top:0;left:0;width:0;visibility:hidden;pointer-events:none;' +
      'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);';
    document.body.appendChild(probe);
    const styles = getComputedStyle(probe);
    const top = parseFloat(styles.paddingTop) || 0;
    const bottom = parseFloat(styles.paddingBottom) || 0;
    probe.remove();

    const root = document.documentElement;
    root.style.setProperty('--app-safe-area-top', `${top}px`);
    root.style.setProperty('--app-safe-area-bottom', `${bottom}px`);
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
      const result = await this.aiOrchestrator.generate<{ text: string }>('family-chat', { message: userMessage });
      this.chatMessages.update(messages => [...messages, {
        text: result.text,
        isUser: false,
        timestamp: new Date()
      }]);
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
