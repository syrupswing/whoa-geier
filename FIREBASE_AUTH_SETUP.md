# Firebase Setup with Authentication

## Step-by-Step Setup Guide

### 1. Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project"
3. Enter project name: "family-command-center" (or your choice)
4. Disable Google Analytics (optional for this project)
5. Click "Create project"

### 2. Register Your Web App

1. In Firebase project overview, click the web icon (`</>`)
2. Register app:
   - App nickname: "Family Command Center"
   - Check "Also set up Firebase Hosting" (optional)
   - Click "Register app"

3. **Copy your Firebase config** - it looks like this:

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc..."
};
```

### 3. Enable Firestore Database

1. In Firebase Console sidebar, click "Firestore Database"
2. Click "Create database"
3. Choose "Start in test mode" (for now)
4. Select location (us-central or closest to you)
5. Click "Enable"

### 4. Enable Authentication

1. In Firebase Console sidebar, click "Authentication"
2. Click "Get started"
3. Click "Sign-in method" tab
4. Enable **Email/Password**:
   - Toggle "Email/Password" to enabled
   - Click "Save"

5. Enable **Google Sign-in** (optional but recommended):
   - Toggle "Google" to enabled
   - Enter project support email
   - Click "Save"

### 5. Configure Firestore Security Rules

1. In Firestore Database, click "Rules" tab
2. Replace with these rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Require authentication for all operations
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
    
    // Optional: Add user-specific rules
    // Only allow users to read/write their own data
    match /groceryItems/{itemId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null && 
        (resource.data.userId == request.auth.uid || !resource.data.keys().hasAny(['userId']));
    }
  }
}
```

3. Click "Publish"

### 6. Update Environment Files

Open `src/environments/environment.ts`:

```typescript
export const environment = {
  production: false,
  firebase: {
    apiKey: 'YOUR_API_KEY_FROM_STEP_2',
    authDomain: 'your-project.firebaseapp.com',
    projectId: 'your-project-id',
    storageBucket: 'your-project.appspot.com',
    messagingSenderId: '123456789',
    appId: '1:123456789:web:abc...'
  },
  useFirestore: true,  // Set to true!
  // ... rest of config
};
```

Do the same for `src/environments/environment.prod.ts`

### 7. Test Your Setup

1. Start your app: `npm start`
2. You should be redirected to the login page
3. Click "Sign Up" and create an account
4. Or click "Sign in with Google"
5. Once logged in, you'll see the dashboard

### 8. Add Your First User

**Option A: Email/Password**
1. Go to login page
2. Click "Need an account? Sign Up"
3. Enter email and password
4. Click "Sign Up"

**Option B: Google Sign-in**
1. Go to login page
2. Click "Sign in with Google"
3. Select your Google account

### 9. Verify Everything Works

1. Add a grocery item
2. Check Firebase Console → Firestore Database
3. You should see `groceryItems` collection with your item
4. The item should have a `userId` field matching your user ID
5. Open app in another browser/device
6. Sign in with the same account
7. Your grocery items should sync automatically!

## Multi-User Setup

### Adding Family Members

1. Each family member creates their own account
2. They'll see all grocery items (shared list)
3. Items are marked with who created them

### Optional: Make Lists Private Per User

If you want each user to have their own private lists, update the Firestore rules:

```javascript
match /groceryItems/{itemId} {
  allow read, write: if request.auth != null && 
    resource.data.userId == request.auth.uid;
  allow create: if request.auth != null;
}
```

## Troubleshooting

**"Firebase not initialized"**
- Check that `useFirestore: true` in environment.ts
- Verify all Firebase config values are correct (not placeholder text)

**"Missing or insufficient permissions"**
- Make sure you're signed in
- Check Firestore rules allow authenticated users
- Publish the rules

**"User not redirected to login"**
- Clear browser cache and cookies
- Check authGuard is applied to routes

**Google Sign-in not working**
- Make sure Google provider is enabled in Firebase Console
- Check that you're using HTTPS (or localhost for development)
- Verify authorized domains in Firebase Console → Authentication → Settings

## Security Best Practices

1. **Never commit Firebase config to public repos**
   - Add environment files to `.gitignore`
   - Use environment variables for production

2. **Update Firestore rules for production**
   - Don't use test mode rules in production
   - Implement proper user-based access control

3. **Enable App Check** (optional, for production)
   - Protects your backend resources from abuse
   - Set up in Firebase Console → App Check

4. **Monitor Usage**
   - Check Firebase Console → Usage tab
   - Set up budget alerts
   - Free tier is generous but monitor for unexpected spikes

## Data Structure

Your data will be organized like this:

```
Firestore Database
├─ groceryItems (collection)
│  ├─ {auto-id}
│  │  ├─ name: "Milk"
│  │  ├─ completed: false
│  │  ├─ userId: "abc123..."
│  │  ├─ createdAt: "2025-12-28T..."
│  │  └─ updatedAt: "2025-12-28T..."
│  └─ ...
│
└─ users (collection) - optional future feature
   ├─ {userId}
   │  ├─ email: "user@example.com"
   │  ├─ displayName: "John Doe"
   │  └─ preferences: {...}
   └─ ...
```

## Next Steps

Once authentication is working:

1. ✅ Grocery items sync across devices
2. Add user profiles with display names
3. Add family groups/sharing
4. Implement push notifications
5. Add offline support with Firestore caching
6. Extend to other features (recipes, vehicles, etc.)

## Resources

- [Firebase Documentation](https://firebase.google.com/docs)
- [Firebase Auth Documentation](https://firebase.google.com/docs/auth)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)
- [Firebase Console](https://console.firebase.google.com/)

## Cost Estimate

Firebase free tier (Spark plan) includes:
- **Firestore**: 1GB storage, 50K reads/day, 20K writes/day
- **Authentication**: Unlimited users
- **Perfect for family use** - you won't hit limits with normal usage

Monitor usage at: Firebase Console → Usage and billing
