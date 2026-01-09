# Firebase Cloud Functions Setup for Secure AI Proxy

This guide helps you set up Firebase Cloud Functions to securely proxy AI requests without exposing your GitHub PAT in the frontend.

## Prerequisites

- Firebase CLI installed: `npm install -g firebase-tools`
- Firebase project created (you already have this)
- GitHub Personal Access Token

## Setup Steps

### 1. Install Firebase CLI (if not already installed)
```bash
npm install -g firebase-tools
```

### 2. Login to Firebase
```bash
firebase login
```

### 3. Initialize Firebase (if not already done)
```bash
firebase init
```
Select:
- Functions (Space to select, Enter to confirm)
- Use existing project (select your whoa-geier project)
- JavaScript
- No ESLint
- Yes to install dependencies

### 4. Install Function Dependencies
```bash
cd functions
npm install
cd ..
```

### 5. Configure GitHub Token (IMPORTANT - this keeps it secure)

**Create a `.env` file in the functions directory:**
```bash
cd functions
cp .env.example .env
```

**Edit `.env` and add your GitHub token:**
```bash
GITHUB_TOKEN=github_pat_YOUR_TOKEN_HERE
```

Replace `github_pat_YOUR_TOKEN_HERE` with your actual GitHub token (starts with `github_pat_` or `ghp_`).

**This stores the token securely - it will NOT be committed to git!**

### 6. Deploy the Function
```bash
firebase deploy --only functions
```

This deploys the `aiProxy` function to Firebase.

### 7. Test Locally (Optional)
```bash
# Start emulator
firebase emulators:start --only functions

# In another terminal, test it
npm start
```

## How It Works

**Local Development:**
- Uses your GitHub PAT from `environment.local.ts`
- Calls GitHub Models API directly

**Production (deployed):**
- Frontend calls Firebase Cloud Function
- Function uses secure token from Firebase config
- Function calls GitHub Models API
- Response returned to frontend

**Your GitHub PAT is never exposed in the deployed JavaScript!**

## Verify Deployment

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Select your project
3. Go to Functions → should see `aiProxy` deployed
4. Check logs if needed

## Update GitHub Actions (Already Done)

The deploy.yml has been updated to NOT inject the GitHub PAT into the frontend code.

## Costs

Firebase Functions free tier includes:
- 2 million invocations/month
- 400,000 GB-seconds/month
- 200,000 CPU-seconds/month

Your usage should easily fit within the free tier.

## Troubleshooting

**"GitHub token not configured" error:**
```bash
firebase functions:config:get
```
Should show `github.token`. If not, set it again:
```bash
firebase functions:config:set github.token="your_token_here"
firebase deploy --only functions
```

**Function not deploying:**
- Ensure you're on the Blaze (pay-as-you-go) plan (free tier is sufficient)
- Check Firebase Console → Functions for error logs
