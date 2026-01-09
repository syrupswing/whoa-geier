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
  useFirebaseProxy: false, // Set to true when Firebase Function is deployed
  useFirestore: true, // Use Firestore for data storage
  githubToken: 'YOUR_GITHUB_TOKEN_HERE', // Add your token for now, or deploy Firebase Function
  weatherApiKey: '92201f509d2af1b53bba583a108c2422',
  defaultCity: 'Minneapolis'
};
