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
    public authService: AuthService
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
      // Router will automatically redirect to /login via authGuard
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
}
