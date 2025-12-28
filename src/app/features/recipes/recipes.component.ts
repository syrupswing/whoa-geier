import { Component, signal, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { LocalStorageService } from '../../services/local-storage.service';
import { GeminiAiService, RecipeSuggestion } from '../../services/gemini-ai.service';

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

@Component({
  selector: 'app-recipes',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    MatExpansionModule,
    MatProgressSpinnerModule,
    MatSnackBarModule
  ],
  templateUrl: './recipes.component.html',
  styleUrls: ['./recipes.component.scss']
})
export class RecipesComponent implements OnInit {
  private readonly STORAGE_KEY = 'family-command-center-recipes';
  private localStorageService = inject(LocalStorageService);
  private geminiAi = inject(GeminiAiService);
  private snackBar = inject(MatSnackBar);

  recipes = signal<Recipe[]>([
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
  ]);

  searchTerm = '';
  filterTag = '';
  showAddForm = false;
  editingRecipeId: string | null = null;
  
  // AI features
  showAiPrompt = false;
  aiPrompt = '';
  isGeneratingAi = false;
  aiSuggestions = signal<RecipeSuggestion[]>([]);

  ngOnInit(): void {
    this.loadRecipes();
  }

  private loadRecipes(): void {
    const savedRecipes = this.localStorageService.getItem<Recipe[]>(this.STORAGE_KEY);
    if (savedRecipes && savedRecipes.length > 0) {
      this.recipes.set(savedRecipes);
    }
  }

  private saveRecipes(): void {
    this.localStorageService.setItem(this.STORAGE_KEY, this.recipes());
  }
  
  newRecipe = {
    name: '',
    description: '',
    prepTime: 0,
    cookTime: 0,
    servings: 4,
    ingredients: '',
    instructions: '',
    tags: ''
  };

  getFilteredRecipes(): Recipe[] {
    return this.recipes().filter(recipe => {
      const matchesSearch = !this.searchTerm || 
        recipe.name.toLowerCase().includes(this.searchTerm.toLowerCase());
      const matchesTag = !this.filterTag || 
        recipe.tags.some(tag => tag.toLowerCase() === this.filterTag.toLowerCase());
      return matchesSearch && matchesTag;
    });
  }

  getFavoriteRecipes(): Recipe[] {
    return this.recipes().filter(r => r.favorite);
  }

  getAllTags(): string[] {
    const tags = new Set<string>();
    this.recipes().forEach(recipe => {
      recipe.tags.forEach(tag => tags.add(tag));
    });
    return Array.from(tags).sort();
  }

  toggleFavorite(recipeId: string): void {
    const updatedRecipes = this.recipes().map(recipe =>
      recipe.id === recipeId ? { ...recipe, favorite: !recipe.favorite } : recipe
    );
    this.recipes.set(updatedRecipes);
    this.saveRecipes();
  }

  getTotalTime(recipe: Recipe): number {
    return recipe.prepTime + recipe.cookTime;
  }

  toggleAddForm(): void {
    this.showAddForm = !this.showAddForm;
    if (!this.showAddForm) {
      this.resetForm();
    }
  }

  addRecipe(): void {
    if (!this.newRecipe.name.trim()) return;

    const recipe: Recipe = {
      id: Date.now().toString(),
      name: this.newRecipe.name,
      description: this.newRecipe.description,
      prepTime: this.newRecipe.prepTime || 0,
      cookTime: this.newRecipe.cookTime || 0,
      servings: this.newRecipe.servings || 4,
      ingredients: this.newRecipe.ingredients.split('\n').filter(i => i.trim()),
      instructions: this.newRecipe.instructions.split('\n').filter(i => i.trim()),
      tags: this.newRecipe.tags.split(',').map(t => t.trim()).filter(t => t),
      favorite: false
    };

    this.recipes.set([...this.recipes(), recipe]);
    this.saveRecipes();
    this.showAddForm = false;
    this.resetForm();
  }

  resetForm(): void {
    this.newRecipe = {
      name: '',
      description: '',
      prepTime: 0,
      cookTime: 0,
      servings: 4,
      ingredients: '',
      instructions: '',
      tags: ''
    };
    this.editingRecipeId = null;
  }

  editRecipe(recipe: Recipe): void {
    this.editingRecipeId = recipe.id;
    this.newRecipe = {
      name: recipe.name,
      description: recipe.description,
      prepTime: recipe.prepTime,
      cookTime: recipe.cookTime,
      servings: recipe.servings,
      ingredients: recipe.ingredients.join('\n'),
      instructions: recipe.instructions.join('\n'),
      tags: recipe.tags.join(', ')
    };
    this.showAddForm = true;
    // Scroll to form
    setTimeout(() => {
      document.querySelector('.add-form-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  updateRecipe(): void {
    if (!this.newRecipe.name.trim() || !this.editingRecipeId) return;

    const updatedRecipe: Recipe = {
      id: this.editingRecipeId,
      name: this.newRecipe.name,
      description: this.newRecipe.description,
      prepTime: this.newRecipe.prepTime || 0,
      cookTime: this.newRecipe.cookTime || 0,
      servings: this.newRecipe.servings || 4,
      ingredients: this.newRecipe.ingredients.split('\n').filter(i => i.trim()),
      instructions: this.newRecipe.instructions.split('\n').filter(i => i.trim()),
      tags: this.newRecipe.tags.split(',').map(t => t.trim()).filter(t => t),
      favorite: this.recipes().find(r => r.id === this.editingRecipeId)?.favorite || false
    };

    this.recipes.set(this.recipes().map(r => r.id === this.editingRecipeId ? updatedRecipe : r));
    this.saveRecipes();
    this.showAddForm = false;
    this.resetForm();
  }

  deleteRecipe(recipeId: string): void {
    if (confirm('Are you sure you want to delete this recipe?')) {
      this.recipes.set(this.recipes().filter(r => r.id !== recipeId));
      this.saveRecipes();
    }
  }

  saveRecipe(): void {
    if (this.editingRecipeId) {
      this.updateRecipe();
    } else {
      this.addRecipe();
    }
  }

  // AI Features
  toggleAiPrompt(): void {
    if (!this.geminiAi.isConfigured()) {
      this.snackBar.open(
        'Gemini AI not configured. Please add your API key to the environment file.',
        'Close',
        { duration: 5000 }
      );
      return;
    }
    this.showAiPrompt = !this.showAiPrompt;
    if (!this.showAiPrompt) {
      this.aiPrompt = '';
      this.aiSuggestions.set([]);
    }
  }

  async generateAiSuggestions(): Promise<void> {
    if (!this.aiPrompt.trim()) {
      this.snackBar.open('Please enter a prompt for AI suggestions', 'Close', { duration: 3000 });
      return;
    }

    this.isGeneratingAi = true;
    this.aiSuggestions.set([]);

    try {
      const suggestions = await this.geminiAi.suggestRecipes(
        this.aiPrompt,
        'You are a helpful cooking assistant for a family. Provide practical, family-friendly recipes.'
      );
      
      this.aiSuggestions.set(suggestions);
      this.snackBar.open(`Generated ${suggestions.length} recipe suggestions!`, 'Close', { duration: 3000 });
    } catch (error: any) {
      console.error('Error generating AI suggestions:', error);
      this.snackBar.open(
        error.message || 'Failed to generate suggestions. Please try again.',
        'Close',
        { duration: 5000 }
      );
    } finally {
      this.isGeneratingAi = false;
    }
  }

  addAiSuggestion(suggestion: RecipeSuggestion): void {
    const recipe: Recipe = {
      id: Date.now().toString(),
      name: suggestion.name,
      description: suggestion.description,
      prepTime: suggestion.prepTime,
      cookTime: suggestion.cookTime,
      servings: suggestion.servings,
      ingredients: suggestion.ingredients,
      instructions: suggestion.instructions,
      tags: suggestion.tags,
      favorite: false
    };

    this.recipes.set([...this.recipes(), recipe]);
    this.saveRecipes();
    this.snackBar.open(`Added "${recipe.name}" to your recipes!`, 'Close', { duration: 3000 });
    
    // Remove from suggestions
    this.aiSuggestions.update(suggestions => 
      suggestions.filter(s => s.name !== suggestion.name)
    );
  }
}
