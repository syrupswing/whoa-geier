import { Injectable, signal, computed, inject } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { LocalStorageService } from './local-storage.service';

export interface QuickLink {
  id: string;
  title: string;
  subtitle?: string;
  icon: string;
  url: string;
  isExternal: boolean;
  isEditable: boolean;
  order?: number;
  createdAt?: Date;
}

@Injectable({
  providedIn: 'root'
})
export class QuickLinkService {
  private firestoreService = inject(FirestoreService);
  private localStorageService = inject(LocalStorageService);
  
  private readonly COLLECTION_NAME = 'quickLinks';
  private readonly LOCAL_STORAGE_KEY = 'quick-links';
  
  private links = signal<QuickLink[]>([]);
  isLoading = signal<boolean>(false);
  
  // Hardcoded links that cannot be edited
  private readonly SYSTEM_LINKS: QuickLink[] = [
    {
      id: 'pickup-patrol',
      title: 'PickUp Patrol',
      subtitle: 'School attendance for Remi',
      icon: 'directions_bus',
      url: 'https://app.pickuppatrol.net/parents/',
      isExternal: true,
      isEditable: false,
      order: 0
    },
    {
      id: 'lake-harriet',
      title: 'Lake Harriet School',
      subtitle: 'Homepage for LHS',
      icon: 'school',
      url: 'https://lakeharriet.mpschools.org/',
      isExternal: true,
      isEditable: false,
      order: 1
    },
    {
      id: 'recipes',
      title: 'Recipes',
      icon: 'chef_hat',
      url: '/recipes',
      isExternal: false,
      isEditable: false,
      order: 2
    },
    {
      id: 'restaurants',
      title: 'Restaurants and delivery',
      icon: 'local_dining',
      url: '/restaurants',
      isExternal: false,
      isEditable: false,
      order: 3
    },
    {
      id: 'quick-links-page',
      title: 'Quick Links',
      icon: 'link',
      url: '/quick-links',
      isExternal: false,
      isEditable: false,
      order: 4
    },
    {
      id: 'calendar',
      title: 'Calendar',
      subtitle: 'Family events',
      icon: 'event',
      url: '/calendar',
      isExternal: false,
      isEditable: false,
      order: 5
    },
    {
      id: 'todos',
      title: 'To-Do List',
      subtitle: 'Tasks & reminders',
      icon: 'checklist',
      url: '/todos',
      isExternal: false,
      isEditable: false,
      order: 6
    },
    {
      id: 'vehicles',
      title: 'Vehicles',
      subtitle: 'Maintenance tracking',
      icon: 'directions_car',
      url: '/vehicles',
      isExternal: false,
      isEditable: false,
      order: 7
    },
    {
      id: 'remi-world',
      title: "Remi's World",
      subtitle: 'Learn & play!',
      icon: 'deployed_code',
      url: '/remi-world',
      isExternal: false,
      isEditable: false,
      order: 8
    }
  ];
  
  // Get all links (system + user) sorted by order
  allLinks = computed(() => {
    const userLinks = this.links();
    const combined = [...this.SYSTEM_LINKS, ...userLinks];
    return combined.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
  });
  
  // Get only user-generated links
  userLinks = computed(() => this.links().filter(link => link.isEditable));
  
  // Check if using Firestore
  useFirestore = computed(() => this.firestoreService.isInitialized());

  constructor() {
    this.loadLinks();
  }

  private async loadLinks(): Promise<void> {
    this.isLoading.set(true);
    
    try {
      if (this.firestoreService.isInitialized()) {
        await this.loadFromFirestore();
      } else {
        this.loadFromLocalStorage();
      }
    } catch (error) {
      console.error('Error loading quick links:', error);
      this.loadFromLocalStorage();
    } finally {
      this.isLoading.set(false);
    }
  }

  private async loadFromFirestore(): Promise<void> {
    this.firestoreService.subscribeToCollection<QuickLink>(
      this.COLLECTION_NAME,
      (links) => {
        const linksWithDates = links.map(link => ({
          ...link,
          createdAt: link.createdAt || new Date()
        }));
        this.links.set(linksWithDates);
        this.saveToLocalStorage(linksWithDates);
      }
    );
  }

  private loadFromLocalStorage(): void {
    const saved = this.localStorageService.getItem<QuickLink[]>(this.LOCAL_STORAGE_KEY);
    if (saved) {
      this.links.set(saved);
    }
  }

  private saveToLocalStorage(links: QuickLink[]): void {
    this.localStorageService.setItem(this.LOCAL_STORAGE_KEY, links);
  }

  async addLink(link: Omit<QuickLink, 'id' | 'isEditable' | 'createdAt'>): Promise<void> {
    const newLink: QuickLink = {
      ...link,
      id: crypto.randomUUID(),
      isEditable: true,
      createdAt: new Date(),
      order: link.order ?? this.allLinks().length
    };

    if (this.firestoreService.isInitialized()) {
      await this.firestoreService.setDocument(this.COLLECTION_NAME, newLink.id, newLink);
    } else {
      const currentLinks = this.links();
      const updatedLinks = [...currentLinks, newLink];
      this.links.set(updatedLinks);
      this.saveToLocalStorage(updatedLinks);
    }
  }

  async updateLink(id: string, updates: Partial<QuickLink>): Promise<void> {
    const link = this.links().find(l => l.id === id);
    if (!link?.isEditable) {
      throw new Error('Cannot edit system links');
    }

    if (this.firestoreService.isInitialized()) {
      await this.firestoreService.updateDocument(this.COLLECTION_NAME, id, updates);
    } else {
      const currentLinks = this.links();
      const updatedLinks = currentLinks.map(l =>
        l.id === id ? { ...l, ...updates } : l
      );
      this.links.set(updatedLinks);
      this.saveToLocalStorage(updatedLinks);
    }
  }

  async deleteLink(id: string): Promise<void> {
    const link = this.links().find(l => l.id === id);
    if (!link?.isEditable) {
      throw new Error('Cannot delete system links');
    }

    if (this.firestoreService.isInitialized()) {
      await this.firestoreService.deleteDocument(this.COLLECTION_NAME, id);
    } else {
      const currentLinks = this.links();
      const updatedLinks = currentLinks.filter(l => l.id !== id);
      this.links.set(updatedLinks);
      this.saveToLocalStorage(updatedLinks);
    }
  }

  // Common Material Icons for quick links
  readonly COMMON_ICONS = [
    'link', 'star', 'favorite', 'home', 'work', 'school', 'local_grocery_store',
    'restaurant', 'local_dining', 'local_cafe', 'local_bar', 'shopping_cart',
    'sports', 'fitness_center', 'sports_soccer', 'sports_basketball',
    'movie', 'music_note', 'videogame_asset', 'book', 'menu_book',
    'computer', 'phone', 'tablet', 'watch', 'headphones',
    'flight', 'hotel', 'local_gas_station', 'local_atm', 'local_hospital',
    'park', 'beach_access', 'pool', 'spa', 'casino',
    'account_balance', 'account_circle', 'card_giftcard', 'credit_card',
    'store', 'shopping_bag', 'local_mall', 'business', 'domain',
    'language', 'public', 'travel_explore', 'explore', 'map',
    'directions_car', 'directions_bus', 'directions_bike', 'directions_walk',
    'pets', 'child_care', 'toys', 'celebration', 'cake'
  ];
}
