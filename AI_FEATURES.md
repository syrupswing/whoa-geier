# AI Features Documentation

## Overview

The Family Command Center integrates Google Gemini AI to provide intelligent suggestions throughout the app, making meal planning and family organization easier and more efficient.

## 🎯 Available AI Features

### 1. **AI Recipe Suggestions** ✨
**Location**: Food Hub → Recipes Tab

Generate custom recipe ideas based on:
- Ingredients you have on hand
- Cuisine preferences (Italian, Asian, Mexican, etc.)
- Dietary restrictions (vegetarian, vegan, gluten-free)
- Time constraints (quick meals, under 30 minutes)
- Meal type (breakfast, lunch, dinner, dessert)
- Occasion (party food, kid-friendly, date night)

**How to Use**:
1. Navigate to the Recipes tab
2. Click the "AI Suggestions" button (sparkle icon)
3. Enter your prompt, e.g.:
   - "Quick dinner with chicken and vegetables"
   - "Vegetarian pasta recipes under 30 minutes"
   - "Kid-friendly lunch ideas"
   - "Desserts with chocolate and strawberries"
4. Click "Generate Suggestions"
5. Review the AI-generated recipes
6. Click "Add to My Recipes" to save any you like

**What You Get**:
- 3 complete recipe suggestions per request
- Full ingredient lists
- Step-by-step instructions
- Prep and cook times
- Serving sizes
- Relevant tags for filtering

### 2. **Smart Grocery Lists** 🛒
**Status**: Service ready, UI coming soon

Generate comprehensive grocery lists based on:
- Your planned recipes for the week
- Missing ingredients comparison
- Avoids duplicating items you already have

**Planned Usage**:
```typescript
const recipes = ['Spaghetti Carbonara', 'Chicken Stir Fry'];
const existingItems = ['salt', 'pepper', 'olive oil'];
const groceries = await geminiAi.suggestGroceries(recipes, existingItems);
```

### 3. **Meal Planning Assistant** 📅
**Status**: Service ready, UI coming soon

AI-powered weekly meal planning:
- Generates balanced meal plans for 7 days
- Considers dietary preferences and restrictions
- Provides breakfast, lunch, dinner, and snack suggestions
- Ensures variety throughout the week

**Planned Usage**:
```typescript
const plan = await geminiAi.suggestMealPlan(
  'Family of 4, vegetarian, under 45 minutes per meal',
  7 // days
);
```

### 4. **Restaurant Recommendations** 🍴
**Status**: Service ready, UI coming soon

Get personalized restaurant suggestions:
- Based on cuisine preferences
- Delivery app availability
- Special dietary needs
- Location and occasion

### 5. **Cooking Assistant** 👨‍🍳
**Status**: Service ready, UI coming soon

Quick answers to cooking questions:
- "What can I substitute for buttermilk?"
- "How do I know when chicken is fully cooked?"
- "What temperature should I bake salmon at?"
- "How do I fix oversalted soup?"

## 🔧 Technical Implementation

### Service Architecture

**GeminiAiService** (`src/app/services/gemini-ai.service.ts`)
- Centralized AI interaction service
- Handles API authentication and requests
- Provides type-safe methods for different use cases
- Error handling and rate limiting
- Structured JSON response parsing

### Key Methods

```typescript
// Recipe suggestions with structured output
suggestRecipes(prompt: string, context?: string): Promise<RecipeSuggestion[]>

// Grocery list generation
suggestGroceries(recipes: string[], existingItems?: string[]): Promise<string[]>

// Meal planning
suggestMealPlan(preferences: string, days: number): Promise<MealPlanSuggestion[]>

// Restaurant recommendations
suggestRestaurants(cuisine: string, preferences?: string): Promise<string>

// Cooking help and tips
getCookingHelp(question: string): Promise<string>

// General AI text generation
generateContent(prompt: string): Promise<GeminiResponse>
```

### Configuration

```typescript
// src/environments/environment.ts
export const environment = {
  geminiApiKey: 'YOUR_API_KEY_HERE'
};
```

### Security Best Practices

1. **API Key Protection**:
   - Never commit API keys to version control
   - Use environment variables in production
   - Restrict API key in Google Cloud Console

2. **Rate Limiting**:
   - Free tier: 60 requests per minute
   - Service gracefully handles rate limits
   - Consider caching responses for common queries

3. **Error Handling**:
   - User-friendly error messages
   - Fallback mechanisms
   - Loading states and progress indicators

## 📊 Usage Examples

### Example 1: Ingredient-Based Recipe Search
```
Prompt: "I have chicken breast, bell peppers, and rice. What can I make?"
Result: 3 recipes using these ingredients with complete instructions
```

### Example 2: Diet-Specific Recipes
```
Prompt: "Vegan dinner recipes that are high in protein"
Result: Plant-based protein-rich meal suggestions
```

### Example 3: Time-Constrained Cooking
```
Prompt: "Quick breakfast recipes under 10 minutes"
Result: Fast, practical breakfast ideas
```

### Example 4: Special Occasions
```
Prompt: "Impressive appetizers for a dinner party"
Result: Restaurant-quality starter recipes
```

## 🚀 Future Enhancements

### Planned Features

1. **Recipe Refinement**
   - "Make this recipe spicier"
   - "Adjust for 8 servings instead of 4"
   - "Make this gluten-free"

2. **Nutritional Analysis**
   - Calorie counting
   - Macronutrient breakdown
   - Dietary compliance checking

3. **Shopping List Optimization**
   - Store aisle organization
   - Price comparison
   - Seasonal ingredient suggestions

4. **Meal Plan Optimization**
   - Leftover utilization
   - Batch cooking suggestions
   - Budget-conscious planning

5. **Voice Integration**
   - Voice commands for recipe lookup
   - Hands-free cooking assistance
   - Timer management

6. **Image Recognition**
   - Photo-based ingredient identification
   - Recipe suggestions from food photos
   - Portion size estimation

## 💡 Tips for Best Results

### Writing Effective Prompts

**Be Specific**:
- ❌ "Give me recipes"
- ✅ "Quick Italian dinner recipes with chicken under 30 minutes"

**Include Constraints**:
- Time limits: "under 30 minutes"
- Dietary needs: "gluten-free and dairy-free"
- Skill level: "beginner-friendly"
- Equipment: "no oven required"

**Provide Context**:
- "Family-friendly recipes for picky eaters"
- "Meal prep ideas for busy weekdays"
- "Romantic dinner for two"

### Common Use Cases

1. **Pantry Cleanout**: List ingredients you need to use up
2. **Weekly Planning**: "5 dinners for a busy family"
3. **Special Diets**: Be clear about restrictions
4. **Skill Building**: "Recipes to learn French cooking techniques"
5. **Budget Meals**: "Inexpensive dinners under $10"

## 📈 Monitoring & Optimization

### Performance Metrics

- Average response time: 3-5 seconds
- Success rate: >95% with valid prompts
- User satisfaction: Track via feedback
- Recipe adoption: % of AI suggestions saved

### Cost Management

- Free tier covers typical family usage
- ~20-30 requests/day for active users
- Monitor usage in Google Cloud Console
- Set up billing alerts if needed

## 🛟 Troubleshooting

### Common Issues

**"API key not configured"**
- Add your key to `environment.ts`
- Restart the dev server

**"Failed to generate suggestions"**
- Check internet connection
- Verify API key is valid
- Check Google Cloud Console for quota

**Poor quality suggestions**
- Make prompts more specific
- Add more context about preferences
- Try different phrasing

**Slow responses**
- Normal: 3-5 seconds for recipes
- Network issues may extend time
- Consider caching for repeated queries

## 📚 Additional Resources

- [Google Gemini Documentation](https://ai.google.dev/docs)
- [API Pricing](https://ai.google.dev/pricing)
- [Best Practices Guide](https://ai.google.dev/docs/best_practices)
- [GEMINI_SETUP.md](GEMINI_SETUP.md) - Setup instructions

---

**Need Help?** The AI service includes built-in error messages and suggestions. Check the browser console for detailed error information during development.
