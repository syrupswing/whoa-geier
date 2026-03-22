import { Injectable, signal, OnDestroy } from '@angular/core';
import { LocalStorageService } from './local-storage.service';
import { FirestoreService } from './firestore.service';
import { AuthService } from './auth.service';
import { environment } from '../../environments/environment';
import { Unsubscribe } from 'firebase/firestore';

export interface TodoItem {
  id: string;
  title: string;
  description?: string;
  completed: boolean;
  completedAt?: string;
  completedByUserId?: string;
  completedByUserName?: string;
  dueDate?: string; // ISO date string
  urgency?: 'time-sensitive' | 'medium' | 'low';
  importance?: 'low' | 'medium' | 'high';
  cadence?: 'chore' | 'standard' | 'long-term';
  isRecurring?: boolean;
  recurrenceType?: 'weekday' | 'month-day' | 'day-interval';
  recurrenceWeekday?: number; // 0-6 (Sunday-Saturday)
  recurrenceWeekInterval?: number; // Every N weeks on selected weekday
  recurrenceMonthDay?: number; // 1-31
  recurrenceDayInterval?: number; // Every N days
  lastRecurringCompletedAt?: string;
  lastRecurringCompletedByUserId?: string;
  lastRecurringCompletedByUserName?: string;
  category?: string;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface TaskScore {
  value: number;
  label: 'critical' | 'high-focus' | 'planned' | 'routine' | 'low-touch';
}

export interface OverdueSeverity {
  label: 'none' | 'watch' | 'elevated' | 'high' | 'critical';
  color: string;
  score: number;
  daysOverdue: number;
}

@Injectable({
  providedIn: 'root'
})
export class TodoService implements OnDestroy {
  private readonly STORAGE_KEY = 'todo-items';
  private readonly COLLECTION_NAME = 'todoItems';
  private firestoreSubscription: Unsubscribe | null = null;

  items = signal<TodoItem[]>([]);
  isLoading = signal<boolean>(false);
  useFirestore = signal<boolean>(environment.useFirestore);

  constructor(
    private localStorageService: LocalStorageService,
    private firestoreService: FirestoreService,
    private authService: AuthService
  ) {
    this.loadItems();
  }

  ngOnDestroy(): void {
    if (this.firestoreSubscription) {
      this.firestoreSubscription();
    }
  }

  /**
   * Load items from storage (localStorage or Firestore)
   */
  private async loadItems(): Promise<void> {
    this.isLoading.set(true);

    try {
      if (this.useFirestore() && this.firestoreService.isInitialized()) {
        await this.loadFromFirestore();
      } else {
        this.loadFromLocalStorage();
      }
    } catch (error) {
      console.error('Error loading todo items:', error);
      // Fallback to localStorage
      this.loadFromLocalStorage();
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Load items from Firestore with real-time updates
   */
  private async loadFromFirestore(): Promise<void> {
    if (this.firestoreSubscription) {
      this.firestoreSubscription();
    }

    this.firestoreSubscription = this.firestoreService.subscribeToCollection<TodoItem>(
      this.COLLECTION_NAME,
      (items) => {
        this.items.set(this.sortItems(items));
        this.isLoading.set(false);
      }
    );
  }

  /**
   * Load items from localStorage
   */
  private loadFromLocalStorage(): void {
    const items = this.localStorageService.getItem<TodoItem[]>(this.STORAGE_KEY) || [];
    this.items.set(this.sortItems(items));
  }

  /**
   * Sort active tasks by due date first, then score, then creation time.
   */
  private sortItems(items: TodoItem[]): TodoItem[] {
    return [...items].sort((a, b) => {
      // Keep active tasks above completed tasks.
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }

      if (!a.completed && !b.completed) {
        if (a.dueDate && b.dueDate) {
          const dueDateDiff = new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
          if (dueDateDiff !== 0) {
            return dueDateDiff;
          }
        }

        if (a.dueDate && !b.dueDate) return -1;
        if (!a.dueDate && b.dueDate) return 1;

        const scoreDiff = this.getTaskScore(b).value - this.getTaskScore(a).value;
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
      }

      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  }

  /**
   * Add a new todo item
   */
  async addItem(item: Omit<TodoItem, 'id' | 'userId' | 'createdAt' | 'updatedAt'>): Promise<void> {
    // Always generate an ID
    const id = this.generateId();
    const newItem: TodoItem = {
      ...item,
      id,
      userId: this.authService.currentUser()?.uid,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (this.useFirestore() && this.firestoreService.isInitialized()) {
      // Use setDocument with the custom ID so we can update it later
      await this.firestoreService.setDocument(this.COLLECTION_NAME, id, newItem);
    } else {
      // For localStorage
      const currentItems = this.items();
      this.items.set([...currentItems, newItem]);
      this.saveToLocalStorage();
    }
  }

  /**
   * Update an existing item
   */
  async updateItem(id: string, updates: Partial<TodoItem>): Promise<void> {
    if (this.useFirestore() && this.firestoreService.isInitialized()) {
      await this.firestoreService.updateDocument(this.COLLECTION_NAME, id, {
        ...updates,
        updatedAt: new Date().toISOString()
      });
    } else {
      const currentItems = this.items();
      const updatedItems = currentItems.map(item =>
        item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item
      );
      this.items.set(updatedItems);
      this.saveToLocalStorage();
    }
  }

  /**
   * Toggle item completion status
   */
  async toggleComplete(id: string): Promise<void> {
    const item = this.items().find(i => i.id === id);
    if (item) {
      // Recurring tasks capture completion metadata and stay in active tasks.
      if (item.isRecurring && !item.completed) {
        const currentUser = this.authService.currentUser();
        const nextDueDate = this.calculateNextRecurringDueDate(item, new Date());
        await this.updateItem(id, {
          completed: false,
          dueDate: nextDueDate?.toISOString(),
          lastRecurringCompletedAt: new Date().toISOString(),
          lastRecurringCompletedByUserId: currentUser?.uid,
          lastRecurringCompletedByUserName: currentUser?.displayName || currentUser?.email || 'Unknown User'
        });
        return;
      }

      const newCompletedValue = !item.completed;
      console.log(`Toggling todo ${id}: completed ${item.completed} -> ${newCompletedValue}`);
      const currentUser = this.authService.currentUser();
      await this.updateItem(id, {
        completed: newCompletedValue,
        completedAt: newCompletedValue ? new Date().toISOString() : undefined,
        completedByUserId: newCompletedValue ? currentUser?.uid : undefined,
        completedByUserName: newCompletedValue ? (currentUser?.displayName || currentUser?.email || 'Unknown User') : undefined
      });
    }
  }

  /**
   * Backfill the actual completion day when a task was done earlier/later than marked.
   */
  async setActualCompletionTime(id: string, completionDate: Date): Promise<void> {
    const item = this.items().find(i => i.id === id);
    if (!item) {
      return;
    }

    const currentUser = this.authService.currentUser();
    const completionDay = this.toStartOfDay(completionDate);
    const completionIso = completionDay.toISOString();

    if (item.isRecurring) {
      const nextDueDate = this.calculateNextRecurringDueDate(item, completionDay);
      await this.updateItem(id, {
        dueDate: nextDueDate?.toISOString(),
        lastRecurringCompletedAt: completionIso,
        lastRecurringCompletedByUserId: currentUser?.uid,
        lastRecurringCompletedByUserName: currentUser?.displayName || currentUser?.email || 'Unknown User'
      });
      return;
    }

    await this.updateItem(id, {
      completed: true,
      completedAt: completionIso,
      completedByUserId: currentUser?.uid,
      completedByUserName: currentUser?.displayName || currentUser?.email || 'Unknown User'
    });
  }

  /**
   * Delete an item
   */
  async deleteItem(id: string): Promise<void> {
    if (this.useFirestore() && this.firestoreService.isInitialized()) {
      await this.firestoreService.deleteDocument(this.COLLECTION_NAME, id);
    } else {
      const currentItems = this.items();
      this.items.set(currentItems.filter(item => item.id !== id));
      this.saveToLocalStorage();
    }
  }

  /**
   * Get items by date range (for calendar view)
   */
  getItemsByDateRange(startDate: Date, endDate: Date): TodoItem[] {
    return this.items().filter(item => {
      if (!item.dueDate) return false;
      const itemDate = new Date(item.dueDate);
      return itemDate >= startDate && itemDate <= endDate;
    });
  }

  /**
   * Get items by category
   */
  getItemsByCategory(category: string): TodoItem[] {
    return this.items().filter(item => item.category === category);
  }

  /**
   * Get overdue items
   */
  getOverdueItems(): TodoItem[] {
    return this.items().filter(item => this.getDaysOverdue(item) > 0 && !item.completed);
  }

  /**
   * Quantify lateness in full calendar days for any due-date item.
   */
  getDaysOverdue(item: Pick<TodoItem, 'dueDate' | 'completed'>): number {
    if (!item.dueDate || item.completed) {
      return 0;
    }

    const dueDate = this.toStartOfDay(new Date(item.dueDate));
    const today = this.toStartOfDay(new Date());
    const diffMs = today.getTime() - dueDate.getTime();
    if (diffMs <= 0) {
      return 0;
    }

    return Math.floor(diffMs / (1000 * 60 * 60 * 24));
  }

  /**
   * Derive overdue severity from lateness and task score (urgency + importance).
   */
  getOverdueSeverity(item: Pick<TodoItem, 'dueDate' | 'completed' | 'urgency' | 'importance' | 'cadence'>): OverdueSeverity {
    const daysOverdue = this.getDaysOverdue(item);
    if (daysOverdue <= 0) {
      return {
        label: 'none',
        color: '#90A4AE',
        score: 0,
        daysOverdue
      };
    }

    // Higher task score should escalate severity sooner when overdue.
    // Cadence tuning: chores escalate sooner, long-term work escalates slower.
    const weightedScore = daysOverdue + (this.getTaskScore(item).value - 2) + this.getCadenceOverdueAdjustment(item.cadence);

    if (weightedScore >= 9) {
      return { label: 'critical', color: '#B71C1C', score: weightedScore, daysOverdue };
    }
    if (weightedScore >= 6) {
      return { label: 'high', color: '#D84315', score: weightedScore, daysOverdue };
    }
    if (weightedScore >= 4) {
      return { label: 'elevated', color: '#EF6C00', score: weightedScore, daysOverdue };
    }

    return { label: 'watch', color: '#F9A825', score: weightedScore, daysOverdue };
  }

  private getCadenceOverdueAdjustment(cadence?: TodoItem['cadence']): number {
    if (cadence === 'chore') {
      return 1;
    }
    if (cadence === 'long-term') {
      return -1;
    }
    return 0;
  }

  /**
   * Get active items with score-first ordering and due-date tie-breakers.
   */
  getSortedIncompleteItems(): TodoItem[] {
    return this.sortItems(this.items()).filter(item => !item.completed);
  }

  /**
   * Get completed items ordered by completion grouping and date tie-breakers.
   */
  getSortedCompletedItems(): TodoItem[] {
    return this.sortItems(this.items()).filter(item => item.completed);
  }

  /**
   * Derive a task score from urgency and importance without persisting it.
   */
  getTaskScore(item: Pick<TodoItem, 'urgency' | 'importance'>): TaskScore {
    const urgencyWeight: Record<'time-sensitive' | 'medium' | 'low', number> = {
      'time-sensitive': 3,
      medium: 2,
      low: 1
    };
    const importanceWeight: Record<'high' | 'medium' | 'low', number> = {
      high: 3,
      medium: 2,
      low: 1
    };

    const urgency = item.urgency || 'medium';
    const importance = item.importance || 'medium';
    const value = urgencyWeight[urgency] + importanceWeight[importance];

    if (value >= 6) {
      return { value, label: 'critical' };
    }
    if (value === 5) {
      return { value, label: 'high-focus' };
    }
    if (value === 4) {
      return { value, label: 'planned' };
    }
    if (value === 3) {
      return { value, label: 'routine' };
    }

    return { value, label: 'low-touch' };
  }

  private calculateNextRecurringDueDate(item: TodoItem, completionDate: Date): Date | undefined {
    const baseDate = this.toStartOfDay(completionDate);

    if (item.recurrenceType === 'weekday') {
      const weekday = item.recurrenceWeekday ?? baseDate.getDay();
      const weekInterval = this.getPositiveInteger(item.recurrenceWeekInterval);

      let daysUntil = (weekday - baseDate.getDay() + 7) % 7;
      if (daysUntil === 0) {
        daysUntil = 7;
      }

      const next = new Date(baseDate);
      next.setDate(next.getDate() + daysUntil + (weekInterval - 1) * 7);
      return next;
    }

    if (item.recurrenceType === 'month-day') {
      const monthDay = this.getPositiveInteger(item.recurrenceMonthDay);
      const currentMonthCandidate = this.buildMonthDayDate(baseDate.getFullYear(), baseDate.getMonth(), monthDay);

      if (currentMonthCandidate.getTime() > baseDate.getTime()) {
        return currentMonthCandidate;
      }

      const nextMonthDate = new Date(baseDate.getFullYear(), baseDate.getMonth() + 1, 1);
      return this.buildMonthDayDate(nextMonthDate.getFullYear(), nextMonthDate.getMonth(), monthDay);
    }

    if (item.recurrenceType === 'day-interval') {
      const dayInterval = this.getPositiveInteger(item.recurrenceDayInterval);
      const next = new Date(baseDate);
      next.setDate(next.getDate() + dayInterval);
      return next;
    }

    return item.dueDate ? new Date(item.dueDate) : undefined;
  }

  private buildMonthDayDate(year: number, month: number, requestedDay: number): Date {
    const maxDay = new Date(year, month + 1, 0).getDate();
    const safeDay = Math.min(this.getPositiveInteger(requestedDay), maxDay);
    return new Date(year, month, safeDay);
  }

  private toStartOfDay(date: Date): Date {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  private getPositiveInteger(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 1;
    }
    return Math.floor(parsed);
  }

  /**
   * Save items to localStorage
   */
  private saveToLocalStorage(): void {
    this.localStorageService.setItem(this.STORAGE_KEY, this.items());
  }

  /**
   * Generate a unique ID
   */
  private generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
}
