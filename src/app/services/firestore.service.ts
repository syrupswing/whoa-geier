import { Injectable, signal } from '@angular/core';
import { initializeApp, FirebaseApp } from 'firebase/app';
import { 
  getFirestore, 
  Firestore, 
  collection, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  getDocs, 
  onSnapshot,
  query,
  Unsubscribe,
  QuerySnapshot,
  DocumentData,
  getDoc,
  setDoc,
  increment,
  deleteField
} from 'firebase/firestore';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class FirestoreService {
  private app: FirebaseApp | null = null;
  private db: Firestore | null = null;
  
  isInitialized = signal<boolean>(false);
  error = signal<string | null>(null);

  constructor() {
    if (environment.firebase && this.hasValidFirebaseConfig()) {
      this.initialize();
    }
  }

  /**
   * Check if Firebase config is valid
   */
  private hasValidFirebaseConfig(): boolean {
    return environment.firebase.apiKey !== 'YOUR_FIREBASE_API_KEY' &&
           environment.firebase.projectId !== 'YOUR_PROJECT_ID';
  }

  /**
   * Initialize Firebase
   */
  private initialize(): void {
    try {
      this.app = initializeApp(environment.firebase);
      this.db = getFirestore(this.app);
      this.isInitialized.set(true);
      this.error.set(null);
    } catch (err: any) {
      this.error.set(`Failed to initialize Firebase: ${err.message}`);
      console.error('Firebase initialization error:', err);
    }
  }

  /**
   * Remove undefined values before setDoc, since Firestore rejects undefined.
   */
  private sanitizeForSet<T extends Record<string, any>>(data: T): Record<string, any> {
    const sanitized: Record<string, any> = {};
    Object.keys(data).forEach((key) => {
      const value = data[key];
      if (value !== undefined) {
        sanitized[key] = value;
      }
    });
    return sanitized;
  }

  /**
   * Convert undefined values to field deletes for updateDoc.
   */
  private sanitizeForUpdate<T extends Record<string, any>>(data: T): Record<string, any> {
    const sanitized: Record<string, any> = {};
    Object.keys(data).forEach((key) => {
      const value = data[key];
      sanitized[key] = value === undefined ? deleteField() : value;
    });
    return sanitized;
  }

  /**
   * Get all documents from a collection
   */
  async getCollection<T>(collectionName: string): Promise<T[]> {
    if (!this.db) {
      throw new Error('Firestore not initialized');
    }

    try {
      const querySnapshot = await getDocs(collection(this.db, collectionName));
      const items: T[] = [];
      
      querySnapshot.forEach((doc) => {
        items.push({ id: doc.id, ...doc.data() } as T);
      });
      
      return items;
    } catch (err: any) {
      this.error.set(`Error getting collection: ${err.message}`);
      console.error('Firestore get error:', err);
      return [];
    }
  }

  /**
   * Subscribe to real-time updates for a collection
   */
  subscribeToCollection<T>(
    collectionName: string,
    callback: (items: T[]) => void
  ): Unsubscribe | null {
    if (!this.db) {
      console.warn('Firestore not initialized');
      return null;
    }

    try {
      const q = query(collection(this.db, collectionName));
      
      return onSnapshot(q, (querySnapshot: QuerySnapshot<DocumentData>) => {
        const items: T[] = [];
        querySnapshot.forEach((doc) => {
          items.push({ id: doc.id, ...doc.data() } as T);
        });
        callback(items);
      }, (err) => {
        this.error.set(`Error subscribing to collection: ${err.message}`);
        console.error('Firestore subscription error:', err);
      });
    } catch (err: any) {
      this.error.set(`Error setting up subscription: ${err.message}`);
      console.error('Firestore subscription setup error:', err);
      return null;
    }
  }

  /**
   * Add a document to a collection (auto-generates ID)
   */
  async addDocument<T>(collectionName: string, data: Partial<T>): Promise<string | null> {
    if (!this.db) {
      throw new Error('Firestore not initialized');
    }

    try {
      const docRef = await addDoc(collection(this.db, collectionName), {
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      return docRef.id;
    } catch (err: any) {
      this.error.set(`Error adding document: ${err.message}`);
      console.error('Firestore add error:', err);
      return null;
    }
  }

  /**
   * Set a document with a specific ID
   */
  async setDocument<T>(
    collectionName: string,
    documentId: string,
    data: Partial<T>
  ): Promise<boolean> {
    if (!this.db) {
      throw new Error('Firestore not initialized');
    }

    try {
      const docRef = doc(this.db, collectionName, documentId);
      const sanitizedData = this.sanitizeForSet(data as Record<string, any>);
      await setDoc(docRef, {
        ...sanitizedData,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      });
      return true;
    } catch (err: any) {
      this.error.set(`Error setting document: ${err.message}`);
      console.error('Firestore set error:', err);
      return false;
    }
  }

  /**
   * Update a document in a collection
   */
  async updateDocument<T>(
    collectionName: string,
    documentId: string,
    data: Partial<T>
  ): Promise<boolean> {
    if (!this.db) {
      throw new Error('Firestore not initialized');
    }

    try {
      const docRef = doc(this.db, collectionName, documentId);

      // Convert undefined updates to explicit field deletes for Firestore.
      const updateData = this.sanitizeForUpdate(data as Record<string, any>);
      updateData['updatedAt'] = new Date().toISOString();
      
      console.log(`Updating Firestore doc ${documentId} in ${collectionName}:`, updateData);
      await updateDoc(docRef, updateData);
      console.log('Firestore update successful');
      return true;
    } catch (err: any) {
      this.error.set(`Error updating document: ${err.message}`);
      console.error('Firestore update error:', err);
      return false;
    }
  }

  /**
   * Delete a document from a collection
   */
  async deleteDocument(collectionName: string, documentId: string): Promise<boolean> {
    if (!this.db) {
      throw new Error('Firestore not initialized');
    }

    try {
      const docRef = doc(this.db, collectionName, documentId);
      await deleteDoc(docRef);
      return true;
    } catch (err: any) {
      this.error.set(`Error deleting document: ${err.message}`);
      console.error('Firestore delete error:', err);
      return false;
    }
  }

  async getDocument<T>(collectionName: string, documentId: string): Promise<T | null> {
    if (!this.db) return null;
    try {
      const docRef = doc(this.db, collectionName, documentId);
      const snap = await getDoc(docRef);
      return snap.exists() ? (snap.data() as T) : null;
    } catch (err: any) {
      console.error('Firestore getDocument error:', err);
      return null;
    }
  }

  /**
   * Get app-wide stats (API counter, etc.)
   */
  async getAppStats(): Promise<{ apiCallCount: number } | null> {
    if (!this.db) {
      return null;
    }

    try {
      const statsRef = doc(this.db, 'app-stats', 'global');
      const statsDoc = await getDoc(statsRef);
      
      if (statsDoc.exists()) {
        return statsDoc.data() as { apiCallCount: number };
      } else {
        // Initialize if doesn't exist
        await setDoc(statsRef, { apiCallCount: 0 });
        return { apiCallCount: 0 };
      }
    } catch (err: any) {
      console.error('Error getting app stats:', err);
      return null;
    }
  }

  /**
   * Subscribe to app-wide stats for real-time updates
   */
  subscribeToAppStats(callback: (apiCallCount: number) => void): Unsubscribe | null {
    if (!this.db) {
      return null;
    }

    try {
      const statsRef = doc(this.db, 'app-stats', 'global');
      
      return onSnapshot(statsRef, async (docSnapshot) => {
        if (docSnapshot.exists()) {
          const data = docSnapshot.data();
          callback(data['apiCallCount'] || 0);
        } else {
          // Initialize if doesn't exist
          await setDoc(statsRef, { apiCallCount: 0 });
          callback(0);
        }
      }, (err) => {
        console.error('Error subscribing to app stats:', err);
      });
    } catch (err: any) {
      console.error('Error setting up app stats subscription:', err);
      return null;
    }
  }

  /**
   * Increment API call counter in Firestore
   */
  async incrementApiCounter(): Promise<boolean> {
    if (!this.db) {
      return false;
    }

    try {
      const statsRef = doc(this.db, 'app-stats', 'global');
      await updateDoc(statsRef, {
        apiCallCount: increment(1)
      });
      return true;
    } catch (err: any) {
      // If document doesn't exist, create it
      if (err.code === 'not-found') {
        try {
          const statsRef = doc(this.db!, 'app-stats', 'global');
          await setDoc(statsRef, { apiCallCount: 1 });
          return true;
        } catch (createErr: any) {
          console.error('Error creating app stats:', createErr);
          return false;
        }
      }
      console.error('Error incrementing API counter:', err);
      return false;
    }
  }

  /**
   * Reset API call counter
   */
  async resetApiCounter(): Promise<boolean> {
    if (!this.db) {
      return false;
    }

    try {
      const statsRef = doc(this.db, 'app-stats', 'global');
      await setDoc(statsRef, { apiCallCount: 0 });
      return true;
    } catch (err: any) {
      console.error('Error resetting API counter:', err);
      return false;
    }
  }

  /**
   * Get all reading entries
   */
  async getReadingEntries(): Promise<any[]> {
    return this.getCollection('reading-entries');
  }

  /**
   * Subscribe to reading entries for real-time updates
   */
  subscribeToReadingEntries(
    callback: (entries: any[]) => void
  ): Unsubscribe | null {
    return this.subscribeToCollection('reading-entries', callback);
  }

  /**
   * Add a reading entry
   */
  async addReadingEntry(minutes: number): Promise<string | null> {
    if (!this.db || minutes <= 0) {
      return null;
    }

    try {
      const entry = {
        minutes,
        timestamp: new Date().toISOString(),
        date: new Date().toLocaleDateString('en-US', { 
          year: 'numeric', 
          month: 'short', 
          day: 'numeric' 
        })
      };
      return await this.addDocument('reading-entries', entry);
    } catch (err: any) {
      console.error('Error adding reading entry:', err);
      return null;
    }
  }

  /**
   * Delete a reading entry
   */
  async deleteReadingEntry(entryId: string): Promise<boolean> {
    return this.deleteDocument('reading-entries', entryId);
  }
}
