/**
 * Pulls "Report a logic bug" submissions (replyBugReports) from Firestore for local debugging.
 * Usage: node pull-bug-reports.js <path-to-service-account.json> [--all] [--resolve]
 *   (default) prints reports with status "new"; --all prints every report;
 *   --resolve marks the printed reports as status "resolved".
 * Also writes them to functions/bug-reports.json (git-ignored).
 */
const admin = require('firebase-admin');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const args = process.argv.slice(2);
const serviceAccountPath = args.find(a => !a.startsWith('--'));
if (!serviceAccountPath) {
  console.error('Usage: node pull-bug-reports.js <path-to-service-account.json> [--all] [--resolve]');
  process.exit(1);
}
const resolved = serviceAccountPath.startsWith('~')
  ? path.join(os.homedir(), serviceAccountPath.slice(1))
  : path.resolve(serviceAccountPath);

admin.initializeApp({ credential: admin.credential.cert(require(resolved)) });

(async () => {
  const db = admin.firestore();
  const snap = await db.collection('replyBugReports').orderBy('createdAt', 'desc').get();
  const reports = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(r => args.includes('--all') || r.status === 'new');

  fs.writeFileSync(path.join(__dirname, 'bug-reports.json'), JSON.stringify(reports, null, 2));

  if (!reports.length) console.log('No bug reports.');
  for (const r of reports) {
    console.log(`\n=== ${r.id} · ${r.createdAt} · ${r.reporterName || r.reporterUid || 'unknown'} · ${r.status}`);
    console.log(`Asked:    ${r.question}`);
    console.log(`Reply:    ${r.reply}`);
    console.log(`Problem:  ${r.note}`);
  }
  console.log(`\n${reports.length} report(s) written to functions/bug-reports.json`);

  if (args.includes('--resolve')) {
    await Promise.all(reports.map(r => db.collection('replyBugReports').doc(r.id).update({ status: 'resolved' })));
    console.log('Marked as resolved.');
  }
  process.exit(0);
})().catch(err => { console.error(err); process.exit(1); });
