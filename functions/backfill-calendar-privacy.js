/**
 * One-time backfill for calendarEvents so the app's two filtered queries (isPrivate == false,
 * createdByUid == me) and the matching security rule can see every item.
 * Usage: node backfill-calendar-privacy.js [path-to-service-account.json] [--apply]
 *   Without --apply it only prints what would change. Without a key file it uses
 *   `gcloud auth application-default login` credentials.
 * - items with no isPrivate get isPrivate: false
 * - private items with no createdByUid get the uid of the account linked to their memberId
 *   (memberLinks); if no account is linked they are listed and left alone.
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
  const [events, links] = await Promise.all([
    db.collection('calendarEvents').get(),
    db.collection('memberLinks').get()
  ]);
  const uidByMember = new Map(links.docs.map(d => [d.data().memberId, d.id]));
  let batch = db.batch(), pending = 0, changed = 0;
  for (const doc of events.docs) {
    const e = doc.data();
    const update = {};
    if (typeof e.isPrivate !== 'boolean') update.isPrivate = e.isPrivate === true;
    if ((update.isPrivate ?? e.isPrivate) === true && !e.createdByUid) {
      const uid = uidByMember.get(e.memberId);
      if (uid) update.createdByUid = uid;
      else console.warn(`Private item "${e.title}" (${doc.id}) has no creator and no linked account; left alone`);
    }
    if (!Object.keys(update).length) continue;
    changed++;
    console.log(`${apply ? 'Updating' : 'Would update'} ${doc.id} "${e.title}":`, update);
    if (apply) {
      batch.update(doc.ref, update);
      if (++pending === 400) { await batch.commit(); batch = db.batch(); pending = 0; }
    }
  }
  if (apply && pending) await batch.commit();
  console.log(`${changed} of ${events.size} items ${apply ? 'updated' : 'need updating (re-run with --apply)'}.`);
})().catch(err => { console.error(err); process.exit(1); });
