import { Component, OnInit, signal } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatListModule } from '@angular/material/list';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Observable } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { CommonModule } from '@angular/common';
import { ThemeService } from './services/theme.service';
import { WeatherService } from './services/weather.service';

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
    MatDividerModule
  ],
  templateUrl: './app.component.html',
  styleUrls: ['./app.component.scss']
})
export class AppComponent implements OnInit {
  title = 'WHOA! At The Geier Haus';
  
  // API call counters
  geminiApiCalls = signal<number>(0);
  githubApiCalls = signal<number>(0);

  isHandset$: Observable<boolean> = this.breakpointObserver.observe(Breakpoints.Handset)
    .pipe(
      map(result => result.matches),
      shareReplay()
    );

  constructor(
    private breakpointObserver: BreakpointObserver,
    public themeService: ThemeService,
    public weatherService: WeatherService
  ) {}
  
  ngOnInit(): void {
    // Load API call counts from localStorage
    const geminiCount = localStorage.getItem('geminiApiCallCount');
    const githubCount = localStorage.getItem('githubApiCallCount');
    
    if (geminiCount) {
      this.geminiApiCalls.set(parseInt(geminiCount, 10));
    }
    if (githubCount) {
      this.githubApiCalls.set(parseInt(githubCount, 10));
    }
    
    // Listen for storage changes to update counters in real-time
    window.addEventListener('storage', this.handleStorageChange.bind(this));
  }
  
  handleStorageChange(event: StorageEvent): void {
    if (event.key === 'geminiApiCallCount' && event.newValue) {
      this.geminiApiCalls.set(parseInt(event.newValue, 10));
    }
    if (event.key === 'githubApiCallCount' && event.newValue) {
      this.githubApiCalls.set(parseInt(event.newValue, 10));
    }
  }

  toggleTheme(): void {
    this.themeService.toggle();
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
