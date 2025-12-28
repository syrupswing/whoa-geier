# Firebase Setup Guide

This guide will help you set up Firebase/Firestore for your Family Command Center app to enable real-time data syncing across all family members' devices.

## Why Firebase?

- **Real-time sync**: All family members see the same grocery list instantly
- **Cloud storage**: Data persists even if you clear your browser
- **Multi-device**: Access from phone, tablet, or computer
- **Free tier**: Generous free plan perfect for family apps
- **Same Google account**: Use the same Google Cloud project as your Calendar API

## Setup Steps

### 1. Go to Firebase Console

Visit [Firebase Console](https://console.firebase.google.com/)

### 2. Add Firebase to Your Existing Project

Since you already have a Google Cloud project for Calendar API:

1. Click "Add project"
2. **Select your existing project** (the one with Calendar API)
3. Confirm Firebase billing plan (free Spark plan is fine)
4. Enable Google Analytics (optional, can skip)
5. Click "Continue"

### 3. Create a Web App

1. In your Firebase project, click the web icon (`</>`) to add a web app
2. Register app:
   - App nickname: "Family Command Center"
   - Check "Also set up Firebase Hosting" (optional)
   - Click "Register app"

3. **Copy your Firebase config** - you'll see something like:

```javascript
const firebaseConfig = {
  apiKey: "AIzaSyD...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef"
};
```

### 4. Enable Firestore Database

1. In Firebase Console, go to "Build" → "Firestore Database"
2. Click "Create database"
3. Choose "Start in test mode" (for development)
   - Test mode allows read/write without authentication
   - We'll secure it later
4. Choose a location (pick closest to you)
5. Click "Enable"

### 5. Configure Firestore Security Rules

For a family app, you'll want to secure your data. In Firestore, click "Rules" tab:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow all reads and writes (for testing)
    // TODO: Add proper authentication rules later
    match /{document=**} {
      allow read, write: if true;
    }
  }
}
```

**For production**, update rules to require authentication:
```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Require users to be signed in
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### 6. Update Your Environment Files

Open `src/environments/environment.ts` and replace the Firebase config:

```typescript
firebase: {
  apiKey: 'AIzaSyD...',  // Your actual API key from step 3
  authDomain: 'your-project.firebaseapp.com',
  projectId: 'your-project-id',
  storageBucket: 'your-project.appspot.com',
  messagingSenderId: '123456789',
  appId: '1:123456789:web:abcdef'
},
useFirestore: true  // Change to true to enable Firestore
```

Do the same for `src/environments/environment.prod.ts`

### 7. Test Your Setup

1. Run your app: `npm start`
2. Go to the Grocery List page
3. Add some items
4. Check Firebase Console → Firestore Database
5. You should see a `groceryItems` collection with your items!

### 8. Test Multi-Device Sync

1. Open your app in two browser windows
2. Add an item in one window
3. Watch it appear instantly in the other window! ✨

## Migration from localStorage

If you already have items stored locally:

1. Your items are automatically saved in localStorage
2. Once Firebase is configured and `useFirestore: true`
3. Use the browser console to migrate:
   ```javascript
   // In browser console
   const service = document.querySelector('app-grocery-list')?.__ngContext__?.[8]?.groceryService;
   await service.migrateToFirestore();
   ```

Or add a migration button temporarily to your UI.

## Security Best Practices

### For Production:

1. **Enable Authentication** (optional but recommended)
   ```typescript
   // In Firebase Console, enable "Authentication" → "Email/Password"
   ```

2. **Update Firestore Rules** to require auth:
   ```javascript
   allow read, write: if request.auth != null;
   ```

3. **Set Budget Alerts** in Google Cloud Console to avoid unexpected charges

4. **Use Environment Variables** for production:
   - Don't commit Firebase keys to Git
   - Use environment variables or build-time injection

## Firestore Data Structure

Your grocery items are stored like this:

```
groceryItems (collection)
  ├─ {auto-id} (document)
  │   ├─ name: "Milk"
  │   ├─ completed: false
  │   ├─ createdAt: "2025-12-20T..."
  │   └─ updatedAt: "2025-12-20T..."
  ├─ {auto-id} (document)
  │   ├─ name: "Bread"
  │   └─ ...
```

## Troubleshooting

**"Missing or insufficient permissions"**
- Check Firestore Rules are in "test mode" or allow authenticated users

**Items not syncing**
- Check browser console for errors
- Verify `useFirestore: true` in environment.ts
- Check Firebase config values are correct

**Firebase not initializing**
- Make sure all config values are replaced (not "YOUR_PROJECT_ID")
- Check browser network tab for failed requests

## Costs

Firebase free tier (Spark plan):
- **Firestore**: 1GB storage, 50K reads/day, 20K writes/day
- Perfect for a family app with normal usage
- Monitor usage in Firebase Console

## Next Steps

Once Firebase is working:
1. Add more features (Quick Links, Activities)
2. Enable authentication for better security
3. Add user profiles and permissions
4. Build a mobile app with the same Firebase backend!

## Resources

- [Firebase Documentation](https://firebase.google.com/docs)
- [Firestore Documentation](https://firebase.google.com/docs/firestore)
- [Firebase Console](https://console.firebase.google.com/)
