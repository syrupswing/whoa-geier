import { Injectable, inject, signal } from '@angular/core';
import { FirestoreService } from './firestore.service';
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
  private firestoreService = inject(FirestoreService);
  private localStorageService = inject(LocalStorageService);

  private readonly VEHICLES_COLLECTION = 'vehicles';
  private readonly MAINTENANCE_COLLECTION = 'maintenanceRecords';
  private readonly VEHICLES_KEY = 'vehicles';
  private readonly MAINTENANCE_KEY = 'maintenance_records';

  vehicles = signal<Vehicle[]>([]);
  maintenanceRecords = signal<MaintenanceRecord[]>([]);

  constructor() {
    this.load();
  }

  private async load(): Promise<void> {
    if (this.firestoreService.isInitialized()) {
      await this.migrateFromLocalStorageIfEmpty();
      this.firestoreService.subscribeToCollection<any>(
        this.VEHICLES_COLLECTION,
        (items) => this.vehicles.set(items.map(v => this.deserializeVehicle(v)))
      );
      this.firestoreService.subscribeToCollection<any>(
        this.MAINTENANCE_COLLECTION,
        (items) => this.maintenanceRecords.set(items.map(r => this.deserializeMaintenanceRecord(r)))
      );
    } else {
      this.loadVehicles();
      this.loadMaintenanceRecords();
    }
  }

  // One-time move of whatever this device had saved locally into Firestore, so vehicle
  // and maintenance data syncs across devices and is visible to the future nightly
  // smart-alerts job. Reuses the original ids so maintenanceRecords.vehicleId references
  // stay valid across the migration.
  private async migrateFromLocalStorageIfEmpty(): Promise<void> {
    const [existingVehicles, existingRecords] = await Promise.all([
      this.firestoreService.getCollection<Vehicle>(this.VEHICLES_COLLECTION),
      this.firestoreService.getCollection<MaintenanceRecord>(this.MAINTENANCE_COLLECTION)
    ]);

    if (existingVehicles.length === 0) {
      const localVehicles = this.localStorageService.getItem<Vehicle[]>(this.VEHICLES_KEY) || [];
      await Promise.all(localVehicles.map(v =>
        this.firestoreService.setDocument(this.VEHICLES_COLLECTION, v.id, this.serializeVehicle(v))
      ));
    }

    if (existingRecords.length === 0) {
      const localRecords = this.localStorageService.getItem<MaintenanceRecord[]>(this.MAINTENANCE_KEY) || [];
      await Promise.all(localRecords.map(r =>
        this.firestoreService.setDocument(this.MAINTENANCE_COLLECTION, r.id, this.serializeMaintenanceRecord(r))
      ));
    }
  }

  // Firestore fields round-trip as plain values, so Date fields are stored as ISO strings
  // (same as they already were via JSON.stringify into localStorage) and reconstructed
  // into real Date instances on read — the rest of this service calls .getTime() on them.
  private serializeVehicle(vehicle: Partial<Vehicle>): Record<string, any> {
    const data: Record<string, any> = { ...vehicle };
    if ('registrationExpiry' in data) {
      data['registrationExpiry'] = vehicle.registrationExpiry
        ? new Date(vehicle.registrationExpiry).toISOString()
        : undefined;
    }
    return data;
  }

  private deserializeVehicle(data: any): Vehicle {
    return {
      ...data,
      registrationExpiry: data.registrationExpiry ? new Date(data.registrationExpiry) : undefined
    };
  }

  private serializeMaintenanceRecord(record: Partial<MaintenanceRecord>): Record<string, any> {
    const data: Record<string, any> = { ...record };
    if ('date' in data) {
      data['date'] = new Date(record.date!).toISOString();
    }
    if ('nextDueDate' in data) {
      data['nextDueDate'] = record.nextDueDate ? new Date(record.nextDueDate).toISOString() : undefined;
    }
    return data;
  }

  private deserializeMaintenanceRecord(data: any): MaintenanceRecord {
    return {
      ...data,
      date: new Date(data.date),
      nextDueDate: data.nextDueDate ? new Date(data.nextDueDate) : undefined
    };
  }

  private loadVehicles(): void {
    const stored = this.localStorageService.getItem<Vehicle[]>(this.VEHICLES_KEY);
    if (stored) {
      this.vehicles.set(stored.map(v => this.deserializeVehicle(v)));
    }
  }

  private loadMaintenanceRecords(): void {
    const stored = this.localStorageService.getItem<MaintenanceRecord[]>(this.MAINTENANCE_KEY);
    if (stored) {
      this.maintenanceRecords.set(stored.map(r => this.deserializeMaintenanceRecord(r)));
    }
  }

  private saveVehiclesToLocalStorage(): void {
    this.localStorageService.setItem(this.VEHICLES_KEY, this.vehicles());
  }

  private saveMaintenanceRecordsToLocalStorage(): void {
    this.localStorageService.setItem(this.MAINTENANCE_KEY, this.maintenanceRecords());
  }

  async addVehicle(vehicle: Omit<Vehicle, 'id'>): Promise<void> {
    const newVehicle: Vehicle = { ...vehicle, id: crypto.randomUUID() };
    if (this.firestoreService.isInitialized()) {
      await this.firestoreService.setDocument(
        this.VEHICLES_COLLECTION, newVehicle.id, this.serializeVehicle(newVehicle)
      );
    } else {
      this.vehicles.update(vehicles => [...vehicles, newVehicle]);
      this.saveVehiclesToLocalStorage();
    }
  }

  async updateVehicle(id: string, updates: Partial<Vehicle>): Promise<void> {
    if (this.firestoreService.isInitialized()) {
      await this.firestoreService.updateDocument(this.VEHICLES_COLLECTION, id, this.serializeVehicle(updates));
    } else {
      this.vehicles.update(vehicles => vehicles.map(v => v.id === id ? { ...v, ...updates } : v));
      this.saveVehiclesToLocalStorage();
    }
  }

  async deleteVehicle(id: string): Promise<void> {
    if (this.firestoreService.isInitialized()) {
      await this.firestoreService.deleteDocument(this.VEHICLES_COLLECTION, id);
      // Also delete associated maintenance records
      const related = this.maintenanceRecords().filter(r => r.vehicleId === id);
      await Promise.all(related.map(r => this.firestoreService.deleteDocument(this.MAINTENANCE_COLLECTION, r.id)));
    } else {
      this.vehicles.update(vehicles => vehicles.filter(v => v.id !== id));
      this.maintenanceRecords.update(records => records.filter(r => r.vehicleId !== id));
      this.saveVehiclesToLocalStorage();
      this.saveMaintenanceRecordsToLocalStorage();
    }
  }

  async addMaintenanceRecord(record: Omit<MaintenanceRecord, 'id'>): Promise<void> {
    const newRecord: MaintenanceRecord = { ...record, id: crypto.randomUUID() };
    if (this.firestoreService.isInitialized()) {
      await this.firestoreService.setDocument(
        this.MAINTENANCE_COLLECTION, newRecord.id, this.serializeMaintenanceRecord(newRecord)
      );
    } else {
      this.maintenanceRecords.update(records => [...records, newRecord]);
      this.saveMaintenanceRecordsToLocalStorage();
    }
  }

  async updateMaintenanceRecord(id: string, updates: Partial<MaintenanceRecord>): Promise<void> {
    if (this.firestoreService.isInitialized()) {
      await this.firestoreService.updateDocument(
        this.MAINTENANCE_COLLECTION, id, this.serializeMaintenanceRecord(updates)
      );
    } else {
      this.maintenanceRecords.update(records => records.map(r => r.id === id ? { ...r, ...updates } : r));
      this.saveMaintenanceRecordsToLocalStorage();
    }
  }

  async deleteMaintenanceRecord(id: string): Promise<void> {
    if (this.firestoreService.isInitialized()) {
      await this.firestoreService.deleteDocument(this.MAINTENANCE_COLLECTION, id);
    } else {
      this.maintenanceRecords.update(records => records.filter(r => r.id !== id));
      this.saveMaintenanceRecordsToLocalStorage();
    }
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
