import { Component, Input, TemplateRef, ViewChild, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import {
  RestaurantService, Restaurant, OrderLink, KNOWN_ORDER_APPS, DIRECT_ORDER, PHONE_ORDER
} from '../../services/restaurant.service';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';

export type { Restaurant, OrderLink };

export type RestaurantMode = 'all' | 'dineOut' | 'delivery' | 'takeout';

interface RestaurantForm {
  name: string;
  cuisine: string;
  phone: string;
  website: string;
  notes: string;
  dineOut: boolean;
  delivery: boolean;
  takeout: boolean;
  deliveryApps: string[];
  bestApp: string;
  bestAppNote: string;
}

const blankForm = (): RestaurantForm => ({
  name: '', cuisine: '', phone: '', website: '', notes: '',
  dineOut: true, delivery: false, takeout: false,
  deliveryApps: [], bestApp: '', bestAppNote: ''
});

@Component({
  selector: 'app-restaurants',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatFormFieldModule,
    MatInputModule,
    MatCheckboxModule,
    MatSelectModule,
    MatSnackBarModule,
    GlobalNavMenuComponent
  ],
  templateUrl: './restaurants.component.html',
  styleUrls: ['./restaurants.component.scss']
})
export class RestaurantsComponent {
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private dialogRef: MatDialogRef<unknown> | null = null;
  @ViewChild('formDialog') private formDialog?: TemplateRef<unknown>;
  private restaurantService = inject(RestaurantService);

  restaurants = this.restaurantService.restaurants;
  isLoading = this.restaurantService.isLoading;

  readonly knownApps = KNOWN_ORDER_APPS.map(a => a.name);
  readonly directOrder = DIRECT_ORDER;
  readonly phoneOrder = PHONE_ORDER;

  /** Inside the Food page the page supplies the header, search and which way of eating to show. */
  @Input() embedded = false;
  @Input() set searchTerm(value: string) { this.search.set(value ?? ''); }
  @Input() set mode(value: RestaurantMode) { this.modeSignal.set(value ?? 'all'); }

  private search = signal('');
  private modeSignal = signal<RestaurantMode>('all');
  cuisineFilter = signal('');

  /** Cuisines present in the list, for the filter chips. */
  cuisines = computed(() => {
    const seen = new Map<string, string>();
    for (const r of this.restaurants()) {
      const c = r.cuisine?.trim();
      if (c && !seen.has(c.toLowerCase())) seen.set(c.toLowerCase(), c);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  });

  visible = computed(() => {
    const term = this.search().trim().toLowerCase();
    const cuisine = this.cuisineFilter().toLowerCase();
    const mode = this.modeSignal();
    const list = this.restaurants().filter(r => {
      if (mode === 'delivery' && !this.restaurantService.offersDelivery(r)) return false;
      if (mode === 'dineOut' && !this.restaurantService.offersDineOut(r)) return false;
      if (mode === 'takeout' && !this.restaurantService.offersTakeout(r)) return false;
      if (cuisine && (r.cuisine ?? '').trim().toLowerCase() !== cuisine) return false;
      if (term && !`${r.name} ${r.cuisine ?? ''} ${r.bestApp ?? ''}`.toLowerCase().includes(term)) return false;
      return true;
    });
    return list.sort((a, b) => a.name.localeCompare(b.name));
  });

  /** True when nothing at all is saved yet, as opposed to filters hiding everything. */
  hasNone = computed(() => this.restaurants().length === 0);

  // ----- Form -----
  private _showAddForm = false;
  editingRestaurantId: string | null = null;
  form: RestaurantForm = blankForm();
  orderLinks: OrderLink[] = [];
  newOrderLink: OrderLink = { text: '', url: '' };
  customApp = '';

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

  /** Apps that can be picked as the best one: those this restaurant is on, plus ordering direct or by phone. */
  get bestAppChoices(): string[] {
    return [...this.form.deliveryApps, DIRECT_ORDER, PHONE_ORDER];
  }

  /** Known apps first, then any custom ones already on this restaurant. */
  get appChoices(): string[] {
    const extra = this.form.deliveryApps.filter(a => !this.knownApps.includes(a));
    return [...this.knownApps, ...extra];
  }

  openAddForm(): void {
    this.resetForm();
    // Starting from the way of eating being viewed saves a tap.
    const mode = this.modeSignal();
    this.form.dineOut = mode === 'all' || mode === 'dineOut';
    this.form.delivery = mode === 'delivery';
    this.form.takeout = mode === 'takeout';
    this.showAddForm = true;
  }

  toggleApp(app: string): void {
    const apps = this.form.deliveryApps;
    this.form.deliveryApps = apps.includes(app) ? apps.filter(a => a !== app) : [...apps, app];
    if (!this.form.deliveryApps.includes(this.form.bestApp) && this.form.bestApp !== DIRECT_ORDER && this.form.bestApp !== PHONE_ORDER) {
      this.form.bestApp = '';
    }
  }

  addCustomApp(): void {
    const app = this.customApp.trim();
    if (app && !this.form.deliveryApps.some(a => a.toLowerCase() === app.toLowerCase())) {
      this.form.deliveryApps = [...this.form.deliveryApps, app];
    }
    this.customApp = '';
  }

  addOrderLink(): void {
    const text = this.newOrderLink.text.trim();
    const url = this.newOrderLink.url.trim();
    if (!text || !url) return;
    this.orderLinks = [...this.orderLinks, { text, url: /^(https?:|tel:)/i.test(url) ? url : `https://${url}` }];
    this.newOrderLink = { text: '', url: '' };
  }

  removeOrderLink(index: number): void {
    this.orderLinks = this.orderLinks.filter((_, i) => i !== index);
  }

  resetForm(): void {
    this.form = blankForm();
    this.orderLinks = [];
    this.newOrderLink = { text: '', url: '' };
    this.customApp = '';
    this.editingRestaurantId = null;
  }

  closeForm(): void {
    this.showAddForm = false;
    this.resetForm();
  }

  editRestaurant(restaurant: Restaurant): void {
    this.editingRestaurantId = restaurant.id;
    this.form = {
      name: restaurant.name,
      cuisine: restaurant.cuisine ?? '',
      phone: restaurant.phone ?? '',
      website: restaurant.website ?? '',
      notes: restaurant.notes ?? '',
      dineOut: this.restaurantService.offersDineOut(restaurant),
      delivery: this.restaurantService.offersDelivery(restaurant),
      takeout: this.restaurantService.offersTakeout(restaurant),
      deliveryApps: [...(restaurant.deliveryApps ?? [])],
      bestApp: restaurant.bestApp ?? '',
      bestAppNote: restaurant.bestAppNote ?? ''
    };
    this.orderLinks = [...(restaurant.orderLinks ?? [])];
    this.showAddForm = true;
  }

  saveRestaurant(): void {
    const f = this.form;
    const name = f.name.trim();
    if (!name) return;
    this.addCustomApp();

    const data: Omit<Restaurant, 'id'> = {
      name,
      cuisine: f.cuisine.trim(),
      phone: f.phone.trim(),
      website: f.website.trim(),
      deliveryApps: [...f.deliveryApps],
      orderLinks: [...this.orderLinks],
      notes: f.notes.trim(),
      dineOut: f.dineOut,
      delivery: f.delivery,
      takeout: f.takeout,
      bestApp: f.bestApp,
      bestAppNote: f.bestAppNote.trim()
    };

    const editing = this.editingRestaurantId;
    const save = editing
      ? this.restaurantService.updateRestaurant(editing, data)
      : this.restaurantService.addRestaurant(data);
    save.catch(() => this.snackBar.open('Couldn\'t save the restaurant. Try again.', 'Close', { duration: 4000 }));
    this.closeForm();
  }

  deleteRestaurant(restaurant: Restaurant): void {
    if (confirm(`Delete ${restaurant.name}?`)) {
      void this.restaurantService.deleteRestaurant(restaurant.id);
    }
  }

  // ----- Card helpers -----
  offersDineOut = (r: Restaurant) => this.restaurantService.offersDineOut(r);
  offersDelivery = (r: Restaurant) => this.restaurantService.offersDelivery(r);
  offersTakeout = (r: Restaurant) => this.restaurantService.offersTakeout(r);
  websiteUrl = (r: Restaurant) => this.restaurantService.websiteUrl(r);
  bestOrderUrl = (r: Restaurant) => this.restaurantService.bestOrderUrl(r);

  /** The ideal-app button only makes sense for ways of eating that involve ordering. */
  canOrder(r: Restaurant): boolean {
    return !!r.bestApp && (this.offersDelivery(r) || this.offersTakeout(r));
  }

  orderIcon(r: Restaurant): string {
    if (r.bestApp === PHONE_ORDER) return 'call';
    if (r.bestApp === DIRECT_ORDER) return 'language';
    return 'shopping_bag';
  }

  trackById = (_: number, r: Restaurant) => r.id;

  /** Other apps it's on besides the best one, shown as plain chips. */
  otherApps(r: Restaurant): string[] {
    return (r.deliveryApps ?? []).filter(a => a !== r.bestApp);
  }
}
