import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
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
import { VehicleService, Vehicle, MaintenanceRecord } from '../../services/vehicle.service';

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
    MatExpansionModule
  ],
  templateUrl: './vehicles.component.html',
  styleUrls: ['./vehicles.component.scss']
})
export class VehiclesComponent {
  showAddVehicle = signal(false);
  showAddMaintenance = signal(false);
  selectedVehicleId = signal<string | null>(null);
  editingVehicleId = signal<string | null>(null);

  // Vehicle form
  vehicleForm = {
    name: '',
    type: 'car' as 'car' | 'truck' | 'trailer',
    make: '',
    model: '',
    year: new Date().getFullYear(),
    currentMileage: 0,
    licensePlate: '',
    registrationExpiry: null as Date | null
  };

  // Maintenance form
  maintenanceForm = {
    vehicleId: '',
    type: 'oil_change' as 'oil_change' | 'tire_rotation' | 'registration' | 'other',
    date: new Date(),
    mileage: 0,
    description: '',
    cost: null as number | null,
    location: '',
    nextDueDate: null as Date | null,
    nextDueMileage: null as number | null
  };

  constructor(public vehicleService: VehicleService) {}

  getVehicleIcon(type: string): string {
    switch (type) {
      case 'car': return 'directions_car';
      case 'truck': return 'local_shipping';
      case 'trailer': return 'rv_hookup';
      default: return 'directions_car';
    }
  }

  getMaintenanceIcon(type: string): string {
    switch (type) {
      case 'oil_change': return 'oil_barrel';
      case 'tire_rotation': return 'settings';
      case 'registration': return 'description';
      case 'other': return 'build';
      default: return 'build';
    }
  }

  getMaintenanceLabel(type: string): string {
    switch (type) {
      case 'oil_change': return 'Oil Change';
      case 'tire_rotation': return 'Tire Rotation';
      case 'registration': return 'Registration';
      case 'other': return 'Other';
      default: return type;
    }
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
      registrationExpiry: vehicle.registrationExpiry ? new Date(vehicle.registrationExpiry) : null
    };
    this.editingVehicleId.set(vehicle.id);
    this.showAddVehicle.set(true);
  }

  openAddMaintenance(vehicleId?: string): void {
    this.resetMaintenanceForm();
    if (vehicleId) {
      this.maintenanceForm.vehicleId = vehicleId;
      const vehicle = this.vehicleService.getVehicleById(vehicleId);
      if (vehicle) {
        this.maintenanceForm.mileage = vehicle.currentMileage;
      }
    }
    this.showAddMaintenance.set(true);
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
      registrationExpiry: null
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
      location: '',
      nextDueDate: null,
      nextDueMileage: null
    };
  }

  addVehicle(): void {
    if (this.vehicleForm.name && this.vehicleForm.make) {
      const editingId = this.editingVehicleId();
      
      if (editingId) {
        // Update existing vehicle
        this.vehicleService.updateVehicle(editingId, {
          ...this.vehicleForm,
          registrationExpiry: this.vehicleForm.registrationExpiry || undefined
        });
      } else {
        // Add new vehicle
        this.vehicleService.addVehicle({
          ...this.vehicleForm,
          registrationExpiry: this.vehicleForm.registrationExpiry || undefined
        });
      }
      
      this.showAddVehicle.set(false);
      this.editingVehicleId.set(null);
      this.resetVehicleForm();
    }
  }

  addMaintenance(): void {
    if (this.maintenanceForm.vehicleId && this.maintenanceForm.description) {
      this.vehicleService.addMaintenanceRecord({
        ...this.maintenanceForm,
        cost: this.maintenanceForm.cost || undefined,
        location: this.maintenanceForm.location || undefined,
        nextDueDate: this.maintenanceForm.nextDueDate || undefined,
        nextDueMileage: this.maintenanceForm.nextDueMileage || undefined
      });
      
      // Update vehicle mileage if higher
      const vehicle = this.vehicleService.getVehicleById(this.maintenanceForm.vehicleId);
      if (vehicle && this.maintenanceForm.mileage > vehicle.currentMileage) {
        this.vehicleService.updateVehicle(this.maintenanceForm.vehicleId, {
          currentMileage: this.maintenanceForm.mileage
        });
      }
      
      this.showAddMaintenance.set(false);
      this.resetMaintenanceForm();
    }
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

  selectVehicle(id: string): void {
    this.selectedVehicleId.set(this.selectedVehicleId() === id ? null : id);
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
