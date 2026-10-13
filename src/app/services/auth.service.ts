import { Injectable, signal } from '@angular/core';
import { 
  Auth, 
  User, 
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from 'firebase/auth';
import { getAuth } from 'firebase/auth';
import { FirestoreService } from './firestore.service';

export interface UserProfile {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private auth: Auth | null = null;
  
  currentUser = signal<UserProfile | null>(null);
  isAuthenticated = signal<boolean>(false);
  isLoading = signal<boolean>(true);

  constructor(private firestoreService: FirestoreService) {
    this.initializeAuth();
  }

  /**
   * Initialize Firebase Auth and listen for auth state changes
   */
  private initializeAuth(): void {
    if (this.firestoreService.isInitialized()) {
      this.auth = getAuth();
      
      // Listen for auth state changes
      onAuthStateChanged(this.auth, (user) => {
        if (user) {
          this.currentUser.set({
            uid: user.uid,
            email: user.email,
            displayName: user.displayName,
            photoURL: user.photoURL
          });
          this.isAuthenticated.set(true);
        } else {
          this.currentUser.set(null);
          this.isAuthenticated.set(false);
        }
        this.isLoading.set(false);
      });
    } else {
      this.isLoading.set(false);
    }
  }

  /**
   * Sign in with email and password
   */
  async signInWithEmail(email: string, password: string): Promise<void> {
    if (!this.auth) throw new Error('Auth not initialized');
    
    try {
      await signInWithEmailAndPassword(this.auth, email, password);
    } catch (error: any) {
      throw new Error(this.getErrorMessage(error.code));
    }
  }

  /**
   * Sign out
   */
  async signOut(): Promise<void> {
    if (!this.auth) throw new Error('Auth not initialized');
    await signOut(this.auth);
  }

  /**
   * Get user-friendly error messages
   */
  private getErrorMessage(errorCode: string): string {
    switch (errorCode) {
      case 'auth/invalid-email':
        return 'Invalid email address';
      case 'auth/user-disabled':
        return 'This account has been disabled';
      case 'auth/user-not-found':
        return 'No account found with this email';
      case 'auth/wrong-password':
        return 'Incorrect password';
      case 'auth/invalid-credential':
        return 'Incorrect email or password';
      // Raised when new accounts are switched off in Firebase and someone without one tries to sign in.
      case 'auth/admin-restricted-operation':
        return "This account isn't part of the family yet. Ask a family member to add you.";
      default:
        return 'An error occurred. Please try again.';
    }
  }

  /**
   * Check if auth is available
   */
  isAuthAvailable(): boolean {
    return this.auth !== null;
  }

  /**
   * Get current user ID
   */
  getUserId(): string | null {
    return this.currentUser()?.uid || null;
  }
}
