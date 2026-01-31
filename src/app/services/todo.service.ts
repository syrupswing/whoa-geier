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
  dueDate?: string; // ISO date string
  priority?: 'low' | 'medium' | 'high';
  category?: string;
  userId?: string;
  createdAt?: string;
  updatedAt?: string;
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
        this.items.set(items.sort((a, b) => {
          // Sort by completed status (incomplete first), then by due date, then by created date
          if (a.completed !== b.completed) {
            return a.completed ? 1 : -1;
          }
          if (a.dueDate && b.dueDate) {
            return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
          }
          if (a.dueDate) return -1;
          if (b.dueDate) return 1;
          return (b.createdAt || '').localeCompare(a.createdAt || '');
        }));
        this.isLoading.set(false);
      }
    );
  }

  /**
   * Load items from localStorage
   */
  private loadFromLocalStorage(): void {
    const items = this.localStorageService.getItem<TodoItem[]>(this.STORAGE_KEY) || [];
    this.items.set(items.sort((a, b) => {
      if (a.completed !== b.completed) {
        return a.completed ? 1 : -1;
      }
      if (a.dueDate && b.dueDate) {
        return new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime();
      }
      if (a.dueDate) return -1;
      if (b.dueDate) return 1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    }));
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
      const newCompletedValue = !item.completed;
      console.log(`Toggling todo ${id}: completed ${item.completed} -> ${newCompletedValue}`);
      await this.updateItem(id, { completed: newCompletedValue });
    }
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
    const now = new Date();
    return this.items().filter(item => {
      if (!item.dueDate || item.completed) return false;
      return new Date(item.dueDate) < now;
    });
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
