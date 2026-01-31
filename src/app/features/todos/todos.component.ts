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
import { TodoService, TodoItem } from '../../services/todo.service';

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

  // New item form
  newItem = {
    title: '',
    description: '',
    dueDate: null as Date | null,
    priority: 'medium' as 'low' | 'medium' | 'high',
    category: ''
  };

  // Edit form
  editForm = {
    title: '',
    description: '',
    dueDate: null as Date | null,
    priority: 'medium' as 'low' | 'medium' | 'high',
    category: ''
  };

  priorities = [
    { value: 'low', label: 'Low', color: '#4CAF50' },
    { value: 'medium', label: 'Medium', color: '#FF9800' },
    { value: 'high', label: 'High', color: '#F44336' }
  ];

  constructor(public todoService: TodoService) {}

  ngOnInit(): void {}

  get incompleteTodos(): TodoItem[] {
    return this.todoService.items().filter(item => !item.completed);
  }

  get completedTodos(): TodoItem[] {
    return this.todoService.items().filter(item => item.completed);
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
      description: this.newItem.description.trim() || undefined,
      dueDate: this.newItem.dueDate?.toISOString(),
      priority: this.newItem.priority,
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
      description: item.description || '',
      dueDate: item.dueDate ? new Date(item.dueDate) : null,
      priority: item.priority || 'medium',
      category: item.category || ''
    };
  }

  async saveEdit(id: string): Promise<void> {
    if (!this.editForm.title.trim()) {
      return;
    }

    await this.todoService.updateItem(id, {
      title: this.editForm.title.trim(),
      description: this.editForm.description.trim() || undefined,
      dueDate: this.editForm.dueDate?.toISOString(),
      priority: this.editForm.priority,
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

  async deleteTodo(id: string): Promise<void> {
    if (confirm('Are you sure you want to delete this todo?')) {
      await this.todoService.deleteItem(id);
    }
  }

  isOverdue(item: TodoItem): boolean {
    if (!item.dueDate || item.completed) return false;
    return new Date(item.dueDate) < new Date();
  }

  isDueToday(item: TodoItem): boolean {
    if (!item.dueDate) return false;
    const today = new Date();
    const dueDate = new Date(item.dueDate);
    return today.toDateString() === dueDate.toDateString();
  }

  getPriorityColor(priority?: string): string {
    const p = this.priorities.find(pr => pr.value === priority);
    return p?.color || '#FF9800';
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

  private resetNewItemForm(): void {
    this.newItem = {
      title: '',
      description: '',
      dueDate: null,
      priority: 'medium',
      category: ''
    };
  }
}
