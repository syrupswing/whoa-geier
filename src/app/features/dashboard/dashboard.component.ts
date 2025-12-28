import { Component, OnInit, AfterViewInit, signal, ViewChild, ElementRef, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatListModule } from '@angular/material/list';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';import { MatTooltipModule } from '@angular/material/tooltip';import { RouterLink } from '@angular/router';
import { GoogleCalendarService, CalendarEvent } from '../../services/google-calendar.service';
import { GroceryService, GroceryItem } from '../../services/grocery.service';
import { GeminiAiService } from '../../services/gemini-ai.service';
import { WeatherService } from '../../services/weather.service';

interface TimelineEvent extends CalendarEvent {
  startDate: Date;
  endDate: Date;
  topPosition: number;
  height: number;
}

interface ChatMessage {
  text: string;
  isUser: boolean;
  timestamp: Date;
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, FormsModule, MatCardModule, MatIconModule, MatButtonModule, MatListModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatProgressSpinnerModule, MatTooltipModule, RouterLink],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss']
})
export class DashboardComponent implements OnInit, AfterViewInit {
  currentTime = signal<Date>(new Date());
  hours = Array.from({ length: 24 }, (_, i) => i);
  private timeInterval?: number;
  newItemName = '';
  
  // AI Chat properties
  chatMessages = signal<ChatMessage[]>([]);
  chatInput = '';;
  isChatLoading = signal(false);
  apiCallCount = signal<number>(0);
  
  // Welcome message properties
  welcomeMessage = signal<string>('Welcome to your Family Command Center!');
  isLoadingWelcome = signal(false);
  hasGeneratedWelcome = false;
  
  // Weather clothing recommendation
  clothingRecommendation = signal<string | null>(null);
  isLoadingClothing = signal(false);
  private hasUserInteracted = false;
  private sharedAudioContext: AudioContext | null = null;
  
  @ViewChild('dashboardTimeline', { read: ElementRef }) dashboardTimeline?: ElementRef;
  @ViewChild('chatContainer', { read: ElementRef }) chatContainer?: ElementRef;

  constructor(
    public calendarService: GoogleCalendarService,
    public groceryService: GroceryService,
    private geminiAi: GeminiAiService,
    public weatherService: WeatherService
  ) {
    // Watch for weather changes and generate clothing recommendation
    effect(() => {
      const weather = this.weatherService.weather();
      if (weather && !this.clothingRecommendation() && !this.isLoadingClothing()) {
        this.generateClothingRecommendation();
      }
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    // Update current time every minute
    this.timeInterval = window.setInterval(() => {
      this.currentTime.set(new Date());
    }, 60000);
    
    // Load API call count from localStorage (using GitHub key)
    const savedCount = localStorage.getItem('githubApiCallCount');
    if (savedCount) {
      this.apiCallCount.set(parseInt(savedCount, 10));
    }
    
    // Set up one-time listener for user interaction to enable audio
    const enableAudio = () => {
      this.hasUserInteracted = true;
      document.removeEventListener('click', enableAudio);
      document.removeEventListener('keydown', enableAudio);
      document.removeEventListener('touchstart', enableAudio);
    };
    document.addEventListener('click', enableAudio, { once: true });
    document.addEventListener('keydown', enableAudio, { once: true });
    document.addEventListener('touchstart', enableAudio, { once: true });
  }

  ngAfterViewInit(): void {
    // Scroll to current time after view is initialized
    setTimeout(() => this.scrollToCurrentTime(), 100);
  }

  ngOnDestroy(): void {
    if (this.timeInterval) {
      clearInterval(this.timeInterval);
    }
    if (this.sharedAudioContext) {
      this.sharedAudioContext.close().catch(() => {});
    }
  }

  /**
   * Scroll timeline to position current time indicator 20% from top
   */
  scrollToCurrentTime(): void {
    if (this.dashboardTimeline?.nativeElement) {
      const container = this.dashboardTimeline.nativeElement;
      const containerHeight = container.clientHeight;
      const currentTimePos = this.getCurrentTimePosition();
      const scrollPosition = Math.max(0, currentTimePos - (containerHeight * 0.2));
      container.scrollTop = scrollPosition;
    }
  }

  getTodayEvents(): TimelineEvent[] {
    const today = new Date();
    const dayStart = new Date(today);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(today);
    dayEnd.setHours(23, 59, 59, 999);

    // Use a Set to track event IDs and prevent duplicates
    const seenEventIds = new Set<string>();
    
    return this.calendarService.events()
      .filter(event => {
        // Skip if we've already processed this event
        if (seenEventIds.has(event.id)) {
          return false;
        }
        
        const eventStart = this.getEventStartDate(event);
        const eventEnd = this.getEventEndDate(event);
        
        // Check if event overlaps with today
        const overlapsToday = (eventStart >= dayStart && eventStart <= dayEnd) ||
                              (eventEnd >= dayStart && eventEnd <= dayEnd) ||
                              (eventStart < dayStart && eventEnd > dayEnd);
        
        if (overlapsToday) {
          seenEventIds.add(event.id);
          return true;
        }
        
        return false;
      })
      .map(event => this.calculateEventPosition(event))
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }

  calculateEventPosition(event: CalendarEvent): TimelineEvent {
    const startDate = this.getEventStartDate(event);
    const endDate = this.getEventEndDate(event);
    
    const today = new Date();
    const dayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 0, 0, 0);
    const dayEnd = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 23, 59, 59);
    
    // Clamp event times to today's bounds if it spans multiple days
    const effectiveStart = startDate < dayStart ? dayStart : startDate;
    const effectiveEnd = endDate > dayEnd ? dayEnd : endDate;
    
    const startMinutes = effectiveStart.getHours() * 60 + effectiveStart.getMinutes();
    const endMinutes = effectiveEnd.getHours() * 60 + effectiveEnd.getMinutes();
    const durationMinutes = endMinutes - startMinutes;
    
    const topPosition = (startMinutes / 60) * 60;
    const height = Math.max((durationMinutes / 60) * 60, 30);
    
    return {
      ...event,
      startDate,
      endDate,
      topPosition,
      height
    };
  }

  getEventStartDate(event: CalendarEvent): Date {
    const dateStr = event.start.dateTime || event.start.date;
    if (!dateStr) return new Date();
    
    if (event.start.date && !event.start.dateTime) {
      // All-day event - parse as local date
      const [year, month, day] = event.start.date.split('-').map(Number);
      return new Date(year, month - 1, day, 0, 0, 0);
    }
    
    // Parse dateTime - JavaScript will handle timezone automatically
    const date = new Date(dateStr);
    return date;
  }

  getEventEndDate(event: CalendarEvent): Date {
    const dateStr = event.end.dateTime || event.end.date;
    if (!dateStr) return new Date();
    
    if (event.end.date && !event.end.dateTime) {
      // All-day event - parse as local date
      const [year, month, day] = event.end.date.split('-').map(Number);
      return new Date(year, month - 1, day, 0, 0, 0);
    }
    
    // Parse dateTime - JavaScript will handle timezone automatically
    const date = new Date(dateStr);
    return date;
  }

  getCurrentTimePosition(): number {
    const now = this.currentTime();
    const minutes = now.getHours() * 60 + now.getMinutes();
    return (minutes / 60) * 60;
  }

  formatHour(hour: number): string {
    if (hour === 0) return '12 AM';
    if (hour < 12) return `${hour} AM`;
    if (hour === 12) return '12 PM';
    return `${hour - 12} PM`;
  }

  formatEventTime(event: CalendarEvent): string {
    if (event.start.dateTime) {
      const start = new Date(event.start.dateTime);
      const end = new Date(event.end.dateTime || event.start.dateTime);
      return `${this.formatTime(start)} - ${this.formatTime(end)}`;
    }
    return 'All day';
  }

  formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  }

  getEventColor(event: CalendarEvent): string {
    const colorMap: { [key: string]: string } = {
      '1': '#a4bdfc', '2': '#7ae7bf', '3': '#dbadff',
      '4': '#ff887c', '5': '#fbd75b', '6': '#ffb878',
      '7': '#46d6db', '8': '#e1e1e1', '9': '#5484ed',
      '10': '#51b749', '11': '#dc2127'
    };
    return event.colorId ? colorMap[event.colorId] : '#2196F3';
  }

  getActiveGroceryItems(): GroceryItem[] {
    return this.groceryService.items().filter(item => !item.completed).slice(0, 5);
  }

  getCompletedGroceryItems(): GroceryItem[] {
    return this.groceryService.items().filter(item => item.completed).slice(0, 3);
  }

  getTotalActiveCount(): number {
    return this.groceryService.items().filter(item => !item.completed).length;
  }

  async toggleGroceryItem(id: string): Promise<void> {
    await this.groceryService.toggleItem(id);
  }

  async addGroceryItem(): Promise<void> {
    if (this.newItemName.trim()) {
      await this.groceryService.addItem(this.newItemName);
      this.newItemName = '';
    }
  }

  signInToCalendar(): void {
    this.calendarService.signIn();
  }

  cards = [
    { 
      title: 'Food Hub', 
      icon: 'restaurant_menu', 
      description: 'Grocery list, recipes, and restaurants',
      route: '/food',
      color: '#4CAF50'
    },
    { 
      title: 'Calendar', 
      icon: 'event', 
      description: 'View family events and schedules',
      route: '/calendar',
      color: '#2196F3'
    },
    { 
      title: 'Quick Links', 
      icon: 'link', 
      description: 'Access school sites and important links',
      route: '/quick-links',
      color: '#FF9800'
    }
  ];

  async generateWelcomeMessage(): Promise<void> {
    // Guard against multiple calls
    if (this.hasGeneratedWelcome || this.isLoadingWelcome()) {
      return;
    }
    
    if (!this.geminiAi.isConfigured()) {
      return; // Keep default message
    }

    this.hasGeneratedWelcome = true;
    
    // Use setTimeout to write to signals outside reactive context
    setTimeout(() => this.isLoadingWelcome.set(true), 0);

    try {
      const prompt = `Write a very brief, friendly, and colloquial welcome message (maximum 15 words) for a family command center app that helps families manage their schedules, grocery lists, and daily activities. Make it warm and encouraging. Just return the message text, nothing else.`;
      
      const response = await this.geminiAi.generateContent(prompt);
      
      if (response.success && response.text.trim()) {
        const message = response.text.trim().replace(/^[\"']|[\"']$/g, '');
        // Use setTimeout to write to signals outside reactive context
        setTimeout(() => this.welcomeMessage.set(message), 0);
      }
    } catch (error) {
      console.error('Error generating welcome message:', error);
    } finally {
      // Use setTimeout to write to signals outside reactive context
      setTimeout(() => this.isLoadingWelcome.set(false), 0);
    }
  }

  // AI Chat methods
  async sendChatMessage(): Promise<void> {
    if (!this.chatInput.trim() || this.isChatLoading()) {
      return;
    }

    if (!this.geminiAi.isConfigured()) {
      this.chatMessages.update(messages => [...messages, {
        text: 'AI assistant is not configured. Please add your GitHub Personal Access Token to the environment file (src/environments/environment.ts). Get a token from: https://github.com/settings/tokens?type=beta with "Model inference: Read" permission.',
        isUser: false,
        timestamp: new Date()
      }]);;
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

    this.isChatLoading.set(true);
    this.scrollChatToBottom();

    try {
      const context = `You are a helpful family assistant for a family command center app. Be friendly, concise, and helpful. The user asked: ${userMessage}`;
      const response = await this.geminiAi.generateContent(context);

      if (response.success) {
        this.chatMessages.update(messages => [...messages, {
          text: response.text,
          isUser: false,
          timestamp: new Date()
        }]);
      } else {
        throw new Error(response.error || 'Failed to get response');
      }
    } catch (error: any) {
      // Check if it's a model/API access error
      const isApiError = error.message?.includes('not found') || error.message?.includes('API version') || error.message?.includes('401') || error.message?.includes('403');
      
      let errorMessage = `Sorry, I couldn't process your message: ${error.message}`;
      
      if (isApiError) {
        errorMessage = `🔧 **GitHub Token Setup Required**

The GitHub Personal Access Token needs to be configured. Here's how:

**Step 1: Create Token**
1. Visit: https://github.com/settings/tokens?type=beta
2. Click "Generate new token" (fine-grained)
3. Name it: "Family Command Center AI"
4. Set expiration: 90 days or longer

**Step 2: Set Permissions**
- Account permissions → Model inference: **Read** access

**Step 3: Generate & Copy**
1. Click "Generate token"
2. Copy the token (starts with github_pat_)

**Step 4: Update Your App**
1. Open: src/environments/environment.ts
2. Replace githubToken value with your new token
3. Restart the dev server (npm start)

**Why GitHub?** It's completely FREE - no payment method needed!

Try again once you've completed these steps!`;
      }
      
      this.chatMessages.update(messages => [...messages, {
        text: errorMessage,
        isUser: false,
        timestamp: new Date()
      }]);
    } finally {
      this.isChatLoading.set(false);
      setTimeout(() => this.scrollChatToBottom(), 100);
    }
  }

  scrollChatToBottom(): void {
    if (this.chatContainer?.nativeElement) {
      const container = this.chatContainer.nativeElement;
      container.scrollTop = container.scrollHeight;
    }
  }

  clearChat(): void {
    this.chatMessages.set([]);
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

  getMoonPhase(): string {
    // Calculate moon phase based on current date
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth() + 1;
    const day = now.getDate();
    
    // Calculate days since known new moon (Jan 6, 2000)
    const knownNewMoon = new Date(2000, 0, 6);
    const daysSince = Math.floor((now.getTime() - knownNewMoon.getTime()) / (1000 * 60 * 60 * 24));
    const lunarCycle = 29.53058867; // Average lunar cycle in days
    const phase = (daysSince % lunarCycle) / lunarCycle;
    
    // Return moon phase emoji
    if (phase < 0.0625) return '🌑'; // New moon
    if (phase < 0.1875) return '🌒'; // Waxing crescent
    if (phase < 0.3125) return '🌓'; // First quarter
    if (phase < 0.4375) return '🌔'; // Waxing gibbous
    if (phase < 0.5625) return '🌕'; // Full moon
    if (phase < 0.6875) return '🌖'; // Waning gibbous
    if (phase < 0.8125) return '🌗'; // Last quarter
    if (phase < 0.9375) return '🌘'; // Waning crescent
    return '🌑'; // New moon
  }

  isNightTime(): boolean {
    const hour = new Date().getHours();
    // Consider night time from 7 PM to 6 AM
    return hour >= 19 || hour < 6;
  }

  getTimeOfDay(): string {
    const hour = new Date().getHours();
    
    if (hour >= 5 && hour < 7) return 'dawn';
    if (hour >= 7 && hour < 10) return 'morning';
    if (hour >= 10 && hour < 15) return 'midday';
    if (hour >= 15 && hour < 17) return 'afternoon';
    if (hour >= 17 && hour < 19) return 'sunset';
    if (hour >= 19 && hour < 21) return 'dusk';
    return 'night';
  }

  getWindIntensity(): string {
    const weather = this.weatherService.weather();
    if (!weather) return 'calm';
    
    const windSpeed = weather.windSpeed;
    if (windSpeed < 5) return 'calm';
    if (windSpeed < 15) return 'light';
    if (windSpeed < 25) return 'moderate';
    return 'strong';
  }

  shouldShowStars(): boolean {
    const condition = this.weatherService.getWeatherConditionClass();
    return this.isNightTime() && (condition === 'clear' || condition === 'foggy');
  }

  shouldShowPrecipitation(): boolean {
    const condition = this.weatherService.getWeatherConditionClass();
    return condition === 'rainy' || condition === 'snowy' || condition === 'stormy';
  }

  getPrecipitationType(): string {
    const condition = this.weatherService.getWeatherConditionClass();
    if (condition === 'snowy') return 'snow';
    if (condition === 'stormy') return 'heavy-rain';
    if (condition === 'rainy') return 'rain';
    return 'none';
  }

  async generateClothingRecommendation(): Promise<void> {
    const weather = this.weatherService.weather();
    if (!weather || !this.geminiAi.isConfigured() || this.isLoadingClothing()) {
      return;
    }

    this.isLoadingClothing.set(true);

    try {
      const prompt = `Based on this weather: ${weather.temperature}°F, ${weather.description}, humidity ${weather.humidity}%, wind ${weather.windSpeed} mph - write ONE short, friendly sentence (max 15 words) suggesting what to wear including both clothing AND footwear. Be conversational and helpful. Just return the sentence, nothing else.`;
      
      const response = await this.geminiAi.generateContent(prompt);
      
      if (response.success && response.text.trim()) {
        const fullText = response.text.trim().replace(/^["']|["']$/g, '');
        // Animate the text typing effect
        await this.animateTypingEffect(fullText);
      }
    } catch (error) {
      console.error('Error generating clothing recommendation:', error);
      // Provide a fallback recommendation with typing effect
      await this.animateTypingEffect('Check the weather and dress comfortably with suitable shoes!');
    } finally {
      this.isLoadingClothing.set(false);
    }
  }

  private async animateTypingEffect(fullText: string): Promise<void> {
    const typingSpeed = 40; // milliseconds per character
    let currentText = '';
    
    // Only try to use audio if user has interacted with the page
    if (this.hasUserInteracted && !this.sharedAudioContext) {
      try {
        this.sharedAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      } catch (error) {
        // Audio context not available
      }
    }
    
    for (let i = 0; i <= fullText.length; i++) {
      currentText = fullText.substring(0, i);
      this.clothingRecommendation.set(currentText);
      
      if (i < fullText.length) {
        const currentChar = fullText.charAt(i);
        // Play beep only for non-space characters
        if (currentChar !== ' ' && this.sharedAudioContext && this.sharedAudioContext.state === 'running') {
          this.playTypingSound(this.sharedAudioContext);
        }
        await new Promise(resolve => setTimeout(resolve, typingSpeed));
      }
    }
  }
  
  private playTypingSound(audioContext: AudioContext): void {
    try {
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // High-pitched consistent beep for each character
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(4500, audioContext.currentTime); // High-pitched
      
      // Short, crisp beep
      gainNode.gain.setValueAtTime(0, audioContext.currentTime);
      gainNode.gain.linearRampToValueAtTime(0.04, audioContext.currentTime + 0.002);
      gainNode.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 0.04);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.04);
    } catch (error) {
      // Silently fail if audio context is not available
    }
  }
}
