import { Injectable, signal } from '@angular/core';
import { getApp } from 'firebase/app';
import { getMessaging, getToken, onMessage, Messaging } from 'firebase/messaging';
import { FirestoreService } from './firestore.service';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class PushNotificationService {
  /** Whether the browser/OS supports Web Push */
  isSupported = signal<boolean>(false);
  /** Current Notification permission state */
  permissionState = signal<NotificationPermission>('default');
  /** The FCM registration token for this device */
  fcmToken = signal<string | null>(null);

  private messaging: Messaging | null = null;
  private messagingSetUp = false;

  constructor(private firestoreService: FirestoreService) {}

  /**
   * Call once on app startup (after Firebase is initialized).
   * Checks support and, if permission is already granted, sets up FCM.
   */
  async initialize(): Promise<void> {
    if (!this.checkSupport()) {
      return;
    }
    this.isSupported.set(true);
    this.permissionState.set(Notification.permission);

    if (Notification.permission === 'granted') {
      await this.setupMessaging();
    }
  }

  /**
   * Request notification permission from the user.
   * Must be called from a user-gesture handler (button click, etc.) on iOS.
   * Returns true if permission was granted.
   */
  async requestPermission(): Promise<boolean> {
    if (!this.isSupported()) {
      return false;
    }
    const permission = await Notification.requestPermission();
    this.permissionState.set(permission);

    if (permission === 'granted') {
      await this.setupMessaging();
      return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private checkSupport(): boolean {
    return (
      typeof window !== 'undefined' &&
      'Notification' in window &&
      'serviceWorker' in navigator &&
      'PushManager' in window
    );
  }

  private async setupMessaging(): Promise<void> {
    if (this.messagingSetUp) {
      return;
    }
    this.messagingSetUp = true;

    if (!environment.firebase.vapidKey) {
      console.warn('PushNotificationService: vapidKey is not configured in environment.');
      return;
    }

    try {
      const app = getApp(); // Reuse the already-initialized Firebase app
      this.messaging = getMessaging(app);

      // Derive the SW path relative to the app's base href so it works
      // on both localhost and sub-path deployments like /whoa-geier/
      const swPath = new URL('firebase-messaging-sw.js', document.baseURI).pathname;
      const swRegistration = await navigator.serviceWorker.register(swPath);

      const token = await getToken(this.messaging, {
        vapidKey: environment.firebase.vapidKey,
        serviceWorkerRegistration: swRegistration
      });

      if (token) {
        this.fcmToken.set(token);
        await this.saveTokenToFirestore(token);
      }

      // Handle messages while the app is in the foreground
      onMessage(this.messaging, (payload) => {
        // Only show a manual notification when the page is visible;
        // when backgrounded the service worker handles it automatically.
        if (document.visibilityState !== 'visible') {
          return;
        }
        const title = payload.notification?.title ?? 'Whoa Geier';
        const body = payload.notification?.body ?? '';
        if (Notification.permission === 'granted') {
          new Notification(title, {
            body,
            icon: '/assets/icons/icon-192x192.png'
          });
        }
      });
    } catch (err) {
      console.error('PushNotificationService setup error:', err);
    }
  }

  private async saveTokenToFirestore(token: string): Promise<void> {
    if (!this.firestoreService.isInitialized()) {
      return;
    }
    // Store each device token keyed by the token itself so saves are idempotent
    await this.firestoreService.setDocument('fcm-tokens', token, {
      token,
      platform: navigator.platform,
      createdAt: new Date().toISOString()
    });
  }
}
