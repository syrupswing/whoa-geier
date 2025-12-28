import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatListModule } from '@angular/material/list';
import { MatInputModule } from '@angular/material/input';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatBadgeModule } from '@angular/material/badge';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { FormControl } from '@angular/forms';
import { Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { GroceryService, GroceryItem } from '../../services/grocery.service';
import { GeminiAiService } from '../../services/gemini-ai.service';

@Component({
  selector: 'app-grocery-list',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    MatCardModule,
    MatListModule,
    MatInputModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    MatBadgeModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatAutocompleteModule
  ],
  templateUrl: './grocery-list.component.html',
  styleUrls: ['./grocery-list.component.scss']
})
export class GroceryListComponent implements OnInit {
  newItemName = '';
  itemControl = new FormControl('');
  filteredItems!: Observable<string[]>;
  itemLocations = new Map<string, string>();
  itemCategories = new Map<string, string>();
  loadingLocations = new Set<string>();
  isSortingByStore = false;
  isSorting = false;
  private geminiAi = inject(GeminiAiService);
  private snackBar = inject(MatSnackBar);
  
  // Typical grocery store section order
  private storeSectionOrder = [
    'Produce',
    'Bakery',
    'Deli/Meat',
    'Dairy',
    'Frozen',
    'Canned Goods',
    'Dry Goods',
    'Condiments',
    'Snacks',
    'Beverages',
    'Health/Beauty',
    'Household',
    'Other'
  ];

  constructor(public groceryService: GroceryService) {}

  ngOnInit(): void {
    // Service automatically loads items
    
    // Set up autocomplete filtering
    this.filteredItems = this.itemControl.valueChanges.pipe(
      startWith(''),
      map(value => this._filterItems(value || ''))
    );
  }

  async preloadLocations(): Promise<void> {
    if (!this.geminiAi.isConfigured()) {
      return;
    }

    // Wait a bit for items to load
    setTimeout(async () => {
      const items = this.activeItems;
      
      // Load locations with a delay between each request to avoid rate limiting
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (!this.itemLocations.has(item.id)) {
          // Add delay between requests (300ms each)
          await new Promise(resolve => setTimeout(resolve, i * 300));
          
          this.getStoreLocation(item).catch(err => {
            console.warn(`Failed to preload location for ${item.name}:`, err);
          });
        }
      }
    }, 500);
  }

  async addItem(): Promise<void> {
    const itemName = this.itemControl.value?.trim() || '';
    if (itemName) {
      await this.groceryService.addItem(itemName);
      this.itemControl.setValue('');
      this.newItemName = '';
    }
  }

  private _filterItems(value: string): string[] {
    const filterValue = value.toLowerCase();
    const completedItemNames = this.getUniqueCompletedItemNames();
    
    return completedItemNames.filter(item => 
      item.toLowerCase().includes(filterValue)
    );
  }

  private getUniqueCompletedItemNames(): string[] {
    const names = this.completedItems.map(item => item.name);
    // Return unique names only
    return Array.from(new Set(names)).sort();
  }

  async deleteItem(id: string): Promise<void> {
    await this.groceryService.deleteItem(id);
  }

  async toggleItem(id: string): Promise<void> {
    await this.groceryService.toggleItem(id);
  }
  
  async sortByStoreLayout(): Promise<void> {
    if (!this.geminiAi.isConfigured()) {
      this.snackBar.open(
        'AI is not configured. Add your GitHub token to use this feature.',
        'Close',
        { duration: 4000 }
      );
      return;
    }
    
    if (this.activeItems.length === 0) {
      return;
    }
    
    this.isSorting = true;
    
    try {
      // Categorize items that don't have categories yet
      const itemsToCategorize = this.activeItems.filter(item => !this.itemCategories.has(item.id));
      
      if (itemsToCategorize.length > 0) {
        const itemNames = itemsToCategorize.map(i => i.name).join(', ');
        const prompt = `Categorize these grocery items into store sections. For each item, choose ONE category from this list: ${this.storeSectionOrder.join(', ')}.

Items: ${itemNames}

Return ONLY a JSON object mapping each item name to its category. Example format:
{
  "milk": "Dairy",
  "apples": "Produce",
  "bread": "Bakery"
}`;
        
        const response = await this.geminiAi.generateContent(prompt);
        
        if (response.success) {
          // Parse JSON response
          const jsonMatch = response.text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const categories = JSON.parse(jsonMatch[0]);
            
            // Store categories for each item
            itemsToCategorize.forEach(item => {
              const category = categories[item.name];
              if (category) {
                this.itemCategories.set(item.id, category);
              }
            });
          }
        }
      }
      
      // Enable sorting mode
      this.isSortingByStore = true;
      this.snackBar.open(
        'Items sorted by store layout! Toggle off to restore original order.',
        'Close',
        { duration: 3000 }
      );
      
    } catch (error: any) {
      console.error('Error sorting by store layout:', error);
      this.snackBar.open(
        'Failed to sort items. Please try again.',
        'Close',
        { duration: 3000 }
      );
    } finally {
      this.isSorting = false;
    }
  }
  
  toggleStoreSort(): void {
    this.isSortingByStore = !this.isSortingByStore;
  }

  async clearCompleted(): Promise<void> {
    if (confirm('Delete all completed items?')) {
      await this.groceryService.clearCompleted();
    }
  }

  get activeItems(): GroceryItem[] {
    const items = this.groceryService.getActiveItems();
    
    if (!this.isSortingByStore) {
      return items;
    }
    
    // Sort by store section order
    return items.sort((a, b) => {
      const catA = this.itemCategories.get(a.id) || 'Other';
      const catB = this.itemCategories.get(b.id) || 'Other';
      
      const indexA = this.storeSectionOrder.indexOf(catA);
      const indexB = this.storeSectionOrder.indexOf(catB);
      
      return indexA - indexB;
    });
  }

  get completedItems(): GroceryItem[] {
    return this.groceryService.getCompletedItems();
  }

  async getStoreLocation(item: GroceryItem): Promise<void> {
    if (!this.geminiAi.isConfigured()) {
      this.snackBar.open(
        'Gemini AI is not configured. Add your API key to use this feature.',
        'Close',
        { duration: 4000 }
      );
      return;
    }

    // If already loaded or currently loading, don't fetch again
    if (this.itemLocations.has(item.id) || this.loadingLocations.has(item.id)) {
      return;
    }

    this.loadingLocations.add(item.id);

    try {
      const prompt = `In which aisle or section of a grocery store would I typically find "${item.name}"? Give a brief, specific answer in one sentence. For example: "Produce section" or "Dairy aisle, near the milk" or "Baking aisle, with flour and sugar".`;
      
      const response = await this.geminiAi.generateContent(prompt);
      
      if (response.success) {
        this.itemLocations.set(item.id, response.text.trim());
      } else {
        throw new Error(response.error || 'Failed to get location');
      }
    } catch (error: any) {
      console.error('Error getting store location:', error);
      this.snackBar.open(
        'Failed to get store location. Please try again.',
        'Close',
        { duration: 3000 }
      );
    } finally {
      this.loadingLocations.delete(item.id);
    }
  }

  getLocationTooltip(item: GroceryItem): string {
    if (this.loadingLocations.has(item.id)) {
      return 'Finding location...';
    }
    const location = this.itemLocations.get(item.id);
    return location || 'Click to find in store';
  }

  isLoadingLocation(itemId: string): boolean {
    return this.loadingLocations.has(itemId);
  }
}
