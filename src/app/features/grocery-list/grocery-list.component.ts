import { Component, OnInit, AfterViewChecked, inject, ViewChild, ElementRef, ChangeDetectionStrategy } from '@angular/core';
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
import { MatTooltip, MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatAutocompleteModule } from '@angular/material/autocomplete';
import { MatMenuModule } from '@angular/material/menu';
import { MatSelectModule } from '@angular/material/select';
import { FormControl } from '@angular/forms';
import { Observable } from 'rxjs';
import { map, startWith } from 'rxjs/operators';
import { GroceryService, GroceryItem } from '../../services/grocery.service';
import { GithubAiService } from '../../services/github-ai.service';

interface AutocompleteItem {
  name: string;
  isInActiveList: boolean;
}

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
    MatAutocompleteModule,
    MatMenuModule,
    MatSelectModule
  ],
  templateUrl: './grocery-list.component.html',
  styleUrls: ['./grocery-list.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class GroceryListComponent implements OnInit, AfterViewChecked {
  private readonly CATEGORY_STORAGE_KEY = 'grocery-custom-categories';
  private readonly DEFAULT_EDITABLE_CATEGORIES = ['Hardware', 'Liquor', 'Household', 'Pharmacy'];
  @ViewChild('itemInput') itemInput!: ElementRef<HTMLInputElement>;
  newItemName = '';
  private shouldFocusInput = false;
  newItemQuantity?: number;
  newItemUnit?: string;
  newItemNotes?: string;
  newItemCategory = 'Grocery';
  newItemCategoryManuallySet = false;
  itemControl = new FormControl('');
  filteredItems!: Observable<AutocompleteItem[]>;
  itemLocations = new Map<string, string>();
  itemCategories = new Map<string, string>();
  loadingLocations = new Set<string>();
  isSortingByStore = false;
  isSorting = false;
  showAddItemForm = false;
  showAddItemDetails = false;
  editingItemId: string | null = null;
  editingItemName = '';
  editingItemQuantity?: number;
  editingItemUnit?: string;
  editingItemNotes?: string;
  editingItemCategory = 'Grocery';
  showPastItems = false;
  showCategoryManagerModal = false;
  newCategoryDraft = '';
  editingCategoryOriginal: string | null = null;
  editingCategoryDraft = '';
  baseCategoryOptions = ['Grocery'];
  customCategoryOptions: string[] = [];
  categoryOptions: string[] = [];
  filterOptions: string[] = [];
  selectedFilters: string[] = [];
  
  unitOptions = [
    { value: 'each', label: 'Each' },
    { value: 'oz', label: 'Ounce (oz)' },
    { value: 'lbs', label: 'Pound (lbs)' },
    { value: 'kg', label: 'Kilogram (kg)' },
    { value: 'g', label: 'Gram (g)' },
    { value: 'ml', label: 'Milliliter (ml)' },
    { value: 'l', label: 'Liter (L)' },
    { value: 'cup', label: 'Cup' },
    { value: 'tbsp', label: 'Tablespoon' },
    { value: 'tsp', label: 'Teaspoon' },
    { value: 'dozen', label: 'Dozen' },
    { value: 'pkg', label: 'Package' },
    { value: 'can', label: 'Can' },
    { value: 'bottle', label: 'Bottle' },
    { value: 'box', label: 'Box' },
    { value: 'bag', label: 'Bag' }
  ];
  
  private githubAi = inject(GithubAiService);
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
    this.loadCustomCategories();
    this.refreshCategoryOptions();

    // Service automatically loads items
    
    // Set up autocomplete filtering
    this.filteredItems = this.itemControl.valueChanges.pipe(
      startWith(''),
      map(value => this._filterItems(value || ''))
    );
  }

  showAddForm(): void {
    this.showAddItemForm = true;
    this.showAddItemDetails = false;
    this.shouldFocusInput = true;
    this.newItemCategory = 'Grocery';
    this.newItemCategoryManuallySet = false;
  }

  closeAddForm(): void {
    this.showAddItemForm = false;
    this.showAddItemDetails = false;
    this.itemControl.setValue('');
    this.newItemName = '';
    this.newItemQuantity = undefined;
    this.newItemUnit = undefined;
    this.newItemNotes = undefined;
    this.newItemCategory = 'Grocery';
    this.newItemCategoryManuallySet = false;
  }

  onNewItemCategoryChanged(): void {
    this.newItemCategoryManuallySet = true;
  }

  toggleAddItemDetails(): void {
    this.showAddItemDetails = !this.showAddItemDetails;
  }

  ngAfterViewChecked(): void {
    if (this.shouldFocusInput && this.itemInput?.nativeElement) {
      this.shouldFocusInput = false;
      // Use requestAnimationFrame to ensure DOM is ready
      requestAnimationFrame(() => {
        if (this.itemInput?.nativeElement) {
          this.itemInput.nativeElement.focus();
          // Trigger click for mobile keyboard
          this.itemInput.nativeElement.click();
        }
      });
    }
  }

  async preloadLocations(): Promise<void> {
    if (!this.githubAi.isConfigured()) {
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
      // Capitalize first letter of each word
      const capitalizedName = itemName
        .split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
        .join(' ');
      
      // Convert empty string to undefined for unit
      const unitValue = this.newItemUnit && this.newItemUnit.trim() ? this.newItemUnit : undefined;
      const inferredCategory = this.inferCategoryFromText(capitalizedName, this.newItemNotes);
      const finalCategory = this.newItemCategoryManuallySet ? this.newItemCategory : inferredCategory;
      
      await this.groceryService.addItem(
        capitalizedName,
        this.newItemQuantity,
        unitValue,
        this.newItemNotes,
        finalCategory
      );
      this.closeAddForm();
      this.snackBar.open(`Added "${capitalizedName}" to your list`, 'Close', { duration: 2000 });
    }
  }

  private _filterItems(value: string): AutocompleteItem[] {
    const filterValue = value.toLowerCase().trim();
    
    // Only show autocomplete suggestions if at least one character is entered
    if (!filterValue || filterValue.length === 0) {
      return [];
    }
    
    // Get all unique item names from both active and completed lists
    const activeItemNames = this.activeItems.map(item => item.name);
    const completedItemNames = this.getUniqueCompletedItemNames();
    const activeItemNamesSet = new Set(activeItemNames);
    
    // Combine both lists and remove duplicates
    const allItemNames = new Set([...activeItemNames, ...completedItemNames]);
    
    // Filter and map to AutocompleteItem
    return Array.from(allItemNames)
      .filter(item => item.toLowerCase().includes(filterValue))
      .map(name => ({
        name,
        isInActiveList: activeItemNamesSet.has(name)
      }))
      .sort((a, b) => {
        // Sort: active items first, then alphabetically
        if (a.isInActiveList && !b.isInActiveList) return -1;
        if (!a.isInActiveList && b.isInActiveList) return 1;
        return a.name.localeCompare(b.name);
      });
  }

  private getUniqueCompletedItemNames(): string[] {
    const names = this.completedItems.map(item => item.name);
    // Return unique names only
    return Array.from(new Set(names)).sort();
  }

  async deleteItem(id: string): Promise<void> {
    try {
      await this.groceryService.deleteItem(id);
    } catch (error) {
      console.error('Error deleting item:', error);
      this.snackBar.open('Failed to delete item. Please try again.', 'Close', { duration: 3000 });
    }
  }

  async toggleItem(id: string): Promise<void> {
    try {
      // Get the item before toggling to know its current state
      const allItems = [...this.groceryService.getActiveItems(), ...this.groceryService.getCompletedItems()];
      const item = allItems.find(i => i.id === id);
      
      await this.groceryService.toggleItem(id);
      
      if (item) {
        if (item.completed) {
          // Item was completed, now moving back to active
          this.snackBar.open(`"${item.name}" moved back to shopping list`, 'Close', { duration: 2000 });
        } else {
          // Item was active, now completed - show undo option
          const snackBarRef = this.snackBar.open(
            `"${item.name}" crossed off the list`, 
            'Undo', 
            { duration: 7000 }
          );
          
          snackBarRef.onAction().subscribe(() => {
            this.toggleItem(id);
          });
        }
      }
    } catch (error) {
      console.error('Error toggling item:', error);
      this.snackBar.open('Failed to update item. Please try again.', 'Close', { duration: 3000 });
    }
  }
  
  async sortByStoreLayout(): Promise<void> {
    if (!this.githubAi.isConfigured()) {
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
        
        const response = await this.githubAi.generateContent(prompt);
        
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

  openCategoryManagerModal(): void {
    this.showCategoryManagerModal = true;
  }

  closeCategoryManagerModal(): void {
    this.showCategoryManagerModal = false;
    this.newCategoryDraft = '';
    this.editingCategoryOriginal = null;
    this.editingCategoryDraft = '';
  }

  addCategoryFromModal(): void {
    const category = this.normalizeCategoryName(this.newCategoryDraft);
    if (!category) {
      return;
    }

    if (this.categoryOptions.includes(category)) {
      this.snackBar.open(`Category "${category}" already exists.`, 'Close', { duration: 2500 });
      return;
    }

    this.customCategoryOptions = [...this.customCategoryOptions, category];
    this.saveCustomCategories();
    this.refreshCategoryOptions();
    this.newCategoryDraft = '';
    this.snackBar.open(`Added category "${category}"`, 'Close', { duration: 2000 });
  }

  startCategoryRename(category: string): void {
    if (category === 'Grocery') {
      this.snackBar.open('Grocery is the default category and cannot be renamed.', 'Close', { duration: 2500 });
      return;
    }

    this.editingCategoryOriginal = category;
    this.editingCategoryDraft = category;
  }

  cancelCategoryRename(): void {
    this.editingCategoryOriginal = null;
    this.editingCategoryDraft = '';
  }

  saveCategoryRename(): void {
    if (!this.editingCategoryOriginal) {
      return;
    }

    const oldCategory = this.editingCategoryOriginal;
    const newCategory = this.normalizeCategoryName(this.editingCategoryDraft);
    if (!newCategory || newCategory === oldCategory) {
      this.cancelCategoryRename();
      return;
    }

    if (this.categoryOptions.includes(newCategory)) {
      this.snackBar.open(`Category "${newCategory}" already exists.`, 'Close', { duration: 2500 });
      return;
    }

    this.customCategoryOptions = this.customCategoryOptions.map(c => c === oldCategory ? newCategory : c);
    this.saveCustomCategories();
    this.refreshCategoryOptions();
    this.cancelCategoryRename();
    void this.reassignCategoryOnItems(oldCategory, newCategory);
  }

  deleteCategoryFromModal(category: string): void {
    if (category === 'Grocery') {
      this.snackBar.open('Grocery is the default category and cannot be deleted.', 'Close', { duration: 2500 });
      return;
    }

    const confirmed = confirm(`Delete category "${category}"? Items in this category will move to Grocery.`);
    if (!confirmed) {
      return;
    }

    this.customCategoryOptions = this.customCategoryOptions.filter(c => c !== category);
    this.saveCustomCategories();
    this.refreshCategoryOptions();
    this.cancelCategoryRename();
    void this.reassignCategoryOnItems(category, 'Grocery');
  }

  get hasCustomCategories(): boolean {
    return this.customCategoryOptions.length > 0;
  }

  private refreshCategoryOptions(): void {
    const unique = new Set<string>([...this.baseCategoryOptions, ...this.customCategoryOptions]);
    this.categoryOptions = Array.from(unique);
    this.filterOptions = ['All', ...this.categoryOptions];

    if (this.selectedFilters.length === 0) {
      this.selectedFilters = [...this.categoryOptions];
      return;
    }

    this.selectedFilters = this.selectedFilters.filter(option => this.categoryOptions.includes(option));

    if (this.selectedFilters.length === 0) {
      this.selectedFilters = [...this.categoryOptions];
    }
  }

  get areAllFiltersSelected(): boolean {
    return this.categoryOptions.length > 0 && this.selectedFilters.length === this.categoryOptions.length;
  }

  get isAllFilterIndeterminate(): boolean {
    return this.selectedFilters.length > 0 && !this.areAllFiltersSelected;
  }

  get filterSummaryLabel(): string {
    if (this.areAllFiltersSelected) {
      return 'All';
    }

    if (this.selectedFilters.length === 0) {
      return 'None';
    }

    if (this.selectedFilters.length === 1) {
      return this.selectedFilters[0];
    }

    return `${this.selectedFilters.length} selected`;
  }

  isFilterOptionSelected(option: string): boolean {
    if (option === 'All') {
      return this.areAllFiltersSelected;
    }

    return this.selectedFilters.includes(option);
  }

  toggleFilterOption(option: string, checked: boolean): void {
    if (option === 'All') {
      this.selectedFilters = checked ? [...this.categoryOptions] : [];
      return;
    }

    if (checked) {
      if (!this.selectedFilters.includes(option)) {
        this.selectedFilters = [...this.selectedFilters, option];
      }
      return;
    }

    this.selectedFilters = this.selectedFilters.filter(selected => selected !== option);
  }

  get isAllFilterActive(): boolean {
    return this.areAllFiltersSelected;
  }

  get activeFilterDescription(): string {
    if (this.selectedFilters.length === 0) {
      return 'selected categories';
    }

    if (this.selectedFilters.length === 1) {
      return this.selectedFilters[0].toLowerCase();
    }

    return this.selectedFilters.map(filter => filter.toLowerCase()).join(', ');
  }

  private loadCustomCategories(): void {
    try {
      const stored = localStorage.getItem(this.CATEGORY_STORAGE_KEY);
      if (!stored) {
        this.customCategoryOptions = [...this.DEFAULT_EDITABLE_CATEGORIES];
        this.saveCustomCategories();
        return;
      }

      const parsed = JSON.parse(stored) as string[];
      this.customCategoryOptions = Array.isArray(parsed)
        ? parsed.map(v => this.normalizeCategoryName(v)).filter(v => !!v)
        : [...this.DEFAULT_EDITABLE_CATEGORIES];

      if (this.customCategoryOptions.length === 0) {
        this.customCategoryOptions = [...this.DEFAULT_EDITABLE_CATEGORIES];
        this.saveCustomCategories();
      }
    } catch {
      this.customCategoryOptions = [...this.DEFAULT_EDITABLE_CATEGORIES];
      this.saveCustomCategories();
    }
  }

  private saveCustomCategories(): void {
    localStorage.setItem(this.CATEGORY_STORAGE_KEY, JSON.stringify(this.customCategoryOptions));
  }

  private normalizeCategoryName(value: string): string {
    const trimmed = value.trim().replace(/\s+/g, ' ');
    if (!trimmed) {
      return '';
    }

    return trimmed
      .split(' ')
      .map(token => token.charAt(0).toUpperCase() + token.slice(1).toLowerCase())
      .join(' ');
  }

  private async reassignCategoryOnItems(fromCategory: string, toCategory: string): Promise<void> {
    const allItems = [...this.activeItems, ...this.completedItems];
    const updates = allItems
      .filter(item => (item.category?.trim() || this.inferCategoryFromText(item.name, item.notes)) === fromCategory)
      .map(item => this.groceryService.updateItem(item.id, { category: toCategory }));

    if (updates.length === 0) {
      return;
    }

    try {
      await Promise.all(updates);
      this.snackBar.open(`Moved ${updates.length} item(s) to ${toCategory}.`, 'Close', { duration: 2500 });
    } catch {
      this.snackBar.open('Could not update all item categories. Please try again.', 'Close', { duration: 3000 });
    }
  }

  togglePastItemsVisibility(): void {
    this.showPastItems = !this.showPastItems;
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
    return [...items].sort((a, b) => {
      const catA = this.itemCategories.get(a.id) || 'Other';
      const catB = this.itemCategories.get(b.id) || 'Other';
      
      const indexA = this.storeSectionOrder.indexOf(catA);
      const indexB = this.storeSectionOrder.indexOf(catB);
      
      return indexA - indexB;
    });
  }

  get displayedActiveItems(): GroceryItem[] {
    return this.activeItems.filter(item => this.matchesFilter(item));
  }

  get completedItems(): GroceryItem[] {
    return this.groceryService.getCompletedItems();
  }

  get displayedCompletedItems(): GroceryItem[] {
    return this.completedItems.filter(item => this.matchesFilter(item));
  }

  trackByItemId(_index: number, item: GroceryItem): string {
    return item.id;
  }

  private matchesFilter(item: GroceryItem): boolean {
    if (this.areAllFiltersSelected) {
      return true;
    }

    if (this.selectedFilters.length === 0) {
      return false;
    }

    return this.selectedFilters.includes(this.getEffectiveCategory(item));
  }

  private getEffectiveCategory(item: GroceryItem): string {
    const persistedCategory = item.category?.trim();
    if (persistedCategory) {
      return persistedCategory;
    }

    return this.inferCategoryFromText(item.name, item.notes);
  }

  private inferCategoryFromText(name: string, notes?: string): string {
    const text = `${name} ${notes ?? ''}`.toLowerCase();

    const hardwareKeywords = [
      'nail', 'screw', 'bolt', 'hammer', 'drill', 'paint', 'tape', 'tool', 'lumber', 'glue', 'light bulb', 'extension cord'
    ];
    if (hardwareKeywords.some(keyword => text.includes(keyword))) {
      return 'Hardware';
    }

    const liquorKeywords = [
      'beer', 'wine', 'vodka', 'whiskey', 'tequila', 'rum', 'gin', 'champagne', 'bourbon', 'liquor'
    ];
    if (liquorKeywords.some(keyword => text.includes(keyword))) {
      return 'Liquor';
    }

    const householdKeywords = [
      'detergent', 'paper towel', 'toilet paper', 'trash bag', 'dish soap', 'cleaner', 'bleach', 'sponge', 'battery', 'foil'
    ];
    if (householdKeywords.some(keyword => text.includes(keyword))) {
      return 'Household';
    }

    const pharmacyKeywords = [
      'medicine', 'vitamin', 'ibuprofen', 'acetaminophen', 'bandage', 'first aid', 'cough', 'allergy', 'ointment', 'prescription'
    ];
    if (pharmacyKeywords.some(keyword => text.includes(keyword))) {
      return 'Pharmacy';
    }

    return 'Grocery';
  }

  async getStoreLocation(item: GroceryItem, tooltip?: MatTooltip): Promise<void> {
    if (!this.githubAi.isConfigured()) {
      this.snackBar.open(
        'GitHub AI is not configured. Add your token to use this feature.',
        'Close',
        { duration: 4000 }
      );
      return;
    }

    // If already loaded, show the tooltip and return
    if (this.itemLocations.has(item.id)) {
      if (tooltip) {
        tooltip.show();
      }
      return;
    }
    
    // If currently loading, just return
    if (this.loadingLocations.has(item.id)) {
      return;
    }

    this.loadingLocations.add(item.id);

    try {
      const prompt = `In which aisle or section of a grocery store would I typically find "${item.name}"? Give a brief, specific answer in one sentence. For example: "Produce section" or "Dairy aisle, near the milk" or "Baking aisle, with flour and sugar".`;
      
      const response = await this.githubAi.generateContent(prompt);
      
      if (response.success) {
        this.itemLocations.set(item.id, response.text.trim());
        // Show tooltip after location is fetched
        if (tooltip) {
          setTimeout(() => tooltip.show(), 100);
        }
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

  async handleItemLocationAction(item: GroceryItem): Promise<void> {
    const existingLocation = this.itemLocations.get(item.id);

    if (existingLocation) {
      this.snackBar.open(existingLocation, 'Close', { duration: 3500 });
      return;
    }

    await this.getStoreLocation(item);

    const fetchedLocation = this.itemLocations.get(item.id);
    if (fetchedLocation) {
      this.snackBar.open(fetchedLocation, 'Close', { duration: 3500 });
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

  startEditItem(item: GroceryItem): void {
    this.editingItemId = item.id;
    this.editingItemName = item.name;
    this.editingItemQuantity = item.quantity;
    this.editingItemUnit = item.unit;
    this.editingItemNotes = item.notes;
    this.editingItemCategory = this.getEffectiveCategory(item);
  }

  cancelEdit(): void {
    this.editingItemId = null;
    this.editingItemName = '';
    this.editingItemQuantity = undefined;
    this.editingItemUnit = undefined;
    this.editingItemNotes = undefined;
    this.editingItemCategory = 'Grocery';
  }

  async saveEdit(): Promise<void> {
    if (!this.editingItemId || !this.editingItemName.trim()) {
      return;
    }

    try {
      // Convert empty string to undefined for unit
      const unitValue = this.editingItemUnit && this.editingItemUnit.trim() ? this.editingItemUnit : undefined;
      
      await this.groceryService.updateItem(this.editingItemId, {
        name: this.editingItemName.trim(),
        category: this.editingItemCategory,
        quantity: this.editingItemQuantity,
        unit: unitValue,
        notes: this.editingItemNotes
      });
      
      this.snackBar.open('Item updated successfully', 'Close', { duration: 2000 });
      this.cancelEdit();
    } catch (error) {
      console.error('Error updating item:', error);
      this.snackBar.open('Failed to update item. Please try again.', 'Close', { duration: 3000 });
    }
  }

  isEditing(itemId: string): boolean {
    return this.editingItemId === itemId;
  }

  getItemDisplayText(item: GroceryItem): string {
    let text = item.name;
    if (item.quantity) {
      // Always show quantity (and unit if present) in parentheses after the name
      if (item.unit && item.unit.trim()) {
        text = `${text} (${item.quantity} ${item.unit})`;
      } else {
        text = `${text} (${item.quantity})`;
      }
    }
    return text;
  }
}
