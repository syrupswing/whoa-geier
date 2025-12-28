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
  DocumentData
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
   * Add a document to a collection
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
      await updateDoc(docRef, {
        ...data,
        updatedAt: new Date().toISOString()
      });
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
}
