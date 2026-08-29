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

Unchanged from the original doc — none of it is stack-dependent (fragments over sentences, color reserved for "needs a decision", unified day view with all-day strip / timeline / meal markers / anytime tray / person switcher). Revisit only after the data layer and one real feature are working, per the build order below.

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
7. Only after the data layer works: revisit the UI toward the unified timeline direction.

## Decisions locked in

- Family-member model: single household doc with an embedded member array (§3), not a per-member collection.
- `dailyTodoReminder`'s `todos`/`todoItems` mismatch: fixed (`functions/index.js` now queries `todoItems`).
- Client-side AI call sites: migrate onto a generalized orchestrator callable, one feature at a time, as its own phase (step 6) — see rationale under §1.
