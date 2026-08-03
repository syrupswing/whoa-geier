const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {onSchedule} = require('firebase-functions/v2/scheduler');
const {defineSecret} = require('firebase-functions/params');
const admin = require('firebase-admin');

admin.initializeApp();

const claudeApiKey = defineSecret('CLAUDE_API_KEY');

exports.aiProxy = onCall({ secrets: ['CLAUDE_API_KEY'] }, async (request) => {
  const token = claudeApiKey.value();

  if (!token) {
    throw new HttpsError('internal', 'Claude API key not configured');
  }

  const { prompt } = request.data;

  if (!prompt || typeof prompt !== 'string') {
    throw new HttpsError('invalid-argument', 'Prompt is required and must be a string');
  }

  try {
    // Fetch available models to avoid hardcoding deprecated model names
    const modelsResponse = await fetch('https://api.anthropic.com/v1/models', {
      headers: { 'x-api-key': token, 'anthropic-version': '2023-06-01' }
    });
    let model = 'claude-3-5-haiku-20241022';
    if (modelsResponse.ok) {
      const modelsData = await modelsResponse.json();
      const models = modelsData.data || [];
      // Prefer haiku (cheapest/fastest), fall back to first available
      const haiku = models.find(m => m.id.includes('haiku'));
      const sonnet = models.find(m => m.id.includes('sonnet'));
      model = (haiku || sonnet || models[0])?.id || model;
    }
    console.log('Using Claude model:', model);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': token,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error('Claude API error response:', JSON.stringify(errorData));
      throw new Error(errorData.error?.message || `API request failed: ${response.status}`);
    }

    const result = await response.json();

    if (!result.content || !result.content[0]?.text) {
      throw new Error('Invalid response format from Claude API');
    }

    return {
      success: true,
      text: result.content[0].text
    };

  } catch (error) {
    console.error('Claude API error:', error);
    throw new HttpsError('internal', error.message || 'Unknown error occurred');
  }
});

/**
 * Daily push notification for overdue or due-today todos.
 * Runs every morning at 8:00 AM Central Time.
 */
exports.dailyTodoReminder = onSchedule(
  { schedule: '0 8 * * *', timeZone: 'America/Chicago' },
  async () => {
  const db = admin.firestore();
  const messaging = admin.messaging();

  // Get all FCM tokens
  const tokensSnap = await db.collection('fcm-tokens').get();
  if (tokensSnap.empty) {
    console.log('No FCM tokens registered — skipping notification.');
    return;
  }
  const tokens = tokensSnap.docs.map(doc => doc.data().token).filter(Boolean);

  // Get all incomplete todos
  const todosSnap = await db.collection('todos').where('completed', '==', false).get();
  if (todosSnap.empty) {
    console.log('No incomplete todos — skipping notification.');
    return;
  }

  const now = new Date();
  const todayStr = now.toISOString().split('T')[0]; // YYYY-MM-DD

  const overdue = [];
  const dueToday = [];

  todosSnap.docs.forEach(doc => {
    const todo = doc.data();
    if (!todo.dueDate) return;
    // Skip todos that are currently snoozed
    if (todo.snoozedUntil && new Date(todo.snoozedUntil) > now) return;
    const due = todo.dueDate.split('T')[0];
    if (due < todayStr) overdue.push(todo.title);
    else if (due === todayStr) dueToday.push(todo.title);
  });

  if (overdue.length === 0 && dueToday.length === 0) {
    console.log('No overdue or due-today todos — skipping notification.');
    return;
  }

  // Build notification content
  let title, body;
  if (overdue.length > 0 && dueToday.length > 0) {
    title = `${overdue.length + dueToday.length} tasks need attention`;
    body = `${overdue.length} overdue, ${dueToday.length} due today`;
  } else if (overdue.length > 0) {
    title = overdue.length === 1 ? '1 overdue task' : `${overdue.length} overdue tasks`;
    body = overdue.length === 1 ? overdue[0] : `${overdue[0]} and ${overdue.length - 1} more`;
  } else {
    title = dueToday.length === 1 ? '1 task due today' : `${dueToday.length} tasks due today`;
    body = dueToday.length === 1 ? dueToday[0] : `${dueToday[0]} and ${dueToday.length - 1} more`;
  }

  const badgeCount = String(overdue.length + dueToday.length);

  // Send to all tokens, ignoring stale ones
  const results = await Promise.allSettled(
    tokens.map(token =>
      messaging.send({
        token,
        data: { title, body, badge: badgeCount }
      })
    )
  );

  // Clean up any tokens that are no longer valid
  const staleTokens = [];
  results.forEach((result, i) => {
    if (result.status === 'rejected') {
      const code = result.reason?.errorInfo?.code ?? '';
      if (code.includes('registration-token-not-registered') || code.includes('invalid-argument')) {
        staleTokens.push(tokens[i]);
      }
    }
  });

  if (staleTokens.length > 0) {
    console.log(`Removing ${staleTokens.length} stale token(s).`);
    await Promise.all(
      staleTokens.map(token => db.collection('fcm-tokens').doc(token).delete())
    );
  }

  const sent = results.filter(r => r.status === 'fulfilled').length;
  console.log(`Sent ${sent}/${tokens.length} notifications. Title: "${title}"`);
});
