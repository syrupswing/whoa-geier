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
    apiKey: "AIzaSyCkPWlwtQZAdtwmrYIeriN1MtNmwMX8s8s",
    authDomain: "whoa-geier.firebaseapp.com",
    projectId: "whoa-geier",
    storageBucket: "whoa-geier.firebasestorage.app",
    messagingSenderId: "457123034868",
    appId: "1:457123034868:web:4dac03baaae1786da390a1",
    measurementId: "G-YEFTQYSHBR"
  },
  useFirestore: true, // Set to true when Firebase is configured and you want to use it (requires authentication setup)
  githubToken: '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', // Get from https://github.com/settings/tokens?type=beta (requires 'Model inference: Read' permission)
  weatherApiKey: 'c37a84f138d1e7f4b0d12cf11f010e7a', // Get from https://openweathermap.org/api (free tier available)
  defaultCity: 'Minneapolis' // Fallback city if geolocation fails
};
