import { Component, TemplateRef, ViewChild, computed, effect, inject, signal, untracked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatTabsModule } from '@angular/material/tabs';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatNativeDateModule } from '@angular/material/core';
import { MatListModule } from '@angular/material/list';
import { MatBadgeModule } from '@angular/material/badge';
import { MatChipsModule } from '@angular/material/chips';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTooltipModule } from '@angular/material/tooltip';
import { VehicleService, Vehicle, MaintenanceRecord } from '../../services/vehicle.service';
import { BacklogService } from '../../services/backlog.service';
import {
  SERVICE_CATALOG, ServiceInterval, ServiceStatus, ServiceType, defaultSchedule
} from '../../services/vehicle-maintenance';

/** Services you can log; registration lives on the vehicle's expiry date instead. */
const LOGGABLE_TYPES = (Object.keys(SERVICE_CATALOG) as ServiceType[]).filter(t => t !== 'registration');
import { AddButtonComponent } from '../../shared/add-button/add-button.component';
import { GlobalNavMenuComponent } from '../../shared/global-nav-menu/global-nav-menu.component';

@Component({
  selector: 'app-vehicles',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatCardModule,
    MatIconModule,
    MatButtonModule,
    MatTabsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatNativeDateModule,
    MatListModule,
    MatBadgeModule,
    MatChipsModule,
    MatExpansionModule,
    MatTooltipModule,
    MatDialogModule,
    MatMenuModule,
    GlobalNavMenuComponent,
    AddButtonComponent
  ],
  templateUrl: './vehicles.component.html',
  styleUrls: ['./vehicles.component.scss']
})
export class VehiclesComponent {
  private dialog = inject(MatDialog);
  @ViewChild('vehicleDialog') private vehicleDialog?: TemplateRef<unknown>;
  @ViewChild('maintenanceDialog') private maintenanceDialog?: TemplateRef<unknown>;

  private backlog = inject(BacklogService);
  @ViewChild('odometerDialog') private odometerDialog?: TemplateRef<unknown>;
  @ViewChild('scheduleDialog') private scheduleDialog?: TemplateRef<unknown>;

  showAddVehicle = signal(false);
  showAddMaintenance = signal(false);
  showOdometer = signal(false);
  showSchedule = signal(false);
  editingVehicleId = signal<string | null>(null);

  readonly loggableTypes = LOGGABLE_TYPES;
  readonly catalog = SERVICE_CATALOG;

  /** Everything the cards need per vehicle, recomputed when vehicles, records or readings change. */
  views = computed(() => {
    const now = new Date();
    return this.vehicleService.vehicles().map(vehicle => {
      const statuses = this.vehicleService.getServiceStatuses(vehicle, now);
      return {
        vehicle,
        estimate: this.vehicleService.getOdometerEstimate(vehicle, now),
        statuses,
        // The two soonest tracked items; untracked ones only show in the detail list.
        upNext: statuses.filter(s => s.status !== 'untracked' && s.type !== 'registration').slice(0, 2),
        history: this.vehicleService.getMaintenanceRecordsForVehicle(vehicle.id)
      };
    });
  });

  attention = computed(() => this.vehicleService.getAttentionItems());

  // Odometer dialog
  odometerVehicleId = '';
  odometerMiles: number | null = null;

  // Schedule dialog
  scheduleVehicleId = '';
  scheduleDraft: Array<{ type: ServiceType; everyMiles: number | null; everyMonths: number | null }> = [];
  scheduleAddType: ServiceType | '' = '';

  // Vehicle form
  vehicleForm = {
    name: '',
    type: 'car' as 'car' | 'truck' | 'trailer',
    make: '',
    model: '',
    year: new Date().getFullYear(),
    currentMileage: 0,
    licensePlate: '',
    registrationExpiry: null as Date | null,
    milesPerYear: null as number | null
  };

  // Maintenance form
  maintenanceForm = {
    vehicleId: '',
    type: 'oil_change' as ServiceType,
    date: new Date(),
    mileage: 0,
    description: '',
    cost: null as number | null,
    location: ''
  };

  getVehicleIcon(type: string): string {
    switch (type) {
      case 'car': return 'directions_car';
      case 'truck': return 'local_shipping';
      case 'trailer': return 'rv_hookup';
      default: return 'directions_car';
    }
  }

  getMaintenanceIcon(type: string): string {
    return SERVICE_CATALOG[type as ServiceType]?.icon ?? 'build';
  }

  getMaintenanceLabel(type: string): string {
    return SERVICE_CATALOG[type as ServiceType]?.label ?? type;
  }

  constructor(public vehicleService: VehicleService) {
    this.openFormInDialog(this.showAddVehicle, () => this.vehicleDialog, () => this.cancelVehicleForm());
    this.openFormInDialog(this.showAddMaintenance, () => this.maintenanceDialog, () => {
      this.showAddMaintenance.set(false);
      this.resetMaintenanceForm();
    });
    this.openFormInDialog(this.showOdometer, () => this.odometerDialog, () => this.showOdometer.set(false));
    this.openFormInDialog(this.showSchedule, () => this.scheduleDialog, () => this.showSchedule.set(false));
  }

  /** Shows a form template in a modal dialog while its flag is on; dismissing the dialog (Esc, backdrop) turns the flag off. */
  private openFormInDialog(open: ReturnType<typeof signal<boolean>>, template: () => TemplateRef<unknown> | undefined, onDismiss: () => void): void {
    let ref: MatDialogRef<unknown> | null = null;
    effect(() => {
      const isOpen = open();
      untracked(() => {
        const tpl = template();
        if (isOpen && !ref && tpl) {
          ref = this.dialog.open(tpl, { width: '640px', maxWidth: '95vw', autoFocus: 'first-tabbable' });
          ref.afterClosed().subscribe(() => {
            ref = null;
            if (open()) onDismiss();
          });
        } else if (!isOpen && ref) {
          ref.close();
        }
      });
    });
  }

  openAddVehicle(): void {
    this.resetVehicleForm();
    this.editingVehicleId.set(null);
    this.showAddVehicle.set(true);
  }

  openEditVehicle(vehicle: Vehicle): void {
    this.vehicleForm = {
      name: vehicle.name,
      type: vehicle.type,
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      currentMileage: vehicle.currentMileage,
      licensePlate: vehicle.licensePlate,
      registrationExpiry: vehicle.registrationExpiry ? new Date(vehicle.registrationExpiry) : null,
      milesPerYear: vehicle.milesPerYear ?? null
    };
    this.editingVehicleId.set(vehicle.id);
    this.showAddVehicle.set(true);
  }

  openAddMaintenance(vehicleId?: string, type?: ServiceType): void {
    this.resetMaintenanceForm();
    // With a single vehicle there is nothing to choose.
    const id = vehicleId ?? (this.vehicleService.vehicles().length === 1 ? this.vehicleService.vehicles()[0].id : '');
    if (id) {
      this.maintenanceForm.vehicleId = id;
      this.onMaintenanceVehicleChange();
    }
    if (type) this.maintenanceForm.type = type;
    this.showAddMaintenance.set(true);
  }

  /** Prefills mileage with the best guess for the chosen vehicle; the user only corrects it. */
  onMaintenanceVehicleChange(): void {
    const vehicle = this.vehicleService.getVehicleById(this.maintenanceForm.vehicleId);
    if (vehicle) {
      this.maintenanceForm.mileage = this.vehicleService.getOdometerEstimate(vehicle).miles;
    }
  }

  openOdometer(vehicleId?: string): void {
    const id = vehicleId ?? (this.vehicleService.vehicles().length === 1 ? this.vehicleService.vehicles()[0].id : '');
    this.odometerVehicleId = id;
    this.onOdometerVehicleChange();
    this.showOdometer.set(true);
  }

  onOdometerVehicleChange(): void {
    const vehicle = this.vehicleService.getVehicleById(this.odometerVehicleId);
    this.odometerMiles = vehicle ? this.vehicleService.getOdometerEstimate(vehicle).miles : null;
  }

  saveOdometer(): void {
    if (!this.odometerVehicleId || this.odometerMiles == null || this.odometerMiles < 0) return;
    this.vehicleService.logOdometer(this.odometerVehicleId, this.odometerMiles);
    this.showOdometer.set(false);
  }

  openSchedule(vehicle: Vehicle): void {
    this.scheduleVehicleId = vehicle.id;
    this.scheduleDraft = this.vehicleService.getScheduleForVehicle(vehicle).map(i => ({
      type: i.type, everyMiles: i.everyMiles ?? null, everyMonths: i.everyMonths ?? null
    }));
    this.scheduleAddType = '';
    this.showSchedule.set(true);
  }

  scheduleAddOptions(): ServiceType[] {
    const used = new Set(this.scheduleDraft.map(r => r.type));
    return LOGGABLE_TYPES.filter(t => !used.has(t));
  }

  addScheduleRow(): void {
    if (!this.scheduleAddType) return;
    this.scheduleDraft = [...this.scheduleDraft, { type: this.scheduleAddType, everyMiles: null, everyMonths: 12 }];
    this.scheduleAddType = '';
  }

  removeScheduleRow(index: number): void {
    this.scheduleDraft = this.scheduleDraft.filter((_, i) => i !== index);
  }

  resetScheduleToDefaults(): void {
    const vehicle = this.vehicleService.getVehicleById(this.scheduleVehicleId);
    if (!vehicle) return;
    this.scheduleDraft = defaultSchedule(vehicle.type).map(i => ({
      type: i.type, everyMiles: i.everyMiles ?? null, everyMonths: i.everyMonths ?? null
    }));
  }

  saveSchedule(): void {
    // Rows with no interval can never come due, and Firestore rejects undefined nested fields.
    const schedule: ServiceInterval[] = this.scheduleDraft
      .filter(r => (r.everyMiles ?? 0) > 0 || (r.everyMonths ?? 0) > 0)
      .map(r => {
        const item: ServiceInterval = { type: r.type };
        if ((r.everyMiles ?? 0) > 0) item.everyMiles = r.everyMiles!;
        if ((r.everyMonths ?? 0) > 0) item.everyMonths = r.everyMonths!;
        return item;
      });
    this.vehicleService.updateVehicle(this.scheduleVehicleId, { schedule });
    this.showSchedule.set(false);
  }

  resetVehicleForm(): void {
    this.vehicleForm = {
      name: '',
      type: 'car',
      make: '',
      model: '',
      year: new Date().getFullYear(),
      currentMileage: 0,
      licensePlate: '',
      registrationExpiry: null,
      milesPerYear: null
    };
  }

  cancelVehicleForm(): void {
    this.showAddVehicle.set(false);
    this.editingVehicleId.set(null);
    this.resetVehicleForm();
  }

  resetMaintenanceForm(): void {
    this.maintenanceForm = {
      vehicleId: '',
      type: 'oil_change',
      date: new Date(),
      mileage: 0,
      description: '',
      cost: null,
      location: ''
    };
  }

  addVehicle(): void {
    if (this.vehicleForm.name && this.vehicleForm.make) {
      const editingId = this.editingVehicleId();
      const { milesPerYear, ...rest } = this.vehicleForm;
      const fields = { ...rest, milesPerYear: milesPerYear || undefined };
      
      if (editingId) {
        // Update existing vehicle
        this.vehicleService.updateVehicle(editingId, {
          ...fields,
          registrationExpiry: this.vehicleForm.registrationExpiry || undefined
        });
      } else {
        // Add new vehicle
        this.vehicleService.addVehicle({
          ...fields,
          registrationExpiry: this.vehicleForm.registrationExpiry || undefined
        });
      }
      
      this.showAddVehicle.set(false);
      this.editingVehicleId.set(null);
      this.resetVehicleForm();
    }
  }

  addMaintenance(): void {
    const form = this.maintenanceForm;
    // A named service needs no description; "Other" has nothing else to say what it was.
    if (!form.vehicleId || (form.type === 'other' && !form.description.trim())) return;
    this.vehicleService.addMaintenanceRecord({
      vehicleId: form.vehicleId,
      type: form.type,
      date: form.date,
      mileage: form.mileage,
      description: form.description.trim() || SERVICE_CATALOG[form.type].label,
      cost: form.cost || undefined,
      location: form.location.trim() || undefined
    });
    this.showAddMaintenance.set(false);
    this.resetMaintenanceForm();
  }

  deleteVehicle(id: string): void {
    if (confirm('Are you sure you want to delete this vehicle and all its maintenance records?')) {
      this.vehicleService.deleteVehicle(id);
    }
  }

  deleteMaintenanceRecord(id: string): void {
    if (confirm('Are you sure you want to delete this maintenance record?')) {
      this.vehicleService.deleteMaintenanceRecord(id);
    }
  }

  // --- Attention rows and cards -------------------------------------------------------------

  /** "Oil change – Subaru": the title an Add-task for this item gets, and how we spot it again. */
  taskTitle(vehicle: Vehicle, status: ServiceStatus): string {
    const what = status.type === 'registration' ? 'Renew registration' : SERVICE_CATALOG[status.type].label;
    return `${what} – ${vehicle.name}`;
  }

  hasOpenTask(vehicle: Vehicle, status: ServiceStatus): boolean {
    const title = this.taskTitle(vehicle, status);
    return this.backlog.open().some(i => i.title === title);
  }

  async addTask(vehicle: Vehicle, status: ServiceStatus): Promise<void> {
    if (this.hasOpenTask(vehicle, status)) return;
    await this.backlog.addItem({
      title: this.taskTitle(vehicle, status),
      notes: this.statusLabel(status)
    });
  }

  /** One short phrase for how far off (or past due) an item is. */
  statusLabel(s: ServiceStatus): string {
    if (s.status === 'untracked') return 'Not logged yet';
    const miles = s.milesRemaining;
    if (s.status === 'overdue') {
      if (miles != null && miles <= 0) return `${this.roundMiles(-miles)} mi overdue`;
      const days = Math.abs(s.daysRemaining ?? 0);
      return days === 0 ? 'Due today' : `${days} ${days === 1 ? 'day' : 'days'} overdue`;
    }
    const parts: string[] = [];
    if (s.effectiveDueDate) {
      const days = s.daysRemaining ?? 0;
      parts.push(days <= 0 ? 'today' : days <= 60 ? `in ${days} ${days === 1 ? 'day' : 'days'}` : this.shortDate(s.effectiveDueDate));
    }
    if (miles != null && miles > 0) parts.push(`${this.roundMiles(miles)} mi`);
    return 'Due ' + parts.join(' · ');
  }

  private roundMiles(miles: number): string {
    // Whole hundreds read better than a falsely precise estimate.
    return (miles >= 1000 ? Math.round(miles / 100) * 100 : Math.round(miles / 10) * 10).toLocaleString();
  }

  private shortDate(date: Date): string {
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  isRegistrationExpiringSoon(vehicle: Vehicle): boolean {
    if (!vehicle.registrationExpiry) return false;
    const expiry = new Date(vehicle.registrationExpiry);
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
    return expiry <= thirtyDaysFromNow && expiry >= new Date();
  }

  isRegistrationExpired(vehicle: Vehicle): boolean {
    if (!vehicle.registrationExpiry) return false;
    return new Date(vehicle.registrationExpiry) < new Date();
  }

  getDaysUntilExpiry(date: Date): number {
    const now = new Date();
    const expiry = new Date(date);
    const diffTime = expiry.getTime() - now.getTime();
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }
}
