import { Injectable, signal } from '@angular/core';
import { 
  Auth, 
  User, 
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup
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
   * Create a new account with email and password
   */
  async signUpWithEmail(email: string, password: string): Promise<void> {
    if (!this.auth) throw new Error('Auth not initialized');
    
    try {
      await createUserWithEmailAndPassword(this.auth, email, password);
    } catch (error: any) {
      throw new Error(this.getErrorMessage(error.code));
    }
  }

  /**
   * Sign in with Google
   */
  async signInWithGoogle(): Promise<void> {
    if (!this.auth) throw new Error('Auth not initialized');
    
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(this.auth, provider);
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
      case 'auth/email-already-in-use':
        return 'An account already exists with this email';
      case 'auth/weak-password':
        return 'Password should be at least 6 characters';
      case 'auth/popup-closed-by-user':
        return 'Sign-in popup was closed';
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
