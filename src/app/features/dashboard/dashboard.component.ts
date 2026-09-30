import { Component, OnInit, AfterViewInit, OnDestroy, signal, computed, ViewChild, ElementRef, inject, effect, HostListener, ChangeDetectionStrategy, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatMenuModule } from '@angular/material/menu';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { GoogleCalendarService, CalendarEvent } from '../../services/google-calendar.service';
import { AppCalendarEventService } from '../../services/app-calendar-event.service';
import { CalendarEventDialogComponent, CalendarEventDialogResult } from '../../components/calendar-event-dialog/calendar-event-dialog.component';
import { LoadingAnimationComponent } from '../../components/loading-animation/loading-animation.component';
import { GroceryService } from '../../services/grocery.service';
import { AiOrchestratorService } from '../../services/ai-orchestrator.service';
import { WeatherService } from '../../services/weather.service';
import { TodoService } from '../../services/todo.service';
import { FirestoreService } from '../../services/firestore.service';
import { PushNotificationService } from '../../services/push-notification.service';
import { RemiScheduleService, RemiDailyBriefing } from '../../services/remi-schedule.service';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';
import { TodoLaneComponent } from '../../shared/todo-lane/todo-lane.component';
import { HomeLogoBtnComponent } from '../../shared/home-logo-btn/home-logo-btn.component';
import { TypewriterDirective } from '../../shared/typewriter/typewriter.directive';
import { QuickAddCardComponent } from '../../shared/quick-add-card/quick-add-card.component';
import {
  QuickAddCreationService,
  QuickAddCard,
  ParsedQuickAddItem
} from '../../services/quick-add-creation.service';
import { AiSuggestionService } from '../../services/ai-suggestion.service';
import { HouseholdService } from '../../services/household.service';

interface TimelineEvent extends CalendarEvent {
  startDate: Date;
  endDate: Date;
  topPosition: number;
  height: number;
  /** True duration-derived height in unscaled px, before the readability minimum is applied. */
  actualHeight: number;
  columnIndex: number;
  columnCount: number;
}

interface ChatMessage {
  text: string;
  isUser: boolean;
  timestamp: Date;
  /** Data-creation suggestions parsed from the assistant's reply, reviewable inline. */
  cards?: QuickAddCard[];
  /** True once the user has already seen this message typed out — skips the typewriter animation on reload. */
  instant?: boolean;
  /** Set on the auto-posted daily briefing blurb — its value is the briefing's own `date`
   *  ("YYYY-MM-DD"). There's one blurb per day; it's rewritten in place as the day moves on
   *  rather than posted again. */
  briefingDate?: string;
  /** Briefing blurb only: ISO time the blurb's contents were last refreshed, shown as "Updated 24 minutes ago". */
  updatedAt?: string;
}

const NOTIFICATION_PROMPT_KEY = 'notificationPromptDismissed';
const CHAT_MESSAGES_KEY = 'dashboardChatMessages';

/** Playful loading phrases typed out on the hero heading before it settles on the real greeting. */
const HERO_LOADING_PHRASES = [
  'Geier-ing...',
  'Whoooaaa Geier!',
  'Using the Force...',
  'Asking permission from Kelly...',
  'Bribing Remi with screen time...',
  'Untangling the grocery list...',
  'Consulting the fridge oracle...',
  'Summoning the weather gods...',
  'Negotiating with a 6-year-old...',
  'Herding the family calendar...',
  'Reticulating chore charts...',
  'Powering up the command center...'
];

type DayPart = 'morning' | 'afternoon' | 'evening' | 'night';

function dayPartOf(hour: number): DayPart {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 20) return 'evening';
  return 'night';
}

/** Casual greetings the hero heading settles on, by time of day; one is picked per visit. Keep them short — they share a row with the logo and menu buttons. */
const HERO_GREETINGS: Record<DayPart, string[]> = {
  morning: [
    'Rise and shine, Geiers!',
    'Morning, team Geier!',
    'Coffee first, then conquer.',
    "Look who's up bright and early!",
    'A fresh day, ready when you are.'
  ],
  afternoon: [
    'Afternoon, Geiers!',
    'Hope the day is treating you well.',
    'Halfway there, keep it rolling!',
    'Still going strong, team Geier!',
    'Hope the afternoon is a good one.'
  ],
  evening: [
    'Evening, Geiers!',
    'Home stretch of the day!',
    'The day is winding down, nice work.',
    'Cozy evening ahead, Geiers.',
    'You made it through the day!'
  ],
  // Covers 8pm through the early hours, so nothing here assumes it's still early evening.
  night: [
    'Evening, Geiers!',
    'Winding down, team Geier?',
    'Quiet night, Geiers.',
    'Time to put the feet up.',
    'You made it through the day!'
  ]
};

/** Generic nudges toward doing something in the app, by time of day (so nothing asks about dinner at midnight); deliberately not tied to what's actually in it. */
const HERO_NUDGES: Record<DayPart, string[]> = {
  morning: [
    "What's on the agenda today?",
    'Anything to add to the grocery list?',
    'Any to-dos to knock out today?',
    'Got something to put on the calendar?',
    'Need a hand with anything?'
  ],
  afternoon: [
    "What's for dinner tonight?",
    'Anything to add to the grocery list?',
    'Any to-dos to knock out today?',
    'Got something to put on the calendar?',
    'Need a hand with anything?'
  ],
  evening: [
    "What's for dinner tonight?",
    'Anything to add to the grocery list?',
    'Anything to plan for tomorrow?',
    'Got something to put on the calendar?',
    'Need a hand with anything?'
  ],
  night: [
    'Anything to plan for tomorrow?',
    'Anything to jot down before bed?',
    'Need anything on the grocery list for tomorrow?',
    'Got something to put on the calendar?',
    'Any to-dos to jot down for tomorrow?'
  ]
};

/** Random slot shared by every time-of-day pool, so a greeting stays put when the hour rolls over. */
const HERO_GREETING_SLOT = Math.random();

function pickRandomHeroPhrase(): string {
  return HERO_LOADING_PHRASES[Math.floor(Math.random() * HERO_LOADING_PHRASES.length)];
}

/** Restores chat history saved by a previous visit so navigating away and back doesn't lose it. */
function loadPersistedChatMessages(): ChatMessage[] {
  try {
    const raw = localStorage.getItem(CHAT_MESSAGES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { text: string; isUser: boolean; timestamp: string }[];
    // Already shown in a previous visit — render instantly rather than replaying the typewriter.
    return parsed.map(message => ({ ...message, timestamp: new Date(message.timestamp), instant: true }));
  } catch {
    return [];
  }
}

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule, TodoLaneComponent, FormsModule, MatIconModule, MatButtonModule, MatFormFieldModule, MatInputModule, LoadingAnimationComponent, MatTooltipModule, MatMenuModule, MatSnackBarModule, GlobalNavMenuComponent, HomeLogoBtnComponent, TypewriterDirective, QuickAddCardComponent],
  templateUrl: './dashboard.component.html',
  styleUrls: ['./dashboard.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class DashboardComponent implements OnInit, AfterViewInit {
  currentTime = signal<Date>(new Date());
  viewDate = signal<Date>(new Date());

  /** A random playful phrase, typed out on load before the heading settles on the real greeting. */
  private readonly heroLoadingPhrase = pickRandomHeroPhrase();
  private heroPhase = signal<'intro' | 'greeting'>('intro');
  private heroSwapTimer?: number;
  /** True while the hero heading is showing a playful loading phrase rather than the real greeting. */
  /**
   * Whether the heading still looks like a loading phrase (light italic, animated logo). Outlasts
   * isHeroLoading() by the erase animation, so the old text doesn't snap to full weight mid-delete.
   */
  heroLoadingStyle = signal(true);
  /** Whether any heading animation is still running or pending — the logo loader keeps going until the final greeting has finished typing. */
  heroAnimating = signal(true);
  isHeroLoading = computed(() => this.heroPhase() === 'intro');
  /** The proactive line after the greeting, fixed once the greeting starts so it can't change under the typing. */
  private heroNudge = signal('');
  heroHeading = computed(() => this.heroPhase() === 'intro'
    ? this.heroLoadingPhrase
    : `${this.getGreetingMessage()} ${this.heroNudge()}`.trim());
  /** True once the user has explicitly stepped away from today's view — blocks the auto re-sync on resume. */
  private hasNavigatedAwayFromToday = false;
  selectedEvent = signal<TimelineEvent | null>(null);
  popoverAbove = false;
  popoverTop = 0;
  readonly HOUR_PX = 20;
  /** Smallest on-screen height (px) of an event block — one title line plus padding; keep in sync with .cal-event-block's min-height. */
  readonly MIN_EVENT_BLOCK_PX = 29;
  readonly TOTAL_TIMELINE_HEIGHT = 480; // fixed container height
  readonly allHours = Array.from({ length: 24 }, (_, i) => i);
  private timeInterval?: number;
  newItemName = '';
  showWeatherWidget = false;
  
  // AI Chat properties
  chatMessages = signal<ChatMessage[]>(loadPersistedChatMessages());
  chatInput = '';;
  isChatLoading = signal(false);
  /** Shown while the sticky input is pinned with a good stretch of chat still below the viewport. */
  showChatScrollBtn = signal(false);
  private suppressChatScrollDetection = false;
  private chatResizeObserver?: ResizeObserver;
  /** The assistant reply currently being corrected (its inline correction form is open). */
  correctingMessage = signal<ChatMessage | null>(null);
  correctionText = '';
  isCorrecting = signal(false);
  isConfirmingClearChat = signal(false);
  /** Index into chatHistoryList() currently shown in the input, via Up/Down recall; -1 = not browsing. */
  private chatHistoryIndex = -1;
  /** What the user had typed before they started browsing history, restored when paging past the newest entry. */
  private chatHistoryDraft = '';
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

  notificationPromptDismissed = signal<boolean>(localStorage.getItem(NOTIFICATION_PROMPT_KEY) === 'true');

  
  @ViewChild('dashboardTimeline', { read: ElementRef }) dashboardTimeline?: ElementRef;
  @ViewChild('chatContainer', { read: ElementRef }) chatContainer?: ElementRef;
  @ViewChild('homeChat', { read: ElementRef }) homeChat?: ElementRef<HTMLElement>;
  @ViewChild('chatDock', { read: ElementRef }) chatDock?: ElementRef<HTMLElement>;
  @ViewChild('chatTextarea', { read: ElementRef }) chatTextarea?: ElementRef<HTMLTextAreaElement>;
  private readonly CHAT_INPUT_MAX_HEIGHT = 300;

  constructor(
    public calendarService: GoogleCalendarService,
    public groceryService: GroceryService,
    private aiOrchestrator: AiOrchestratorService,
    public weatherService: WeatherService,
    public todoService: TodoService,
    public firestoreService: FirestoreService,
    public pushNotificationService: PushNotificationService,
    public remiScheduleService: RemiScheduleService,
    private snackBar: MatSnackBar,
    private quickAddCreation: QuickAddCreationService,
    private aiSuggestionService: AiSuggestionService,
    private householdService: HouseholdService,
    public appCalendarEventService: AppCalendarEventService,
    private dialog: MatDialog
  ) {
    // Clothing recommendation is now opt-in via button click to avoid auto-loading errors

    // Keeps the auto-posted briefing blurb current: the clock moving on, fresh weather, or a
    // refreshed briefing all re-evaluate what's still ahead. Rewriting is a no-op when the
    // text comes out the same, so the once-a-minute clock tick is cheap.
    effect(() => {
      const briefing = this.remiScheduleService.todayBriefing();
      const now = this.currentTime();
      this.weatherService.weather();
      this.weatherService.forecast();
      if (!briefing) return;
      untracked(() => this.syncBriefingMessage(briefing, now));
    });

    // Persist chat history so it survives navigating away and back.
    effect(() => {
      const messages = this.chatMessages();
      try {
        localStorage.setItem(CHAT_MESSAGES_KEY, JSON.stringify(messages));
      } catch {
        // localStorage unavailable (e.g. private browsing) — chat still works in-memory
      }
    });
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

    // Capture phase, since scroll events from the timeline container don't bubble.
    window.addEventListener('scroll', this.closePopoverOnScroll, true);

    // Catches a day rollover while this component stayed alive in the background
    // (mobile tab suspend/resume, a kiosk tablet left open, etc).
    document.addEventListener('visibilitychange', this.resyncViewDateOnForeground);

    // Read-only — just fetches today's cached briefing doc if one exists; the effect in the
    // constructor turns it into the chat blurb. Never triggers a full regeneration.
    void this.remiScheduleService.loadTodayBriefing();

    // Normally onHeroTyped() hands off once the loading phrase has finished typing; this
    // is only a backstop so the greeting still shows up if that never fires.
    this.heroSwapTimer = window.setTimeout(() => this.startHeroGreeting(), 8000);
  }

  /** The loading phrase is fully erased (the greeting is about to type), so the loading look can end. */
  onHeroCleared(): void {
    if (this.heroPhase() === 'greeting') {
      this.heroLoadingStyle.set(false);
    }
  }

  /** Once the loading phrase finishes typing, let it sit a beat, then erase it for the real greeting. */
  onHeroTyped(): void {
    if (this.heroPhase() === 'greeting') {
      this.heroAnimating.set(false);
      return;
    }
    if (this.heroSwapTimer) clearTimeout(this.heroSwapTimer);
    this.heroSwapTimer = window.setTimeout(() => this.startHeroGreeting(), 1800);
  }

  private startHeroGreeting(): void {
    const nudges = HERO_NUDGES[dayPartOf(this.currentTime().getHours())];
    this.heroNudge.set(nudges[Math.floor(HERO_GREETING_SLOT * nudges.length)]);
    this.heroPhase.set('greeting');
  }


  ngAfterViewInit(): void {
    // Scroll to current time after view is initialized
    setTimeout(() => this.scrollToCurrentTime(), 100);

    // The page scrolls inside .app-container, not the window, and scroll events don't
    // bubble — so listen in the capture phase (same trick as closePopoverOnScroll).
    window.addEventListener('scroll', this.updateChatDockState, true);
    window.addEventListener('resize', this.updateChatDockState);
    if (this.homeChat && typeof ResizeObserver !== 'undefined') {
      // The chat grows as replies type out, with no scroll event to notice it.
      this.chatResizeObserver = new ResizeObserver(() => this.updateChatDockState());
      this.chatResizeObserver.observe(this.homeChat.nativeElement);
    }
  }

  /** Bottom edge of the viewport minus the dock's sticky offset — where the dock rests when pinned. */
  private static readonly CHAT_DOCK_BOTTOM_OFFSET = 16;
  /** Hide the button this far before sticky releases, so it doesn't linger to the last pixel. */
  private static readonly CHAT_SCROLL_BTN_HIDE_MARGIN = 200;

  private updateChatDockState = (): void => {
    if (this.suppressChatScrollDetection) return;
    const chat = this.homeChat?.nativeElement;
    if (!chat) {
      this.showChatScrollBtn.set(false);
      return;
    }
    const restingBottom = window.innerHeight - DashboardComponent.CHAT_DOCK_BOTTOM_OFFSET;
    // .home-chat isn't sticky, so its bottom is the dock's unclamped flow position —
    // how far there still is to scroll before sticky releases.
    const distanceToRelease = chat.getBoundingClientRect().bottom - restingBottom;
    this.showChatScrollBtn.set(distanceToRelease > DashboardComponent.CHAT_SCROLL_BTN_HIDE_MARGIN);

    // Keep the message scroll-margin in step with the dock's real height (it changes as the
    // button shows/hides and the textarea grows).
    if (this.chatDock) {
      const clearance = this.chatDock.nativeElement.offsetHeight + DashboardComponent.CHAT_DOCK_BOTTOM_OFFSET + 12;
      chat.style.setProperty('--chat-dock-clearance', `${clearance}px`);
    }
  };

  /** Scrolls until the chat's end meets the dock's resting place, i.e. just past where sticky releases. */
  scrollToChatBottom(): void {
    const chat = this.homeChat?.nativeElement;
    if (!chat) return;
    const restingBottom = window.innerHeight - DashboardComponent.CHAT_DOCK_BOTTOM_OFFSET;
    // The button collapses away as the scroll starts, shrinking the chat (and pulling its bottom
    // edge up) by its own height plus margin. Measured now, that space would still be counted, so
    // the scroll would overshoot by that much — subtract it to land the input where it will rest.
    const btn = this.chatDock?.nativeElement.querySelector<HTMLElement>('.scroll-to-bottom-btn');
    const collapsing = btn ? btn.offsetHeight + (parseFloat(getComputedStyle(btn).marginBottom) || 0) : 0;
    // A couple of pixels past the threshold: exactly at it, stuck and natural positions coincide.
    const delta = chat.getBoundingClientRect().bottom - collapsing - restingBottom + 2;
    const scroller = chat.closest('.app-container') ?? window;

    // Hide now and pause detection so the button doesn't flicker back on mid-scroll.
    this.showChatScrollBtn.set(false);
    this.suppressChatScrollDetection = true;
    scroller.scrollBy({ top: delta, behavior: 'smooth' });
    setTimeout(() => {
      this.suppressChatScrollDetection = false;
      this.updateChatDockState();
    }, 600);
  }

  ngOnDestroy(): void {
    window.removeEventListener('scroll', this.closePopoverOnScroll, true);
    window.removeEventListener('scroll', this.updateChatDockState, true);
    window.removeEventListener('resize', this.updateChatDockState);
    this.chatResizeObserver?.disconnect();
    document.removeEventListener('visibilitychange', this.resyncViewDateOnForeground);
    if (this.timeInterval) {
      clearInterval(this.timeInterval);
    }
    if (this.heroSwapTimer) {
      clearTimeout(this.heroSwapTimer);
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

  dismissNotificationPrompt(): void {
    this.notificationPromptDismissed.set(true);
    localStorage.setItem(NOTIFICATION_PROMPT_KEY, 'true');
  }

  /**
   * Scroll timeline to position current time indicator 20% from top
   */
  get isViewingToday(): boolean {
    const v = this.viewDate(), t = new Date();
    return v.getFullYear() === t.getFullYear() && v.getMonth() === t.getMonth() && v.getDate() === t.getDate();
  }

  prevDay(): void {
    this.hasNavigatedAwayFromToday = true;
    const d = new Date(this.viewDate());
    d.setDate(d.getDate() - 1);
    this.viewDate.set(d);
  }

  nextDay(): void {
    this.hasNavigatedAwayFromToday = true;
    const d = new Date(this.viewDate());
    d.setDate(d.getDate() + 1);
    this.viewDate.set(d);
  }

  goToToday(): void {
    this.hasNavigatedAwayFromToday = false;
    this.viewDate.set(new Date());
    setTimeout(() => this.scrollToCurrentTime(), 50);
  }

  /**
   * Keeps the default view pinned to the real current day even if this component instance
   * stays alive across midnight (e.g. a mobile tab suspended and resumed, or a kiosk tablet
   * left open) — without ever overriding a day the user explicitly navigated to.
   */
  private syncViewDateToToday(): void {
    if (this.hasNavigatedAwayFromToday) return;
    const now = new Date();
    if (now.toDateString() !== this.viewDate().toDateString()) {
      this.viewDate.set(now);
    }
  }

  formatViewDate(): string {
    return this.viewDate().toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    });
  }

  /** Deep-links to Google Calendar's own day view for whatever date the widget is showing. */
  googleCalendarUrl(): string {
    const d = this.viewDate();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `https://calendar.google.com/calendar/r/day/${year}/${month}/${day}`;
  }

  /** Google-synced events plus app-native events (see AppCalendarEventService), merged for display. */
  getAllEvents(): CalendarEvent[] {
    return [
      ...this.calendarService.events().map(event => ({ ...event, source: event.source ?? 'google' as const })),
      ...this.appCalendarEventService.events()
    ];
  }

  getViewDayEvents(): TimelineEvent[] {
    const day = this.viewDate();
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0);
    const dayEnd = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
    const seenIds = new Set<string>();
    return this.getAllEvents()
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
    // A point-in-time event has zero duration, so this naturally falls back to the
    // same minimum height as any other very short timed event — it renders like a
    // normal event block, just with the top-border marker added in CSS.
    const actualHeight = ((endMin - startMin) / 60) * this.HOUR_PX;
    const height = Math.max(actualHeight, 14);
    return {
      ...event, startDate, endDate,
      topPosition: (startMin / 60) * this.HOUR_PX,
      height,
      actualHeight,
      columnIndex: 0,
      columnCount: 1
    };
  }

  getAllDayEvents(): TimelineEvent[] {
    return this.getViewDayEvents().filter(e =>
      !e.start.dateTime && (e.source === 'app' || this.calendarService.isCalendarVisible(e.calendarId || 'primary'))
    );
  }

  getTimedEvents(): TimelineEvent[] {
    return this.assignOverlapColumns(this.getVisibleTimedEvents());
  }

  /** Timed events for the viewed day, without overlap columns — those depend on the scale, which depends on this. */
  private getVisibleTimedEvents(): TimelineEvent[] {
    return this.getViewDayEvents().filter(e =>
      !!e.start.dateTime && (e.source === 'app' || this.calendarService.isCalendarVisible(e.calendarId || 'primary'))
    );
  }

  /** Splits overlapping events into side-by-side columns so none are hidden. */
  private assignOverlapColumns(events: TimelineEvent[]): TimelineEvent[] {
    const sorted = [...events].sort((a, b) => a.topPosition - b.topPosition || b.height - a.height);
    // Blocks render at least MIN_EVENT_BLOCK_PX tall on screen whatever their duration, which
    // is a different share of the (zoomed) timeline depending on how few hours are shown.
    const minUnscaledHeight = this.MIN_EVENT_BLOCK_PX / this.scaleFactor;
    let cluster: TimelineEvent[] = [];
    let columnEnds: number[] = [];

    const closeCluster = () => {
      const count = Math.max(columnEnds.length, 1);
      cluster.forEach(e => (e.columnCount = count));
      cluster = [];
      columnEnds = [];
    };

    for (const event of sorted) {
      const start = event.topPosition;
      const end = start + Math.max(event.actualHeight, minUnscaledHeight);

      if (cluster.length && columnEnds.every(colEnd => colEnd <= start)) {
        closeCluster();
      }

      let column = columnEnds.findIndex(colEnd => colEnd <= start);
      if (column === -1) {
        column = columnEnds.length;
      }
      columnEnds[column] = end;
      event.columnIndex = column;
      cluster.push(event);
    }
    closeCluster();

    return sorted;
  }

  getEventLayoutStyle(event: TimelineEvent): { [key: string]: string } {
    const width = 100 / event.columnCount;
    return {
      left: `${width * event.columnIndex}%`,
      width: event.columnCount > 1 ? `calc(${width}% - 2px)` : '100%'
    };
  }

  getVisibleHourRange(): { start: number; end: number } {
    const timed = this.getVisibleTimedEvents();
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

    return this.getAllEvents()
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
    const actualHeight = (durationMinutes / 60) * 60;
    const height = Math.max(actualHeight, 30);
    
    return {
      ...event,
      startDate,
      endDate,
      topPosition,
      height,
      actualHeight,
      columnIndex: 0,
      columnCount: 1
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
    // The popover is position: fixed, so it needs a viewport-relative offset.
    this.popoverTop = this.popoverAbove ? rect.top - 8 : rect.bottom + 8;
    this.selectedEvent.set(event);
  }

  clearSelectedEvent(): void {
    this.selectedEvent.set(null);
  }

  /** The selected event, only when it's a timed (non-all-day) event — used to gate the
   * hoisted timed-event popover so it doesn't double up with the all-day chip's own. */
  selectedTimedEvent(): TimelineEvent | null {
    const event = this.selectedEvent();
    return event && event.start.dateTime ? event : null;
  }

  // getAllDayEvents()/getTimedEvents() rebuild their arrays (and TimelineEvent objects) on
  // every call rather than caching, so without trackBy, any change-detection pass would
  // make *ngFor treat every event as new and recreate its DOM node — dropping :hover state.
  trackByEventId(_index: number, item: { id: string }): string {
    return item.id;
  }

  trackByHour(_index: number, hour: number): number {
    return hour;
  }

  /** Name of the household member an event is tagged for, or null when it concerns everyone. */
  memberName(memberId: string | undefined): string | null {
    if (!memberId) return null;
    return this.householdService.getMemberById(memberId)?.name ?? null;
  }

  private readonly closePopoverOnScroll = (): void => {
    if (this.selectedEvent()) {
      this.clearSelectedEvent();
    }
  };

  private readonly resyncViewDateOnForeground = (): void => {
    if (document.visibilityState === 'visible') {
      this.syncViewDateToToday();
    }
  };

  formatHour(hour: number): string {
    if (hour === 0) return '12 AM';
    if (hour < 12) return `${hour} AM`;
    if (hour === 12) return '12 PM';
    return `${hour - 12} PM`;
  }

  getGreetingMessage(): string {
    const pool = HERO_GREETINGS[dayPartOf(this.currentTime().getHours())];
    return pool[Math.floor(HERO_GREETING_SLOT * pool.length)];
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
      if (event.isPointInTime) {
        return this.formatTime(start);
      }
      const end = new Date(event.end.dateTime || event.start.dateTime);
      const startLabel = `${event.startApproximate ? '~' : ''}${this.formatTime(start)}`;
      const endLabel = `${event.endApproximate ? '~' : ''}${this.formatTime(end)}`;
      const sameDay = start.toDateString() === end.toDateString();
      if (sameDay) {
        return `${startLabel} – ${endLabel}`;
      }
      return `${this.formatShortDate(start)} ${startLabel} – ${this.formatShortDate(end)} ${endLabel}`;
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

  /**
   * "just now", "24 minutes ago", "3 hours ago" — read against the once-a-minute clock signal so
   * the label in the template keeps counting up on its own.
   */
  relativeAge(when: string | Date | undefined): string {
    if (!when) return 'just now';
    const minutes = Math.max(0, Math.floor((this.currentTime().getTime() - new Date(when).getTime()) / 60_000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours} ${hours === 1 ? 'hour' : 'hours'} ago`;
  }

  private briefingSeeded = false;
  private lastOutfitRefreshAt = 0;

  /**
   * Keeps today's blurb in the chat up to date. The first time (per visit) it's posted as a
   * new assistant message so it types out; after that it's rewritten in place, instantly,
   * whenever what's still ahead changes. A no-op until today's briefing exists.
   */
  private syncBriefingMessage(briefing: RemiDailyBriefing, now: Date): void {
    // Left open past midnight, the loaded briefing is yesterday's — nothing to say about it.
    if (briefing.date !== now.toLocaleDateString('en-CA')) return;

    void this.refreshStaleOutfit(briefing, now);

    const text = this.buildBriefingBlurb(briefing, now);
    const existing = this.chatMessages().find(m => m.briefingDate === briefing.date);
    if (existing) {
      this.briefingSeeded = true;
      // Fresh when the contents changed just now, or the weather it's built on was re-fetched since.
      const weatherAt = this.weatherService.lastUpdated();
      const stampedAt = existing.updatedAt ? new Date(existing.updatedAt).getTime() : 0;
      const textChanged = existing.text !== text;
      const weatherNewer = !!weatherAt && weatherAt.getTime() > stampedAt;
      if (textChanged || weatherNewer || !existing.updatedAt) {
        const updatedAt = textChanged || !weatherAt ? now : weatherAt;
        this.chatMessages.update(messages =>
          messages.map(m => (m === existing ? { ...m, text, instant: true, updatedAt: updatedAt.toISOString() } : m))
        );
      }
      return;
    }

    // Clearing the chat shouldn't make the blurb pop straight back in.
    if (this.briefingSeeded) return;
    this.briefingSeeded = true;
    this.chatMessages.update(messages => [...messages, {
      text,
      isUser: false,
      timestamp: new Date(),
      briefingDate: briefing.date,
      updatedAt: (this.weatherService.lastUpdated() ?? now).toISOString()
    }]);
  }

  /** Whether there's still somewhere for Remi to go today that an outfit suggestion would matter for. */
  private isOutfitRelevant(briefing: RemiDailyBriefing, nowMin: number): boolean {
    const startMin = briefing.schoolStatus === 'no-school' ? null : this.parseHHmmToMinutes(briefing.startTime);
    if (startMin !== null && nowMin < startMin) return true;
    return (briefing.activities || []).some(a => {
      const minutes = this.parseClockLabelToMinutes(a.time);
      return minutes !== null && minutes >= nowMin;
    });
  }

  /**
   * The outfit line was written from the morning's forecast. When it's gone stale and there's
   * still an outing ahead, regenerate it (which re-reads the weather) — at most every couple of hours.
   */
  private async refreshStaleOutfit(briefing: RemiDailyBriefing, now: Date): Promise<void> {
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const nowMin = now.getHours() * 60 + now.getMinutes();
    if (!this.isOutfitRelevant(briefing, nowMin) || this.remiScheduleService.regeneratingFacet()) return;

    const fetchedAt = briefing.weather?.fetchedAt ? new Date(briefing.weather.fetchedAt).getTime() : 0;
    if (now.getTime() - fetchedAt < TWO_HOURS || now.getTime() - this.lastOutfitRefreshAt < TWO_HOURS) return;

    this.lastOutfitRefreshAt = now.getTime();
    await this.remiScheduleService.regenerateFacet('clothing');
  }

  /**
   * The chat's daily blurb, written for the current moment: only what's still ahead today.
   * School that already started, breakfast once it's past (or Remi is at school), the
   * school lunch once he's there, and activities that already happened are all dropped, and
   * the weather comes from the live conditions and the rest-of-day forecast, not the morning's.
   */
  private buildBriefingBlurb(briefing: RemiDailyBriefing, now: Date): string {
    const nowMin = now.getHours() * 60 + now.getMinutes();
    const startMin = this.parseHHmmToMinutes(briefing.startTime);
    const endMin = this.parseHHmmToMinutes(briefing.endTime);
    const isSchoolDay = briefing.schoolStatus !== 'no-school' && startMin !== null;
    const atSchoolOrDone = isSchoolDay && nowMin >= startMin!;
    const note = briefing.scheduleNote ? ` (${briefing.scheduleNote})` : '';

    const bullets: string[] = [];

    if (briefing.schoolStatus === 'no-school') {
      bullets.push(briefing.scheduleNote ? `No school — ${briefing.scheduleNote}` : 'No school today');
    } else if (isSchoolDay) {
      const earlyRelease = briefing.schoolStatus === 'early-release';
      if (nowMin < startMin!) {
        bullets.push(
          `School starts at ${this.formatClockTime(briefing.startTime!)}` +
          `${earlyRelease && briefing.endTime ? `, early release at ${this.formatClockTime(briefing.endTime)}` : ''}${note}`
        );
      } else if (endMin !== null && nowMin < endMin) {
        bullets.push(`${earlyRelease ? 'Early release at' : 'School lets out at'} ${this.formatClockTime(briefing.endTime!)}${note}`);
      }
    }

    const upcoming = (briefing.activities || []).filter(a => {
      const minutes = this.parseClockLabelToMinutes(a.time);
      return minutes === null || minutes >= nowMin;
    });
    if (upcoming.length) {
      bullets.push(`Coming up: ${upcoming.slice(0, 3).map(a => (a.time ? `${a.title} at ${a.time}` : a.title)).join(', ')}`);
    }

    // Breakfast is over by 10, or once school has started (whichever is sooner).
    if (briefing.breakfastIdea && nowMin < 10 * 60 && !atSchoolOrDone) {
      bullets.push(`Breakfast: ${briefing.breakfastIdea}`);
    }

    // School lunch only matters before Remi is at school.
    if (isSchoolDay && nowMin < startMin!) {
      bullets.push(briefing.lunchPlan === 'pack'
        ? `Lunch: packed${briefing.packedLunchIdea ? ` — ${briefing.packedLunchIdea}` : ''}`
        : `Lunch: hot lunch${briefing.lunchMenuText ? ` — ${briefing.lunchMenuText}` : ''}`);
    }

    const weatherLine = this.formatWeatherForBlurb();
    if (weatherLine) bullets.push(weatherLine);

    if (briefing.clothingIdea && this.isOutfitRelevant(briefing, nowMin)) {
      bullets.push(`Wear: ${briefing.clothingIdea}`);
    }

    if (briefing.dinnerIdea && nowMin >= 12 * 60 && nowMin < 21 * 60) {
      bullets.push(`Dinner: ${briefing.dinnerIdea}`);
    }

    const weekday = now.toLocaleDateString('en-US', { weekday: 'long' });
    const part = dayPartOf(now.getHours());
    const lead = `Here's what's ahead this ${weekday} ${part}:`;
    if (!bullets.length) {
      return `${lead}\nNothing else is on the schedule.`;
    }
    return `${lead}\n${bullets.map(b => `• ${b}`).join('\n')}`;
  }

  /** "Weather: 62°F and light rain now. Evening 55°F, 60% chance of rain." — live conditions plus what's left of the day. */
  private formatWeatherForBlurb(): string | null {
    const weather = this.weatherService.weather();
    if (!weather) return null;

    const partLabel: Record<string, string> = { morning: 'Morning', afternoon: 'Afternoon', evening: 'Evening', night: 'Overnight' };
    const periods = (this.weatherService.forecast()?.periods ?? [])
      .slice(0, 2)
      .map(p => `${partLabel[p.part]} ${p.tempF}°F${p.pop >= 30 ? `, ${p.pop}% chance of rain` : ''}`);

    return `Weather: ${weather.temperature}°F and ${weather.description} now.${periods.length ? ` ${periods.join('; ')}.` : ''}`;
  }

  private parseHHmmToMinutes(hhmm: string | null | undefined): number | null {
    if (!hhmm) return null;
    const [hour, minute] = hhmm.split(':').map(Number);
    return hour * 60 + minute;
  }

  /** Parses a displayed "H:MM AM/PM" activity time into minutes since midnight. */
  private parseClockLabelToMinutes(label: string | null): number | null {
    const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((label || '').trim());
    if (!match) return null;
    let hour = Number(match[1]) % 12;
    if (match[3].toUpperCase() === 'PM') hour += 12;
    return hour * 60 + Number(match[2]);
  }

  /** Formats a stored "HH:mm" schedule time as "8:00 AM". */
  private formatClockTime(hhmm: string): string {
    const [hours, minutes] = hhmm.split(':').map(Number);
    const period = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 === 0 ? 12 : hours % 12;
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${period}`;
  }

  getEventColor(event: CalendarEvent): string {
    // App-native events (created in-app) get a fixed distinct color rather than a Google
    // colorId, so they're visually told apart from synced events — same color the
    // dedicated /calendar page uses for the same purpose.
    if (event.source === 'app') {
      return '#8E6BC9';
    }
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

  /** Opens the add-event form, pre-filled to whatever day the timeline is currently showing. */
  openAddEventDialog(): void {
    const dialogRef = this.dialog.open(CalendarEventDialogComponent, {
      width: '500px',
      data: { mode: 'add', defaultDate: this.viewDate() }
    });

    dialogRef.afterClosed().subscribe(async (result: CalendarEventDialogResult | undefined) => {
      if (!result || result.action !== 'save') return;
      try {
        await this.appCalendarEventService.addEvent(result.event);
        this.snackBar.open('Event added', 'Close', { duration: 3000 });
      } catch (error) {
        console.error('Error adding calendar event:', error);
        this.snackBar.open('Failed to add event', 'Close', { duration: 3000 });
      }
    });
  }

  /** Opens the edit form for an app-native event (Google-synced events aren't editable here). */
  openEditEventDialog(event: CalendarEvent): void {
    if (event.source !== 'app') return;
    this.clearSelectedEvent();

    const dialogRef = this.dialog.open(CalendarEventDialogComponent, {
      width: '500px',
      data: { mode: 'edit', event }
    });

    dialogRef.afterClosed().subscribe(async (result: CalendarEventDialogResult | undefined) => {
      if (!result) return;
      try {
        if (result.action === 'delete') {
          await this.appCalendarEventService.deleteEvent(event.id);
          this.snackBar.open('Event deleted', 'Close', { duration: 3000 });
        } else {
          await this.appCalendarEventService.updateEvent(event.id, result.event);
          this.snackBar.open('Event updated', 'Close', { duration: 3000 });
        }
      } catch (error) {
        console.error('Error updating calendar event:', error);
        this.snackBar.open('Failed to save event', 'Close', { duration: 3000 });
      }
    });
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
    
    this.hasGeneratedWelcome = true;

    // Use setTimeout to write to signals outside reactive context
    setTimeout(() => this.isLoadingWelcome.set(true), 0);

    try {
      const result = await this.aiOrchestrator.generate<{ text: string }>('dashboard-welcome-message');

      if (result.text.trim()) {
        const message = result.text.trim().replace(/^[\"']|[\"']$/g, '');
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

  requestClearChat(): void {
    this.isConfirmingClearChat.set(true);
  }

  cancelClearChat(): void {
    this.isConfirmingClearChat.set(false);
  }

  confirmClearChat(): void {
    this.chatMessages.set([]);
    this.isConfirmingClearChat.set(false);
  }

  // AI Chat methods
  async sendChatMessage(): Promise<void> {
    if (!this.chatInput.trim() || this.isChatLoading()) {
      return;
    }

    const userMessage = this.chatInput.trim();
    this.chatInput = '';
    this.chatHistoryIndex = -1;
    this.chatHistoryDraft = '';
    setTimeout(() => this.autoResizeChatInput(), 0);

    // Recent turns, before the new user message is appended below, so the AI can resolve
    // a reply like "Yes" against the question it just asked.
    const conversationHistory = this.chatMessages()
      .slice(-10)
      .map(m => ({ role: m.isUser ? 'user' : 'assistant', content: m.text }));

    // Add user message
    this.chatMessages.update(messages => [...messages, {
      text: userMessage,
      isUser: true,
      timestamp: new Date()
    }]);

    this.isChatLoading.set(true);
    this.scrollChatToBottom();

    try {
      const knownPeople = this.householdService.members().map(m => m.name);
      const { result, suggestionIds } = await this.aiOrchestrator.generateWithSuggestionIds<
        { text: string; items: ParsedQuickAddItem[] }
      >('family-chat', { message: userMessage, knownPeople, conversationHistory });

      const items = result.items || [];
      const ids = suggestionIds || [];
      const cards = items.map((item, i) => this.quickAddCreation.buildCard(item, ids[i] ?? null));

      this.chatMessages.update(messages => [...messages, {
        text: result.text,
        isUser: false,
        timestamp: new Date(),
        cards: cards.length ? cards : undefined
      }]);
    } catch (error: any) {
      this.chatMessages.update(messages => [...messages, {
        text: `Sorry, I couldn't process your message: ${error.message}`,
        isUser: false,
        timestamp: new Date()
      }]);
    } finally {
      this.isChatLoading.set(false);
      setTimeout(() => this.scrollChatToBottom(), 100);
    }
  }

  startCorrection(message: ChatMessage): void {
    this.correctingMessage.set(message);
    this.correctionText = '';
  }

  cancelCorrection(): void {
    this.correctingMessage.set(null);
    this.correctionText = '';
  }

  /**
   * Turns the user's correction of an assistant reply into a fact card on that reply. The
   * card goes through the normal Confirm/Discard review, so nothing reaches household memory
   * until the user approves the wording.
   */
  async submitCorrection(message: ChatMessage): Promise<void> {
    const correction = this.correctionText.trim();
    if (!correction || this.isCorrecting()) {
      return;
    }

    const messages = this.chatMessages();
    const index = messages.indexOf(message);
    const question = messages.slice(0, index).reverse().find(m => m.isUser)?.text ?? '';

    this.isCorrecting.set(true);
    try {
      const result = await this.aiOrchestrator.generate<
        { factText: string; category: string; replacesFactId: string | null }
      >('memory-correction', { question, reply: message.text, correction });

      if (!result.factText) {
        throw new Error('Could not turn that into a fact — try rephrasing');
      }
      const card = this.quickAddCreation.buildCard({
        type: 'fact',
        title: result.factText,
        factText: result.factText,
        category: result.category,
        replacesFactId: result.replacesFactId
      }, null);
      this.chatMessages.update(all => all.map(m =>
        m === message ? { ...m, cards: [...(m.cards || []), card] } : m
      ));
      this.cancelCorrection();
    } catch (error: any) {
      this.snackBar.open(error?.message || 'Could not save that correction — try again', 'Close', { duration: 3000 });
    } finally {
      this.isCorrecting.set(false);
    }
  }

  toggleCardEdit(message: ChatMessage, card: QuickAddCard): void {
    this.updateMessageCards(message, cards =>
      cards.map(c => c === card ? { ...c, isEditing: !c.isEditing } : c)
    );
  }

  updateCardField(message: ChatMessage, card: QuickAddCard, field: keyof ParsedQuickAddItem, value: any): void {
    this.updateMessageCards(message, cards =>
      cards.map(c => c === card ? this.quickAddCreation.updateField(c, field, value) : c)
    );
  }

  async confirmCard(message: ChatMessage, card: QuickAddCard): Promise<void> {
    try {
      await this.quickAddCreation.createRecord(card.item);
      if (card.suggestionId) {
        const wasEdited = JSON.stringify(card.item) !== JSON.stringify(card.original);
        if (wasEdited) {
          await this.aiSuggestionService.markEdited(card.suggestionId, card.item as Record<string, any>);
        } else {
          await this.aiSuggestionService.markAccepted(card.suggestionId);
        }
      }
      this.setCardStatus(message, card, 'confirmed');
    } catch (err: any) {
      this.snackBar.open(err?.message || 'Failed to add — try again', 'Close', { duration: 3000 });
    }
  }

  async discardCard(message: ChatMessage, card: QuickAddCard): Promise<void> {
    if (card.suggestionId) {
      await this.aiSuggestionService.markRejected(card.suggestionId);
    }
    this.setCardStatus(message, card, 'discarded');
  }

  hasConfirmableHighConfidence(message: ChatMessage): boolean {
    return !!message.cards?.some(c => c.status === 'pending' && !c.isLowConfidence);
  }

  async confirmAllHighConfidence(message: ChatMessage): Promise<void> {
    const targets = (message.cards || []).filter(c => c.status === 'pending' && !c.isLowConfidence);
    for (const card of targets) {
      await this.confirmCard(message, card);
    }
  }

  private setCardStatus(message: ChatMessage, card: QuickAddCard, status: QuickAddCard['status']): void {
    this.updateMessageCards(message, cards =>
      cards.map(c => c === card ? { ...c, status } : c)
    );
  }

  private updateMessageCards(message: ChatMessage, updateFn: (cards: QuickAddCard[]) => QuickAddCard[]): void {
    this.chatMessages.update(messages => messages.map(m =>
      m === message && m.cards ? { ...m, cards: updateFn(m.cards) } : m
    ));
  }

  /** Grows the chat textarea to fit its content, up to CHAT_INPUT_MAX_HEIGHT, then lets it scroll. */
  autoResizeChatInput(): void {
    // A genuine edit (this only fires on real keystrokes, not our own programmatic
    // recalls) means the user has moved on from the recalled entry — stop browsing.
    if (this.chatHistoryIndex !== -1 && this.chatInput !== this.chatHistoryList()[this.chatHistoryIndex]) {
      this.chatHistoryIndex = -1;
    }
    const el = this.chatTextarea?.nativeElement;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, this.CHAT_INPUT_MAX_HEIGHT)}px`;
  }

  /** Enter sends the message; Shift+Enter inserts a newline in the textarea. */
  onChatEnter(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (!keyboardEvent.shiftKey) {
      keyboardEvent.preventDefault();
      void this.sendChatMessage();
    }
  }

  private chatHistoryList(): string[] {
    return this.chatMessages().filter(m => m.isUser).map(m => m.text);
  }

  /**
   * Up/Down recall of previously sent prompts, like a terminal or shell history.
   * Up only takes over when the box is empty (a fresh prompt) or already mid-recall —
   * otherwise it moves the cursor normally within whatever the user is typing.
   */
  onChatArrowUp(event: Event): void {
    const history = this.chatHistoryList();
    if (!history.length) return;

    const browsing = this.chatHistoryIndex !== -1;
    if (!browsing && this.chatInput.trim()) return;

    event.preventDefault();
    if (!browsing) {
      this.chatHistoryDraft = this.chatInput;
      this.chatHistoryIndex = history.length - 1;
    } else if (this.chatHistoryIndex > 0) {
      this.chatHistoryIndex--;
    }
    this.chatInput = history[this.chatHistoryIndex];
    setTimeout(() => this.autoResizeChatInput(), 0);
  }

  /** Down steps forward through history, restoring the original draft once past the newest entry. */
  onChatArrowDown(event: Event): void {
    if (this.chatHistoryIndex === -1) return;

    event.preventDefault();
    const history = this.chatHistoryList();
    if (this.chatHistoryIndex < history.length - 1) {
      this.chatHistoryIndex++;
      this.chatInput = history[this.chatHistoryIndex];
    } else {
      this.chatHistoryIndex = -1;
      this.chatInput = this.chatHistoryDraft;
    }
    setTimeout(() => this.autoResizeChatInput(), 0);
  }

  scrollChatToBottom(): void {
    // The page (not the message list) scrolls now, so bring the newest message into view;
    // its scroll-margin-bottom keeps it clear of the sticky input.
    const container: HTMLElement | undefined = this.chatContainer?.nativeElement;
    container?.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'smooth' });
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
    if (!weather || this.isLoadingClothing()) {
      return;
    }

    this.isLoadingClothing.set(true);

    try {
      const result = await this.aiOrchestrator.generate<{ text: string }>('dashboard-clothing-recommendation', {
        temperature: weather.temperature,
        description: weather.description,
        humidity: weather.humidity,
        windSpeed: weather.windSpeed
      });

      if (result.text.trim()) {
        const fullText = result.text.trim().replace(/^["']|["']$/g, '');
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
