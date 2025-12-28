import { Component, OnInit, OnDestroy, AfterViewInit, signal, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { GoogleCalendarService, CalendarEvent } from '../../services/google-calendar.service';

interface TimelineEvent extends CalendarEvent {
  startDate: Date;
  endDate: Date;
  topPosition: number;
  height: number;
}

@Component({
  selector: 'app-calendar',
  standalone: true,
  imports: [
    CommonModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    MatTooltipModule
  ],
  templateUrl: './calendar.component.html',
  styleUrls: ['./calendar.component.scss']
})
export class CalendarComponent implements OnInit, OnDestroy, AfterViewInit {
  currentDate = signal<Date>(new Date());
  currentTime = signal<Date>(new Date());
  viewMode = signal<'day' | 'week'>('day');
  
  private timeInterval?: number;
  
  hours = Array.from({ length: 24 }, (_, i) => i);

  constructor(public calendarService: GoogleCalendarService) {}

  ngOnInit(): void {
    // Update current time every minute
    this.timeInterval = window.setInterval(() => {
      this.currentTime.set(new Date());
    }, 60000);
    
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
  }

  /**
   * Scroll timeline to position current time indicator 20% from top
   */
  scrollToCurrentTime(): void {
    const currentTimePos = this.getCurrentTimePosition();
    
    // Find the mat-sidenav-content element (the actual scrollable container)
    const sidenavContent = document.querySelector('.mat-sidenav-content');
    
    if (sidenavContent) {
      const containerHeight = sidenavContent.clientHeight;
      const scrollPosition = Math.max(0, currentTimePos - (containerHeight * 0.2));
      sidenavContent.scrollTop = scrollPosition;
    }
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

  previousDay(): void {
    const newDate = new Date(this.currentDate());
    newDate.setDate(newDate.getDate() - 1);
    this.currentDate.set(newDate);
    // No need to reload - events are already cached
  }

  nextDay(): void {
    const newDate = new Date(this.currentDate());
    newDate.setDate(newDate.getDate() + 1);
    this.currentDate.set(newDate);
    // No need to reload - events are already cached
  }

  today(): void {
    this.currentDate.set(new Date());
    // No need to reload - events are already cached
  }

  getViewStartDate(): Date {
    const start = new Date(this.currentDate());
    start.setHours(0, 0, 0, 0);
    
    if (this.viewMode() === 'week') {
      // Start of week (Sunday)
      const day = start.getDay();
      start.setDate(start.getDate() - day);
    }
    
    return start;
  }

  getViewEndDate(): Date {
    const end = new Date(this.currentDate());
    end.setHours(23, 59, 59, 999);
    
    if (this.viewMode() === 'week') {
      // End of week (Saturday)
      const day = end.getDay();
      end.setDate(end.getDate() + (6 - day));
    }
    
    return end;
  }

  getWeekDays(): Date[] {
    const days: Date[] = [];
    const start = this.getViewStartDate();
    
    for (let i = 0; i < 7; i++) {
      const day = new Date(start);
      day.setDate(start.getDate() + i);
      days.push(day);
    }
    
    return days;
  }

  getEventsForDay(date: Date): TimelineEvent[] {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(date);
    dayEnd.setHours(23, 59, 59, 999);

    // Filter from cached events - no API call needed
    return this.calendarService.events()
      .filter(event => {
        const eventStart = this.getEventStartDate(event);
        const eventEnd = this.getEventEndDate(event);
        // Include events that start or end on this day, or span across it
        return (eventStart >= dayStart && eventStart <= dayEnd) ||
               (eventEnd >= dayStart && eventEnd <= dayEnd) ||
               (eventStart < dayStart && eventEnd > dayEnd);
      })
      .map(event => this.calculateEventPosition(event))
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
  }

  getAllDayEventsForDay(date: Date): CalendarEvent[] {
    return this.getEventsForDay(date).filter(event => this.isAllDayEvent(event));
  }

  getTimedEventsForDay(date: Date): TimelineEvent[] {
    return this.getEventsForDay(date).filter(event => !this.isAllDayEvent(event));
  }

  isAllDayEvent(event: CalendarEvent): boolean {
    // All-day events have date property instead of dateTime
    return !!event.start.date && !event.start.dateTime;
  }

  calculateEventPosition(event: CalendarEvent): TimelineEvent {
    const startDate = this.getEventStartDate(event);
    const endDate = this.getEventEndDate(event);
    
    // Calculate position based on time (60px per hour)
    const startMinutes = startDate.getHours() * 60 + startDate.getMinutes();
    const endMinutes = endDate.getHours() * 60 + endDate.getMinutes();
    const durationMinutes = endMinutes - startMinutes;
    
    const topPosition = (startMinutes / 60) * 60; // 60px per hour
    const height = Math.max((durationMinutes / 60) * 60, 30); // Minimum 30px height
    
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
    return (minutes / 60) * 60; // 60px per hour
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
      const end = new Date(event.end.dateTime || event.start.dateTime);
      return `${this.formatTime(start)} - ${this.formatTime(end)}`;
    }
    return 'All day';
  }

  formatTime(date: Date): string {
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone // Use system timezone
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
}
