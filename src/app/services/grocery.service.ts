import { Injectable, signal, OnDestroy } from '@angular/core';
import { LocalStorageService } from './local-storage.service';
import { FirestoreService } from './firestore.service';
import { environment } from '../../environments/environment';
import { Unsubscribe } from 'firebase/firestore';

export interface GroceryItem {
  id: string;
  name: string;
  completed: boolean;
  createdAt?: string;
  updatedAt?: string;
}

@Injectable({
  providedIn: 'root'
})
export class GroceryService implements OnDestroy {
  private readonly STORAGE_KEY = 'grocery-items';
  private readonly COLLECTION_NAME = 'groceryItems';
  private firestoreSubscription: Unsubscribe | null = null;

  items = signal<GroceryItem[]>([]);
  isLoading = signal<boolean>(false);
  useFirestore = signal<boolean>(environment.useFirestore);

  constructor(
    private localStorageService: LocalStorageService,
    private firestoreService: FirestoreService
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
        // Use Firestore with real-time updates
        this.subscribeToFirestore();
      } else {
        // Use localStorage
        const items = this.localStorageService.getItem<GroceryItem[]>(this.STORAGE_KEY) || [];
        this.items.set(items);
      }
    } catch (error) {
      console.error('Error loading items:', error);
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Subscribe to Firestore real-time updates
   */
  private subscribeToFirestore(): void {
    this.firestoreSubscription = this.firestoreService.subscribeToCollection<GroceryItem>(
      this.COLLECTION_NAME,
      (items) => {
        this.items.set(items);
      }
    );
  }

  /**
   * Add a new grocery item
   */
  async addItem(name: string): Promise<void> {
    if (!name.trim()) return;

    const trimmedName = name.trim();
    
    // Remove any existing items with the same name (case-insensitive) from both active and completed
    const currentItems = this.items();
    const itemsToRemove = currentItems.filter(
      item => item.name.toLowerCase() === trimmedName.toLowerCase()
    );
    
    // Delete existing duplicates
    if (itemsToRemove.length > 0) {
      if (this.useFirestore() && this.firestoreService.isInitialized()) {
        // Delete from Firestore
        for (const item of itemsToRemove) {
          await this.firestoreService.deleteDocument(this.COLLECTION_NAME, item.id);
        }
      } else {
        // Remove from localStorage
        const filteredItems = currentItems.filter(
          item => item.name.toLowerCase() !== trimmedName.toLowerCase()
        );
        this.items.set(filteredItems);
        this.saveToLocalStorage(filteredItems);
      }
    }

    const newItem: GroceryItem = {
      id: Date.now().toString(),
      name: trimmedName,
      completed: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    if (this.useFirestore() && this.firestoreService.isInitialized()) {
      // Add to Firestore
      const docId = await this.firestoreService.addDocument(this.COLLECTION_NAME, newItem);
      if (docId) {
        newItem.id = docId;
      }
    } else {
      // Add to localStorage
      const currentItems = this.items();
      const updatedItems = [newItem, ...currentItems];
      this.items.set(updatedItems);
      this.saveToLocalStorage(updatedItems);
    }
  }

  /**
   * Update an existing grocery item
   */
  async updateItem(id: string, updates: Partial<GroceryItem>): Promise<void> {
    if (this.useFirestore() && this.firestoreService.isInitialized()) {
      // Update in Firestore
      await this.firestoreService.updateDocument(this.COLLECTION_NAME, id, updates);
    } else {
      // Update in localStorage
      const currentItems = this.items();
      const updatedItems = currentItems.map(item =>
        item.id === id ? { ...item, ...updates, updatedAt: new Date().toISOString() } : item
      );
      this.items.set(updatedItems);
      this.saveToLocalStorage(updatedItems);
    }
  }

  /**
   * Toggle item completion status
   */
  async toggleItem(id: string): Promise<void> {
    const currentItems = this.items();
    const item = currentItems.find(i => i.id === id);
    if (item) {
      await this.updateItem(id, { completed: !item.completed });
    }
  }

  /**
   * Delete a grocery item
   */
  async deleteItem(id: string): Promise<void> {
    if (this.useFirestore() && this.firestoreService.isInitialized()) {
      // Delete from Firestore
      await this.firestoreService.deleteDocument(this.COLLECTION_NAME, id);
    } else {
      // Delete from localStorage
      const currentItems = this.items();
      const updatedItems = currentItems.filter(item => item.id !== id);
      this.items.set(updatedItems);
      this.saveToLocalStorage(updatedItems);
    }
  }

  /**
   * Delete all completed items
   */
  async clearCompleted(): Promise<void> {
    const completedItems = this.items().filter(item => item.completed);
    
    for (const item of completedItems) {
      await this.deleteItem(item.id);
    }
  }

  /**
   * Migrate data from localStorage to Firestore
   */
  async migrateToFirestore(): Promise<void> {
    if (!this.firestoreService.isInitialized()) {
      console.error('Firestore not initialized');
      return;
    }

    const localItems = this.localStorageService.getItem<GroceryItem[]>(this.STORAGE_KEY) || [];
    
    if (localItems.length === 0) {
      console.log('No items to migrate');
      return;
    }

    console.log(`Migrating ${localItems.length} items to Firestore...`);

    for (const item of localItems) {
      await this.firestoreService.addDocument(this.COLLECTION_NAME, item);
    }

    // Clear localStorage after successful migration
    this.localStorageService.removeItem(this.STORAGE_KEY);
    
    // Enable Firestore mode
    this.useFirestore.set(true);
    
    // Subscribe to Firestore
    this.subscribeToFirestore();

    console.log('Migration complete!');
  }

  /**
   * Save items to localStorage
   */
  private saveToLocalStorage(items: GroceryItem[]): void {
    this.localStorageService.setItem(this.STORAGE_KEY, items);
  }

  /**
   * Get active (not completed) items
   */
  getActiveItems(): GroceryItem[] {
    return this.items().filter(item => !item.completed);
  }

  /**
   * Get completed items
   */
  getCompletedItems(): GroceryItem[] {
    return this.items().filter(item => item.completed);
  }
}
