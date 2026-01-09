const functions = require('firebase-functions');
const admin = require('firebase-admin');

admin.initializeApp();

/**
 * Proxy requests to GitHub Models API
 * Keeps the GitHub PAT secure on the backend
 */
exports.aiProxy = functions.https.onCall(async (data, context) => {
  // Get the GitHub PAT from environment variable
  const githubToken = process.env.GITHUB_TOKEN;
  
  if (!githubToken) {
    throw new functions.https.HttpsError(
      'failed-precondition',
      'GitHub token not configured. Set GITHUB_TOKEN environment variable.'
    );
  }

  const { prompt } = data;

  if (!prompt || typeof prompt !== 'string') {
    throw new functions.https.HttpsError(
      'invalid-argument',
      'Prompt is required and must be a string'
    );
  }

  try {
    const response = await fetch('https://models.inference.ai.azure.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${githubToken}`
      },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: prompt
          }
        ],
        model: 'gpt-4o-mini',
        temperature: 0.7,
        max_tokens: 4096
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
    }

    const result = await response.json();

    if (!result.choices || !result.choices[0]?.message?.content) {
      throw new Error('Invalid response format from GitHub Models API');
    }

    return {
      success: true,
      text: result.choices[0].message.content
    };

  } catch (error) {
    console.error('GitHub Models API error:', error);
    throw new functions.https.HttpsError(
      'internal',
      error.message || 'Unknown error occurred'
    );
  }
});
