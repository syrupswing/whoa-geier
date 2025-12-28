# Google Gemini AI Setup Guide

This guide will help you set up Google Gemini AI for intelligent suggestions in your Family Command Center app.

## Getting Your API Key

1. **Visit Google AI Studio**
   - Go to: https://aistudio.google.com/app/apikey
   - Sign in with your Google account

2. **Create API Key**
   - Click "Create API Key"
   - Select an existing Google Cloud project or create a new one
   - Copy the generated API key

3. **Add to Environment File**
   - Open `src/environments/environment.ts`
   - Replace `'YOUR_GEMINI_API_KEY'` with your actual API key:
   ```typescript
   geminiApiKey: 'AIzaSyDD8N6dWTbI8B3ZQhwDGsBxrRQyBzRJo8M' // Your actual key
   ```

## Features Enabled by Gemini AI

### 🍳 Recipe Suggestions
- **AI-Powered Recipe Ideas**: Get recipe suggestions based on ingredients you have
- **Smart Search**: Generate recipes for specific cuisines, dietary needs, or occasions
- **Ingredient-Based**: Tell AI what's in your fridge and get recipe ideas

### 🛒 Grocery List Assistant
- **Smart Shopping Lists**: Generate grocery lists from your meal plan
- **Missing Ingredients**: Identify what you need to buy for specific recipes
- **Avoid Duplicates**: AI checks your existing items before suggesting

### 📅 Meal Planning
- **Weekly Meal Plans**: Get AI-generated meal plans for the week
- **Dietary Preferences**: Customize based on vegetarian, vegan, gluten-free, etc.
- **Variety Suggestions**: AI ensures diverse meals throughout the week

### 🍴 Restaurant Recommendations
- **Cuisine-Based**: Get suggestions for specific types of food
- **Delivery Options**: Find restaurants available on your preferred delivery apps
- **Personalized**: Recommendations based on your preferences

### 👨‍🍳 Cooking Assistant
- **Ingredient Substitutions**: "What can I use instead of buttermilk?"
- **Cooking Tips**: "How do I know when salmon is done?"
- **Technique Help**: Get quick answers to cooking questions

## Usage Examples

### In Recipes Component
```typescript
// Click "AI Suggestions" button in the Recipes tab
// Enter: "quick dinner with chicken and vegetables"
// Get 3 AI-generated recipe suggestions
```

### In Grocery List
```typescript
// Click "AI Grocery List" button
// AI analyzes your planned recipes and suggests needed items
```

### Meal Planning
```typescript
// Click "AI Meal Plan" in Food Hub
// Specify preferences: "vegetarian, family of 4, under 30 minutes"
// Get a full week of meal suggestions
```

## API Usage & Limits

- **Free Tier**: 60 requests per minute
- **Cost**: Free for moderate usage (check current pricing at https://ai.google.dev/pricing)
- **Rate Limiting**: The service handles rate limits gracefully

## Security Notes

⚠️ **Important Security Practices:**

1. **Never Commit API Keys**: The `.gitignore` already excludes environment files
2. **Use Environment Variables**: In production, use environment variables instead of hardcoding
3. **Restrict API Key**: In Google Cloud Console, restrict your key to:
   - HTTP referrers (websites) - add your domains
   - API restrictions - enable only Gemini API

## Testing the Integration

1. Add your API key to `environment.ts`
2. Restart the dev server: `npm start`
3. Navigate to Food Hub → Recipes
4. Click the "AI Suggestions" button (sparkles icon)
5. Enter a prompt and watch the AI generate recipes!

## Troubleshooting

### "API key not configured" error
- Check that you've added the key to `environment.ts`
- Restart the development server

### "API request failed: 400" error
- Verify your API key is correct
- Check that you've enabled the Gemini API in Google Cloud Console

### "Rate limit exceeded" error
- You've hit the free tier limit (60 requests/min)
- Wait a minute and try again
- Consider upgrading to paid tier for higher limits

## Alternative AI Services

While this app uses Google Gemini, you can adapt the service for:
- **OpenAI GPT**: Replace the API calls with OpenAI's API
- **Anthropic Claude**: Use Claude's API for suggestions
- **Local LLM**: Use Ollama or similar for offline AI

The `GeminiAiService` can be modified to work with any AI API by updating the `generateContent()` method.

## Next Steps

Once configured, AI suggestions will be available in:
- ✅ Recipes tab (AI recipe generation)
- ✅ Grocery List (smart item suggestions)  
- ✅ Meal planning features
- ✅ Restaurant recommendations
- ✅ Cooking help and tips

Enjoy your AI-powered family command center! 🚀
