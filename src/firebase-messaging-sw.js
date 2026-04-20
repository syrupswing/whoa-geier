// Firebase Cloud Messaging Service Worker
// This file must be served from the root of your domain.
// It handles background push notifications when the app is not in the foreground.
// Required for iOS 16.4+ Web Push when added to Home Screen.

importScripts('https://www.gstatic.com/firebasejs/12.7.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/12.7.0/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey: 'FIREBASE_API_KEY_PLACEHOLDER',
  authDomain: 'whoa-geier.firebaseapp.com',
  projectId: 'whoa-geier',
  storageBucket: 'whoa-geier.firebasestorage.app',
  messagingSenderId: '457123034868',
  appId: '1:457123034868:web:4dac03baaae1786da390a1'
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  // Notification messages (with a `notification` field) are automatically displayed
  // by the OS/browser via APNs on iOS. Calling showNotification here would create a duplicate.
  // Only manually show a notification for data-only messages.
  if (payload.notification) {
    return;
  }

  const title = payload.data?.title ?? 'Whoa Geier';
  const options = {
    body: payload.data?.body ?? '',
    icon: '/assets/icons/icon-192x192.png',
    badge: '/assets/icons/icon-192x192.png',
    data: payload.data ?? {}
  };
  self.registration.showNotification(title, options);
});
