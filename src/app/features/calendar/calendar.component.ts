import { Component, OnInit, OnDestroy, HostListener, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { externalEditLabel, externalEditUrl } from '../../utils/external-edit-link';
import { SwipeNavDirective } from '../../shared/swipe-nav/swipe-nav.directive';
import { CalendarSkeletonComponent } from '../../shared/calendar-skeleton/calendar-skeleton.component';
import { DriveEntry, DriveTimeService } from '../../services/drive-time.service';
import { GRAPH_EXPLORER_URL, OutlookTokenDialogComponent } from '../../components/outlook-token-dialog/outlook-token-dialog.component';
import { OutlookCalendarService } from '../../services/outlook-calendar.service';
import { GoogleCalendarService, CalendarEvent, CalendarInfo } from '../../services/google-calendar.service';
import { AppCalendarEventService } from '../../services/app-calendar-event.service';
import { highlightWhenPresent } from '../../utils/highlight';
import { buildTaskChecklist, completionFor, expandRecurringForDay, isSnoozedOccurrence, occurrenceKey, TaskChecklistRow } from '../../utils/recurrence';
import { formatSnoozeEnd, getSnoozeOptions } from '../../utils/snooze';
import { HouseholdService } from '../../services/household.service';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';
import { HomeLogoBtnComponent } from '../../shared/home-logo-btn/home-logo-btn.component';
import { LoadingAnimationComponent } from '../../components/loading-animation/loading-animation.component';
import { CalendarEventDialogComponent, CalendarEventDialogResult } from '../../components/calendar-event-dialog/calendar-event-dialog.component';

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

// Keep in sync with the week-view breakpoint in calendar.component.scss.

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
    CalendarSkeletonComponent,
    SwipeNavDirective,
    GlobalNavMenuComponent,
    HomeLogoBtnComponent
  ],
  templateUrl: './calendar.component.html',
  styleUrls: ['./calendar.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CalendarComponent implements OnInit, OnDestroy {
  currentDate = signal<Date>(new Date());

  /** Whether the task band is folded down to just each day's count; remembered, and shared with the dashboard's task list. */
  tasksCollapsed = signal(CalendarComponent.loadTasksCollapsed());

  /** Each day of the viewed week with its checklist of tasks (see buildTaskChecklist). */
  weekTasks = computed(() => {
    const events = this.appCalendarEventService.events();
    // Read each minute (currentTime ticks), so a task whose snooze has ended comes back by itself.
    const now = this.currentTime();
    const start = new Date(this.currentDate());
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - start.getDay());
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      return { day, rows: buildTaskChecklist(events, day, now) };
    });
  });
  weekHasTasks = computed(() => this.weekTasks().some(d => d.rows.length > 0));

  private static loadTasksCollapsed(): boolean {
    try {
      return localStorage.getItem('taskLaneCollapsed') === 'true';
    } catch {
      return false;
    }
  }

  toggleTasksCollapsed(): void {
    const next = !this.tasksCollapsed();
    this.tasksCollapsed.set(next);
    try {
      localStorage.setItem('taskLaneCollapsed', String(next));
    } catch {
      // Not persisted, but it still works for this visit
    }
  }

  trackByTaskRow(_: number, row: TaskChecklistRow): string {
    return row.event.id + occurrenceKey(row.event);
  }
  currentTime = signal<Date>(new Date());
  selectedEvent = signal<CalendarEvent | null>(null);
  /** Which view the calendar options menu is showing: its actions, or the calendar checkboxes. */
  calendarMenuView = signal<'actions' | 'calendars'>('actions');
  /** Sunday–Saturday week view when there's room for it; a single day otherwise. */

  popoverAbove = false;
  popoverTop = 0;
  readonly HOUR_PX = 60;
  readonly allHours = Array.from({ length: 24 }, (_, i) => i);


  private timeInterval?: number;
  /** True once the user has explicitly stepped away from today's view — blocks the auto re-sync on resume. */
  private hasNavigatedAwayFromToday = false;

  constructor(
    public calendarService: GoogleCalendarService,
    public outlookService: OutlookCalendarService,
    public appCalendarEventService: AppCalendarEventService,
    private householdService: HouseholdService,
    private dialog: MatDialog,
    private snackBar: MatSnackBar,
    private route: ActivatedRoute
  ) {
  }

  ngOnInit(): void {
    // Update current time every minute
    this.timeInterval = window.setInterval(() => {
      this.currentTime.set(new Date());
    }, 60000);

    // Catches a day rollover while this component stayed alive in the background
    // (mobile tab suspend/resume, a kiosk tablet left open, etc).
    document.addEventListener('visibilitychange', this.resyncViewDateOnForeground);
    window.addEventListener('scroll', this.closePopoverOnScroll, true);

    // A link such as /calendar?date=2026-10-05 (from a chat confirmation) opens that week.
    this.calendarTimeout = window.setTimeout(
      () => this.calendarLoadTimedOut.set(true),
      CalendarComponent.CALENDAR_LOAD_TIMEOUT_MS
    );

    this.dateParamSub = this.route.queryParamMap.subscribe(params => {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(params.get('date') ?? '');
      if (!match) return;
      this.hasNavigatedAwayFromToday = true;
      this.currentDate.set(new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      const highlight = params.get('highlight');
      if (highlight) highlightWhenPresent(highlight);
    });

    this.loadEventsForCurrentView();
  }

  private dateParamSub?: Subscription;

  /** How long the calendar shows its loading skeleton before giving up on a connection. */
  private static readonly CALENDAR_LOAD_TIMEOUT_MS = 10_000;
  private calendarTimeout?: number;
  calendarLoadTimedOut = signal(false);

  /** True while nothing is loaded yet and a connection may still arrive (at most the timeout above). */
  calendarWaiting = computed(() =>
    !this.calendarLoadTimedOut() &&
    !(this.calendarService.isInitialized() && (
      this.calendarService.isSignedIn() ||
      this.calendarService.events().length > 0 ||
      this.outlookService.events().length > 0 ||
      this.appCalendarEventService.events().length > 0
    ))
  );

  /** Past the timeout with no Google connection and nothing cached from it. */
  calendarConnectionFailed = computed(() =>
    this.calendarLoadTimedOut() &&
    !this.calendarService.isSignedIn() &&
    this.calendarService.events().length === 0
  );

  ngOnDestroy(): void {
    this.dateParamSub?.unsubscribe();
    if (this.calendarTimeout) clearTimeout(this.calendarTimeout);
    if (this.timeInterval) {
      clearInterval(this.timeInterval);
    }
    document.removeEventListener('visibilitychange', this.resyncViewDateOnForeground);
    window.removeEventListener('scroll', this.closePopoverOnScroll, true);
  }

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

  signIn(): void {
    this.calendarService.signIn();
  }

  async loadEventsForCurrentView(): Promise<void> {
    // Load events for the next 60 days to cache them
    await Promise.all([
      this.calendarService.isSignedIn() ? this.calendarService.loadCalendarEvents(60) : undefined,
      this.outlookService.isSignedIn() ? this.outlookService.sync(60) : undefined
    ]);
  }

  async refreshEvents(): Promise<void> {
    // Force refresh from API
    await this.loadEventsForCurrentView();
  }

  /** Opens the add-event form, pre-filled to whatever day is currently in view. */
  openAddEventDialog(): void {
    const dialogRef = this.dialog.open(CalendarEventDialogComponent, {
      width: '500px',
      maxWidth: '95vw',
      data: { mode: 'add', defaultDate: this.currentDate() }
    });

    dialogRef.afterClosed().subscribe(async (result: CalendarEventDialogResult | undefined) => {
      if (!result || result.action !== 'save') return;
      try {
        await this.appCalendarEventService.addEvent(result.event);
        this.snackBar.open('Item added', 'Close', { duration: 3000 });
      } catch (error) {
        console.error('Error adding calendar event:', error);
        this.snackBar.open('Failed to add item', 'Close', { duration: 3000 });
      }
    });
  }

  /** Opens the edit form for an app-native event (Google-synced events aren't editable here). */
  openEditEventDialog(event: CalendarEvent): void {
    if (event.source !== 'app') return;
    this.clearSelectedEvent();

    const dialogRef = this.dialog.open(CalendarEventDialogComponent, {
      width: '500px',
      maxWidth: '95vw',
      data: { mode: 'edit', event }
    });

    dialogRef.afterClosed().subscribe(async (result: CalendarEventDialogResult | undefined) => {
      if (!result) return;
      try {
        if (result.action === 'delete') {
          await this.appCalendarEventService.deleteEvent(event.id);
          this.snackBar.open('Item deleted', 'Close', { duration: 3000 });
        } else {
          await this.appCalendarEventService.updateEvent(event.id, result.event);
          this.snackBar.open('Item updated', 'Close', { duration: 3000 });
        }
      } catch (error) {
        console.error('Error updating calendar event:', error);
        this.snackBar.open('Failed to save item', 'Close', { duration: 3000 });
      }
    });
  }

  previousPeriod(): void {
    this.hasNavigatedAwayFromToday = true;
    const d = new Date(this.currentDate());
    d.setDate(d.getDate() - 7);
    this.currentDate.set(d);
  }

  nextPeriod(): void {
    this.hasNavigatedAwayFromToday = true;
    const d = new Date(this.currentDate());
    d.setDate(d.getDate() + 7);
    this.currentDate.set(d);
  }

  goToToday(): void {
    this.hasNavigatedAwayFromToday = false;
    this.currentDate.set(new Date());
  }

  get isViewingToday(): boolean {
    return this.getWeekDays().some(day => this.isToday(day));
  }

  formatViewLabel(): string {
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
      ...this.calendarService.events()
        .filter(event => this.calendarService.isCalendarVisible(event.calendarId || 'primary'))
        .map(event => ({ ...event, source: event.source ?? 'google' as const })),
      ...this.outlookService.events().filter(event => this.outlookService.isCalendarVisible(event.calendarId!)),
      ...this.appCalendarEventService.events()
    ];
  }

  getAllDayEventsForDay(date: Date): TimelineEvent[] {
    return this.getEventsForDay(date).filter(event => this.isAllDayEvent(event));
  }

  /** The week's all-day row skips tasks: those live in the task band above it. */
  getAllDayNonTaskEventsForDay(date: Date): TimelineEvent[] {
    return this.getAllDayEventsForDay(date).filter(event => event.kind !== 'task');
  }

  getTimedEventsForDay(date: Date): TimelineEvent[] {
    const events = this.getEventsForDay(date).filter(event => !this.isAllDayEvent(event));
    return this.assignOverlapColumns(events);
  }

  private getEventsForDay(date: Date): TimelineEvent[] {
    const dayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 0, 0, 0);
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);

    return expandRecurringForDay(this.getAllEvents(), dayStart, dayEnd)
      .filter(event => !isSnoozedOccurrence(event))
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
      actualHeight: ((endMin - startMin) / 60) * this.HOUR_PX,
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
      // end.date is exclusive (Google Calendar semantics); subtract 1ms so the last day is the final one included.
      return new Date(new Date(year, month - 1, day, 0, 0, 0).getTime() - 1);
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

  driveTimeService = inject(DriveTimeService);

  /** Shows (looking it up first) or hides the drive time from home for an event with a location. */
  async toggleDriveTime(event: CalendarEvent, domEvent: Event): Promise<void> {
    domEvent.stopPropagation();
    if (this.driveTimeService.get(event)) {
      this.driveTimeService.hide(event);
      return;
    }
    const error = await this.driveTimeService.show(event);
    if (error) this.snackBar.open(error, 'Close', { duration: 4000 });
  }

  /** "4:25 PM" — when to leave home for an event. */
  formatLeave(drive: DriveEntry): string {
    return this.formatTime(new Date(drive.leaveByIso));
  }

  /** The dashed "leave home" line above a timed event whose drive time is being shown, on the given day's timeline. */
  getDriveLine(event: TimelineEvent, day: Date): { top: number; height: number; label: string } | null {
    const drive = this.driveTimeService.get(event);
    if (!drive) return null;
    const dayStart = new Date(day.getFullYear(), day.getMonth(), day.getDate());
    const leaveMinutes = Math.max(0, (new Date(drive.leaveByIso).getTime() - dayStart.getTime()) / 60000);
    const top = (leaveMinutes / 60) * this.HOUR_PX;
    const height = event.topPosition - top;
    return height > 0 ? { top, height, label: `Leave ${this.formatLeave(drive)}` } : null;
  }

  /** Snooze choices for the popover's menu, worked out fresh so "Tonight" and "Tomorrow" are right when opened. */
  snoozeOptions = () => getSnoozeOptions();

  /** Hides a task occurrence from the calendar until then, with an undo. */
  async snoozeTask(event: CalendarEvent, until: Date): Promise<void> {
    const key = occurrenceKey(event);
    this.clearSelectedEvent();
    try {
      await this.appCalendarEventService.snoozeOccurrence(event.id, key, until);
      this.snackBar
        .open(`Snoozed until ${formatSnoozeEnd(until)}`, 'Undo', { duration: 5000 })
        .onAction()
        .subscribe(() => this.appCalendarEventService.unsnoozeOccurrence(event.id, key));
    } catch (error) {
      console.error('Error snoozing task:', error);
      this.snackBar.open('Could not snooze the task — try again', 'Close', { duration: 3000 });
    }
  }

  externalEditUrl = externalEditUrl;
  externalEditLabel = externalEditLabel;

  /** Google and Outlook calendars together, for the "Choose calendars" lists. */
  selectableCalendars(): CalendarInfo[] {
    return [...this.calendarService.calendars(), ...this.outlookService.calendars()];
  }

  isCalendarChecked(calendarId: string): boolean {
    return calendarId.startsWith('outlook:')
      ? this.outlookService.isCalendarVisible(calendarId)
      : this.calendarService.isCalendarVisible(calendarId);
  }

  connectOutlook(): void {
    // Renewing means a trip to Graph Explorer for a fresh token, so open it for them right away
    // (from this click, so it isn't blocked) — the dialog is already waiting when they come back.
    if (this.outlookService.hasCache()) {
      window.open(GRAPH_EXPLORER_URL, '_blank', 'noopener');
    }
    this.dialog.open(OutlookTokenDialogComponent, { width: '480px', maxWidth: '95vw' });
  }

  disconnectOutlook(): void {
    this.outlookService.signOut();
  }

  toggleCalendarVisibility(calendarId: string, event: Event): void {
    const checkbox = event.target as HTMLInputElement;
    if (calendarId.startsWith('outlook:')) {
      this.outlookService.toggleCalendar(calendarId, checkbox.checked);
      return;
    }
    this.calendarService.toggleCalendar(calendarId, checkbox.checked);
  }

  /** Deep-links to Google Calendar's own day or week view for whatever's currently in view. */
  googleCalendarUrl(): string {
    const d = this.currentDate();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `https://calendar.google.com/calendar/r/week/${year}/${month}/${day}`;
  }

  getEventColor(event: CalendarEvent): string {
    // App-native events (created in-app) get a fixed distinct color rather than a Google
    // colorId, so they're visually told apart from synced events.
    if (event.source === 'app') {
      return '#8E6BC9';
    }
    if (event.source === 'outlook') {
      return this.outlookService.getCalendarColor(event.calendarId!);
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

  selectEvent(event: CalendarEvent, mouseEvent: Event): void {
    mouseEvent.stopPropagation();
    const target = mouseEvent.currentTarget as HTMLElement;
    const rect = target.getBoundingClientRect();
    // Flip above if less than 210px below the event
    this.popoverAbove = (window.innerHeight - rect.bottom) < 210;
    // The popover is position: fixed, so it needs a viewport-relative offset.
    this.popoverTop = this.popoverAbove ? rect.top - 8 : rect.bottom + 8;
    this.confirmingTask.set(null);
    this.selectedEvent.set(event);
  }

  // ── Tasks ──────────────────────────────────────────────────────
  /** The task occurrence whose "Mark complete?" popover is open. */
  confirmingTask = signal<CalendarEvent | null>(null);
  confirmAbove = false;
  confirmTop = 0;

  isTask(event: CalendarEvent): boolean {
    return event.kind === 'task';
  }

  isTaskDone(event: CalendarEvent): boolean {
    return !!completionFor(event);
  }

  completionFor = completionFor;

  /** Tapping the checkbox asks first (in a popover under it), rather than toggling straight away. */
  askTaskToggle(event: CalendarEvent, domEvent: Event): void {
    domEvent.stopPropagation();
    const rect = (domEvent.currentTarget as HTMLElement).getBoundingClientRect();
    this.confirmAbove = (window.innerHeight - rect.bottom) < 150;
    this.confirmTop = this.confirmAbove ? rect.top - 8 : rect.bottom + 8;
    this.clearSelectedEvent();
    this.confirmingTask.set(event);
  }

  cancelTaskPrompt(domEvent?: Event): void {
    domEvent?.stopPropagation();
    this.confirmingTask.set(null);
  }

  async confirmTaskToggle(event: CalendarEvent, domEvent: Event): Promise<void> {
    domEvent.stopPropagation();
    this.confirmingTask.set(null);
    const key = occurrenceKey(event);
    try {
      if (this.isTaskDone(event)) {
        await this.appCalendarEventService.clearCompletion(event.id, key);
      } else {
        await this.appCalendarEventService.completeOccurrence(event.id, key);
      }
    } catch (error) {
      console.error('Error updating task completion:', error);
      this.snackBar.open('Could not update the task — try again', 'Close', { duration: 3000 });
    }
  }

  formatCompletionTime(iso: string): string {
    const d = new Date(iso);
    return `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} at ${this.formatTime(d)}`;
  }

  private readonly closePopoverOnScroll = (): void => {
    if (this.selectedEvent()) this.clearSelectedEvent();
    if (this.confirmingTask()) this.confirmingTask.set(null);
  };

  @HostListener('document:keydown.escape')
  onEscapeKey(): void {
    this.clearSelectedEvent();
    this.confirmingTask.set(null);
  }

  @HostListener('document:click')
  onDocumentClick(): void {
    this.clearSelectedEvent();
    this.confirmingTask.set(null);
  }

  clearSelectedEvent(): void {
    this.selectedEvent.set(null);
  }

  // trackBy functions: getTimedEventsForDay()/getAllDayEventsForDay()/getWeekDays() all
  // construct fresh arrays (and fresh Date/TimelineEvent objects) on every call, since
  // their positions are recomputed each time rather than cached. Without trackBy, any
  // change-detection pass — including one triggered by simply hovering an event, since
  // that's a DOM event zone.js reacts to — would make *ngFor treat every item as new and
  // recreate its DOM node, which drops :hover state and reads as a flicker.
  trackByEventId(_index: number, item: { id: string }): string {
    return item.id;
  }

  trackByWeekTask(_index: number, entry: { day: Date }): number {
    return entry.day.getTime();
  }

  trackByDate(_index: number, date: Date): number {
    return date.getTime();
  }

  trackByHour(_index: number, hour: number): number {
    return hour;
  }

  /** Name of the household member an event is tagged for, or null when it concerns everyone. */
  memberName(memberId: string | undefined): string | null {
    if (!memberId) return null;
    return this.householdService.getMemberById(memberId)?.name ?? null;
  }
}
