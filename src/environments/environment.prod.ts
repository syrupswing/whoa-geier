export const environment = {
  production: true,
  googleCalendar: {
    apiKey: '',
    clientId: '675585365638-bi72vup1j25pgpa2orhul8i18507cs4p.apps.googleusercontent.com',
    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
    scopes: 'https://www.googleapis.com/auth/calendar.readonly'
  },
  firebase: {
    apiKey: "FIREBASE_API_KEY",
    authDomain: "whoa-geier.firebaseapp.com",
    projectId: "whoa-geier",
    storageBucket: "whoa-geier.firebasestorage.app",
    messagingSenderId: "457123034868",
    appId: "1:457123034868:web:4dac03baaae1786da390a1",
    measurementId: "G-YEFTQYSHBR"
  },
  useFirestore: true, // Use Firebase Function proxy in production
  githubToken: '', // NOT USED in production - function uses server-side token
  weatherApiKey: 'OPEN_WEATHER_API_KEY',
  defaultCity: 'Minneapolis'
};
