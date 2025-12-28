import { Injectable, signal } from '@angular/core';
import { LocalStorageService } from './local-storage.service';

export interface Vehicle {
  id: string;
  name: string;
  type: 'car' | 'truck' | 'trailer';
  make: string;
  model: string;
  year: number;
  currentMileage: number;
  licensePlate: string;
  registrationExpiry?: Date;
}

export interface MaintenanceRecord {
  id: string;
  vehicleId: string;
  type: 'oil_change' | 'tire_rotation' | 'registration' | 'other';
  date: Date;
  mileage: number;
  description: string;
  cost?: number;
  location?: string;
  nextDueDate?: Date;
  nextDueMileage?: number;
}

@Injectable({
  providedIn: 'root'
})
export class VehicleService {
  private readonly VEHICLES_KEY = 'vehicles';
  private readonly MAINTENANCE_KEY = 'maintenance_records';

  vehicles = signal<Vehicle[]>([]);
  maintenanceRecords = signal<MaintenanceRecord[]>([]);

  constructor(private localStorage: LocalStorageService) {
    this.loadVehicles();
    this.loadMaintenanceRecords();
  }

  private loadVehicles(): void {
    const stored = this.localStorage.getItem<Vehicle[]>(this.VEHICLES_KEY);
    if (stored) {
      this.vehicles.set(stored);
    }
  }

  private loadMaintenanceRecords(): void {
    const stored = this.localStorage.getItem<MaintenanceRecord[]>(this.MAINTENANCE_KEY);
    if (stored) {
      // Convert date strings back to Date objects
      const records = stored.map(record => ({
        ...record,
        date: new Date(record.date),
        nextDueDate: record.nextDueDate ? new Date(record.nextDueDate) : undefined
      }));
      this.maintenanceRecords.set(records);
    }
  }

  private saveVehicles(): void {
    this.localStorage.setItem(this.VEHICLES_KEY, this.vehicles());
  }

  private saveMaintenanceRecords(): void {
    this.localStorage.setItem(this.MAINTENANCE_KEY, this.maintenanceRecords());
  }

  addVehicle(vehicle: Omit<Vehicle, 'id'>): void {
    const newVehicle: Vehicle = {
      ...vehicle,
      id: Date.now().toString()
    };
    this.vehicles.update(vehicles => [...vehicles, newVehicle]);
    this.saveVehicles();
  }

  updateVehicle(id: string, updates: Partial<Vehicle>): void {
    this.vehicles.update(vehicles =>
      vehicles.map(v => v.id === id ? { ...v, ...updates } : v)
    );
    this.saveVehicles();
  }

  deleteVehicle(id: string): void {
    this.vehicles.update(vehicles => vehicles.filter(v => v.id !== id));
    // Also delete associated maintenance records
    this.maintenanceRecords.update(records =>
      records.filter(r => r.vehicleId !== id)
    );
    this.saveVehicles();
    this.saveMaintenanceRecords();
  }

  addMaintenanceRecord(record: Omit<MaintenanceRecord, 'id'>): void {
    const newRecord: MaintenanceRecord = {
      ...record,
      id: Date.now().toString()
    };
    this.maintenanceRecords.update(records => [...records, newRecord]);
    this.saveMaintenanceRecords();
  }

  updateMaintenanceRecord(id: string, updates: Partial<MaintenanceRecord>): void {
    this.maintenanceRecords.update(records =>
      records.map(r => r.id === id ? { ...r, ...updates } : r)
    );
    this.saveMaintenanceRecords();
  }

  deleteMaintenanceRecord(id: string): void {
    this.maintenanceRecords.update(records => records.filter(r => r.id !== id));
    this.saveMaintenanceRecords();
  }

  getVehicleById(id: string): Vehicle | undefined {
    return this.vehicles().find(v => v.id === id);
  }

  getMaintenanceRecordsForVehicle(vehicleId: string): MaintenanceRecord[] {
    return this.maintenanceRecords()
      .filter(r => r.vehicleId === vehicleId)
      .sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  getUpcomingMaintenance(): Array<{ vehicle: Vehicle; record: MaintenanceRecord }> {
    const now = new Date();
    const upcoming: Array<{ vehicle: Vehicle; record: MaintenanceRecord }> = [];

    this.maintenanceRecords().forEach(record => {
      if (record.nextDueDate && record.nextDueDate > now) {
        const vehicle = this.getVehicleById(record.vehicleId);
        if (vehicle) {
          upcoming.push({ vehicle, record });
        }
      }
    });

    return upcoming.sort((a, b) => 
      a.record.nextDueDate!.getTime() - b.record.nextDueDate!.getTime()
    );
  }

  getOverdueMaintenance(): Array<{ vehicle: Vehicle; record?: MaintenanceRecord; reason: string }> {
    const now = new Date();
    const overdue: Array<{ vehicle: Vehicle; record?: MaintenanceRecord; reason: string }> = [];

    // Check for expired registrations
    this.vehicles().forEach(vehicle => {
      if (vehicle.registrationExpiry && new Date(vehicle.registrationExpiry) < now) {
        overdue.push({
          vehicle,
          reason: 'Registration expired'
        });
      }
    });

    // Check for overdue maintenance
    this.maintenanceRecords().forEach(record => {
      if (record.nextDueDate && record.nextDueDate < now) {
        const vehicle = this.getVehicleById(record.vehicleId);
        if (vehicle) {
          overdue.push({ vehicle, record, reason: 'Maintenance overdue' });
        }
      }
    });

    return overdue;
  }
}
