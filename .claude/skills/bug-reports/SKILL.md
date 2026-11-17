---
name: bug-reports
description: Check the app's "Report a logic bug" submissions for unresolved items, investigate them against the code, and mark them resolved. Use for /bug-reports, "any bug reports?", or when a session reminder says there are unresolved bug reports.
---

# Bug reports

Chat replies carry a "Report a logic bug" button. Submissions land in the Firestore collection `replyBugReports`
with a `status` of `new` until someone resolves them.

## Steps

1. List what's unresolved. From `functions/`, run `node pull-bug-reports.js --all`, then show only reports whose
   status isn't `resolved` (read them from `functions/bug-reports.json`, which is git-ignored). Never pass
   `--resolve`: it marks every printed report resolved, including ones not looked at.
   - Needs `gcloud auth application-default login` credentials; if the call fails on auth, say so.
2. For each unresolved report, show: when, the question asked, the reply given, and the reporter's note.
3. Investigate each against the code and real data (the chat context is built in `functions/index.js` and
   `functions/chat-context.js`; check Firestore for the underlying records). Decide whether it is a logic bug, bad
   data, or already fixed by a later commit (`git log` since the report date). Say which, with evidence.
4. Fix real bugs (with a test where one fits) and ask before committing or pushing.
5. Mark a report resolved only once the user agrees it is, and only that one: update its document's `status` to
   `resolved` with a one-off script using the Admin SDK, not `--resolve`.
