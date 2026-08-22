const {onCall, HttpsError} = require('firebase-functions/v2/https');
const {onSchedule} = require('firebase-functions/v2/scheduler');
const {defineSecret} = require('firebase-functions/params');
const admin = require('firebase-admin');
const cheerio = require('cheerio');
const {PDFParse} = require('pdf-parse');
const ical = require('node-ical');

admin.initializeApp();

const claudeApiKey = defineSecret('CLAUDE_API_KEY');
const openWeatherApiKey = defineSecret('OPEN_WEATHER_API_KEY');

/**
 * Pick the cheapest available Claude model (haiku preferred) and call it with a prompt.
 * Shared by the aiProxy callable and the daily briefing generator so both stay in sync.
 */
async function callClaude(token, prompt, maxTokens = 1024) {
  const modelsResponse = await fetch('https://api.anthropic.com/v1/models', {
    headers: { 'x-api-key': token, 'anthropic-version': '2023-06-01' }
  });
  let model = 'claude-3-5-haiku-20241022';
  if (modelsResponse.ok) {
    const modelsData = await modelsResponse.json();
    const models = modelsData.data || [];
    const haiku = models.find(m => m.id.includes('haiku'));
    const sonnet = models.find(m => m.id.includes('sonnet'));
    model = (haiku || sonnet || models[0])?.id || model;
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': token,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
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
  return result.content[0].text.trim();
}

exports.aiProxy = onCall({ secrets: ['CLAUDE_API_KEY'] }, async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Sign-in required');
  }

  const token = claudeApiKey.value();

  if (!token) {
    throw new HttpsError('internal', 'Claude API key not configured');
  }

  const { prompt } = request.data;

  if (!prompt || typeof prompt !== 'string') {
    throw new HttpsError('invalid-argument', 'Prompt is required and must be a string');
  }

  try {
    const text = await callClaude(token, prompt);
    return { success: true, text };
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

// ---------------------------------------------------------------------------
// Remi's Daily Briefing
// ---------------------------------------------------------------------------

const MPS_MENU_PAGE_URL = 'https://www.mpschools.org/departments/cws/menus';

/**
 * Finds this month's elementary "On-Site" lunch PDF on the MPS menus page.
 * The PDF's own URL changes every month (hashed finalsite.net path), so we
 * re-scrape the stable menus page each time rather than hardcoding a link.
 */
async function findOnSiteLunchPdfUrl() {
  const res = await fetch(MPS_MENU_PAGE_URL);
  if (!res.ok) {
    throw new Error(`MPS menu page fetch failed: ${res.status}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);

  let pdfUrl = null;
  $('section.fsElement').each((_, section) => {
    const heading = $(section).find('h2.fsElementTitle').first().text().trim();
    if (/lunch menus/i.test(heading)) {
      const link = $(section).find('a.fsResourceLink[data-resource-title="On-Site"]').first();
      if (link.length) {
        pdfUrl = link.attr('href');
      }
    }
  });
  return pdfUrl;
}

/**
 * Fetches and text-extracts the current On-Site lunch PDF, caching the raw
 * result per month. NOTE: this does NOT attempt to auto-assign items to
 * specific dates — the PDF's internal text order does not reliably match
 * its visual calendar order (verified against a real sample: the day-number
 * headers and the meal-item blocks are two independently-ordered text
 * streams with no generalizable positional relationship). Auto-assigning
 * per day would risk confidently showing the WRONG day's lunch, which is
 * worse than showing nothing, so the extracted text is surfaced in the
 * Remi schedule settings UI for a 10-second manual copy into a specific day
 * instead of being guessed automatically.
 */
exports.syncLunchMenuSource = onSchedule(
  { schedule: '0 9 * * *', timeZone: 'America/Chicago' },
  async () => {
    const db = admin.firestore();
    try {
      const pdfUrl = await findOnSiteLunchPdfUrl();
      if (!pdfUrl) {
        console.warn('syncLunchMenuSource: could not find the On-Site lunch PDF link on the menu page.');
        return;
      }

      const pdfRes = await fetch(pdfUrl);
      if (!pdfRes.ok) {
        throw new Error(`Lunch menu PDF fetch failed: ${pdfRes.status}`);
      }
      const buf = Buffer.from(await pdfRes.arrayBuffer());

      const parser = new PDFParse({ data: buf });
      const { text } = await parser.getText();
      await parser.destroy();

      const now = new Date();
      const monthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

      await db.collection('remi-lunch-menu-source').doc(monthKey).set({
        pdfUrl,
        extractedText: text,
        fetchedAt: now.toISOString()
      });

      console.log(`syncLunchMenuSource: cached ${monthKey} menu source from ${pdfUrl}`);
    } catch (err) {
      console.error('syncLunchMenuSource error:', err);
    }
  }
);

function toDateStr(date) {
  return date.toISOString().split('T')[0];
}

/**
 * Resolves the effective schedule for a given date from the recurring
 * settings doc plus any per-date exception.
 */
async function resolveScheduleForDate(db, dateStr) {
  const settingsDoc = await db.collection('remi-schedule').doc('settings').get();
  const settings = settingsDoc.exists ? settingsDoc.data() : {};
  const schoolDays = settings.schoolDays || [1, 2, 3, 4, 5];
  const defaultStartTime = settings.schoolStartTime || '08:00';
  const defaultEndTime = settings.schoolEndTime || '14:30';
  const defaultLunchPlan = settings.defaultLunchPlan || 'hot';

  const exceptionDoc = await db.collection('remi-schedule-exceptions').doc(dateStr).get();
  const exception = exceptionDoc.exists ? exceptionDoc.data() : {};

  const weekday = new Date(`${dateStr}T00:00:00`).getDay();
  const noSchool = exception.noSchool === true || !schoolDays.includes(weekday);

  let schoolStatus = 'school';
  if (noSchool) {
    schoolStatus = 'no-school';
  } else if (exception.startTimeOverride || exception.endTimeOverride) {
    schoolStatus = 'early-release';
  }

  return {
    schoolStatus,
    scheduleNote: exception.note || null,
    startTime: noSchool ? null : (exception.startTimeOverride || defaultStartTime),
    endTime: noSchool ? null : (exception.endTimeOverride || defaultEndTime),
    lunchPlan: exception.packLunch ? 'pack' : defaultLunchPlan,
    icalUrl: settings.calendarIcalUrl || null
  };
}

async function fetchWeatherSnapshot(apiKey) {
  const url = `https://api.openweathermap.org/data/2.5/weather?zip=55410,US&units=imperial&appid=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Weather fetch failed: ${res.status}`);
  }
  const data = await res.json();
  return {
    tempF: Math.round(data.main.temp),
    feelsLike: Math.round(data.main.feels_like),
    conditions: data.weather[0].main,
    description: data.weather[0].description
  };
}

/** Reads events for a specific date from a calendar's secret iCal URL (no OAuth needed). */
async function fetchActivitiesForDate(icalUrl, dateStr) {
  if (!icalUrl) return [];
  try {
    const events = await ical.async.fromURL(icalUrl);
    const activities = [];
    for (const key of Object.keys(events)) {
      const ev = events[key];
      if (ev.type !== 'VEVENT' || !ev.start) continue;
      if (toDateStr(new Date(ev.start)) !== dateStr) continue;
      const isAllDay = ev.datetype === 'date';
      activities.push({
        title: ev.summary || 'Event',
        time: isAllDay ? null : new Date(ev.start).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      });
    }
    return activities;
  } catch (err) {
    console.error('fetchActivitiesForDate error:', err);
    return [];
  }
}

/**
 * Builds (and caches) the full daily briefing for a date: schedule status,
 * weather, calendar activities, lunch plan/menu, and short AI suggestions
 * for what to wear, what to pack, and what to make for breakfast.
 */
async function buildBriefing(dateStr, claudeToken, weatherKey) {
  const db = admin.firestore();
  const schedule = await resolveScheduleForDate(db, dateStr);

  const lunchDoc = await db.collection('remi-lunch-menu').doc(dateStr).get();
  const lunchMenuText = lunchDoc.exists ? (lunchDoc.data().lunch || null) : null;

  let weather = null;
  try {
    weather = await fetchWeatherSnapshot(weatherKey);
  } catch (err) {
    console.error('buildBriefing weather error:', err);
  }

  const activities = await fetchActivitiesForDate(schedule.icalUrl, dateStr);

  let clothingIdea = null;
  let packedLunchIdea = null;
  let breakfastIdea = null;

  if (claudeToken && weather) {
    try {
      clothingIdea = await callClaude(
        claudeToken,
        `Weather today: ${weather.tempF}°F, feels like ${weather.feelsLike}°F, ${weather.description}. ` +
        `Write ONE short, friendly sentence (max 18 words) telling a parent what a 6-year-old going into 1st grade ` +
        `should wear to school today, including footwear. Just the sentence, nothing else.`,
        100
      );
    } catch (err) {
      console.error('buildBriefing clothingIdea error:', err);
    }
  }

  if (claudeToken && schedule.lunchPlan === 'pack') {
    try {
      packedLunchIdea = await callClaude(
        claudeToken,
        `Suggest ONE simple, kid-friendly packed lunch for a 6-year-old with no dietary restrictions, ` +
        `for a school lunchbox. Max 20 words, just the idea, nothing else.`,
        100
      );
    } catch (err) {
      console.error('buildBriefing packedLunchIdea error:', err);
    }
  }

  if (claudeToken) {
    try {
      breakfastIdea = await callClaude(
        claudeToken,
        `Suggest ONE quick, kid-friendly breakfast idea for a 6-year-old before school, no dietary restrictions, ` +
        `ready in under 10 minutes. Max 18 words, just the idea, nothing else.`,
        100
      );
    } catch (err) {
      console.error('buildBriefing breakfastIdea error:', err);
    }
  }

  const briefing = {
    date: dateStr,
    schoolStatus: schedule.schoolStatus,
    scheduleNote: schedule.scheduleNote,
    startTime: schedule.startTime,
    endTime: schedule.endTime,
    weather,
    clothingIdea,
    activities,
    lunchPlan: schedule.lunchPlan,
    lunchMenuText,
    packedLunchIdea,
    breakfastIdea,
    generatedAt: new Date().toISOString()
  };

  await db.collection('remi-daily-briefing').doc(dateStr).set(briefing);
  return briefing;
}

function summarizeBriefingForPush(briefing) {
  const parts = [];

  if (briefing.schoolStatus === 'no-school') {
    parts.push(briefing.scheduleNote ? `No school today — ${briefing.scheduleNote}` : 'No school today');
  } else if (briefing.schoolStatus === 'early-release') {
    parts.push(`Early release today, starts ${briefing.startTime}`);
  } else {
    parts.push(`School at ${briefing.startTime}`);
  }

  if (briefing.clothingIdea) parts.push(briefing.clothingIdea);

  if (briefing.lunchPlan === 'pack' && briefing.packedLunchIdea) {
    parts.push(`Pack: ${briefing.packedLunchIdea}`);
  } else if (briefing.lunchMenuText) {
    parts.push(`Lunch: ${briefing.lunchMenuText}`);
  }

  return parts.join(' • ');
}

/**
 * Builds today's briefing and pushes a summary to all registered devices.
 * Runs every morning at 6:00 AM Central Time.
 */
exports.dailyRemiBriefing = onSchedule(
  { schedule: '0 6 * * *', timeZone: 'America/Chicago', secrets: ['CLAUDE_API_KEY', 'OPEN_WEATHER_API_KEY'] },
  async () => {
    const db = admin.firestore();
    const dateStr = toDateStr(new Date());

    const briefing = await buildBriefing(dateStr, claudeApiKey.value(), openWeatherApiKey.value());

    const tokensSnap = await db.collection('fcm-tokens').get();
    if (tokensSnap.empty) {
      console.log('dailyRemiBriefing: no FCM tokens registered — skipping push.');
      return;
    }
    const tokens = tokensSnap.docs.map(doc => doc.data().token).filter(Boolean);
    const messaging = admin.messaging();

    const title = "Remi's Daily Briefing";
    const body = summarizeBriefingForPush(briefing);

    const results = await Promise.allSettled(
      tokens.map(token => messaging.send({ token, data: { title, body } }))
    );

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
      console.log(`dailyRemiBriefing: removing ${staleTokens.length} stale token(s).`);
      await Promise.all(staleTokens.map(token => db.collection('fcm-tokens').doc(token).delete()));
    }

    const sent = results.filter(r => r.status === 'fulfilled').length;
    console.log(`dailyRemiBriefing: sent ${sent}/${tokens.length} notifications.`);
  }
);

/** On-demand regeneration for the dashboard widget's "Refresh" button. */
exports.regenerateBriefing = onCall(
  { secrets: ['CLAUDE_API_KEY', 'OPEN_WEATHER_API_KEY'], invoker: 'public' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign-in required');
    }

    const dateStr = (request.data && request.data.date) || toDateStr(new Date());
    try {
      const briefing = await buildBriefing(dateStr, claudeApiKey.value(), openWeatherApiKey.value());
      return { success: true, briefing };
    } catch (err) {
      console.error('regenerateBriefing error:', err);
      throw new HttpsError('internal', err.message || 'Failed to generate briefing');
    }
  }
);
