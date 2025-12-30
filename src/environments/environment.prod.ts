export const environment = {
  production: true,
  geminiApiKey: 'AIzaSyDD8N6dWTbI8B3ZQhwDGsBxrRQyBzRJo8M', // Get from https://aistudio.google.com/app/apikey
  googleCalendar: {
    apiKey: '', // Optional when using OAuth
    clientId: '675585365638-bi72vup1j25pgpa2orhul8i18507cs4p.apps.googleusercontent.com',
    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
    scopes: 'https://www.googleapis.com/auth/calendar.readonly'
  },
  firebase: {
    apiKey: "AIzaSyCkPWlwtQZAdtwmrYIeriN1MtNmwMX8s8s",
    authDomain: "whoa-geier.firebaseapp.com",
    projectId: "whoa-geier",
    storageBucket: "whoa-geier.firebasestorage.app",
    messagingSenderId: "457123034868",
    appId: "1:457123034868:web:4dac03baaae1786da390a1",
    measurementId: "G-YEFTQYSHBR"
  },
  useFirestore: true // Use Firestore in production for family sharing
};
