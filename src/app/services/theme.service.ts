import { Injectable, signal, effect } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ThemeService {
  // Signal to track dark mode state
  isDarkMode = signal<boolean>(false);

  constructor() {
    // Check if user has a saved preference
    const storedPreference = localStorage.getItem('theme-preference');
    
    if (storedPreference) {
      this.isDarkMode.set(storedPreference === 'dark');
    } else {
      // Check system preference if no saved preference
      const systemPrefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      this.isDarkMode.set(systemPrefersDark);
    }

    // React to theme changes
    effect(() => {
      const darkModeEnabled = this.isDarkMode();
      const bodyClassList = document.body.classList;
      
      if (darkModeEnabled) {
        bodyClassList.add('dark-mode');
      } else {
        bodyClassList.remove('dark-mode');
      }
      
      // Persist preference
      localStorage.setItem('theme-preference', darkModeEnabled ? 'dark' : 'light');
    });
  }

  toggle(): void {
    this.isDarkMode.update(current => !current);
  }
}
