export const environment = {
  production: false,
  googleCalendar: {
    // Get these credentials from Google Cloud Console
    // 1. Go to https://console.cloud.google.com/
    // 2. Create a new project or select existing one
    // 3. Enable Google Calendar API
    // 4. Create OAuth 2.0 Client ID (Web application)
    // 5. Add authorized JavaScript origins: http://localhost:4200
    // 6. Add authorized redirect URIs: http://localhost:4200
    // NOTE: API key is optional when using OAuth 2.0 - you only need the clientId
    apiKey: '', // Optional - leave empty when using OAuth
    clientId: '675585365638-bi72vup1j25pgpa2orhul8i18507cs4p.apps.googleusercontent.com',
    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
    scopes: 'https://www.googleapis.com/auth/calendar.readonly'
  },
  firebase: {
    // Get these from Firebase Console: https://console.firebase.google.com/
    // 1. Create a new project (can use same as Google Calendar)
    // 2. Add a web app to your Firebase project
    // 3. Copy the config values here
    apiKey: 'YOUR_FIREBASE_API_KEY',
    authDomain: 'YOUR_PROJECT_ID.firebaseapp.com',
    projectId: 'YOUR_PROJECT_ID',
    storageBucket: 'YOUR_PROJECT_ID.appspot.com',
    messagingSenderId: 'YOUR_MESSAGING_SENDER_ID',
    appId: 'YOUR_APP_ID'
  },
  useFirestore: false, // Set to true when Firebase is configured and you want to use it
  githubToken: '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', // Get from https://github.com/settings/tokens?type=beta (requires 'Model inference: Read' permission)
  weatherApiKey: 'c37a84f138d1e7f4b0d12cf11f010e7a', // Get from https://openweathermap.org/api (free tier available)
  defaultCity: 'Minneapolis' // Fallback city if geolocation fails
};
