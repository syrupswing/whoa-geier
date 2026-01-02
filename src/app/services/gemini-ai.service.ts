import { Injectable } from '@angular/core';
import { environment } from '../../environments/environment';

export interface GeminiResponse {
  text: string;
  success: boolean;
  error?: string;
}

export interface RecipeSuggestion {
  name: string;
  description: string;
  prepTime: number;
  cookTime: number;
  servings: number;
  ingredients: string[];
  instructions: string[];
  tags: string[];
}

export interface MealPlanSuggestion {
  day: string;
  breakfast?: string;
  lunch?: string;
  dinner?: string;
  snacks?: string[];
}

@Injectable({
  providedIn: 'root'
})
export class GeminiAiService {
  private readonly API_URL = 'https://models.inference.ai.azure.com/chat/completions';
  
  constructor() {}

  /**
   * Check if API key is configured
   */
  isConfigured(): boolean {
    return !!environment.githubToken && 
           environment.githubToken !== 'YOUR_GITHUB_PAT' && 
           environment.githubToken.startsWith('github_pat_');
  }

  /**
   * Generate recipe suggestions based on ingredients or preferences
   */
  async suggestRecipes(prompt: string, context?: string): Promise<RecipeSuggestion[]> {
    const fullPrompt = `${context ? context + '\n\n' : ''}Generate 3 recipe suggestions based on: ${prompt}

Please respond with a JSON array of recipes in this exact format:
[
  {
    "name": "Recipe Name",
    "description": "Brief description",
    "prepTime": 15,
    "cookTime": 30,
    "servings": 4,
    "ingredients": ["ingredient 1", "ingredient 2"],
    "instructions": ["step 1", "step 2"],
    "tags": ["tag1", "tag2"]
  }
]

Only return valid JSON, no additional text.`;

    const response = await this.generateContent(fullPrompt);
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to generate recipe suggestions');
    }

    try {
      // Extract JSON from response
      const jsonMatch = response.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No valid JSON found in response');
      }
      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('Error parsing recipe suggestions:', error);
      throw new Error('Failed to parse recipe suggestions');
    }
  }

  /**
   * Generate grocery list suggestions based on recipes or meals planned
   */
  async suggestGroceries(recipes: string[], existingItems?: string[]): Promise<string[]> {
    const existingItemsText = existingItems?.length 
      ? `\n\nExisting items (don't duplicate): ${existingItems.join(', ')}` 
      : '';
    
    const prompt = `Based on these planned recipes: ${recipes.join(', ')}${existingItemsText}

Generate a comprehensive grocery list. Return only a JSON array of strings, no additional text:
["item 1", "item 2", "item 3"]`;

    const response = await this.generateContent(prompt);
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to generate grocery suggestions');
    }

    try {
      const jsonMatch = response.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No valid JSON found in response');
      }
      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('Error parsing grocery suggestions:', error);
      throw new Error('Failed to parse grocery suggestions');
    }
  }

  /**
   * Generate meal plan for the week
   */
  async suggestMealPlan(preferences: string, days: number = 7): Promise<MealPlanSuggestion[]> {
    const prompt = `Create a ${days}-day meal plan based on: ${preferences}

Return only a JSON array in this format, no additional text:
[
  {
    "day": "Monday",
    "breakfast": "meal name",
    "lunch": "meal name",
    "dinner": "meal name",
    "snacks": ["snack 1", "snack 2"]
  }
]`;

    const response = await this.generateContent(prompt);
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to generate meal plan');
    }

    try {
      const jsonMatch = response.text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) {
        throw new Error('No valid JSON found in response');
      }
      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      console.error('Error parsing meal plan:', error);
      throw new Error('Failed to parse meal plan');
    }
  }

  /**
   * Get restaurant recommendations based on preferences
   */
  async suggestRestaurants(cuisine: string, preferences?: string): Promise<string> {
    const prompt = `Suggest 3-5 ${cuisine} restaurants or food delivery options. ${preferences ? `Preferences: ${preferences}` : ''}
    
Provide brief descriptions and what makes each one special. Format as a simple text list.`;

    const response = await this.generateContent(prompt);
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to generate restaurant suggestions');
    }

    return response.text;
  }

  /**
   * General purpose AI text generation
   */
  async generateContent(prompt: string): Promise<GeminiResponse> {
    if (!this.isConfigured()) {
      return {
        success: false,
        text: '',
        error: 'GitHub Personal Access Token not configured. Please add your token to the environment file.'
      };
    }

    try {
      const response = await fetch(this.API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${environment.githubToken}`
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          messages: [
            {
              role: 'user',
              content: prompt
            }
          ],
          temperature: 0.7,
          max_tokens: 2048
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.choices || !data.choices[0]?.message?.content) {
        throw new Error('Invalid response format from OpenAI API');
      }

      const resultText = data.choices[0].message.content;

      // Increment GitHub API call counter
      this.incrementApiCounter();

      return {
        success: true,
        text: resultText
      };
    } catch (error: any) {
      console.error('GitHub Models API error:', error);
      return {
        success: false,
        text: '',
        error: error.message || 'Unknown error occurred'
      };
    }
  }

  /**
   * Increment GitHub API call counter and persist to localStorage
   */
  private incrementApiCounter(): void {
    const currentCount = parseInt(localStorage.getItem('githubApiCallCount') || '0', 10);
    const newCount = currentCount + 1;
    localStorage.setItem('githubApiCallCount', newCount.toString());
    
    // Dispatch storage event to update UI counters
    window.dispatchEvent(new StorageEvent('storage', {
      key: 'githubApiCallCount',
      newValue: newCount.toString()
    }));
  }

  /**
   * Generate cooking tips or substitutions
   */
  async getCookingHelp(question: string): Promise<string> {
    const prompt = `You are a helpful cooking assistant. Answer this question briefly and practically: ${question}`;
    
    const response = await this.generateContent(prompt);
    
    if (!response.success) {
      throw new Error(response.error || 'Failed to get cooking help');
    }

    return response.text;
  }
}
