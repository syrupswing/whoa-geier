# AI memory & orchestration — revised plan

Revised after validating the original planning-session doc against the actual repo (2026-08-27/28). The original doc assumed Postgres and Gemini; neither is accurate. This version reflects what's actually here. Still a direction, not a locked spec.

## Current state (validated against code)

- **Stack**: Angular 17 + Capacitor (iOS/Android), Firebase (Firestore + Cloud Functions + FCM), no SQL database anywhere.
- **LLM providers actually in use**:
  - Client-side calls go through `GithubAiService` (`src/app/services/github-ai.service.ts`) → GitHub Models (`gpt-4o-mini`) directly in local dev, or via a Firebase callable proxy (`aiProxy`, `functions/index.js:58-82`) in production — which itself calls **Claude Haiku**, not GitHub Models. So production client-side "AI" calls are silently served by Claude.
  - Server-side (Cloud Functions) calls Claude directly for the daily briefing (`functions/index.js:418-463`).
  - `@google/genai` is in `package.json` but **unused** — dead dependency. `gemini-ai.service.ts` is a dead duplicate of `github-ai.service.ts` (same API, also calls GitHub Models despite the name, no callers). `AI_FEATURES.md` and `GEMINI_SETUP.md` describe this dead Gemini path and are stale.
- **An orchestration-shaped pattern already exists**, just scoped to one feature: `functions/index.js`'s `buildBriefing()` assembles schedule + weather + calendar context server-side, calls Claude for 4 structured facets (clothing/breakfast/lunch/dinner), and caches the result to Firestore (`remi-daily-briefing/{date}`). `regenerateBriefing()` (full rebuild) and `regenerateBriefingFacet()` (single-facet redo, with an `avoidClause()` that feeds in the prior suggestion so it won't repeat) are both callable functions already wired to the dashboard's refresh buttons. **This is the seed of the orchestration service** — the plan should grow this, not build a parallel system.
- **No family-member data model exists.** Auth is one Firebase account (`UserProfile` = uid/email/displayName/photoURL only). "Remi" (the kid) is hardcoded into Claude prompt strings server-side ("6-year-old, 1st grade", "no dietary restrictions") — not represented as data anywhere. Todos track `completedByUserId`/`completedByUserName` for attribution, which is the full extent of per-person modeling today. **Decided**: model this as a single household doc with an array of member profiles (not a separate per-member collection) — see §3.
- **Meal suggestions are 100% freeform** — the breakfast/lunch/dinner ideas in the daily briefing have zero grounding in saved recipes or meal history; they only avoid repeating the immediately-prior suggestion via `avoidClause()`.
- **Recipes and vehicles are both localStorage-only**, not Firestore. This matters more than it sounds: a server-side nightly Cloud Function (the smart-alerts job) cannot read `localStorage` — it only sees Firestore. So neither "suggest from saved recipes" nor "vehicle mileage → maintenance alert" can work until that data is migrated to Firestore. Vehicles already have decent client-side logic for this (`getUpcomingMaintenance()`/`getOverdueMaintenance()` in `vehicle.service.ts`) — it just needs to move server-accessible.
- **No suggestion-logging or accept/edit/reject tracking exists anywhere.** Confirmed via full grep — nothing to build on, but also nothing to reconcile with.
- **Remi World** (`remi-world.component.ts`) is an unrelated kid's quiz game (spelling/math/fun-facts, in-memory only) — not part of the memory/orchestration system. **Remi Schedule** (`remi-schedule.component.ts`) is the parent-facing admin config (school days, exceptions, lunch menu, calendar feeds) that feeds `buildBriefing()` — relevant as a context source, not as a feature to change.
- **Fixed during discovery**: `functions/index.js`'s `dailyTodoReminder` queried Firestore collection `todos`, but the app has only ever used `todoItems` (`todo.service.ts:55`) — confirmed via git history that `todos` was a typo introduced when the reminder job was added (`ab21c63`), not a legacy collection. Changed the query to `todoItems`; no schema decision needed, no other collection to reconcile.

## 1. Architecture: AI orchestration layer

Original idea stands (route every AI feature through one service that builds context, picks a prompt template, requests structured JSON, and logs outcomes) — but the implementation home changes:

- **Extend `functions/index.js`**, not a new standalone service. It already has the context-assembly + Claude-call + Firestore-cache shape for the daily briefing; generalize that into a shared internal helper (`callOrchestrator(featureType, context, promptTemplate)`) that `buildBriefing()`'s facets and any newly-migrated feature (meal suggestions, grocery hints, recipe suggestions) can call, rather than each Cloud Function/client service hitting Claude/GitHub Models ad hoc.
- Structured JSON output: already the norm for recipe suggestions, grocery categorization, and Remi World questions (regex-extracted then `JSON.parse`d). Prose still used for grocery aisle hints, dashboard welcome message, weather→outfit line, and all 4 briefing facets — these are the ones to convert to structured JSON so they can be diffed/logged/compared against history.

### Client-side AI call sites: recommended approach

All client-side calls (recipes "Ask AI", grocery aisle hints, grocery categorization, dashboard/header chat, Remi World quiz) currently bypass the server entirely in dev via `GithubAiService` → GitHub Models, and get silently redirected to Claude through `aiProxy` only in production. That split is exactly the kind of thing that should collapse into one path:

- **Generalize `aiProxy`** (`functions/index.js:58-82`) into the shared orchestrator entry point: `{ featureType, payload, memberId? }` in, and it does memory lookup (relevant `explicitFacts`/`learnedPatterns`/`recentContext`), template selection, the Claude call, JSON validation, and an `aiSuggestions` log write, all server-side. This is the same shape `buildBriefing()` already needs, just callable from any feature instead of only the scheduled/regenerate briefing functions.
- **Migrate call sites one at a time**, cutting each one over to the generalized callable and deleting its bespoke prompt-building code from the component. Suggested order, easiest/lowest-risk first: grocery aisle hint → grocery categorization (both already simple JSON) → recipe suggestions → Remi World quiz → chat widgets last, since free-text chat doesn't fit a `featureType + JSON schema` shape as cleanly — let those stay prose in/out through the same callable, and skip suggestion-logging for them specifically (there's no clean accept/reject event for a chat reply).
- **Retire the dev-only direct-to-GitHub-Models path** once each site is migrated, rather than keeping it as a second live code path. It has no logging, can't see memory/context, and is already effectively unused in production. Delete `gemini-ai.service.ts` (dead duplicate) at the same time, and update or remove `AI_FEATURES.md`/`GEMINI_SETUP.md`, which currently document a Gemini integration that was never actually wired up.
- **Sequencing**: don't bundle this with the initial data-model/briefing work (steps 1-2 in the build order below). Do it as its own phase after the generalized orchestrator is proven out on the briefing feature — migrating a feature at a time keeps each change reviewable and means a broken migration only affects one feature, not all AI calls in the app at once.

## 2. Memory model

Unchanged in concept from the original doc — three categories, kept distinct:

| Type | Description | Examples | Lifecycle |
|---|---|---|---|
| **Explicit facts** | Directly stated by a family member | "Remi is allergic to shellfish", "oil change every 5,000 miles" | Persistent until edited/removed |
| **Learned patterns** | Inferred from the suggestion feedback log over time | "Dinner suggestions get swapped on Mondays" | Confidence/frequency signal, not asserted as fact |
| **Recent context** | Short-term, time-bound | "Grandma visiting Saturday" | Auto-archives after the relevant date |

## 3. Data model additions (Firestore, not Postgres)

Collections below follow the existing naming convention seen in the repo (flat kebab/camelCase collection names, doc-per-date where the existing `remi-daily-briefing`/`remi-lunch-menu` collections already do that).

```
household/{householdId}          — likely a single fixed doc for this app, e.g. household/main
  members: [
    { id, name, dietaryRestrictions: string[], preferences: map }
  ]
  createdAt
  — does not exist today. Decided: one household doc with an embedded member array,
    not a separate per-member collection — this is a single-family app, not multi-tenant,
    and member profiles (a handful of fields, rarely written) don't need document-per-member
    scale. `memberId` below refers to the `id` inside this array.

explicitFacts/{factId}
  memberId (nullable — household-wide if absent), factText, category, createdAt

learnedPatterns/{patternId}
  memberId (nullable), patternDescription, confidenceScore, supportingEventCount, lastObservedAt

recentContext/{contextId}
  description, relevantDateStart, relevantDateEnd, archivedAt

aiSuggestions/{suggestionId}
  featureType (meal/outfit/shopping_hint/recipe/...), memberId, generatedContent (map), contextSnapshot (map),
  status (accepted/edited/rejected), editedContent (map, nullable), createdAt

mealHistory/{entryId}
  memberId, mealType, dish, date, source (ai_suggested/manual)

smartAlerts/{alertId}
  alertType, message, triggeringRule, status (pending/dismissed/acted_on), createdAt
```

Two prerequisites the original doc didn't anticipate, because they only show up once you look at the real data:

- **`recipes` needs a Firestore collection** (mirroring the current localStorage shape in `recipes.component.ts`) before meal suggestions can be grounded in it, and before it's usable from a Cloud Function at all.
- **`vehicles` and `maintenanceRecords` need Firestore collections** (mirroring the current localStorage shape in `vehicle.service.ts`, which already has the due-date/due-mileage fields) before a nightly smart-alerts job can see them. The client-side overdue/upcoming logic already there can mostly move as-is once the data is server-accessible.

## 4. Smart alerts

Same pattern as the original doc: `alert = (calendar/recent-context signal) + (learned pattern or explicit fact) crossing a threshold`, run on a schedule via a new `onSchedule` Cloud Function (there's already a nightly-job precedent: `dailyRemiBriefing` at `functions/index.js:574`, 6am Central). Examples from the original doc still apply once the underlying data exists in Firestore:

- Coffee restock pattern → shopping list suggestion
- Field trip on calendar → packed lunch instead of hot lunch
- Vehicle mileage pattern (once `vehicles`/`maintenanceRecords` are in Firestore) → oil change alert
- Recent-context entry + no meal planned + dietary notes on file → suggest a meal

## 5. UI direction

Two general principles carry over from the original doc and aren't stack-dependent: fragments over sentences in AI-generated text, and color reserved for "needs a decision" rather than decoration.

**Unified day view: dropped for now.** The original doc's all-day-strip/timeline/meal-markers/anytime-tray/person-switcher concept isn't locked in and isn't currently planned — not convinced it's the right direction yet. Don't build toward it; if a better concept for consolidating the dashboard/calendar/todo views emerges later, it replaces this section rather than extending it.

## 6. Existing features — how they connect (revised)

- **Shopping list (`grocery-list`, Firestore collection `groceryItems`)**: aisle-hint and categorization AI calls already exist and are already client-side JSON/prose via `GithubAiService`. Extending with "usually on the list by now" suggestions is a natural fit once `aiSuggestions`/`learnedPatterns` exist — no migration blocker here, this one's already in Firestore.
- **Recipes**: currently generates freely with no grounding (see above) and lives only in `localStorage`. Two separate pieces of work: (a) migrate to Firestore, (b) feed saved recipes into the meal-suggestion prompt context. Don't assume these ship together — (a) alone unblocks cross-device sync and is useful even before (b).
- **Vehicles**: currently localStorage-only with decent client-side maintenance-due logic already written. Migrating to Firestore is the blocker for using it as an explicit-facts source for alerts; the due-date/due-mileage logic itself doesn't need to be rewritten, just relocated.
- **Remi World**: confirmed out of scope — it's a standalone quiz game, not a memory/context feature.

## 7. Suggested build order (revised)

1. Add `explicitFacts`, `learnedPatterns`, `recentContext`, `aiSuggestions` Firestore collections — no UI changes.
2. Convert the daily-briefing facets (`functions/index.js:418-463`) to structured JSON output and start writing to `aiSuggestions` on every generate/regenerate call — this reuses the existing regenerate/regenerate-facet flow instead of building a new one, and it's the feature that already has an accept/reject-shaped UI action (the refresh button).
3. Add a basic explicit-facts UI ("remember that...") so the store has real data.
4. Migrate `recipes` (localStorage → Firestore) and `vehicles`/`maintenanceRecords` (localStorage → Firestore) — required before either can feed a server-side smart-alerts job or be grounded against.
5. Build the nightly smart-alerts `onSchedule` function against the new data, starting with 1-2 rules that only need data already in Firestore (e.g. vehicle maintenance, once step 4 lands).
6. Generalize `aiProxy` into the shared orchestrator callable and migrate client-side AI call sites onto it one at a time (see "Client-side AI call sites" above for order); retire the dev-only GitHub Models path and delete the dead Gemini duplicate/docs once migrated.
7. Build the natural-language quick-add feature (§8), in four checkpointed sub-steps. **Status: done**, not yet deployed/tested against the live Claude API.
   - **7a. Native calendar events + merged calendar view** — done, see §8a.
   - **7b. `quick-add-parse` orchestrator template** (`functions/index.js`, `ORCHESTRATOR_TEMPLATES`) — done. Classifies into **five** types, not four: `event`, `reminder`, `todo`, `fact`, and `shopping_item` (added during implementation — the §8 duplicate-detection spec already named the shopping list as an in-scope domain, so the parser needed a type for it too; a statement like "we need milk" would otherwise misclassify as a generic todo and miss `GroceryService`/aisle-hint integration entirely). Vehicle maintenance was deliberately left out of the parser's output types (picking a vehicle is more involved than a one-line parse) even though it's still a valid duplicate-check domain for other item types that might reference it later.
   - **7c. Confirmation-card UI + FAB entry point** — done: `QuickAddComponent` (`src/app/shared/quick-add/`), wired into `app.component.html`. Reuses the screen position of the already-dead, commented-out chat-toggle FAB (`app.component.ts`/`.scss`) rather than the floating chat itself — that chat panel has had no visible toggle button for a while and was left alone, out of scope here.
   - **7d. Per-item-type duplicate detection** — done, folded into `QuickAddComponent` (`computeDuplicateNote()`): plain-JS normalize + substring match, no extra AI call, against `GroceryService.getActiveItems()`, `TodoService.items()`, the merged calendar-event list (§8a), and `MemoryService.explicitFacts()`. The plan's original "added by [name] [time ago]" duplicate-note wording was dropped — this app has one shared Firebase Auth account (see "Current state" above), so per-user attribution isn't meaningful; the note just names the matching item.
   
   Depended on step 6 (generalized orchestrator callable) and step 4 (`maintenanceRecords` in Firestore) — both already done.

## 8. Natural-language quick-add (build order step 7)

**Status: implemented, 2026-08-29.** Not yet deployed to production or exercised against the live Claude API — verified so far only via `tsc --noEmit` and `ng build`.

A free-text entry point where a person types or speaks a plain-language statement, and the system parses it into structured records (calendar events, reminders/alarms, to-dos, shopping items, or even explicit facts) rather than requiring form-filling.

### 8a. Native calendar events + merged calendar view

Decided during scoping: rather than add Google Calendar write access (new OAuth scope, re-consent for existing users, `gapi.client.calendar.events.insert`), the app gets its own event store, merged into the same calendar view.

- New Firestore collection `calendarEvents/{eventId}`, shaped like the existing `CalendarEvent` interface (`google-calendar.service.ts`) plus a `source: 'app'` discriminator (Google-sourced events get `source: 'google'` when merged, not stored that way).
- `CalendarComponent` (`calendar.component.ts`) currently reads only from `GoogleCalendarService.events()` (see `getEventsForDay()`). Merge in the new native-event service's signal at that same read point, so every position/rendering method downstream (`calculateEventPosition`, `getEventColor`, etc.) keeps working unchanged against the merged list.
- `getEventColor()` picks a distinct, fixed color for `source: 'app'` events instead of the Google `colorId` palette — this is the "different color" visual cue for which events are app-native vs. synced from Google.
- This collection is useful standalone (an in-app "add event" affordance becomes possible even before quick-add exists) and is also where quick-add writes when it classifies a statement as a calendar event.
- Firestore rules: add `calendarEvents/{eventId}` with the same authenticated CRUD shape as `todoItems`/`groceryItems`.

**Status: done.** `AppCalendarEventService` (`src/app/services/app-calendar-event.service.ts`), merged into `CalendarComponent` via `getAllEvents()`, `getEventColor()` returns `#8E6BC9` for `source: 'app'`. The Google-sign-in gate on the timeline view was also loosened (`calendar.component.html`) — the timeline now renders once `calendarService.isInitialized()`, not only when Google-signed-in, since native events shouldn't require a Google connection to be visible.

### 8b. Suggestion logging granularity

Decided: log one `aiSuggestions` doc per **extracted item**, not one per raw statement. A statement like "soccer practice Tuesday at 4, remind me to bring snacks" yields two `aiSuggestions` docs (`featureType: quick-add-parse`), each independently accept/edit/reject-able. This reuses the existing per-id `AiSuggestionService.markAccepted/markEdited/markRejected` API as-is — no new logging shape needed. Each doc's `contextSnapshot` includes the original raw statement text so the group can still be reconstructed for review.

### Why this belongs in the orchestration layer

Same structured-output pattern as §1, applied to input instead of output. Routes through the same generalized orchestrator callable (§1), uses the same "return structured JSON" discipline, and logs corrections back to the feedback system so the parser improves the same way suggestions do.

### Core design principle: never silently commit

Natural language is ambiguous ("remind me next week," "the doctor," "in the morning"). The design must never guess silently and save. Every parse result is shown as a confirmation card before it's written to Firestore.

### Parsing behavior

1. **Classify before extracting.** The first job of the parser is to determine what kind of item each part of the statement is — calendar event, reminder/alarm, to-do, shopping-list item, or explicit fact (e.g. "Remi is allergic to shellfish" is a fact, not a scheduled item; "we need milk" is a shopping item added during implementation, see build order step 7b). Route by type, not by which screen the person happened to be on.
2. **One statement can yield multiple items.** "Remi has soccer practice Tuesday at 4, and remind me to bring snacks" should produce two separate structured items (one event, one reminder), not force a single-item assumption.
3. **Confidence-aware extraction.** Each extracted field carries an implicit confidence. High-confidence fields (explicit day/time stated) get parsed as-is. Low-confidence or missing fields (vague relative dates, no time given, ambiguous references to a person or place) must be flagged, not defaulted silently.

### Confirmation UI

- Each parsed item renders as its own small card: type icon, extracted title, key details (who/when), and Edit / Confirm actions.
- Cards with a low-confidence or missing field render with a warning treatment (e.g. warning-colored border/background) and an explicit note describing what was inferred and why, e.g. "No time specified — default: Tue 3:00 PM (1hr before practice)." The default should be reasonable (tying to a related event/pattern when possible) but always visible and editable, never hidden.
- High-confidence cards are neutral-styled and support a fast "confirm all" action for the common case where the parse is clean.
- If genuinely ambiguous in a way defaults can't resolve (e.g. "the doctor" with multiple doctor contacts on file), prefer a clarifying follow-up over guessing.

### Data/feedback loop

- Log the original statement, the parsed output, and the final confirmed/edited version in `aiSuggestions` (§3) — same shape as any other suggestion, `featureType: quick-add-parse`.
- Corrections are learning signal: if people consistently adjust a vague-time default (e.g. "morning" parsed as 9am but always corrected to 8am), that should feed into `learnedPatterns` over time, the same as suggestion edits do elsewhere.

### Placement in the UI

- A persistent quick-entry affordance (e.g. floating action button or entry bar) rather than a full conversational chat interface — the interaction is meant to be fast capture, not back-and-forth dialogue, except when a clarifying question is genuinely required.
- Should be reachable from anywhere in the app, not buried inside a specific feature screen, since a single statement may produce items across multiple features (calendar + reminders + shopping, etc).

### Duplicate detection against existing records

Before a parsed item is confirmed, check it against existing records for a likely duplicate, especially the case where a different family member already added the same thing. This is a distinct check from confidence-flagging on parsed fields — it is about the item versus what is already stored, not about how well the statement was parsed.

- **Scope the check per item type, since "duplicate" means something different in each domain:**
  - *Shopping list* (`groceryItems`): match against currently unpurchased items on the list (e.g. "milk" vs "buy milk" should match).
  - *Calendar events* (merged `calendarEvents` + Google events per §8a): match against events with overlapping time and the same family member.
  - *Reminders/to-dos* (`todoItems`): match against open items with similar title/intent.
  - *Vehicle maintenance* (`maintenanceRecords`, already in Firestore per step 4): match against the same service type on the same vehicle within a recent window (a second oil change six months later is a new instance, not a duplicate, so this check is time-bounded rather than a simple existence check).
- **Surface it inline on the same confirmation card**, not as a separate step: a short note such as "Looks similar to an item already on the list, added by [name] [time ago]," with an option to confirm it's already covered (discard) or confirm it's genuinely new (add anyway).
- Likely reuses the same matching logic across item types conceptually (recent-window lookup plus similarity match on title/subject), even though the specific fields compared differ per type.
- This check is a good candidate to log outcomes for as well (was the "possible duplicate" flag correct or a false alarm), since that is exactly the kind of signal `learnedPatterns` is meant to absorb over time.

## Decisions locked in

- Family-member model: single household doc with an embedded member array (§3), not a per-member collection.
- `dailyTodoReminder`'s `todos`/`todoItems` mismatch: fixed (`functions/index.js` now queries `todoItems`).
- Client-side AI call sites: migrate onto a generalized orchestrator callable, one feature at a time, as its own phase (step 6) — see rationale under §1.
- Natural-language quick-add (§8) is now build order step 7, ahead of any UI-consolidation work — it depends on step 6's orchestrator callable, not on a redesigned dashboard.
- Unified day view (previously §5/old step 7): dropped, not just deferred with a placeholder — no replacement concept adopted yet. Don't resurrect the all-day-strip/timeline/tray/person-switcher design without a fresh discussion.
- Calendar events: no Google Calendar write access. New app-native `calendarEvents` Firestore collection merged into the existing calendar view instead, distinguished by color (§8a).
- Quick-add suggestion logging: one `aiSuggestions` doc per extracted item, not per raw statement (§8b) — reuses the existing per-id accept/edit/reject API unchanged.
- Build order step 7 (quick-add, all four sub-steps): done as of 2026-08-29, not yet deployed or tested against the live Claude API.
- Quick-add item types: five, not four — `shopping_item` added alongside event/reminder/todo/fact so "we need milk"-style statements route to the grocery list instead of becoming a generic todo (step 7b). Vehicle maintenance stays a duplicate-check-only domain, not a parser output type.
