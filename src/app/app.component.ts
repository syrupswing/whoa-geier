import { Component, OnInit, signal, effect } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { ThemeService } from './services/theme.service';
import { WeatherService } from './services/weather.service';
import { AuthService } from './services/auth.service';
import { GithubAiService } from './services/github-ai.service';

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
    MatSidenavModule,
    MatListModule,
    MatTooltipModule,
    MatDividerModule,
    MatMenuModule,
    MatProgressSpinnerModule
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  title = 'Whoa Geier App';
  
  // API call counter
  githubApiCalls = signal<number>(0);
  
  // AI connection status
  isAIConnected = signal<boolean>(false);
  showAISetupPrompt = signal<boolean>(false);

  isHandset$: Observable<boolean> = this.breakpointObserver.observe(Breakpoints.Handset)
    .pipe(
      map(result => result.matches),
      shareReplay()
    );

  constructor(
    private breakpointObserver: BreakpointObserver,
    private router: Router,
    public themeService: ThemeService,
    public weatherService: WeatherService,
    public authService: AuthService,
    public githubAiService: GithubAiService
  ) {
    // Redirect to dashboard if authenticated and on login page
    effect(() => {
      if (this.authService.isAuthenticated() && this.router.url === '/login') {
        this.router.navigate(['/']);
      }
    });
  }
  
  ngOnInit(): void {
    // Load API call count from localStorage
    const githubCount = localStorage.getItem('githubApiCallCount');
    
    if (githubCount) {
      this.githubApiCalls.set(parseInt(githubCount, 10));
    }
    
    // Check AI connection status
    this.isAIConnected.set(this.githubAiService.isConfigured());
    
    // Listen for storage changes to update counter in real-time
    window.addEventListener('storage', this.handleStorageChange.bind(this));
  }
  
  handleStorageChange(event: StorageEvent): void {
    if (event.key === 'githubApiCallCount' && event.newValue) {
      this.githubApiCalls.set(parseInt(event.newValue, 10));
    }
  }

  toggleTheme(): void {
    this.themeService.toggle();
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
  
  getWeatherIcon(): string {
    const condition = this.weatherService.getWeatherConditionClass();
    switch (condition) {
      case 'rainy': return 'rainy';
      case 'snowy': return 'ac_unit';
      case 'cloudy': return 'cloud';
      case 'clear': return 'wb_sunny';
      case 'stormy': return 'thunderstorm';
      case 'foggy': return 'foggy';
      default: return 'wb_sunny';
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
  
  resetApiCounter(): void {
    this.githubApiCalls.set(0);
    localStorage.setItem('githubApiCallCount', '0');
  }
}
