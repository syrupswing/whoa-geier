import { Component, OnInit, OnDestroy, AfterViewInit, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { GoogleCalendarService, CalendarEvent } from '../../services/google-calendar.service';
import { AppCalendarEventService } from '../../services/app-calendar-event.service';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';
import { HomeLogoBtnComponent } from '../../shared/home-logo-btn/home-logo-btn.component';
import { LoadingAnimationComponent } from '../../components/loading-animation/loading-animation.component';
import { CalendarEventDialogComponent, CalendarEventDialogResult } from '../../components/calendar-event-dialog/calendar-event-dialog.component';

interface TimelineEvent extends CalendarEvent {
  startDate: Date;
  endDate: Date;
  topPosition: number;
  height: number;
  columnIndex: number;
  columnCount: number;
}

// Keep in sync with the week-view breakpoint in calendar.component.scss.
const WIDE_VIEWPORT_QUERY = '(min-width: 1024px)';

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [
    CommonModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    LoadingAnimationComponent,
    MatTooltipModule,
    MatSnackBarModule,
    GlobalNavMenuComponent,
    HomeLogoBtnComponent
  ],
  templateUrl: './calendar.component.html',
  styleUrls: ['./calendar.component.scss']
})
export class CalendarComponent implements OnInit, OnDestroy, AfterViewInit {
  currentDate = signal<Date>(new Date());
  currentTime = signal<Date>(new Date());
  selectedEvent = signal<TimelineEvent | null>(null);
  /** Sunday–Saturday week view when there's room for it; a single day otherwise. */
  isWideViewport = signal<boolean>(false);

  popoverAbove = false;
  popoverTop = 0;
  readonly HOUR_PX = 60;
  readonly allHours = Array.from({ length: 24 }, (_, i) => i);

  @ViewChild('timelineScroll') timelineScroll?: ElementRef<HTMLElement>;

  private timeInterval?: number;
  /** True once the user has explicitly stepped away from today's view — blocks the auto re-sync on resume. */
  private hasNavigatedAwayFromToday = false;
  private readonly wideViewportQuery = window.matchMedia(WIDE_VIEWPORT_QUERY);

  constructor(
    public calendarService: GoogleCalendarService,
    public appCalendarEventService: AppCalendarEventService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar
  ) {
    this.isWideViewport.set(this.wideViewportQuery.matches);
  }

  ngOnInit(): void {
    // Update current time every minute
    this.timeInterval = window.setInterval(() => {
      this.currentTime.set(new Date());
    }, 60000);

    // Catches a day rollover while this component stayed alive in the background
    // (mobile tab suspend/resume, a kiosk tablet left open, etc).
    document.addEventListener('visibilitychange', this.resyncViewDateOnForeground);
    this.wideViewportQuery.addEventListener('change', this.onViewportChange);

    this.loadEventsForCurrentView();
  }

  ngAfterViewInit(): void {
    // Scroll to current time after view is initialized
    setTimeout(() => this.scrollToCurrentTime(), 300);
  }

  ngOnDestroy(): void {
    if (this.timeInterval) {
      clearInterval(this.timeInterval);
    }
    document.removeEventListener('visibilitychange', this.resyncViewDateOnForeground);
    this.wideViewportQuery.removeEventListener('change', this.onViewportChange);
  }

  private readonly onViewportChange = (event: MediaQueryListEvent): void => {
    this.isWideViewport.set(event.matches);
  };

  private readonly resyncViewDateOnForeground = (): void => {
    if (document.visibilityState === 'visible') {
      this.syncViewDateToToday();
    }
  };

  /**
   * Keeps the default view pinned to the real current day even if this component instance
   * stays alive across midnight, without ever overriding a day the user explicitly navigated to.
   */
  private syncViewDateToToday(): void {
    if (this.hasNavigatedAwayFromToday) return;
    const now = new Date();
    if (now.toDateString() !== this.currentDate().toDateString()) {
      this.currentDate.set(now);
    }
  }

  scrollToCurrentTime(): void {
    const el = this.timelineScroll?.nativeElement;
    if (!el) return;
    const currentTimePos = this.getCurrentTimePosition();
    el.scrollTop = Math.max(0, currentTimePos - el.clientHeight * 0.2);
  }

  signIn(): void {
    this.calendarService.signIn();
  }

  signOut(): void {
    this.calendarService.signOut();
  }

  async loadEventsForCurrentView(): Promise<void> {
    if (!this.calendarService.isSignedIn()) return;

    // Load events for the next 60 days to cache them
    await this.calendarService.loadCalendarEvents(60);
  }

  async refreshEvents(): Promise<void> {
    // Force refresh from API
    await this.loadEventsForCurrentView();
  }

  /** Opens the add-event form, pre-filled to whatever day is currently in view. */
  openAddEventDialog(): void {
    const dialogRef = this.dialog.open(CalendarEventDialogComponent, {
      width: '500px',
      data: { mode: 'add', defaultDate: this.currentDate() }
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

  previousPeriod(): void {
    this.hasNavigatedAwayFromToday = true;
    const d = new Date(this.currentDate());
    d.setDate(d.getDate() - (this.isWideViewport() ? 7 : 1));
    this.currentDate.set(d);
  }

  nextPeriod(): void {
    this.hasNavigatedAwayFromToday = true;
    const d = new Date(this.currentDate());
    d.setDate(d.getDate() + (this.isWideViewport() ? 7 : 1));
    this.currentDate.set(d);
  }

  goToToday(): void {
    this.hasNavigatedAwayFromToday = false;
    this.currentDate.set(new Date());
    setTimeout(() => this.scrollToCurrentTime(), 50);
  }

  get isViewingToday(): boolean {
    if (!this.isWideViewport()) return this.isToday(this.currentDate());
    return this.getWeekDays().some(day => this.isToday(day));
  }

  formatViewLabel(): string {
    if (!this.isWideViewport()) {
      return this.currentDate().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    }
    const [start, end] = [this.getWeekDays()[0], this.getWeekDays()[6]];
    const sameMonth = start.getMonth() === end.getMonth();
    const startLabel = start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    const endLabel = end.toLocaleDateString('en-US', sameMonth ? { day: 'numeric' } : { month: 'short', day: 'numeric' });
    return `${startLabel} – ${endLabel}`;
  }

  /** The Sunday–Saturday week containing the current date. */
  getWeekDays(): Date[] {
    const start = new Date(this.currentDate());
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      return day;
    });
  }

  /** Google-synced events plus app-native events (see AppCalendarEventService), merged for display. */
  getAllEvents(): CalendarEvent[] {
    return [
      ...this.calendarService.events().map(event => ({ ...event, source: event.source ?? 'google' as const })),
      ...this.appCalendarEventService.events()
    ];
  }

  getAllDayEventsForDay(date: Date): TimelineEvent[] {
    return this.getEventsForDay(date).filter(event => this.isAllDayEvent(event));
  }

  getTimedEventsForDay(date: Date): TimelineEvent[] {
    const events = this.getEventsForDay(date).filter(event => !this.isAllDayEvent(event));
    return this.assignOverlapColumns(events);
  }

  private getEventsForDay(date: Date): TimelineEvent[] {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

    return this.getAllEvents()
      .filter(event => {
        const eventStart = this.getEventStartDate(event);
        const eventEnd = this.getEventEndDate(event);
        return eventStart <= dayEnd && eventEnd >= dayStart;
      })
      .map(event => this.calculateEventPosition(event, date))
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }

  isAllDayEvent(event: CalendarEvent): boolean {
    // All-day events have date property instead of dateTime
    return !!event.start.date && !event.start.dateTime;
  }

  calculateEventPosition(event: CalendarEvent, forDate: Date): TimelineEvent {
    const startDate = this.getEventStartDate(event);
    const endDate = this.getEventEndDate(event);
    const dayStart = new Date(forDate.getFullYear(), forDate.getMonth(), forDate.getDate(), 0, 0, 0);
    const dayEnd = new Date(forDate.getFullYear(), forDate.getMonth(), forDate.getDate(), 23, 59, 59);
    const effectiveStart = startDate < dayStart ? dayStart : startDate;
    const effectiveEnd = endDate > dayEnd ? dayEnd : endDate;
    const startMin = effectiveStart.getHours() * 60 + effectiveStart.getMinutes();
    const endMin = effectiveEnd.getHours() * 60 + effectiveEnd.getMinutes();

    return {
      ...event,
      startDate,
      endDate,
      topPosition: (startMin / 60) * this.HOUR_PX,
      // A point-in-time event has zero duration, so this naturally falls back to the
      // same minimum height as any other very short timed event — it renders like a
      // normal event block, just with the top-border marker added in CSS.
      height: Math.max(((endMin - startMin) / 60) * this.HOUR_PX, 30),
      columnIndex: 0,
      columnCount: 1
    };
  }

  /** Splits overlapping events into side-by-side columns so none are hidden. */
  private assignOverlapColumns(events: TimelineEvent[]): TimelineEvent[] {
    const sorted = [...events].sort((a, b) => a.topPosition - b.topPosition || b.height - a.height);
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
      const end = start + event.height;

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

  getEventStartDate(event: CalendarEvent): Date {
    const dateStr = event.start.dateTime || event.start.date;
    if (!dateStr) return new Date();

    // For all-day events (date only), use local midnight
    if (event.start.date && !event.start.dateTime) {
      const [year, month, day] = event.start.date.split('-').map(Number);
      return new Date(year, month - 1, day, 0, 0, 0);
    }

    // For timed events, parse the ISO string which includes timezone
    return new Date(dateStr);
  }

  getEventEndDate(event: CalendarEvent): Date {
    const dateStr = event.end.dateTime || event.end.date;
    if (!dateStr) return new Date();

    // For all-day events (date only), use local midnight
    if (event.end.date && !event.end.dateTime) {
      const [year, month, day] = event.end.date.split('-').map(Number);
      return new Date(year, month - 1, day, 0, 0, 0);
    }

    // For timed events, parse the ISO string which includes timezone
    return new Date(dateStr);
  }

  getCurrentTimePosition(): number {
    const now = this.currentTime();
    const minutes = now.getHours() * 60 + now.getMinutes();
    return (minutes / 60) * this.HOUR_PX;
  }

  isToday(date: Date): boolean {
    const today = new Date();
    return date.getDate() === today.getDate() &&
           date.getMonth() === today.getMonth() &&
           date.getFullYear() === today.getFullYear();
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
      if (event.isPointInTime) {
        return this.formatTime(start);
      }
      const end = new Date(event.end.dateTime || event.start.dateTime);
      const startLabel = `${event.startApproximate ? '~' : ''}${this.formatTime(start)}`;
      const endLabel = `${event.endApproximate ? '~' : ''}${this.formatTime(end)}`;
      return `${startLabel} – ${endLabel}`;
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

  toggleCalendarVisibility(calendarId: string, event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    this.calendarService.toggleCalendar(calendarId, checkbox.checked);
  }

  /** Deep-links to Google Calendar's own day or week view for whatever's currently in view. */
  googleCalendarUrl(): string {
    const d = this.currentDate();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const view = this.isWideViewport() ? 'week' : 'day';
    return `https://calendar.google.com/calendar/r/${view}/${year}/${month}/${day}`;
  }

  getEventColor(event: CalendarEvent): string {
    // App-native events (created in-app) get a fixed distinct color rather than a Google
    // colorId, so they're visually told apart from synced events.
    if (event.source === 'app') {
      return '#8E6BC9';
    }
    const calendarColor = this.calendarService.getCalendarColor(event.calendarId || 'primary');
    if (calendarColor && calendarColor !== '#2196F3') {
      return calendarColor;
    }
    const colorMap: { [key: string]: string } = {
      '1': '#a4bdfc', '2': '#7ae7bf', '3': '#dbadff',
      '4': '#ff887c', '5': '#fbd75b', '6': '#ffb878',
      '7': '#46d6db', '8': '#e1e1e1', '9': '#5484ed',
      '10': '#51b749', '11': '#dc2127'
    };
    return event.colorId ? colorMap[event.colorId] : calendarColor;
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
}
