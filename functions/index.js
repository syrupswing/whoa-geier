const {onCall} = require('firebase-functions/v2/https');
const {defineString} = require('firebase-functions/params');

// Define environment variable parameter
const githubToken = defineString('GITHUB_TOKEN');

/**
 * Proxy requests to GitHub Models API
 * Keeps the GitHub PAT secure on the backend
 */
exports.aiProxy = onCall(async (request) => {
  // Get the GitHub PAT from environment variable
  const token = githubToken.value();
  
  if (!token) {
    throw new Error('GitHub token not configured');
  }

  const { prompt } = request.data;

  if (!prompt || typeof prompt !== 'string') {
    throw new Error('Prompt is required and must be a string');
  }

  try {
    const response = await fetch('https://models.inference.ai.azure.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
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
