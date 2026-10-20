import { Injectable, inject, signal } from '@angular/core';
import { FirestoreService } from './firestore.service';
import { LocalStorageService } from './local-storage.service';
import {
  OdometerReading, OdometerEstimate, ServiceInterval, ServiceStatus, ServiceType, VehicleType,
  compareStatuses, computeRegistrationStatus, computeServiceStatus, defaultSchedule, estimateOdometer
} from './vehicle-maintenance';

export type { OdometerReading, ServiceInterval, ServiceType } from './vehicle-maintenance';

export interface Vehicle {
  id: string;
  name: string;
  type: VehicleType;
  make: string;
  model: string;
  year: number;
  currentMileage: number;
  licensePlate: string;
  registrationExpiry?: Date;
  /** Rough yearly driving, used to project the odometer until there's enough reading history. */
  milesPerYear?: number;
  /** This vehicle's service intervals; unset means the generic defaults for its type. */
  schedule?: ServiceInterval[];
}

export interface MaintenanceRecord {
  id: string;
  vehicleId: string;
  type: ServiceType;
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
  private readonly ODOMETER_COLLECTION = 'odometerReadings';
  private readonly VEHICLES_KEY = 'vehicles';
  private readonly MAINTENANCE_KEY = 'maintenance_records';
  private readonly ODOMETER_KEY = 'odometer_readings';

  vehicles = signal<Vehicle[]>([]);
  maintenanceRecords = signal<MaintenanceRecord[]>([]);
  odometerReadings = signal<OdometerReading[]>([]);

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
      this.firestoreService.subscribeToCollection<any>(
        this.ODOMETER_COLLECTION,
        (items) => this.odometerReadings.set(items.map(r => this.deserializeOdometerReading(r)))
      );
    } else {
      this.loadVehicles();
      this.loadMaintenanceRecords();
      this.loadOdometerReadings();
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

  private serializeOdometerReading(reading: OdometerReading): Record<string, any> {
    return { ...reading, date: reading.date.toISOString() };
  }

  private deserializeOdometerReading(data: any): OdometerReading {
    return { ...data, date: new Date(data.date) };
  }

  private loadOdometerReadings(): void {
    const stored = this.localStorageService.getItem<OdometerReading[]>(this.ODOMETER_KEY);
    if (stored) {
      this.odometerReadings.set(stored.map(r => this.deserializeOdometerReading(r)));
    }
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
    if (newVehicle.currentMileage > 0) {
      await this.addOdometerReading(newVehicle.id, newVehicle.currentMileage);
    }
  }

  async updateVehicle(id: string, updates: Partial<Vehicle>): Promise<void> {
    const previous = this.getVehicleById(id);
    if (updates.currentMileage != null && previous && updates.currentMileage !== previous.currentMileage) {
      await this.addOdometerReading(id, updates.currentMileage);
    }
    await this.writeVehicle(id, updates);
  }

  /** The raw vehicle write, with none of updateVehicle's odometer-reading side effect. */
  private async writeVehicle(id: string, updates: Partial<Vehicle>): Promise<void> {
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
      const readings = this.odometerReadings().filter(r => r.vehicleId === id);
      await Promise.all(readings.map(r => this.firestoreService.deleteDocument(this.ODOMETER_COLLECTION, r.id)));
    } else {
      this.odometerReadings.update(readings => readings.filter(r => r.vehicleId !== id));
      this.localStorageService.setItem(this.ODOMETER_KEY, this.odometerReadings());
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
    // A service visit is also an odometer reading; the history estimate then needs no extra entry.
    if (newRecord.mileage > 0) {
      await this.addOdometerReading(newRecord.vehicleId, newRecord.mileage, newRecord.date);
      const vehicle = this.getVehicleById(newRecord.vehicleId);
      if (vehicle && newRecord.mileage > vehicle.currentMileage) {
        await this.writeVehicle(vehicle.id, { currentMileage: newRecord.mileage });
      }
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

  /** Records a dated odometer reading; callers that also change the vehicle's mileage write it themselves. */
  async addOdometerReading(vehicleId: string, miles: number, date: Date = new Date()): Promise<void> {
    const reading: OdometerReading = { id: crypto.randomUUID(), vehicleId, date, miles };
    if (this.firestoreService.isInitialized()) {
      await this.firestoreService.setDocument(
        this.ODOMETER_COLLECTION, reading.id, this.serializeOdometerReading(reading)
      );
    } else {
      this.odometerReadings.update(readings => [...readings, reading]);
      this.localStorageService.setItem(this.ODOMETER_KEY, this.odometerReadings());
    }
  }

  /** Public entry point for "update odometer": a reading plus the vehicle's current mileage. */
  async logOdometer(vehicleId: string, miles: number): Promise<void> {
    const vehicle = this.getVehicleById(vehicleId);
    if (!vehicle) return;
    if (miles === vehicle.currentMileage) {
      // updateVehicle only records a reading on change; a same-number confirmation still counts.
      await this.addOdometerReading(vehicleId, miles);
    } else {
      await this.updateVehicle(vehicleId, { currentMileage: miles });
    }
  }

  getScheduleForVehicle(vehicle: Vehicle): ServiceInterval[] {
    return vehicle.schedule ?? defaultSchedule(vehicle.type);
  }

  /**
   * Odometer history for a vehicle. Service records count as readings too, so existing data
   * produces an estimate with no migration.
   */
  private getReadingsForVehicle(vehicleId: string): Array<{ date: Date; miles: number }> {
    const stored = this.odometerReadings().filter(r => r.vehicleId === vehicleId);
    const fromRecords = this.maintenanceRecords().filter(r => r.vehicleId === vehicleId && r.mileage > 0);
    return [
      ...stored.map(r => ({ date: r.date, miles: r.miles })),
      ...fromRecords.map(r => ({ date: r.date, miles: r.mileage }))
    ];
  }

  getOdometerEstimate(vehicle: Vehicle, now: Date = new Date()): OdometerEstimate {
    return estimateOdometer({
      readings: this.getReadingsForVehicle(vehicle.id),
      currentMileage: vehicle.currentMileage,
      milesPerYear: vehicle.milesPerYear
    }, now);
  }

  /** Every scheduled service plus registration for one vehicle, most urgent first. */
  getServiceStatuses(vehicle: Vehicle, now: Date = new Date()): ServiceStatus[] {
    const estimate = this.getOdometerEstimate(vehicle, now);
    const records = this.maintenanceRecords().filter(r => r.vehicleId === vehicle.id);
    const statuses = this.getScheduleForVehicle(vehicle).map(i => computeServiceStatus(i, records, estimate, now));
    const registration = computeRegistrationStatus(vehicle.registrationExpiry, now);
    if (registration) statuses.push(registration);
    return statuses.sort(compareStatuses);
  }

  /** Overdue and due-soon items across all vehicles; the feed for the page's attention list. */
  getAttentionItems(now: Date = new Date()): Array<{ vehicle: Vehicle; status: ServiceStatus }> {
    return this.vehicles()
      .flatMap(vehicle => this.getServiceStatuses(vehicle, now).map(status => ({ vehicle, status })))
      .filter(i => i.status.status === 'overdue' || i.status.status === 'soon')
      .sort((a, b) => compareStatuses(a.status, b.status));
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
