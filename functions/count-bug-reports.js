/**
 * Prints one line saying how many "Report a logic bug" submissions aren't resolved yet, or nothing when
 * there are none (or the lookup can't run). Used by the SessionStart hook in .claude/settings.json, so it
 * must stay quick and quiet on failure. Needs `gcloud auth application-default login` credentials.
 * To read the reports themselves, use pull-bug-reports.js (or the /bug-reports skill).
 */
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

const project = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '.firebaserc'), 'utf8')).projects.default;
admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: project });

admin.firestore().collection('replyBugReports').get()
  .then(snap => {
    const open = snap.docs.filter(d => d.data().status !== 'resolved').length;
    if (open) console.log(`Reminder: ${open} unresolved bug report${open === 1 ? '' : 's'} in replyBugReports. Mention this to the user and offer to run /bug-reports.`);
    process.exit(0);
  })
  .catch(() => process.exit(0));
