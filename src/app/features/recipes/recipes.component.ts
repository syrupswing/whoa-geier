import { Component, Input, TemplateRef, ViewChild, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { RecipeService, Recipe, RecipeSuggestion } from '../../services/recipe.service';
import { AiOrchestratorService } from '../../services/ai-orchestrator.service';
import { LoadingAnimationComponent } from '../../components/loading-animation/loading-animation.component';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';
import { TypewriterDirective } from '../../shared/typewriter/typewriter.directive';
export type { Recipe };

@Component({
  selector: 'app-recipes',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatChipsModule,
    MatExpansionModule,
    LoadingAnimationComponent,
    MatSnackBarModule,
    GlobalNavMenuComponent,
    TypewriterDirective
  ],
  templateUrl: './recipes.component.html',
  styleUrls: ['./recipes.component.scss']
})
export class RecipesComponent {
  private dialog = inject(MatDialog);
  private dialogRef: MatDialogRef<unknown> | null = null;
  @ViewChild('formDialog') private formDialog?: TemplateRef<unknown>;
  recipeService = inject(RecipeService);
  private aiOrchestrator = inject(AiOrchestratorService);
  private snackBar = inject(MatSnackBar);

  /** Inside the Food page the page supplies the header and search. */
  @Input() embedded = false;
  @Input() searchTerm = '';
  filterTag = '';
  private _showAddForm = false;

  /** Whether the add/edit form is open; it lives in a modal dialog, so setting this opens or closes it. */
  get showAddForm(): boolean {
    return this._showAddForm;
  }
  set showAddForm(open: boolean) {
    this._showAddForm = open;
    if (open && !this.dialogRef && this.formDialog) {
      this.dialogRef = this.dialog.open(this.formDialog, { width: '640px', maxWidth: '95vw', autoFocus: 'first-tabbable' });
      this.dialogRef.afterClosed().subscribe(() => {
        this.dialogRef = null;
        // Dismissed via backdrop or Esc rather than Save/Cancel
        if (this._showAddForm) {
          this._showAddForm = false;
          this.resetForm();
        }
      });
    } else if (!open && this.dialogRef) {
      this.dialogRef.close();
    }
  }
  editingRecipeId: string | null = null;

  // AI features
  showAiPrompt = false;
  aiPrompt = '';
  isGeneratingAi = false;
  aiSuggestions = signal<RecipeSuggestion[]>([]);

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
    return this.recipeService.recipes().filter(recipe => {
      const matchesSearch = !this.searchTerm ||
        recipe.name.toLowerCase().includes(this.searchTerm.toLowerCase());
      const matchesTag = !this.filterTag ||
        recipe.tags.some(tag => tag.toLowerCase() === this.filterTag.toLowerCase());
      return matchesSearch && matchesTag;
    });
  }

  getFavoriteRecipes(): Recipe[] {
    return this.recipeService.getFavorites();
  }

  getAllTags(): string[] {
    return this.recipeService.getAllTags();
  }

  async toggleFavorite(recipeId: string): Promise<void> {
    const recipe = this.recipeService.recipes().find(r => r.id === recipeId);
    if (!recipe) return;
    await this.recipeService.updateRecipe(recipeId, { favorite: !recipe.favorite });
  }

  getTotalTime(recipe: Recipe): number {
    return recipe.prepTime + recipe.cookTime;
  }

  /** Opens the add form; used by the Food page's add button. */
  openAddForm(): void {
    this.showAddForm = true;
  }

  toggleAddForm(): void {
    this.showAddForm = !this.showAddForm;
    if (!this.showAddForm) {
      this.resetForm();
    }
  }

  async addRecipe(): Promise<void> {
    if (!this.newRecipe.name.trim()) return;

    await this.recipeService.addRecipe({
      name: this.newRecipe.name,
      description: this.newRecipe.description,
      prepTime: this.newRecipe.prepTime || 0,
      cookTime: this.newRecipe.cookTime || 0,
      servings: this.newRecipe.servings || 4,
      ingredients: this.newRecipe.ingredients.split('\n').filter(i => i.trim()),
      instructions: this.newRecipe.instructions.split('\n').filter(i => i.trim()),
      tags: this.newRecipe.tags.split(',').map(t => t.trim()).filter(t => t),
      favorite: false
    });

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

  async updateRecipe(): Promise<void> {
    if (!this.newRecipe.name.trim() || !this.editingRecipeId) return;

    await this.recipeService.updateRecipe(this.editingRecipeId, {
      name: this.newRecipe.name,
      description: this.newRecipe.description,
      prepTime: this.newRecipe.prepTime || 0,
      cookTime: this.newRecipe.cookTime || 0,
      servings: this.newRecipe.servings || 4,
      ingredients: this.newRecipe.ingredients.split('\n').filter(i => i.trim()),
      instructions: this.newRecipe.instructions.split('\n').filter(i => i.trim()),
      tags: this.newRecipe.tags.split(',').map(t => t.trim()).filter(t => t)
    });

    this.showAddForm = false;
    this.resetForm();
  }

  async deleteRecipe(recipeId: string): Promise<void> {
    if (confirm('Are you sure you want to delete this recipe?')) {
      await this.recipeService.deleteRecipe(recipeId);
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
      const suggestions = await this.aiOrchestrator.generate<RecipeSuggestion[]>(
        'recipe-suggestions',
        { prompt: this.aiPrompt }
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

  async addAiSuggestion(suggestion: RecipeSuggestion): Promise<void> {
    await this.recipeService.addRecipe({
      name: suggestion.name,
      description: suggestion.description,
      prepTime: suggestion.prepTime,
      cookTime: suggestion.cookTime,
      servings: suggestion.servings,
      ingredients: suggestion.ingredients,
      instructions: suggestion.instructions,
      tags: suggestion.tags,
      favorite: false
    });

    this.snackBar.open(`Added "${suggestion.name}" to your recipes!`, 'Close', { duration: 3000 });

    // Remove from suggestions
    this.aiSuggestions.update(suggestions =>
      suggestions.filter(s => s.name !== suggestion.name)
    );
  }
}
