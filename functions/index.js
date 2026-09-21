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
async function callClaude(token, prompt, maxTokens = 1024, history = []) {
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
      messages: [...history, { role: 'user', content: prompt }]
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

/**
 * Validates and trims a client-supplied prior-turns array before it's forwarded to Claude,
 * so a reply like "Yes" to the assistant's own previous question can be resolved — untrusted
 * client input, so shape/role/length are all checked rather than passed through as-is.
 */
function sanitizeConversationHistory(history) {
  if (!Array.isArray(history)) return [];
  return history
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-10)
    .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));
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

// ---------------------------------------------------------------------------
// AI orchestrator — shared entry point for client-triggered AI features.
// Unlike aiProxy (which just relays a client-built prompt), each featureType here owns
// its own prompt template server-side, so the client sends a small structured payload
// instead of prose it assembled itself. New features should be added here rather than
// building another prompt client-side and hitting aiProxy directly.
// ---------------------------------------------------------------------------

const GROCERY_STORE_SECTIONS = [
  'Produce', 'Bakery', 'Deli/Meat', 'Dairy', 'Frozen', 'Canned Goods',
  'Dry Goods', 'Condiments', 'Snacks', 'Beverages', 'Health/Beauty', 'Household', 'Other'
];

// Shared item shape/instructions for anything that asks the model to turn free text into
// structured event/reminder/todo/shopping_item/fact records — used by 'family-chat' so a
// chat message can both get a reply and (optionally) propose data to create.
const ITEM_SCHEMA_BLOCK = (
  `Classify each item as exactly one of these types:\n` +
  `- "event": has a specific date/time and describes something happening (e.g. "soccer practice Tuesday at 4")\n` +
  `- "reminder": a task tied to a specific date/time, phrased as a reminder (e.g. "remind me to bring snacks tomorrow")\n` +
  `- "todo": a task with no fixed time, or only a due date with no time\n` +
  `- "shopping_item": something to buy or add to the shopping list (e.g. "we need milk", "add paper towels to the list")\n` +
  `- "fact": a persistent statement about a person or household rule, not a scheduled item (e.g. ` +
  `"Remi is allergic to shellfish", "oil change every 5000 miles")\n\n` +
  `Each item has this shape (omit fields that don't apply to its type):\n` +
  `{\n` +
  `  "type": "event" | "reminder" | "todo" | "shopping_item" | "fact",\n` +
  `  "title": "short title (for event/reminder/todo/shopping_item)",\n` +
  `  "factText": "the fact, verbatim or lightly cleaned up (for fact only)",\n` +
  `  "category": "dietary | preference | maintenance | medical | schedule | other (for fact only)",\n` +
  `  "date": "YYYY-MM-DD (for event/reminder/todo, resolved from today's date above)",\n` +
  `  "time": "HH:mm 24-hour, or null if no time was given (for event/reminder)",\n` +
  `  "person": "a name from the known list above, or the mentioned name/pronoun as written, or null",\n` +
  `  "confidence": { "date": "high"|"low", "time": "high"|"low", "person": "high"|"low" },\n` +
  `  "inferredNote": "a short note explaining any default you applied (e.g. 'No time given — defaulted ` +
  `to 9:00 AM'), or null if nothing was inferred"\n` +
  `}\n\n` +
  `Only mark a field "high" confidence if the statement stated it explicitly or it follows unambiguously ` +
  `(e.g. "tomorrow" resolved from today's date is high confidence). Never silently guess a "high" ` +
  `confidence — when you apply a default, mark that field "low" and explain it in inferredNote.`
);

const ORCHESTRATOR_TEMPLATES = {
  'grocery-aisle-hint': {
    // Fired once per grocery item on every list load — no accept/reject action exists for
    // it, so it's excluded from the aiSuggestions log to avoid flooding it with permanently-
    // "pending" noise, and it skips the memory lookup since a fact/recent-context lookup has
    // nothing to add to "which aisle is milk in".
    usesMemory: false,
    logSuggestion: false,
    maxTokens: 100,
    buildPrompt: (payload) => (
      `In which aisle or section of a grocery store would I typically find "${payload.itemName}"? ` +
      `Respond with ONLY a JSON object of the exact shape {"location": "..."} — no other text. The ` +
      `"location" value should be a brief, specific answer, e.g. "Produce section" or "Dairy aisle, near ` +
      `the milk" or "Baking aisle, with flour and sugar".`
    ),
    parseResponse: extractJson
  },
  'grocery-categorize': {
    usesMemory: false,
    logSuggestion: false,
    maxTokens: 500,
    buildPrompt: (payload) => (
      `Categorize these grocery items into store sections. For each item, choose ONE category from this ` +
      `list: ${GROCERY_STORE_SECTIONS.join(', ')}.\n\nItems: ${(payload.itemNames || []).join(', ')}\n\n` +
      `Respond with ONLY a JSON object mapping each item name to its category — no other text. Example ` +
      `format:\n{"milk": "Dairy", "apples": "Produce", "bread": "Bakery"}`
    ),
    parseResponse: extractJson
  },
  'recipe-suggestions': {
    // Recipes are a rare, deliberate ask (unlike the per-item grocery calls above), and
    // dietary facts genuinely change what a "good" suggestion looks like, so this one uses
    // memory and logs to aiSuggestions.
    usesMemory: true,
    logSuggestion: true,
    maxTokens: 2048,
    buildPrompt: (payload, context) => {
      const factsClause = context.facts.length
        ? ` Keep in mind these household facts: ${context.facts.join('; ')}.`
        : '';
      return (
        `You are a helpful cooking assistant for a family. Provide practical, family-friendly recipes.` +
        `${factsClause}\n\nGenerate 3 recipe suggestions based on: ${payload.prompt}\n\n` +
        `Respond with ONLY a JSON array of recipes, no other text, in this exact format:\n` +
        `[\n  {\n    "name": "Recipe Name",\n    "description": "Brief description",\n` +
        `    "prepTime": 15,\n    "cookTime": 30,\n    "servings": 4,\n` +
        `    "ingredients": ["ingredient 1", "ingredient 2"],\n` +
        `    "instructions": ["step 1", "step 2"],\n    "tags": ["tag1", "tag2"]\n  }\n]`
      );
    },
    parseResponse: extractJsonArray
  },
  'remi-quiz-question': {
    usesMemory: false,
    logSuggestion: false,
    maxTokens: 300,
    buildPrompt: (payload) => {
      switch (payload.category) {
        case 'spelling':
          return (
            `Generate 1 unique and creative spelling question for a 5-6 year old child. Use variety in ` +
            `word selection across these categories:\n\n` +
            `EASY WORDS (3-4 letters): cat, dog, sun, run, hat, mat, box, fox, bat, rat, bug, hug, jet, net, pen, hen, top, mop, car, jar\n` +
            `MEDIUM WORDS (4-6 letters): happy, silly, funny, apple, pizza, tiger, ninja, magic, dragon, robot, wizard, castle, banana, cookie, rocket, turtle, monkey, pencil\n` +
            `MINECRAFT THEMED: mine, cave, dirt, wood, tree, gold, iron, crop, farm, food, chest, sword, block, stone, craft\n` +
            `NATURE WORDS: bird, fish, frog, leaf, seed, moon, star, rain, snow, wind\n` +
            `ACTION WORDS: swim, jump, run, hop, skip, play, read, sing, dance, climb\n\n` +
            `Pick ONE word randomly from ANY category above (mix it up!). Create an engaging sentence ` +
            `that relates to Minecraft, nature, or something fun. Respond with ONLY a JSON object, no ` +
            `other text, in this format:\n` +
            `{"word": "dragon", "sentence": "Can you spell DRAGON? In Minecraft, the ender dragon flies ` +
            `in the sky!", "hint": "A big flying creature that breathes fire"}`
          );
        case 'math':
          return (
            `Generate 1 simple math question for a 5-6 year old child. Use addition or subtraction with ` +
            `numbers 1-10 only. Make it fun and engaging. Respond with ONLY a JSON object, no other text, ` +
            `in this format:\n` +
            `{"question": "If you have 3 blocks and get 2 more, how many blocks do you have?", "answer": "5"}`
          );
        case 'fun-facts':
          return (
            `Generate 1 fun multiple choice question for a 5-6 year old child about Minecraft or animals ` +
            `or nature. Make it fun and educational. Respond with ONLY a JSON object, no other text, in ` +
            `this format:\n` +
            `{"question": "What do creepers in Minecraft do?", "correctAnswer": "Explode", ` +
            `"options": ["Explode", "Fly", "Swim", "Sleep"]}`
          );
        default:
          throw new Error(`Unknown quiz category: ${payload.category}`);
      }
    },
    parseResponse: extractJson
  },
  'dashboard-welcome-message': {
    usesMemory: false,
    logSuggestion: false,
    maxTokens: 60,
    buildPrompt: () => (
      `Write a very brief, friendly, and colloquial welcome message (maximum 15 words) for a family ` +
      `command center app that helps families manage their schedules, grocery lists, and daily activities. ` +
      `Make it warm and encouraging. Respond with ONLY a JSON object of the exact shape {"text": "..."} — ` +
      `no other text.`
    ),
    parseResponse: extractJson
  },
  'dashboard-clothing-recommendation': {
    usesMemory: false,
    logSuggestion: false,
    maxTokens: 100,
    buildPrompt: (payload) => (
      `Based on this weather: ${payload.temperature}°F, ${payload.description}, humidity ` +
      `${payload.humidity}%, wind ${payload.windSpeed} mph - write ONE short, friendly sentence (max 15 ` +
      `words) suggesting what to wear including both clothing AND footwear. Be conversational and helpful. ` +
      `Respond with ONLY a JSON object of the exact shape {"text": "..."} — no other text.`
    ),
    parseResponse: extractJson
  },
  'family-chat': {
    // Hybrid template: replies conversationally AND decides whether the message asks to
    // create/save something (event, reminder, todo, shopping item, or fact). Structured
    // items are logged per-item to aiSuggestions (logSuggestion: 'items-field') so each can
    // be independently accepted/edited/rejected from its own inline chat card — this is the
    // single entry point for what used to be the separate 'quick-add-parse' template behind
    // its own FAB; the chat is now the only place free-text data creation happens.
    usesMemory: true,
    logSuggestion: 'items-field',
    maxTokens: 1500,
    buildContext: buildFamilyChatContext,
    buildPrompt: (payload, context) => {
      const factsClause = context.facts.length
        ? ` Household facts to keep in mind: ${context.facts.join('; ')}.`
        : '';
      const recentClause = context.recentContext.length
        ? ` Recent household context: ${context.recentContext.join('; ')}.`
        : '';
      const scheduleClause = context.scheduleSummary
        ? `\nToday's schedule: ${context.scheduleSummary}.`
        : '';
      const weatherClause = context.weatherSummary
        ? `\nCurrent weather: ${context.weatherSummary}.`
        : '';
      const calendarClause = context.calendarEvents.length
        ? `\nUpcoming calendar events: ${context.calendarEvents.join('; ')}.`
        : '';
      const todosClause = context.todos.length
        ? `\nOpen to-do items: ${context.todos.join('; ')}.`
        : '';
      const groceryClause = context.groceryItems.length
        ? `\nShopping list: ${context.groceryItems.join(', ')}.`
        : '';
      const alertsClause = context.alerts.length
        ? `\nActive alerts: ${context.alerts.join('; ')}.`
        : '';
      const peopleClause = (payload.knownPeople || []).length
        ? ` Known family member names: ${payload.knownPeople.join(', ')}. If a mentioned person matches ` +
          `one of these, use that exact name.`
        : '';
      return (
        `You are a helpful family assistant for a family command center app. Today is ` +
        `${context.todayWeekday}, ${context.today} — use this as the reference date for "today", ` +
        `"tomorrow", and any other relative dates. Be friendly, concise, and ` +
        `helpful. Use the household information below when it's relevant to the question — don't recite ` +
        `all of it unless asked.${factsClause}${recentClause}${scheduleClause}${weatherClause}${calendarClause}` +
        `${todosClause}${groceryClause}${alertsClause}${peopleClause}\n\nThe user said: ${payload.message}\n\n` +
        `In addition to replying, decide whether the user is asking you to create or save something. Most ` +
        `messages are just questions or conversation and should yield no items — only propose items when ` +
        `the user is clearly asking you to add/save/remember/schedule something (e.g. "remind me to...", ` +
        `"add ... to the list", "we have soccer practice Tuesday", "remember that..."). A single message can ` +
        `yield multiple items — split them.\n\n${ITEM_SCHEMA_BLOCK}\n\n` +
        `Respond with ONLY a JSON object of this exact shape, no other text:\n` +
        `{\n` +
        `  "reply": "your conversational response to the user's message, as you'd normally answer",\n` +
        `  "items": [ ] // zero or more items in the shape above, or an empty array if nothing should be created\n` +
        `}`
      );
    },
    parseResponse: (raw) => {
      const parsed = extractJson(raw);
      return { text: (parsed.reply || '').trim(), items: Array.isArray(parsed.items) ? parsed.items : [] };
    }
  }
};

/** Facts and still-relevant recent-context entries for a member (or the whole household). */
async function buildOrchestratorMemoryContext(db, memberId) {
  const now = new Date();
  const [factsSnap, contextSnap] = await Promise.all([
    db.collection('explicitFacts').get(),
    db.collection('recentContext').get()
  ]);

  const facts = factsSnap.docs
    .map(d => d.data())
    .filter(f => !f.memberId || f.memberId === memberId)
    .map(f => f.factText);

  const recentContext = contextSnap.docs
    .map(d => d.data())
    .filter(c => !c.archivedAt && (!c.relevantDateEnd || new Date(c.relevantDateEnd) >= now))
    .map(c => c.description);

  return { facts, recentContext };
}

/** Minutes since midnight for a moment, read in the family's time zone. */
function nowMinutesInTz(date) {
  const label = date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hourCycle: 'h23', timeZone: TIME_ZONE });
  const [hour, minute] = label.split(':').map(Number);
  return hour * 60 + minute;
}

/** Parses a stored "HH:mm" 24-hour schedule time (e.g. school startTime) into minutes since midnight. */
function parseHHmmToMinutes(hhmm) {
  if (!hhmm) return null;
  const [hour, minute] = hhmm.split(':').map(Number);
  return hour * 60 + minute;
}

/** Parses a displayed "H:MM AM/PM" activity time (as produced by fetchActivitiesForDate) into minutes since midnight. */
function parseClockLabelToMinutes(label) {
  const match = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec((label || '').trim());
  if (!match) return null;
  let hour = Number(match[1]) % 12;
  if (match[3].toUpperCase() === 'PM') hour += 12;
  return hour * 60 + Number(match[2]);
}

/**
 * Gathers a snapshot of household data for family-chat: the client's last-synced
 * Google Calendar events (app-cache/calendar-events, written by GoogleCalendarService
 * on every load), Remi's schedule for today (from the cached daily briefing, or
 * computed live if no briefing exists yet), open to-dos, the shopping list, and any
 * pending smart alerts. Anything tied to a specific time of day — calendar events,
 * today's activities, meal plans — is dropped once that time has passed, even
 * earlier the same day, since it's no longer actionable for the person asking.
 */
async function buildFamilyChatContext(db) {
  const now = new Date();
  const today = toDateStr(now);
  const horizon = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);

  const [calendarCacheDoc, briefingDoc, todosSnap, grocerySnap, alertsSnap] = await Promise.all([
    db.collection('app-cache').doc('calendar-events').get(),
    db.collection('remi-daily-briefing').doc(today).get(),
    db.collection('todoItems').where('completed', '==', false).get(),
    db.collection('groceryItems').where('completed', '==', false).get(),
    db.collection('smartAlerts').where('status', '==', 'pending').get()
  ]);

  const cachedEvents = calendarCacheDoc.exists ? (calendarCacheDoc.data().events || []) : [];
  const calendarEvents = cachedEvents
    .map(e => {
      const isAllDay = !e.start?.dateTime;
      const startStr = e.start?.dateTime || e.start?.date;
      const endStr = e.end?.dateTime || e.end?.date || startStr;
      if (!startStr) return null;
      return {
        title: e.summary || 'Event',
        start: new Date(startStr),
        end: new Date(endStr),
        allDay: isAllDay,
        // All-day dates (e.g. "2026-09-20") carry no time zone. Parsing one with `new
        // Date(...)` reads it as UTC midnight, and converting that back through
        // America/Chicago for display would land on the previous day — so for all-day
        // events, keep the original calendar-day string instead of round-tripping it
        // through a Date object.
        allDayDateStr: isAllDay ? e.start.date : null
      };
    })
    .filter(e => e && e.end >= now && e.start <= horizon)
    .sort((a, b) => a.start - b.start)
    .slice(0, 20)
    .map(e => {
      const dateLabel = e.allDay ? e.allDayDateStr : toDateStr(e.start);
      const timeLabel = e.allDay ? '' : ` at ${e.start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE })}`;
      return `${e.title} on ${dateLabel}${timeLabel}`;
    });

  const nowMin = nowMinutesInTz(now);
  // Fixed cutoffs since meal plans carry no specific time of their own — once the
  // day has moved past when a meal would happen, it's no longer actionable info.
  const MEAL_CUTOFF_MIN = { breakfast: 10 * 60, lunch: 14 * 60, dinner: 21 * 60 };

  // Fetched fresh on every chat turn (not just read from the once-daily 6am briefing
  // cache) so "what should I wear" reflects right-now conditions — the cached snapshot
  // can be hours stale by the time someone asks later in the day.
  let weatherSummary = null;
  try {
    weatherSummary = formatWeatherSummary(await fetchWeatherSnapshot(openWeatherApiKey.value()));
  } catch (err) {
    console.error('buildFamilyChatContext live weather error:', err);
  }

  let scheduleSummary = null;
  try {
    let schoolStatus, scheduleNote, startTime, endTime, activities, lunchPlan, lunchMenuText, packedLunchIdea, breakfastIdea, dinnerIdea, weather;
    if (briefingDoc.exists) {
      ({ schoolStatus, scheduleNote, startTime, endTime, activities, lunchPlan, lunchMenuText, packedLunchIdea, breakfastIdea, dinnerIdea, weather } = briefingDoc.data());
      // Fall back to this morning's cached reading only if the live fetch above failed.
      if (!weatherSummary && weather) {
        weatherSummary = formatWeatherSummary(weather);
      }
    } else {
      const schedule = await resolveScheduleForDate(db, today);
      ({ schoolStatus, scheduleNote, startTime, endTime, lunchPlan } = schedule);
      activities = await fetchActivitiesForDate(schedule.icalUrls, today);
    }

    const endMin = parseHHmmToMinutes(endTime);
    const schoolEnded = endMin !== null && nowMin >= endMin;

    const parts = [];
    if (schoolStatus === 'no-school') {
      parts.push(`No school today${scheduleNote ? ` (${scheduleNote})` : ''}`);
    } else if (schoolStatus === 'early-release') {
      parts.push(schoolEnded
        ? `Early release today — school has already let out${scheduleNote ? ` (${scheduleNote})` : ''}`
        : `Early release today, starts ${formatTime12h(startTime)}${scheduleNote ? ` (${scheduleNote})` : ''}`);
    } else {
      parts.push(schoolEnded
        ? 'School already let out for today'
        : `School today ${formatTime12h(startTime)}-${formatTime12h(endTime)}`);
    }

    // Drop activities whose start time has already passed — an event earlier today
    // is no longer upcoming info, same as a fully past calendar event.
    const upcomingActivities = (activities || []).filter(a => {
      const activityMin = parseClockLabelToMinutes(a.time);
      return activityMin === null || activityMin >= nowMin;
    });
    if (upcomingActivities.length) {
      parts.push(`Activities: ${upcomingActivities.map(a => (a.time ? `${a.title} at ${a.time}` : a.title)).join(', ')}`);
    }

    if (nowMin < MEAL_CUTOFF_MIN.breakfast && breakfastIdea) {
      parts.push(`Breakfast: ${breakfastIdea}`);
    }
    if (nowMin < MEAL_CUTOFF_MIN.lunch) {
      parts.push(lunchPlan === 'hot'
        ? `Lunch: ${lunchMenuText || 'hot lunch, menu not entered yet'}`
        : `Lunch: packed${packedLunchIdea ? ` — ${packedLunchIdea}` : ''}`);
    }
    if (nowMin < MEAL_CUTOFF_MIN.dinner && dinnerIdea) {
      parts.push(`Dinner: ${dinnerIdea}`);
    }

    scheduleSummary = parts.join('. ');
  } catch (err) {
    console.error('buildFamilyChatContext schedule error:', err);
  }

  const todos = todosSnap.docs
    .map(d => d.data())
    // Private todos are personal to one member — this context is shared with anyone
    // chatting, so it can't reveal them without knowing who's asking.
    .filter(t => !t.isPrivate && (!t.snoozedUntil || new Date(t.snoozedUntil) <= now))
    .map(t => (t.dueDate ? `${t.title} (due ${t.dueDate.split('T')[0]})` : t.title))
    .slice(0, 20);

  const groceryItems = grocerySnap.docs.map(d => d.data().name).filter(Boolean).slice(0, 30);

  const alerts = alertsSnap.docs.map(d => d.data().message).filter(Boolean).slice(0, 10);

  const todayWeekday = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: TIME_ZONE });

  return { today, todayWeekday, weatherSummary, calendarEvents, scheduleSummary, todos, groceryItems, alerts };
}

exports.orchestratedGenerate = onCall(
  { secrets: ['CLAUDE_API_KEY', 'OPEN_WEATHER_API_KEY'] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign-in required');
    }

    const { featureType, payload, memberId } = request.data || {};
    const template = ORCHESTRATOR_TEMPLATES[featureType];
    if (!template) {
      throw new HttpsError('invalid-argument', `Unknown featureType: ${featureType}`);
    }

    const token = claudeApiKey.value();
    if (!token) {
      throw new HttpsError('internal', 'Claude API key not configured');
    }

    const db = admin.firestore();

    try {
      const context = template.usesMemory === false
        ? { facts: [], recentContext: [] }
        : await buildOrchestratorMemoryContext(db, memberId);

      if (template.buildContext) {
        Object.assign(context, await template.buildContext(db, payload || {}));
      }

      const prompt = template.buildPrompt(payload || {}, context);
      const history = sanitizeConversationHistory(payload?.conversationHistory);
      const raw = await callClaude(token, prompt, template.maxTokens || 1024, history);
      const result = template.parseResponse(raw);

      let suggestionId = null;
      let suggestionIds = null;
      if (template.logSuggestion === 'items-field') {
        const items = Array.isArray(result.items) ? result.items : [];
        suggestionIds = await Promise.all(items.map(item => logAiSuggestion(db, {
          featureType,
          memberId,
          generatedContent: item,
          contextSnapshot: { payload: payload || {}, memory: context }
        })));
      } else if (template.logSuggestion !== false) {
        suggestionId = await logAiSuggestion(db, {
          featureType,
          memberId,
          generatedContent: result,
          contextSnapshot: { payload: payload || {}, memory: context }
        });
      }

      return { success: true, result, suggestionId, suggestionIds };
    } catch (err) {
      console.error(`orchestratedGenerate error (${featureType}):`, err);
      throw new HttpsError('internal', err.message || 'Failed to generate suggestion');
    }
  }
);

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

const TIME_ZONE = 'America/Chicago';

/** YYYY-MM-DD in the family's time zone; functions themselves run in UTC. */
function toDateStr(date) {
  return date.toLocaleDateString('en-CA', { timeZone: TIME_ZONE });
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

  // calendarIcalUrl is the pre-multi-calendar setting and is still honored.
  const icalUrls = (settings.calendarIcalUrls || [])
    .concat(settings.calendarIcalUrl ? [settings.calendarIcalUrl] : [])
    .map(url => (url || '').trim())
    .filter(Boolean);

  return {
    schoolStatus,
    scheduleNote: exception.note || null,
    startTime: noSchool ? null : (exception.startTimeOverride || defaultStartTime),
    endTime: noSchool ? null : (exception.endTimeOverride || defaultEndTime),
    lunchPlan: exception.packLunch ? 'pack' : defaultLunchPlan,
    icalUrls: Array.from(new Set(icalUrls))
  };
}

/** Turns a fetchWeatherSnapshot() (or cached briefing) weather object into a short prompt-ready summary. */
function formatWeatherSummary(weather) {
  if (!weather) return null;
  const rangeText = (weather.highF !== undefined && weather.lowF !== undefined)
    ? ` (high ${weather.highF}°F, low ${weather.lowF}°F)`
    : '';
  const precipText = weather.maxPrecipChance ? `, ${weather.maxPrecipChance}% chance of precipitation` : '';
  return `${weather.tempF}°F and ${weather.description}, feels like ${weather.feelsLike}°F${rangeText}${precipText}`;
}

async function fetchWeatherSnapshot(apiKey) {
  const url = `https://api.openweathermap.org/data/2.5/weather?zip=55410,US&units=imperial&appid=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Weather fetch failed: ${res.status}`);
  }
  const data = await res.json();
  const snapshot = {
    tempF: Math.round(data.main.temp),
    feelsLike: Math.round(data.main.feels_like),
    conditions: data.weather[0].main,
    description: data.weather[0].description,
    fetchedAt: new Date().toISOString()
  };

  try {
    Object.assign(snapshot, await fetchDayForecast(apiKey));
  } catch (err) {
    console.error('fetchWeatherSnapshot forecast error:', err);
  }

  return snapshot;
}

/** Summarizes the rest of today from the 3-hour forecast so suggestions can reason ahead. */
async function fetchDayForecast(apiKey) {
  const url = `https://api.openweathermap.org/data/2.5/forecast?zip=55410,US&units=imperial&appid=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Forecast fetch failed: ${res.status}`);
  }
  const data = await res.json();
  const today = toDateStr(new Date());

  const slots = (data.list || [])
    .map(entry => ({
      date: toDateStr(new Date(entry.dt * 1000)),
      hour: Number(new Date(entry.dt * 1000).toLocaleString('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: TIME_ZONE })),
      tempF: Math.round(entry.main.temp),
      pop: Math.round((entry.pop || 0) * 100),
      description: entry.weather?.[0]?.description || ''
    }))
    .filter(slot => slot.date === today);

  if (slots.length === 0) return {};

  const partOf = (hour) => (hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening');
  const periods = {};
  for (const slot of slots) {
    const part = partOf(slot.hour);
    if (!periods[part]) {
      periods[part] = { part, tempF: slot.tempF, pop: slot.pop, description: slot.description };
    } else {
      periods[part].pop = Math.max(periods[part].pop, slot.pop);
      periods[part].tempF = Math.max(periods[part].tempF, slot.tempF);
    }
  }

  return {
    highF: Math.max(...slots.map(s => s.tempF)),
    lowF: Math.min(...slots.map(s => s.tempF)),
    maxPrecipChance: Math.max(...slots.map(s => s.pop)),
    periods: Object.values(periods)
  };
}

/** Reads events for a specific date from each calendar's secret iCal URL (no OAuth needed). */
async function fetchActivitiesForDate(icalUrls, dateStr) {
  const urls = (icalUrls || []).filter(Boolean);
  if (urls.length === 0) return [];

  const perCalendar = await Promise.all(urls.map(async (icalUrl) => {
    try {
      const events = await ical.async.fromURL(icalUrl);
      const activities = [];
      for (const key of Object.keys(events)) {
        const ev = events[key];
        if (ev.type !== 'VEVENT' || !ev.start) continue;
        const start = new Date(ev.start);
        const isAllDay = ev.datetype === 'date';
        // All-day values carry no time zone, so they're compared as the plain UTC date.
        const eventDateStr = isAllDay ? start.toISOString().split('T')[0] : toDateStr(start);
        if (eventDateStr !== dateStr) continue;
        activities.push({
          start: isAllDay ? null : start.getTime(),
          title: ev.summary || 'Event',
          time: isAllDay ? null : start.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: TIME_ZONE })
        });
      }
      return activities;
    } catch (err) {
      console.error(`fetchActivitiesForDate error for ${icalUrl}:`, err);
      return [];
    }
  }));

  return perCalendar
    .flat()
    .sort((a, b) => (a.start ?? -1) - (b.start ?? -1))
    .map(({ start, ...activity }) => activity);
}

/**
 * Builds (and caches) the full daily briefing for a date: schedule status,
 * weather, calendar activities, lunch plan/menu, and short AI suggestions
 * for what to wear, what to pack, and what to make for breakfast.
 */
/** Appends an "avoid repeating" clause when a previous suggestion is provided, so refreshing a single card gets variety. */
function avoidClause(previous) {
  return previous ? ` Don't repeat this previous suggestion: "${previous}".` : '';
}

/** Extracts and parses the first {...} JSON object found in a model response. */
function extractJson(text) {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(`No JSON object found in model response: ${text.slice(0, 200)}`);
  }
  return JSON.parse(match[0]);
}

/** Extracts and parses the first [...] JSON array found in a model response. */
function extractJsonArray(text) {
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) {
    throw new Error(`No JSON array found in model response: ${text.slice(0, 200)}`);
  }
  return JSON.parse(match[0]);
}

/**
 * Logs an AI-generated suggestion to the aiSuggestions collection so its outcome
 * (accepted/edited/rejected) can be tracked and later mined for learned patterns.
 */
async function logAiSuggestion(db, { featureType, memberId, generatedContent, contextSnapshot }) {
  const suggestion = {
    featureType,
    generatedContent,
    contextSnapshot,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  if (memberId) suggestion.memberId = memberId;
  const ref = await db.collection('aiSuggestions').add(suggestion);
  return ref.id;
}

/** Marks a previously-logged suggestion rejected — used when a facet is explicitly regenerated. */
async function rejectAiSuggestion(db, suggestionId) {
  if (!suggestionId) return;
  try {
    await db.collection('aiSuggestions').doc(suggestionId).update({ status: 'rejected' });
  } catch (err) {
    console.error('rejectAiSuggestion error:', err);
  }
}

/**
 * Generates the "what should Remi wear" reasoning. This runs at 7:30 AM for the scheduled
 * push, before Remi is actually dressed and out the door — so the outfit must be reasoned
 * from the forecast for when he'll actually be outside (school hours, plus any later
 * activity), not from the "right now" reading at push time, which is given as background only.
 */
async function generateClothingIdea(claudeToken, weather, previous, context = {}) {
  const { startTime, endTime, activities } = context;
  const forecastLine = (weather.periods || [])
    .map(p => `${p.part}: ${p.tempF}°F, ${p.description}, ${p.pop}% chance of precipitation`)
    .join('; ');

  const outLine = startTime
    ? `Remi will be out for school roughly ${formatTime12h(startTime)}–${formatTime12h(endTime)}`
    : 'Remi has no school today';
  const activityLine = (activities || []).length
    ? `, and has ${activities.map(a => a.time ? `${a.title} at ${a.time}` : a.title).join(', ')} later`
    : '';

  const raw = await callClaude(
    claudeToken,
    `You're helping a parent get their 6-year-old son Remi (1st grade) dressed for the day.\n\n` +
    `${outLine}${activityLine}.\n` +
    `Today's forecast${weather.highF ? ` — high ${weather.highF}°F, low ${weather.lowF}°F` : ''}` +
    `${forecastLine ? `: ${forecastLine}` : ''}.\n` +
    `(Right now: ${weather.tempF}°F, feels like ${weather.feelsLike}°F, ${weather.description} — for ` +
    `background only; base the outfit on the forecast for when he'll actually be out, not this reading.)\n\n` +
    `Respond with ONLY a JSON object of the exact shape {"reasoning": "..."} — no other text. The ` +
    `"reasoning" value should be 2-3 conversational sentences telling the parent what Remi should wear, ` +
    `reasoning out loud from the forecast for the hours he'll actually be outside (mention specific rain ` +
    `chances or times of day when they matter). Lead with whatever the weather actually calls for — a ` +
    `jacket, rain gear, sun protection — then cover the basics like top, bottom, and footwear. Mention ` +
    `extras like sunglasses, a hat, or gloves only if the forecast justifies them. Refer to him as Remi. ` +
    `Warm and casual, like a text from a partner.${avoidClause(previous)}`,
    350
  );

  return extractJson(raw);
}

async function generatePackedLunchIdea(claudeToken, previous) {
  const raw = await callClaude(
    claudeToken,
    `Respond with ONLY a JSON object of the exact shape {"dish": "..."} — no other text. The "dish" value ` +
    `should suggest ONE simple, kid-friendly packed lunch for a 6-year-old with no dietary restrictions, ` +
    `for a school lunchbox. Max 20 words.${avoidClause(previous)}`,
    150
  );

  return extractJson(raw);
}

async function generateBreakfastIdea(claudeToken, previous) {
  const raw = await callClaude(
    claudeToken,
    `Respond with ONLY a JSON object of the exact shape {"dish": "..."} — no other text. The "dish" value ` +
    `should suggest ONE quick, kid-friendly breakfast idea for a 6-year-old before school, no dietary ` +
    `restrictions, ready in under 10 minutes. Max 18 words.${avoidClause(previous)}`,
    150
  );

  return extractJson(raw);
}

async function generateDinnerIdea(claudeToken, previous) {
  const raw = await callClaude(
    claudeToken,
    `Respond with ONLY a JSON object of the exact shape {"dish": "..."} — no other text. The "dish" value ` +
    `should suggest ONE simple, kid-friendly dinner idea for a 6-year-old with no dietary restrictions, ` +
    `easy enough for a busy weeknight. Max 20 words.${avoidClause(previous)}`,
    150
  );

  return extractJson(raw);
}

async function buildBriefing(dateStr, claudeToken, weatherKey) {
  const db = admin.firestore();
  const docRef = db.collection('remi-daily-briefing').doc(dateStr);

  // If a briefing already exists for this date, this call is regenerating it (rather than
  // a fresh day's first run) — the old suggestions get marked rejected once new ones land.
  const existingSnap = await docRef.get();
  const existing = existingSnap.exists ? existingSnap.data() : null;

  const schedule = await resolveScheduleForDate(db, dateStr);

  const lunchDoc = await db.collection('remi-lunch-menu').doc(dateStr).get();
  const lunchMenuText = lunchDoc.exists ? (lunchDoc.data().lunch || null) : null;

  let weather = null;
  try {
    weather = await fetchWeatherSnapshot(weatherKey);
  } catch (err) {
    console.error('buildBriefing weather error:', err);
  }

  const activities = await fetchActivitiesForDate(schedule.icalUrls, dateStr);
  // No point suggesting a school outfit on a day Remi has nothing on the calendar.
  const isGoingOut = schedule.schoolStatus !== 'no-school' || activities.length > 0;

  let clothingIdea = null;
  let clothingSuggestionId = null;
  let packedLunchIdea = null;
  let packedLunchSuggestionId = null;
  let breakfastIdea = null;
  let breakfastSuggestionId = null;
  let dinnerIdea = null;
  let dinnerSuggestionId = null;

  if (claudeToken && weather && isGoingOut) {
    try {
      const idea = await generateClothingIdea(claudeToken, weather, existing?.clothingIdea, {
        startTime: schedule.startTime,
        endTime: schedule.endTime,
        activities
      });
      clothingIdea = idea.reasoning;
      await rejectAiSuggestion(db, existing?.clothingSuggestionId);
      clothingSuggestionId = await logAiSuggestion(db, {
        featureType: 'remi-clothing',
        generatedContent: idea,
        contextSnapshot: { date: dateStr, weather }
      });
    } catch (err) {
      console.error('buildBriefing clothingIdea error:', err);
    }
  }

  if (claudeToken && schedule.lunchPlan === 'pack') {
    try {
      const idea = await generatePackedLunchIdea(claudeToken, existing?.packedLunchIdea);
      packedLunchIdea = idea.dish;
      await rejectAiSuggestion(db, existing?.packedLunchSuggestionId);
      packedLunchSuggestionId = await logAiSuggestion(db, {
        featureType: 'remi-packed-lunch',
        generatedContent: idea,
        contextSnapshot: { date: dateStr }
      });
    } catch (err) {
      console.error('buildBriefing packedLunchIdea error:', err);
    }
  }

  if (claudeToken) {
    try {
      const idea = await generateBreakfastIdea(claudeToken, existing?.breakfastIdea);
      breakfastIdea = idea.dish;
      await rejectAiSuggestion(db, existing?.breakfastSuggestionId);
      breakfastSuggestionId = await logAiSuggestion(db, {
        featureType: 'remi-breakfast',
        generatedContent: idea,
        contextSnapshot: { date: dateStr }
      });
    } catch (err) {
      console.error('buildBriefing breakfastIdea error:', err);
    }
  }

  if (claudeToken) {
    try {
      const idea = await generateDinnerIdea(claudeToken, existing?.dinnerIdea);
      dinnerIdea = idea.dish;
      await rejectAiSuggestion(db, existing?.dinnerSuggestionId);
      dinnerSuggestionId = await logAiSuggestion(db, {
        featureType: 'remi-dinner',
        generatedContent: idea,
        contextSnapshot: { date: dateStr }
      });
    } catch (err) {
      console.error('buildBriefing dinnerIdea error:', err);
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
    clothingSuggestionId,
    activities,
    lunchPlan: schedule.lunchPlan,
    lunchMenuText,
    packedLunchIdea,
    packedLunchSuggestionId,
    breakfastIdea,
    breakfastSuggestionId,
    dinnerIdea,
    dinnerSuggestionId,
    generatedAt: new Date().toISOString()
  };

  await docRef.set(briefing);
  return briefing;
}

/** "08:00" -> "8:00 AM" */
function formatTime12h(hhmm) {
  if (!hhmm) return '';
  const [hours, minutes] = hhmm.split(':').map(Number);
  const period = hours >= 12 ? 'PM' : 'AM';
  const hour12 = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour12}:${String(minutes).padStart(2, '0')} ${period}`;
}

/** Three bullets: what's on today, breakfast, and (only if he's actually going out) an outfit. */
function summarizeBriefingForPush(briefing) {
  const activities = briefing.activities || [];
  const isGoingOut = briefing.schoolStatus !== 'no-school' || activities.length > 0;
  const activityText = activities.slice(0, 2).map(a => (a.time ? `${a.title} ${a.time}` : a.title)).join(', ');

  let scheduleLine;
  if (briefing.schoolStatus === 'no-school') {
    scheduleLine = briefing.scheduleNote ? `No school — ${briefing.scheduleNote}` : 'No school today';
  } else if (briefing.schoolStatus === 'early-release') {
    scheduleLine = `Early release, starts ${formatTime12h(briefing.startTime)}`;
  } else {
    scheduleLine = `School at ${formatTime12h(briefing.startTime)}`;
  }
  if (activityText) scheduleLine += ` — ${activityText}`;

  const bullets = [scheduleLine];
  if (briefing.breakfastIdea) bullets.push(`Breakfast: ${briefing.breakfastIdea}`);
  // No point suggesting an outfit on a day off with nothing on the calendar.
  if (isGoingOut && briefing.clothingIdea) bullets.push(`Wear: ${briefing.clothingIdea}`);

  return bullets.map(b => `• ${b}`).join('\n');
}

/**
 * Builds today's briefing and pushes a summary to all registered devices.
 * Runs every morning at 7:30 AM Central Time.
 */
exports.dailyRemiBriefing = onSchedule(
  { schedule: '30 7 * * *', timeZone: 'America/Chicago', secrets: ['CLAUDE_API_KEY', 'OPEN_WEATHER_API_KEY'] },
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

    const title = "Remi's Day";
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

/**
 * Regenerates a single AI-suggested facet of an already-generated briefing
 * (clothing, breakfast, lunch, or dinner) without recomputing weather/schedule/
 * calendar — cheap, fast, and lets the dashboard offer a per-card "different idea" refresh.
 */
exports.regenerateBriefingFacet = onCall(
  { secrets: ['CLAUDE_API_KEY', 'OPEN_WEATHER_API_KEY'], invoker: 'public' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign-in required');
    }

    const { date, facet } = request.data || {};
    if (!date || !facet) {
      throw new HttpsError('invalid-argument', 'date and facet are required');
    }

    const db = admin.firestore();
    const docRef = db.collection('remi-daily-briefing').doc(date);
    const snap = await docRef.get();
    if (!snap.exists) {
      throw new HttpsError('not-found', 'No briefing exists for this date yet');
    }
    const briefing = snap.data();
    const token = claudeApiKey.value();

    let updates;
    try {
      switch (facet) {
        case 'clothing': {
          if (!briefing.weather) {
            throw new HttpsError('failed-precondition', 'No weather data available for this day');
          }
          // The stored snapshot is from whenever the briefing was built (7:30 AM for
          // the scheduled run), so today's outfit advice re-reads the weather.
          let weather = briefing.weather;
          if (date === toDateStr(new Date())) {
            try {
              weather = await fetchWeatherSnapshot(openWeatherApiKey.value());
            } catch (err) {
              console.error('regenerateBriefingFacet weather refresh error:', err);
            }
          }
          const idea = await generateClothingIdea(token, weather, briefing.clothingIdea, {
            startTime: briefing.startTime,
            endTime: briefing.endTime,
            activities: briefing.activities
          });
          await rejectAiSuggestion(db, briefing.clothingSuggestionId);
          const suggestionId = await logAiSuggestion(db, {
            featureType: 'remi-clothing',
            generatedContent: idea,
            contextSnapshot: { date, weather }
          });
          updates = { weather, clothingIdea: idea.reasoning, clothingSuggestionId: suggestionId };
          break;
        }
        case 'breakfast': {
          const idea = await generateBreakfastIdea(token, briefing.breakfastIdea);
          await rejectAiSuggestion(db, briefing.breakfastSuggestionId);
          const suggestionId = await logAiSuggestion(db, {
            featureType: 'remi-breakfast',
            generatedContent: idea,
            contextSnapshot: { date }
          });
          updates = { breakfastIdea: idea.dish, breakfastSuggestionId: suggestionId };
          break;
        }
        case 'lunch': {
          if (briefing.lunchPlan !== 'pack') {
            throw new HttpsError('failed-precondition', 'Today is a hot-lunch day, not a packed lunch');
          }
          const idea = await generatePackedLunchIdea(token, briefing.packedLunchIdea);
          await rejectAiSuggestion(db, briefing.packedLunchSuggestionId);
          const suggestionId = await logAiSuggestion(db, {
            featureType: 'remi-packed-lunch',
            generatedContent: idea,
            contextSnapshot: { date }
          });
          updates = { packedLunchIdea: idea.dish, packedLunchSuggestionId: suggestionId };
          break;
        }
        case 'dinner': {
          const idea = await generateDinnerIdea(token, briefing.dinnerIdea);
          await rejectAiSuggestion(db, briefing.dinnerSuggestionId);
          const suggestionId = await logAiSuggestion(db, {
            featureType: 'remi-dinner',
            generatedContent: idea,
            contextSnapshot: { date }
          });
          updates = { dinnerIdea: idea.dish, dinnerSuggestionId: suggestionId };
          break;
        }
        default:
          throw new HttpsError('invalid-argument', `Unknown facet: ${facet}`);
      }
    } catch (err) {
      if (err instanceof HttpsError) throw err;
      console.error('regenerateBriefingFacet generation error:', err);
      throw new HttpsError('internal', err.message || 'Failed to regenerate');
    }

    updates.generatedAt = new Date().toISOString();
    await docRef.update(updates);
    return { success: true, ...updates };
  }
);

// ---------------------------------------------------------------------------
// Smart alerts
// ---------------------------------------------------------------------------

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Creates a smart alert unless a pending one from the same triggering rule already
 * exists — keeps an ongoing issue (e.g. registration that's been expired for weeks)
 * from generating a fresh alert every single night.
 */
async function upsertSmartAlert(db, { alertType, message, triggeringRule }) {
  const existing = await db.collection('smartAlerts')
    .where('triggeringRule', '==', triggeringRule)
    .where('status', '==', 'pending')
    .limit(1)
    .get();
  if (!existing.empty) return;

  await db.collection('smartAlerts').add({
    alertType,
    message,
    triggeringRule,
    status: 'pending',
    createdAt: new Date().toISOString()
  });
}

/** Vehicle registration expiring/expired, or maintenance due/overdue by date or mileage. */
async function evaluateVehicleAlerts(db) {
  const [vehiclesSnap, recordsSnap] = await Promise.all([
    db.collection('vehicles').get(),
    db.collection('maintenanceRecords').get()
  ]);

  const vehicles = vehiclesSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const records = recordsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
  const now = new Date();
  const thirtyDaysOut = new Date(now.getTime() + THIRTY_DAYS_MS);

  for (const vehicle of vehicles) {
    if (!vehicle.registrationExpiry) continue;
    const expiry = new Date(vehicle.registrationExpiry);
    if (expiry < now) {
      await upsertSmartAlert(db, {
        alertType: 'vehicle-registration-expired',
        message: `${vehicle.name}'s registration expired ${expiry.toLocaleDateString()}`,
        triggeringRule: `vehicle-registration:${vehicle.id}`
      });
    } else if (expiry <= thirtyDaysOut) {
      await upsertSmartAlert(db, {
        alertType: 'vehicle-registration-due-soon',
        message: `${vehicle.name}'s registration expires ${expiry.toLocaleDateString()}`,
        triggeringRule: `vehicle-registration:${vehicle.id}`
      });
    }
  }

  for (const record of records) {
    const vehicle = vehicles.find(v => v.id === record.vehicleId);
    if (!vehicle) continue;

    const dueByDate = record.nextDueDate ? new Date(record.nextDueDate) : null;
    const dueByMileage = record.nextDueMileage != null && vehicle.currentMileage >= record.nextDueMileage;
    if (!((dueByDate && dueByDate <= thirtyDaysOut) || dueByMileage)) continue;

    const overdue = (dueByDate && dueByDate < now) || dueByMileage;
    const label = (record.type || 'maintenance').replace('_', ' ');
    await upsertSmartAlert(db, {
      alertType: overdue ? 'vehicle-maintenance-overdue' : 'vehicle-maintenance-due-soon',
      message: overdue
        ? `${vehicle.name} is overdue for ${label}`
        : `${vehicle.name} will be due for ${label} soon`,
      triggeringRule: `vehicle-maintenance:${record.id}`
    });
  }
}

/** A field trip on tomorrow's calendar, when tomorrow is otherwise a hot-lunch school day. */
async function evaluateFieldTripLunchAlert(db) {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const dateStr = toDateStr(tomorrow);

  const schedule = await resolveScheduleForDate(db, dateStr);
  if (schedule.schoolStatus !== 'school' || schedule.lunchPlan !== 'hot') return;

  const activities = await fetchActivitiesForDate(schedule.icalUrls, dateStr);
  const fieldTrip = activities.find(a => /field trip/i.test(a.title));
  if (!fieldTrip) return;

  await upsertSmartAlert(db, {
    alertType: 'field-trip-pack-lunch',
    message: `"${fieldTrip.title}" tomorrow — consider packing a lunch instead of hot lunch`,
    triggeringRule: `field-trip-lunch:${dateStr}`
  });
}

async function evaluateSmartAlerts() {
  const db = admin.firestore();
  await evaluateVehicleAlerts(db);
  await evaluateFieldTripLunchAlert(db);
}

/** Runs every evening so alerts about tomorrow (and ongoing vehicle upkeep) are ready by morning. */
exports.nightlySmartAlerts = onSchedule(
  { schedule: '0 20 * * *', timeZone: 'America/Chicago' },
  async () => {
    await evaluateSmartAlerts();
  }
);

/** Manual trigger for testing the same rules on demand, without waiting for the nightly run. */
exports.runSmartAlertsNow = onCall(
  { invoker: 'public' },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Sign-in required');
    }
    try {
      await evaluateSmartAlerts();
      return { success: true };
    } catch (err) {
      console.error('runSmartAlertsNow error:', err);
      throw new HttpsError('internal', err.message || 'Failed to evaluate smart alerts');
    }
  }
);
