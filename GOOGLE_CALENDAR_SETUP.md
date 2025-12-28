# Google Calendar API Setup Guide

Follow these steps to enable Google Calendar integration in your Family Command Center app.

## 1. Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a Project" → "New Project"
3. Enter project name: "Family Command Center"
4. Click "Create"

## 2. Enable Google Calendar API

1. In your project, go to "APIs & Services" → "Library"
2. Search for "Google Calendar API"
3. Click on it and press "Enable"

## 3. Create OAuth 2.0 Credentials

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. If prompted, configure OAuth consent screen:
   - User Type: External
   - App name: "Family Command Center"
   - User support email: your email
   - Developer contact: your email
   - Scopes: Add `.../auth/calendar.readonly`
   - Test users: Add your Google account(s)
   - Click "Save and Continue"

4. Create OAuth Client ID:
   - Application type: "Web application"
   - Name: "Family Command Center Web Client"
   - Authorized JavaScript origins:
     - `http://localhost:4200` (for development)
     - Your production URL (when deploying)
   - Authorized redirect URIs:
     - `http://localhost:4200` (for development)
     - Your production URL (when deploying)
   - Click "Create"

5. **Save your credentials:**
   - Client ID: looks like `xxxxx.apps.googleusercontent.com`
   - Copy these values!

## 4. Create API Key

1. Still in "Credentials", click "Create Credentials" → "API key"
2. Copy the API key
3. (Recommended) Click "Restrict Key":
   - API restrictions: Select "Google Calendar API"
   - Click "Save"

## 5. Update Your Application

1. Open `src/environments/environment.ts`
2. Replace the placeholder values:

```typescript
export const environment = {
  production: false,
  googleCalendar: {
    apiKey: 'YOUR_API_KEY_HERE',  // Paste your API key
    clientId: 'YOUR_CLIENT_ID_HERE.apps.googleusercontent.com',  // Paste your Client ID
    discoveryDocs: ['https://www.googleapis.com/discovery/v1/apis/calendar/v3/rest'],
    scopes: 'https://www.googleapis.com/auth/calendar.readonly'
  }
};
```

3. For production, update `src/environments/environment.prod.ts` with production URLs

## 6. Test the Integration

1. Run your development server: `npm start`
2. Navigate to the Calendar page
3. Click "Sign In with Google"
4. Grant permission to read your calendar
5. Your Google Calendar events should now appear!

## Security Notes

- **Never commit your API keys to Git!**
- Add environment files to `.gitignore`:
  ```
  /src/environments/environment.ts
  /src/environments/environment.prod.ts
  ```
- Keep backup copies of your credentials in a secure location
- For production, use environment variables instead of hardcoded values

## Troubleshooting

### "Access blocked: This app's request is invalid"
- Make sure your OAuth consent screen is configured
- Add yourself as a test user in the OAuth consent screen

### "The JavaScript origin in the request does not match..."
- Check that your JavaScript origins match exactly (no trailing slash)
- For localhost, use `http://localhost:4200` not `http://localhost:4200/`

### "Unable to load calendar events"
- Verify the Google Calendar API is enabled
- Check that your API key has the correct restrictions
- Make sure you've granted calendar.readonly permission

### Events not showing
- The service only loads upcoming events (from today forward)
- Check that you have events in your primary Google Calendar
- Look for errors in the browser console

## API Limits

Google Calendar API has the following quotas:
- 1,000,000 queries per day
- 10 queries per second per user

For a family app, you'll be well within these limits.

## Additional Resources

- [Google Calendar API Documentation](https://developers.google.com/calendar/api/guides/overview)
- [OAuth 2.0 for Client-side Web Applications](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)
- [Google Cloud Console](https://console.cloud.google.com/)
