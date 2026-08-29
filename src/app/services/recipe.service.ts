import { Injectable, inject, signal } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { LocalStorageService } from './local-storage.service';

export interface Recipe {
  id: string;
  name: string;
  description: string;
  prepTime: number;
  cookTime: number;
  servings: number;
  ingredients: string[];
  instructions: string[];
  tags: string[];
  imageUrl?: string;
  favorite: boolean;
}

export interface RecipeSuggestion {
  name: string;
  description: string;
  prepTime: number;
  cookTime: number;
  servings: number;
  ingredients: string[];
  instructions: string[];
  tags: string[];
}

const SAMPLE_RECIPES: Recipe[] = [
  {
    id: '1',
    name: 'Spaghetti Carbonara',
    description: 'Classic Italian pasta dish with eggs, cheese, and bacon',
    prepTime: 10,
    cookTime: 20,
    servings: 4,
    ingredients: [
      '400g spaghetti',
      '200g bacon or pancetta',
      '4 eggs',
      '100g Parmesan cheese',
      'Black pepper',
      'Salt'
    ],
    instructions: [
      'Cook pasta according to package directions',
      'Fry bacon until crispy',
      'Beat eggs with grated cheese',
      'Drain pasta and mix with bacon',
      'Remove from heat and stir in egg mixture',
      'Season with pepper and serve'
    ],
    tags: ['Italian', 'Pasta', 'Quick'],
    favorite: true
  },
  {
    id: '2',
    name: 'Chicken Stir Fry',
    description: 'Quick and healthy Asian-inspired dish',
    prepTime: 15,
    cookTime: 15,
    servings: 4,
    ingredients: [
      '500g chicken breast',
      'Mixed vegetables',
      'Soy sauce',
      'Garlic',
      'Ginger',
      'Rice'
    ],
    instructions: [
      'Cut chicken into bite-sized pieces',
      'Heat wok with oil',
      'Cook chicken until golden',
      'Add vegetables and stir fry',
      'Add soy sauce and seasonings',
      'Serve over rice'
    ],
    tags: ['Asian', 'Healthy', 'Quick'],
    favorite: false
  }
];

@Injectable({
  providedIn: 'root'
})
export class RecipeService {
  private firestoreService = inject(FirestoreService);
  private localStorageService = inject(LocalStorageService);

  private readonly COLLECTION_NAME = 'recipes';
  private readonly LOCAL_STORAGE_KEY = 'family-command-center-recipes';

  recipes = signal<Recipe[]>([]);
  isLoading = signal<boolean>(false);

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    this.isLoading.set(true);
    try {
      if (this.firestoreService.isInitialized()) {
        await this.migrateFromLocalStorageIfEmpty();
        this.firestoreService.subscribeToCollection<Recipe>(
          this.COLLECTION_NAME, (items) => this.recipes.set(items)
        );
      } else {
        this.loadFromLocalStorage();
      }
    } finally {
      this.isLoading.set(false);
    }
  }

  // One-time move of whatever this device had saved locally (or the sample recipes for a
  // brand-new install) into Firestore, so Firestore becomes the single source of truth
  // instead of each device keeping its own separate recipe list.
  private async migrateFromLocalStorageIfEmpty(): Promise<void> {
    const existing = await this.firestoreService.getCollection<Recipe>(this.COLLECTION_NAME);
    if (existing.length > 0) return;

    const seed = this.localStorageService.getItem<Recipe[]>(this.LOCAL_STORAGE_KEY) || SAMPLE_RECIPES;
    await Promise.all(
      seed.map(recipe => this.firestoreService.setDocument(this.COLLECTION_NAME, recipe.id, recipe))
    );
  }

  private loadFromLocalStorage(): void {
    const saved = this.localStorageService.getItem<Recipe[]>(this.LOCAL_STORAGE_KEY);
    this.recipes.set(saved && saved.length > 0 ? saved : SAMPLE_RECIPES);
  }

  private saveToLocalStorage(recipes: Recipe[]): void {
    this.localStorageService.setItem(this.LOCAL_STORAGE_KEY, recipes);
  }

  getFavorites(): Recipe[] {
    return this.recipes().filter(r => r.favorite);
  }

  getAllTags(): string[] {
    const tags = new Set<string>();
    this.recipes().forEach(recipe => recipe.tags.forEach(tag => tags.add(tag)));
    return Array.from(tags).sort();
  }

  async addRecipe(recipe: Omit<Recipe, 'id'>): Promise<void> {
    const newRecipe: Recipe = { ...recipe, id: crypto.randomUUID() };
    if (this.firestoreService.isInitialized()) {
      await this.firestoreService.setDocument(this.COLLECTION_NAME, newRecipe.id, newRecipe);
    } else {
      const updated = [...this.recipes(), newRecipe];
      this.recipes.set(updated);
      this.saveToLocalStorage(updated);
    }
  }

  async updateRecipe(id: string, updates: Partial<Omit<Recipe, 'id'>>): Promise<void> {
    if (this.firestoreService.isInitialized()) {
      await this.firestoreService.updateDocument(this.COLLECTION_NAME, id, updates);
    } else {
      const updated = this.recipes().map(r => r.id === id ? { ...r, ...updates } : r);
      this.recipes.set(updated);
      this.saveToLocalStorage(updated);
    }
  }

  async deleteRecipe(id: string): Promise<void> {
    if (this.firestoreService.isInitialized()) {
      await this.firestoreService.deleteDocument(this.COLLECTION_NAME, id);
    } else {
      const updated = this.recipes().filter(r => r.id !== id);
      this.recipes.set(updated);
      this.saveToLocalStorage(updated);
    }
  }
}
