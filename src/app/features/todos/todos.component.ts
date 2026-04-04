import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatSelectModule } from '@angular/material/select';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { TodoService, TodoItem } from '../../services/todo.service';
import { MATERIAL_ICONS } from '../../shared/material-icons';

type UrgencyType = 'hard-deadline' | 'soft-deadline' | 'hard-start-date' | 'soft-start-date' | 'hard-recurring' | 'soft-recurring';

@Component({
  selector: 'app-todos',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatSelectModule,
    MatAutocompleteModule,
    MatChipsModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatExpansionModule
  ],
  templateUrl: './todos.component.html',
  styleUrls: ['./todos.component.scss']
})
export class TodosComponent implements OnInit {
  showAddForm = false;
  editingItemId: string | null = null;
  adjustingCompletionItemId: string | null = null;
  adjustCompletionDate: Date | null = null;

  // New item form
  newItem = {
    title: '',
    icon: '',
    description: '',
    dueDate: null as Date | null,
    urgency: 'soft-deadline' as 'hard-deadline' | 'soft-deadline' | 'hard-start-date' | 'soft-start-date' | 'hard-recurring' | 'soft-recurring',
    importance: 'medium' as 'low' | 'medium' | 'high',
    isRecurring: false,
    recurrenceType: 'weekday' as 'weekday' | 'month-day' | 'day-interval',
    recurrenceWeekday: 1,
    recurrenceWeekInterval: 1,
    recurrenceMonthDay: 1,
    recurrenceDayInterval: 7,
    category: ''
  };

  // Edit form
  editForm = {
    title: '',
    icon: '',
    description: '',
    dueDate: null as Date | null,
    urgency: 'soft-deadline' as 'hard-deadline' | 'soft-deadline' | 'hard-start-date' | 'soft-start-date' | 'hard-recurring' | 'soft-recurring',
    importance: 'medium' as 'low' | 'medium' | 'high',
    isRecurring: false,
    recurrenceType: 'weekday' as 'weekday' | 'month-day' | 'day-interval',
    recurrenceWeekday: 1,
    recurrenceWeekInterval: 1,
    recurrenceMonthDay: 1,
    recurrenceDayInterval: 7,
    category: ''
  };

  urgencyLevels = [
    { value: 'hard-deadline', label: 'Hard deadline', color: '#D32F2F' },
    { value: 'soft-deadline', label: 'Soft deadline', color: '#F57C00' },
    { value: 'hard-start-date', label: 'Hard start date', color: '#C62828' },
    { value: 'soft-start-date', label: 'Soft start date', color: '#E65100' },
    { value: 'hard-recurring', label: 'Hard recurring', color: '#6A1B9A' },
    { value: 'soft-recurring', label: 'Soft recurring', color: '#AB47BC' }
  ];

  importanceLevels = [
    { value: 'low', label: 'Low', color: '#607D8B' },
    { value: 'medium', label: 'Medium', color: '#1976D2' },
    { value: 'high', label: 'High', color: '#C62828' }
  ];

  weekdays = [
    { value: 0, label: 'Sunday' },
    { value: 1, label: 'Monday' },
    { value: 2, label: 'Tuesday' },
    { value: 3, label: 'Wednesday' },
    { value: 4, label: 'Thursday' },
    { value: 5, label: 'Friday' },
    { value: 6, label: 'Saturday' }
  ];

  iconSuggestions = MATERIAL_ICONS;

  constructor(public todoService: TodoService) {}

  ngOnInit(): void {}

  get incompleteTodos(): TodoItem[] {
    return this.todoService.getSortedIncompleteItems();
  }

  get completedTodos(): TodoItem[] {
    return this.todoService.getSortedCompletedItems();
  }

  get overdueTodos(): TodoItem[] {
    return this.todoService.getOverdueItems();
  }

  toggleAddForm(): void {
    this.showAddForm = !this.showAddForm;
    if (!this.showAddForm) {
      this.resetNewItemForm();
    }
  }

  async addTodo(): Promise<void> {
    if (!this.newItem.title.trim()) {
      return;
    }

    await this.todoService.addItem({
      title: this.newItem.title.trim(),
      icon: this.newItem.icon.trim() || undefined,
      description: this.newItem.description.trim() || undefined,
      dueDate: this.newItem.dueDate?.toISOString(),
      urgency: this.newItem.urgency as UrgencyType,
      importance: this.newItem.importance,
      isRecurring: this.newItem.isRecurring,
      recurrenceType: this.newItem.isRecurring ? this.newItem.recurrenceType : undefined,
      recurrenceWeekday: this.newItem.isRecurring && this.newItem.recurrenceType === 'weekday' ? this.newItem.recurrenceWeekday : undefined,
      recurrenceWeekInterval: this.newItem.isRecurring && this.newItem.recurrenceType === 'weekday' ? this.getPositiveInteger(this.newItem.recurrenceWeekInterval) : undefined,
      recurrenceMonthDay: this.newItem.isRecurring && this.newItem.recurrenceType === 'month-day' ? this.newItem.recurrenceMonthDay : undefined,
      recurrenceDayInterval: this.newItem.isRecurring && this.newItem.recurrenceType === 'day-interval' ? this.newItem.recurrenceDayInterval : undefined,
      category: this.newItem.category.trim() || undefined,
      completed: false
    });

    this.resetNewItemForm();
    this.showAddForm = false;
  }

  startEdit(item: TodoItem): void {
    this.editingItemId = item.id;
    this.editForm = {
      title: item.title,
      icon: item.icon || '',
      description: item.description || '',
      dueDate: item.dueDate ? new Date(item.dueDate) : null,
      urgency: item.urgency || 'soft-deadline',
      importance: item.importance || 'medium',
      isRecurring: !!item.isRecurring,
      recurrenceType: item.recurrenceType || 'weekday',
      recurrenceWeekday: item.recurrenceWeekday ?? 1,
      recurrenceWeekInterval: item.recurrenceWeekInterval ?? 1,
      recurrenceMonthDay: item.recurrenceMonthDay ?? 1,
      recurrenceDayInterval: item.recurrenceDayInterval ?? 7,
      category: item.category || ''
    };
  }

  async saveEdit(id: string): Promise<void> {
    if (!this.editForm.title.trim()) {
      return;
    }

    await this.todoService.updateItem(id, {
      title: this.editForm.title.trim(),
      icon: this.editForm.icon.trim() || undefined,
      description: this.editForm.description.trim() || undefined,
      dueDate: this.editForm.dueDate?.toISOString(),
      urgency: this.editForm.urgency as UrgencyType,
      importance: this.editForm.importance,
      isRecurring: this.editForm.isRecurring,
      recurrenceType: this.editForm.isRecurring ? this.editForm.recurrenceType : undefined,
      recurrenceWeekday: this.editForm.isRecurring && this.editForm.recurrenceType === 'weekday' ? this.editForm.recurrenceWeekday : undefined,
      recurrenceWeekInterval: this.editForm.isRecurring && this.editForm.recurrenceType === 'weekday' ? this.getPositiveInteger(this.editForm.recurrenceWeekInterval) : undefined,
      recurrenceMonthDay: this.editForm.isRecurring && this.editForm.recurrenceType === 'month-day' ? this.editForm.recurrenceMonthDay : undefined,
      recurrenceDayInterval: this.editForm.isRecurring && this.editForm.recurrenceType === 'day-interval' ? this.editForm.recurrenceDayInterval : undefined,
      ...(this.editForm.isRecurring ? {} : {
        lastRecurringCompletedAt: undefined,
        lastRecurringCompletedByUserId: undefined,
        lastRecurringCompletedByUserName: undefined
      }),
      category: this.editForm.category.trim() || undefined
    });

    this.cancelEdit();
  }

  cancelEdit(): void {
    this.editingItemId = null;
  }

  async toggleComplete(id: string): Promise<void> {
    await this.todoService.toggleComplete(id);
  }

  canToggleComplete(item: TodoItem): boolean {
    return !this.todoService.isCompletionBlocked(item);
  }

  startAdjustCompletion(item: TodoItem): void {
    const existingTimestamp = item.isRecurring ? item.lastRecurringCompletedAt : item.completedAt;
    this.adjustingCompletionItemId = item.id;
    this.adjustCompletionDate = existingTimestamp ? new Date(existingTimestamp) : new Date();
  }

  cancelAdjustCompletion(): void {
    this.adjustingCompletionItemId = null;
    this.adjustCompletionDate = null;
  }

  async saveAdjustedCompletionDate(item: TodoItem): Promise<void> {
    if (!this.adjustCompletionDate) {
      return;
    }

    await this.todoService.setActualCompletionTime(item.id, this.adjustCompletionDate);
    this.cancelAdjustCompletion();
  }

  isAdjustingCompletion(item: TodoItem): boolean {
    return this.adjustingCompletionItemId === item.id;
  }

  async deleteTodo(id: string): Promise<void> {
    if (confirm('Are you sure you want to delete this todo?')) {
      await this.todoService.deleteItem(id);
    }
  }

  isOverdue(item: TodoItem): boolean {
    return this.todoService.getDaysOverdue(item) > 0;
  }

  getDaysOverdue(item: TodoItem): number {
    return this.todoService.getDaysOverdue(item);
  }

  getOverdueSeverityColor(item: TodoItem): string {
    return this.todoService.getOverdueSeverity(item).color;
  }

  getOverdueSeverityLabel(item: TodoItem): string {
    return this.todoService.getOverdueSeverity(item).label;
  }

  isDueToday(item: TodoItem): boolean {
    if (!item.dueDate) return false;
    const today = new Date();
    const dueDate = new Date(item.dueDate);
    return today.toDateString() === dueDate.toDateString();
  }

  getUrgencyColor(urgency?: string): string {
    const value = this.urgencyLevels.find(level => level.value === urgency);
    return value?.color || '#F57C00';
  }

  getImportanceColor(importance?: string): string {
    const value = this.importanceLevels.find(level => level.value === importance);
    return value?.color || '#1976D2';
  }

  getTaskScoreLabel(item: TodoItem): string {
    const score = this.todoService.getTaskScore(item);
    return `${score.label} (${score.value})`;
  }

  getTaskScoreColor(item: TodoItem): string {
    const score = this.todoService.getTaskScore(item);
    switch (score.label) {
      case 'critical':
        return '#B71C1C';
      case 'high-focus':
        return '#D84315';
      case 'planned':
        return '#2E7D32';
      case 'routine':
        return '#1565C0';
      default:
        return '#546E7A';
    }
  }

  formatDate(dateString?: string): string {
    if (!dateString) return '';
    const date = new Date(dateString);
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === tomorrow.toDateString()) {
      return 'Tomorrow';
    } else {
      return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
  }

  getCompletionDaysAgoText(dateString?: string): string {
    const daysAgo = this.getDaysAgo(dateString);
    if (daysAgo === null) {
      return 'recently';
    }

    return `${daysAgo} day${daysAgo === 1 ? '' : 's'} ago`;
  }

  getCompletionUserFirstName(userName?: string, userId?: string): string {
    return this.getFirstName(userName || userId);
  }

  getExactDateTooltip(dateString?: string): string {
    if (!dateString) {
      return '';
    }

    const date = new Date(dateString);
    if (Number.isNaN(date.getTime())) {
      return '';
    }

    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  }

  private getDaysAgo(dateString?: string): number | null {
    if (!dateString) {
      return null;
    }

    const completed = new Date(dateString);
    if (Number.isNaN(completed.getTime())) {
      return null;
    }

    const completedDay = new Date(completed);
    completedDay.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diffMs = today.getTime() - completedDay.getTime();
    return Math.max(0, Math.floor(diffMs / (1000 * 60 * 60 * 24)));
  }

  private getFirstName(identity?: string): string {
    if (!identity) {
      return 'Unknown';
    }

    const trimmed = identity.trim();
    if (!trimmed) {
      return 'Unknown';
    }

    const base = trimmed.includes('@') ? trimmed.split('@')[0] : trimmed;
    const normalized = base.replace(/[._-]+/g, ' ').trim();
    const first = normalized.split(/\s+/)[0];

    if (!first) {
      return 'Unknown';
    }

    return first.charAt(0).toUpperCase() + first.slice(1);
  }

  getRecurrenceSummary(item: TodoItem): string {
    if (!item.isRecurring || !item.recurrenceType) {
      return '';
    }

    if (item.recurrenceType === 'weekday') {
      const weekInterval = this.getPositiveInteger(item.recurrenceWeekInterval);
      const weekdayLabel = this.getWeekdayLabel(item.recurrenceWeekday);
      if (weekInterval === 1) {
        return `Every week on ${weekdayLabel}`;
      }
      return `Every ${weekInterval} weeks on ${weekdayLabel}`;
    }

    if (item.recurrenceType === 'month-day') {
      return `Monthly on day ${item.recurrenceMonthDay || 1}`;
    }

    return `Every ${item.recurrenceDayInterval || 1} day(s)`;
  }

  getFilteredIconSuggestions(value: string): string[] {
    const query = (value || '').trim().toLowerCase();
    if (!query) {
      return this.iconSuggestions;
    }
    return this.iconSuggestions
      .filter(icon => icon.toLowerCase().includes(query));
  }

  onNewRecurringChange(isRecurring: boolean): void {
    if (!isRecurring) {
      this.newItem.recurrenceType = 'weekday';
      this.newItem.recurrenceWeekday = 1;
      this.newItem.recurrenceWeekInterval = 1;
      this.newItem.recurrenceMonthDay = 1;
      this.newItem.recurrenceDayInterval = 7;
    }
  }

  onEditRecurringChange(isRecurring: boolean): void {
    if (!isRecurring) {
      this.editForm.recurrenceType = 'weekday';
      this.editForm.recurrenceWeekday = 1;
      this.editForm.recurrenceWeekInterval = 1;
      this.editForm.recurrenceMonthDay = 1;
      this.editForm.recurrenceDayInterval = 7;
    }
  }

  private getWeekdayLabel(weekday?: number): string {
    const day = this.weekdays.find(w => w.value === weekday);
    return day?.label || 'Monday';
  }

  private getPositiveInteger(value: unknown): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed < 1) {
      return 1;
    }
    return Math.floor(parsed);
  }

  private resetNewItemForm(): void {
    this.newItem = {
      title: '',
      icon: '',
      description: '',
      dueDate: null,
      urgency: 'soft-deadline',
      importance: 'medium',
      isRecurring: false,
      recurrenceType: 'weekday',
      recurrenceWeekday: 1,
      recurrenceWeekInterval: 1,
      recurrenceMonthDay: 1,
      recurrenceDayInterval: 7,
      category: ''
    };
  }
}
