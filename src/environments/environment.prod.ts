export const environment = {
  production: true,
  geminiApiKey: 'AIzaSyDD8N6dWTbI8B3ZQhwDGsBxrRQyBzRJo8M', // Get from https://aistudio.google.com/app/apikey
  googleCalendar: {
    apiKey: '', // Optional when using OAuth
    clientId: 'YOUR_PRODUCTION_CLIENT_ID_HERE.apps.googleusercontent.com',
    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
    scopes: 'https://www.googleapis.com/auth/calendar.readonly'
  },
  firebase: {
    apiKey: 'YOUR_FIREBASE_API_KEY',
    authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT_ID.appspot.com',
    messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
    appId: 'YOUR_APP_ID'
  },
  useFirestore: true // Use Firestore in production for family sharing
};
