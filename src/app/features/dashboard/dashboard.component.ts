import { Component, OnInit, AfterViewInit, OnDestroy, signal, ViewChild, ElementRef, inject, effect, HostListener, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { GoogleCalendarService, CalendarEvent } from '../../services/google-calendar.service';
import { LoadingAnimationComponent } from '../../components/loading-animation/loading-animation.component';
import { GroceryService } from '../../services/grocery.service';
import { GithubAiService } from '../../services/github-ai.service';
import { WeatherService } from '../../services/weather.service';
import { TodoService } from '../../services/todo.service';
import { FirestoreService } from '../../services/firestore.service';
import { PushNotificationService } from '../../services/push-notification.service';
import { RemiScheduleService } from '../../services/remi-schedule.service';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';
import { HomeLogoBtnComponent } from '../../shared/home-logo-btn/home-logo-btn.component';

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
  imports: [CommonModule, FormsModule, MatIconModule, MatButtonModule, MatFormFieldModule, MatInputModule, LoadingAnimationComponent, MatTooltipModule, MatSnackBarModule, RouterLink, GlobalNavMenuComponent, HomeLogoBtnComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit, AfterViewInit {
  currentTime = signal<Date>(new Date());
  viewDate = signal<Date>(new Date());
  selectedEvent = signal<TimelineEvent | null>(null);
  popoverAbove = false;
  showCalendarSelector = false;
  readonly HOUR_PX = 20;
  readonly TOTAL_TIMELINE_HEIGHT = 480; // fixed container height
  readonly allHours = Array.from({ length: 24 }, (_, i) => i);
  private timeInterval?: number;
  newItemName = '';
  showWeatherWidget = false;
  
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
  
  // Reading entries widget
  readingEntries = signal<any[]>([]);
  readingMinutes = signal<number>(0);
  showReadingForm = signal<boolean>(false);
  showReadingLog = signal<boolean>(false);
  minutesToAdd = signal<number | null>(null);
  private readingUnsubscribe: any = null;
  
  @ViewChild('dashboardTimeline', { read: ElementRef }) dashboardTimeline?: ElementRef;
  @ViewChild('chatContainer', { read: ElementRef }) chatContainer?: ElementRef;

  constructor(
    public calendarService: GoogleCalendarService,
    public groceryService: GroceryService,
    public githubAi: GithubAiService,
    public weatherService: WeatherService,
    public todoService: TodoService,
    public firestoreService: FirestoreService,
    public pushNotificationService: PushNotificationService,
    public remiScheduleService: RemiScheduleService,
    private snackBar: MatSnackBar
  ) {
    // Clothing recommendation is now opt-in via button click to avoid auto-loading errors
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
    
    // Subscribe to reading entries from Firestore
    if (this.firestoreService.isInitialized()) {
      this.readingUnsubscribe = this.firestoreService.subscribeToReadingEntries((entries) => {
        this.readingEntries.set(entries);
        // Calculate total minutes
        const total = entries.reduce((sum, entry) => sum + (entry.minutes || 0), 0);
        this.readingMinutes.set(total);
      });
    }

    // Load today's briefing for Remi
    this.remiScheduleService.loadTodayBriefing();
    
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
    if (this.readingUnsubscribe) {
      this.readingUnsubscribe();
    }
  }

  async enableNotifications(): Promise<void> {
    const granted = await this.pushNotificationService.requestPermission();
    if (granted) {
      this.snackBar.open('Notifications enabled!', 'Dismiss', { duration: 3000 });
    } else {
      this.snackBar.open('Notifications blocked — you can enable them in browser settings.', 'Dismiss', { duration: 5000 });
    }
  }

  /**
   * Scroll timeline to position current time indicator 20% from top
   */
  get isViewingToday(): boolean {
    const v = this.viewDate(), t = new Date();
    return v.getFullYear() === t.getFullYear() && v.getMonth() === t.getMonth() && v.getDate() === t.getDate();
  }

  prevDay(): void {
    const d = new Date(this.viewDate());
    d.setDate(d.getDate() - 1);
    this.viewDate.set(d);
  }

  nextDay(): void {
    const d = new Date(this.viewDate());
    d.setDate(d.getDate() + 1);
    this.viewDate.set(d);
  }

  goToToday(): void {
    this.viewDate.set(new Date());
    setTimeout(() => this.scrollToCurrentTime(), 50);
  }

  formatViewDate(): string {
    return this.viewDate().toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  getViewDayEvents(): TimelineEvent[] {
    const day = this.viewDate();
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
    const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
    const seenIds = new Set<string>();
    return this.calendarService.events()
      .filter(event => {
        if (seenIds.has(event.id)) return false;
        const start = this.getEventStartDate(event);
        const end = this.getEventEndDate(event);
        if (start <= dayEnd && end >= dayStart) { seenIds.add(event.id); return true; }
        return false;
      })
      .map(event => this.calculateEventPositionForDate(event, day))
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }

  calculateEventPositionForDate(event: CalendarEvent, forDate: Date): TimelineEvent {
    const startDate = this.getEventStartDate(event);
    const endDate = this.getEventEndDate(event);
    const dayStart = new Date(forDate.getFullYear(), forDate.getMonth(), forDate.getDate(), 0, 0, 0);
    const dayEnd = new Date(forDate.getFullYear(), forDate.getMonth(), forDate.getDate(), 23, 59, 59);
    const effectiveStart = startDate < dayStart ? dayStart : startDate;
    const effectiveEnd = endDate > dayEnd ? dayEnd : endDate;
    const startMin = effectiveStart.getHours() * 60 + effectiveStart.getMinutes();
    const endMin = effectiveEnd.getHours() * 60 + effectiveEnd.getMinutes();
    return {
      ...event, startDate, endDate,
      topPosition: (startMin / 60) * this.HOUR_PX,
      height: Math.max(((endMin - startMin) / 60) * this.HOUR_PX, 14)
    };
  }

  getAllDayEvents(): TimelineEvent[] {
    return this.getViewDayEvents().filter(e => !e.start.dateTime && this.calendarService.isCalendarVisible(e.calendarId || 'primary'));
  }

  getTimedEvents(): TimelineEvent[] {
    return this.getViewDayEvents().filter(e => !!e.start.dateTime && this.calendarService.isCalendarVisible(e.calendarId || 'primary'));
  }

  getVisibleHourRange(): { start: number; end: number } {
    const timed = this.getTimedEvents();
    if (timed.length === 0) return { start: 0, end: 24 };

    let minHour = 24, maxHour = 0;
    for (const e of timed) {
      const startHour = e.startDate.getHours() + e.startDate.getMinutes() / 60;
      const endHour = e.endDate.getHours() + e.endDate.getMinutes() / 60;
      if (startHour < minHour) minHour = startHour;
      if (endHour > maxHour) maxHour = endHour;
    }

    return {
      start: Math.max(0, Math.floor(minHour - 1.5)),
      end: Math.min(24, Math.ceil(maxHour + 1.5)),
    };
  }

  getVisibleHours(): number[] {
    const { start, end } = this.getVisibleHourRange();
    return this.allHours.slice(start, end);
  }

  get effectiveHourPx(): number {
    const count = this.getVisibleHours().length;
    return count > 0 ? this.TOTAL_TIMELINE_HEIGHT / count : this.HOUR_PX;
  }

  get scaleFactor(): number {
    return this.effectiveHourPx / this.HOUR_PX;
  }

  isPlayheadInView(): boolean {
    const { start, end } = this.getVisibleHourRange();
    const now = this.currentTime();
    const hourNow = now.getHours() + now.getMinutes() / 60;
    return hourNow >= start && hourNow <= end;
  }

  playheadEdge(): 'above' | 'below' | null {
    if (!this.isViewingToday) return null;
    const { start, end } = this.getVisibleHourRange();
    const now = this.currentTime();
    const hourNow = now.getHours() + now.getMinutes() / 60;
    if (hourNow < start) return 'above';
    if (hourNow > end) return 'below';
    return null;
  }

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
      const [year, month, day] = event.end.date.split('-').map(Number);
      // Google Calendar end.date is exclusive for all-day events; subtract 1ms to make it inclusive
      return new Date(new Date(year, month - 1, day, 0, 0, 0).getTime() - 1);
    }
    
    // Parse dateTime - JavaScript will handle timezone automatically
    const date = new Date(dateStr);
    return date;
  }

  getCurrentTimePosition(): number {
    const now = this.currentTime();
    const minutes = now.getHours() * 60 + now.getMinutes();
    return (minutes / 60) * this.HOUR_PX;
  }

  selectEvent(event: TimelineEvent, mouseEvent: Event): void {
    mouseEvent.stopPropagation();
    const target = mouseEvent.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    // Flip above if less than 210px below the event
    this.popoverAbove = (window.innerHeight - rect.bottom) < 210;
    this.selectedEvent.set(event);
  }

  clearSelectedEvent(): void {
    this.selectedEvent.set(null);
  }

  formatHour(hour: number): string {
    if (hour === 0) return '12 AM';
    if (hour < 12) return `${hour} AM`;
    if (hour === 12) return '12 PM';
    return `${hour - 12} PM`;
  }

  getGreetingMessage(): string {
    const hour = this.currentTime().getHours();
    let greeting = 'Good evening';

    if (hour >= 5 && hour < 12) {
      greeting = 'Good morning';
    } else if (hour >= 12 && hour < 18) {
      greeting = 'Good afternoon';
    }

    return `${greeting}!`;
  }

  getNotificationCount(): number {
    const eventCount = this.getTodayEvents().length;
    const overdueTodos = this.todoService
      .getSortedIncompleteItems()
      .filter(item => this.todoService.getDaysOverdue(item) > 0).length;
    return eventCount + overdueTodos;
  }

  formatEventTime(event: CalendarEvent): string {
    if (event.start.dateTime) {
      const start = new Date(event.start.dateTime);
      const end = new Date(event.end.dateTime || event.start.dateTime);
      const sameDay = start.toDateString() === end.toDateString();
      if (sameDay) {
        return `${this.formatTime(start)} – ${this.formatTime(end)}`;
      }
      return `${this.formatShortDate(start)} ${this.formatTime(start)} – ${this.formatShortDate(end)} ${this.formatTime(end)}`;
    }
    // Parse date-only strings as local midnight to avoid UTC timezone shift
    const start = this.parseDateLocal(event.start.date!);
    const end = this.parseDateLocal(event.end.date!);
    // end.date is exclusive per Google API, subtract a day for display
    end.setDate(end.getDate() - 1);
    if (start.toDateString() === end.toDateString()) {
      return `All day · ${this.formatShortDate(start)}`;
    }
    return `${this.formatShortDate(start)} – ${this.formatShortDate(end)}`;
  }

  private parseDateLocal(dateStr: string): Date {
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(y, m - 1, d);
  }

  formatShortDate(date: Date): string {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  formatTime(date: Date): string {
    let hours = date.getHours();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const ampm = hours >= 12 ? 'pm' : 'am';
    
    // Convert to 12-hour format
    if (hours > 12) {
      hours -= 12;
    } else if (hours === 0) {
      hours = 12;
    }
    
    return `${hours}:${minutes}${ampm}`;
  }

  getEventColor(event: CalendarEvent): string {
    // First try to get calendar's color
    const calendarColor = this.calendarService.getCalendarColor(event.calendarId || 'primary');
    if (calendarColor && calendarColor !== '#2196F3') {
      return calendarColor; // Use calendar's backgroundColor if available
    }
    // Fall back to event colorId mapping
    const colorMap: { [key: string]: string } = {
      '1': '#a4bdfc', '2': '#7ae7bf', '3': '#dbadff',
      '4': '#ff887c', '5': '#fbd75b', '6': '#ffb878',
      '7': '#46d6db', '8': '#e1e1e1', '9': '#5484ed',
      '10': '#51b749', '11': '#dc2127'
    };
    return event.colorId ? colorMap[event.colorId] : calendarColor;
  }

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    if (this.selectedEvent()) {
      this.clearSelectedEvent();
    }
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    if (this.selectedEvent()) {
      this.clearSelectedEvent();
    }
  }

  toggleCalendarVisibility(calendarId: string, event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    this.calendarService.toggleCalendar(calendarId, checkbox.checked);
  }

  getTotalActiveCount(): number {
    return this.groceryService.getActiveItems().length;
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
    
    if (!this.githubAi.isConfigured()) {
      return; // Keep default message
    }

    this.hasGeneratedWelcome = true;
    
    // Use setTimeout to write to signals outside reactive context
    setTimeout(() => this.isLoadingWelcome.set(true), 0);

    try {
      const prompt = `Write a very brief, friendly, and colloquial welcome message (maximum 15 words) for a family command center app that helps families manage their schedules, grocery lists, and daily activities. Make it warm and encouraging. Just return the message text, nothing else.`;
      
      const response = await this.githubAi.generateContent(prompt);
      
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

    if (!this.githubAi.isConfigured()) {
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
      const response = await this.githubAi.generateContent(context);

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
    if (!weather || !this.githubAi.isConfigured() || this.isLoadingClothing()) {
      return;
    }

    this.isLoadingClothing.set(true);

    try {
      const prompt = `Based on this weather: ${weather.temperature}°F, ${weather.description}, humidity ${weather.humidity}%, wind ${weather.windSpeed} mph - write ONE short, friendly sentence (max 15 words) suggesting what to wear including both clothing AND footwear. Be conversational and helpful. Just return the sentence, nothing else.`;
      
      const response = await this.githubAi.generateContent(prompt);
      
      if (response.success && response.text.trim()) {
        const fullText = response.text.trim().replace(/^["']|["']$/g, '');
        // Set loading to false BEFORE animating so text is visible
        this.isLoadingClothing.set(false);
        // Animate the text typing effect
        await this.animateTypingEffect(fullText);
      } else {
        this.isLoadingClothing.set(false);
      }
    } catch (error) {
      console.error('Error generating clothing recommendation:', error);
      this.isLoadingClothing.set(false);
      // Provide a fallback recommendation with typing effect
      await this.animateTypingEffect('Check the weather and dress comfortably with suitable shoes!');
    }
  }

  // Reading entries methods
  toggleReadingForm(): void {
    this.showReadingForm.set(!this.showReadingForm());
    if (!this.showReadingForm()) {
      this.minutesToAdd.set(null);
    }
  }

  toggleReadingLog(): void {
    this.showReadingLog.set(!this.showReadingLog());
  }

  async addReadingMinutes(): Promise<void> {
    const minutes = this.minutesToAdd();
    if (minutes && minutes > 0) {
      const entryId = await this.firestoreService.addReadingEntry(minutes);
      if (entryId) {
        this.minutesToAdd.set(null);
        this.showReadingForm.set(false);
      }
    }
  }

  async deleteReadingEntry(entryId: string): Promise<void> {
    await this.firestoreService.deleteReadingEntry(entryId);
  }

  formatTimestamp(timestamp: string): string {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
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
