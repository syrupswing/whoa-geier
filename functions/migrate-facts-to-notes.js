/**
 * One-time copy of explicitFacts into the notes collection (kind: 'fact'), so the family
 * notebook is the single place facts live. Safe to re-run: each copy gets the id "fact-<old id>"
 * and an existing note is never overwritten. The old explicitFacts docs are left in place as a backup.
 * Usage: node migrate-facts-to-notes.js [path-to-service-account.json] [--apply]
 *   Without --apply it only prints what would be copied. Without a key file it uses
 *   `gcloud auth application-default login` credentials.
 */
const admin = require('firebase-admin');
const fs = require('fs');

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const keyPath = process.argv.slice(2).find(a => !a.startsWith('--'));
const apply = process.argv.includes('--apply');
admin.initializeApp(keyPath
  ? { credential: admin.credential.cert(JSON.parse(fs.readFileSync(keyPath, 'utf8'))) }
  : { credential: admin.credential.applicationDefault(), projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();

(async () => {
  const facts = await db.collection('explicitFacts').get();
  let copied = 0;
  for (const doc of facts.docs) {
    const f = doc.data();
    const ref = db.collection('notes').doc(`fact-${doc.id}`);
    if ((await ref.get()).exists) continue;
    const note = {
      kind: 'fact',
      title: String(f.factText || '').slice(0, 80),
      body: f.factText || '',
      category: f.category || 'other',
      source: 'migrated',
      createdAt: f.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    if (f.memberId) note.memberId = f.memberId;
    copied++;
    console.log(`${apply ? 'Copying' : 'Would copy'} ${doc.id}: "${note.body}"`);
    if (apply) await ref.create(note);
  }
  console.log(`${copied} of ${facts.size} facts ${apply ? 'copied' : 'to copy (re-run with --apply)'}.`);
})().catch(err => { console.error(err); process.exit(1); });
