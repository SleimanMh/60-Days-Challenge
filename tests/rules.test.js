/* Security-rules tests, run against Google's real Firestore emulator.

   These rules are the only thing stopping an athlete from marking their own
   days done, sending proof for a day that isn't today, or reading a
   teammate's photos, so re-run this after any edit to firestore.rules:

       npm install
       npm run test:rules

   Needs Java (the emulator is a Java program). Uses a demo project: nothing
   touches your real database.                                               */
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs, writeBatch } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
async function t(name, p, expectOk) {
  try { await (expectOk ? assertSucceeds(p) : assertFails(p)); pass++; console.log('  PASS', name); }
  catch (e) { fail++; console.log('  FAIL', name, '->', (e && e.message || e).toString().slice(0, 160)); }
}
const OK = true, DENY = false;

/* Dates relative to now, and "today" computed exactly as the rules do (the
   challenge's time zone is UTC+2..+3), so the tests hold at any hour.      */
const utcDay = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
const dayAt = (start, h) => {
  const [y, m, d] = start.split('-').map(Number);
  const secs = Math.floor((Date.now() + h * 3600e3 - Date.UTC(y, m - 1, d)) / 1000);
  return secs < 0 ? 0 : Math.floor(secs / 86400) + 1;
};
const today = start => dayAt(start, 2);          // always inside the accepted window
const img = 'data:image/jpeg;base64,' + 'A'.repeat(200000);
const proof = (uid, day, extra) => Object.assign({ uid, day, status: 'pending', note: 'did it', submittedAt: 1 }, extra || {});

(async () => {
  /* host and port come from FIRESTORE_EMULATOR_HOST, which `npm run test:rules` sets */
  const env = await initializeTestEnvironment({ projectId: 'demo-eagle',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
  const as = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true }).firestore();
  const coach = as('coach', 'rtrader2002@gmail.com'), sam = as('sam', 'sam@x.com'), lea = as('lea', 'lea@x.com'),
        nina = as('nina', 'nina@x.com'), pend = as('pend', 'pend@x.com'), stranger = as('stranger', 'who@x.com');

  const START = { sam: utcDay(5), lea: utcDay(2), dee: utcDay(8), coach: utcDay(3) };
  const T = { sam: today(START.sam), lea: today(START.lea), dee: today(START.dee), coach: today(START.coach) };
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore(), m = (n, s) => ({ name: n, email: n + '@x.com', status: s, requestedAt: 1 });
    await setDoc(doc(db, 'members/coach'), { name:'Raji', email:'rtrader2002@gmail.com', status:'approved', requestedAt:1 });
    for (const id of ['sam', 'lea', 'nina', 'dee', 'fut', 'nos', 'odd', 'bee']) await setDoc(doc(db, 'members/' + id), m(id, 'approved'));
    await setDoc(doc(db, 'members/pend'), m('pend', 'pending'));
    await setDoc(doc(db, 'members/gone'), m('gone', 'out'));
    await setDoc(doc(db, 'progress/sam'), { done: { '1': true }, start: START.sam, updated: 1 });
    await setDoc(doc(db, 'progress/lea'), { done: {}, start: '', updated: 1 });
    await setDoc(doc(db, 'progress/dee'), { done: {}, start: START.dee, updated: 1 });
    await setDoc(doc(db, 'progress/bee'), { done: {}, start: utcDay(3), updated: 1 });
    await setDoc(doc(db, 'progress/fut'), { done: {}, start: utcDay(-100), updated: 1 });
    await setDoc(doc(db, 'progress/nos'), { done: {}, start: '', updated: 1 });
    await setDoc(doc(db, 'progress/odd'), { done: {}, start: 'soon', updated: 1 });
    await setDoc(doc(db, 'progress/gone'), { done: {}, start: utcDay(5), updated: 1 });
    await setDoc(doc(db, 'progress/coach'), { done: {}, start: START.coach, updated: 1 });
  });

  console.log('\n[progress] athletes cannot mark days done');
  await t('Sam ticks his own today', updateDoc(doc(sam, 'progress/sam'), { ['done.' + T.sam]: true }), DENY);
  await t('Sam rewrites his whole record with an extra day', setDoc(doc(sam, 'progress/sam'), { done: { '1': true, '2': true }, start: START.sam, updated: 2 }), DENY);
  await t('Sam unticks his own day 1', setDoc(doc(sam, 'progress/sam'), { done: {}, start: START.sam, updated: 2 }), DENY);
  await t('Sam moves his start date (already set)', updateDoc(doc(sam, 'progress/sam'), { start: '2026-01-01' }), DENY);
  await t('Sam re-saves his record unchanged', setDoc(doc(sam, 'progress/sam'), { done: { '1': true }, start: START.sam, updated: 3 }), OK);
  await t('Lea sets her start date while it is empty', updateDoc(doc(lea, 'progress/lea'), { start: START.lea, updated: 2 }), OK);
  await t('Lea then changes it', updateDoc(doc(lea, 'progress/lea'), { start: '2026-01-01', updated: 3 }), DENY);
  await t('Nina creates her empty record on first visit', setDoc(doc(nina, 'progress/nina'), { done: {}, start: '', updated: 1 }), OK);
  await t('a newcomer creates a record with days already done', setDoc(doc(nina, 'progress/nina'), { done: { '5': true }, start: '', updated: 1 }), DENY);
  await t('Sam writes Lea\'s record', updateDoc(doc(sam, 'progress/lea'), { start: '2026-01-01' }), DENY);
  await t('a pending applicant reads the squad', getDoc(doc(pend, 'progress/sam')), DENY);
  await t('someone taken off (status "out") reads the squad', getDoc(doc(as('gone', 'gone@x.com'), 'progress/sam')), DENY);
  await t('coach ticks Sam\'s past day 2', updateDoc(doc(coach, 'progress/sam'), { 'done.2': true }), OK);
  await t('coach unticks Sam\'s day 1', updateDoc(doc(coach, 'progress/sam'), { done: { '2': true } }), OK);
  await t('coach moves Sam\'s start date', updateDoc(doc(coach, 'progress/sam'), { start: START.sam }), OK);
  await t('coach ticks Dee\'s future day 40', updateDoc(doc(coach, 'progress/dee'), { 'done.40': true }), OK);

  console.log('\n[today only] proof can be sent on the day itself - not before, not after');
  await t(`Sam (on day ${T.sam}) sends proof for today`, setDoc(doc(sam, 'proofs/sam_' + T.sam), proof('sam', T.sam)), OK);
  await t('...with its photo', setDoc(doc(sam, 'proofImages/sam_' + T.sam), { uid:'sam', day:T.sam, image: img }), OK);
  await t('Sam sends proof for yesterday', setDoc(doc(sam, 'proofs/sam_' + (T.sam - 1)), proof('sam', T.sam - 1)), DENY);
  await t('Sam sends a photo for yesterday', setDoc(doc(sam, 'proofImages/sam_' + (T.sam - 1)), { uid:'sam', day:T.sam - 1, image: img }), DENY);
  await t('Sam sends proof for day 1, long gone', setDoc(doc(sam, 'proofs/sam_1'), proof('sam', 1)), DENY);
  /* the rules accept today at UTC+2 or UTC+3 (they can't follow daylight saving), so within the last
     hour of a winter day "tomorrow" by UTC+3 is still allowed; past that window it never is   */
  const TOMORROW = dayAt(START.sam, 3) + 1;
  await t('Sam sends proof for tomorrow', setDoc(doc(sam, 'proofs/sam_' + TOMORROW), proof('sam', TOMORROW)), DENY);
  await t('Sam sends a photo two days early', setDoc(doc(sam, 'proofImages/sam_' + (T.sam + 2)), { uid:'sam', day:T.sam + 2, image: img }), DENY);
  await t('starting in 100 days: proof for day 1', setDoc(doc(as('fut', 'fut@x.com'), 'proofs/fut_1'), proof('fut', 1)), DENY);
  await t('no start date yet: proof for day 1', setDoc(doc(as('nos', 'nos@x.com'), 'proofs/nos_1'), proof('nos', 1)), DENY);
  await t('a garbled start date: proof for day 1', setDoc(doc(as('odd', 'odd@x.com'), 'proofs/odd_1'), proof('odd', 1)), DENY);

  console.log('\n[proofs] honesty and privacy');
  await t('Sam sends today\'s proof already marked approved', setDoc(doc(sam, 'proofs/sam_' + T.sam), proof('sam', T.sam, { status: 'approved' })), DENY);
  await t('Sam approves his own pending proof', updateDoc(doc(sam, 'proofs/sam_' + T.sam), { status: 'approved' }), DENY);
  await t('Sam sends proof in Lea\'s name', setDoc(doc(sam, 'proofs/lea_' + T.sam), proof('lea', T.sam)), DENY);
  await t('Sam files today under another day\'s id', setDoc(doc(sam, 'proofs/sam_9'), proof('sam', T.sam)), DENY);
  await t('Sam sends proof for day 61', setDoc(doc(sam, 'proofs/sam_61'), proof('sam', 61)), DENY);
  await t('Sam sends a 300-character note', setDoc(doc(sam, 'proofs/sam_' + T.sam), proof('sam', T.sam, { note: 'x'.repeat(300) })), DENY);
  await t('Sam sends a photo over 1 MB', setDoc(doc(sam, 'proofImages/sam_' + T.sam), { uid:'sam', day:T.sam, image: 'data:' + 'A'.repeat(1000001) }), DENY);
  await t('a pending applicant sends proof', setDoc(doc(pend, 'proofs/pend_1'), proof('pend', 1)), DENY);
  await t('someone taken off sends proof', setDoc(doc(as('gone', 'gone@x.com'), 'proofs/gone_' + today(utcDay(5))), proof('gone', today(utcDay(5)))), DENY);
  await t('Sam reads his own proof', getDoc(doc(sam, 'proofs/sam_' + T.sam)), OK);
  await t('Lea reads Sam\'s proof', getDoc(doc(lea, 'proofs/sam_' + T.sam)), DENY);
  await t('Lea looks at Sam\'s photo', getDoc(doc(lea, 'proofImages/sam_' + T.sam)), DENY);
  await t('a stranger looks at Sam\'s photo', getDoc(doc(stranger, 'proofImages/sam_' + T.sam)), DENY);
  await t('Lea lists her own proofs', getDocs(query(collection(lea, 'proofs'), where('uid', '==', 'lea'))), OK);
  await t('Lea lists everyone\'s proofs', getDocs(collection(lea, 'proofs')), DENY);
  await t('coach lists every proof', getDocs(collection(coach, 'proofs')), OK);
  await t('coach views Sam\'s photo', getDoc(doc(coach, 'proofImages/sam_' + T.sam)), OK);
  await t('coach approves Sam\'s today', updateDoc(doc(coach, 'proofs/sam_' + T.sam), { status: 'approved', reviewedAt: 2 }), OK);
  await t('Sam overwrites his approved proof', setDoc(doc(sam, 'proofs/sam_' + T.sam), proof('sam', T.sam)), DENY);
  await t('Sam swaps the photo on his approved day', setDoc(doc(sam, 'proofImages/sam_' + T.sam), { uid:'sam', day:T.sam, image: img }), DENY);
  await t(`Lea (on day ${T.lea}) sends today`, setDoc(doc(lea, 'proofs/lea_' + T.lea), proof('lea', T.lea)), OK);
  await t('coach rejects it with a reason', updateDoc(doc(coach, 'proofs/lea_' + T.lea), { status: 'rejected', reason: 'blurry', reviewedAt: 3 }), OK);
  await t('Lea resends the same day', setDoc(doc(lea, 'proofs/lea_' + T.lea), proof('lea', T.lea)), OK);
  await t('Lea resends smuggling a reason field', setDoc(doc(lea, 'proofs/lea_' + T.lea), proof('lea', T.lea, { reason: '' })), DENY);
  await t('coach deletes a proof and a photo', Promise.all([deleteDoc(doc(coach, 'proofs/lea_' + T.lea)), deleteDoc(doc(coach, 'proofImages/sam_' + T.sam))]), OK);
  await t('Sam deletes his own proof', deleteDoc(doc(sam, 'proofs/sam_' + T.sam)), DENY);

  console.log('\n[admins as players] own days: today only');
  await t(`coach (on day ${T.coach}) ticks his own today`, updateDoc(doc(coach, 'progress/coach'), { ['done.' + T.coach]: true }), OK);
  await t('coach ticks his own yesterday', updateDoc(doc(coach, 'progress/coach'), { ['done.' + (T.coach - 1)]: true }), DENY);
  await t('coach ticks his own day after tomorrow', updateDoc(doc(coach, 'progress/coach'), { ['done.' + (T.coach + 2)]: true }), DENY);
  await t('coach unticks his own day', updateDoc(doc(coach, 'progress/coach'), { done: {} }), OK);
  await t('coach moves his own start to the future and ticks day 1', setDoc(doc(coach, 'progress/coach'), { done: { '1': true }, start: utcDay(-30), updated: 2 }), DENY);
  await t('coach sets his own start date in the future (no days)', setDoc(doc(coach, 'progress/coach'), { done: {}, start: utcDay(-30), updated: 3 }), OK);
  await t('...and re-saves his record while nothing has begun', setDoc(doc(coach, 'progress/coach'), { done: {}, start: utcDay(-30), updated: 4 }), OK);
  await t('coach clears his own start date', updateDoc(doc(coach, 'progress/coach'), { start: '', updated: 5 }), OK);
  await t('coach starts again and ticks that day', setDoc(doc(coach, 'progress/coach'), { done: { [today(utcDay(1))]: true }, start: utcDay(1), updated: 6 }), OK);
  await t('another admin ticks the coach\'s missed day', updateDoc(doc(as('sleiman', 'sleimenmhanna@gmail.com'), 'progress/coach'), { 'done.1': true }), OK);

  console.log('\n[batches] exactly what the page sends, saved as one');
  const batch = (db, ops) => { const b = writeBatch(db); ops.forEach(([op, p, data]) => op === 'delete' ? b.delete(doc(db, p)) : b[op](doc(db, p), data)); return b.commit(); };
  const bee = as('bee', 'bee@x.com'), TB = today(utcDay(3));
  await t('Bee sends today\'s photo + proof together', batch(bee, [['set', 'proofImages/bee_' + TB, { uid:'bee', day:TB, image: img }], ['set', 'proofs/bee_' + TB, proof('bee', TB)]]), OK);
  await t('Bee slips a self-approval into the batch: nothing saved', batch(bee, [['set', 'proofImages/bee_' + TB, { uid:'bee', day:TB, image: 'data:x' }], ['set', 'proofs/bee_' + TB, proof('bee', TB, { status: 'approved' })]]), DENY);
  await t('...not even the photo half of it', getDoc(doc(coach, 'proofImages/bee_' + TB)).then(s => { if (s.data().image === 'data:x') throw new Error('photo was replaced'); }), OK);
  await t('coach approves: day + proof together', batch(coach, [['update', 'progress/bee', { ['done.' + TB]: true, updated: 9 }], ['update', 'proofs/bee_' + TB, { status: 'approved', reviewedAt: 9 }]]), OK);
  await t('Bee tries the coach\'s approval batch herself', batch(bee, [['update', 'progress/bee', { 'done.1': true }], ['update', 'proofs/bee_1', { status: 'approved' }]]), DENY);
  await t('coach takes someone off: record, proofs and photos deleted, status "out"', batch(coach, [['delete', 'progress/dee', undefined], ['update', 'members/dee', { status: 'out' }]]), OK);

  console.log('\n[admins] the second admin, and joining, names, levels');
  const sleiman = as('sleiman', 'sleimenmhanna@gmail.com');
  await t('second admin moves his own start date', setDoc(doc(sleiman, 'progress/sleiman'), { done: {}, start: utcDay(-10), updated: 1 }), OK);
  await t('second admin views every proof', getDocs(collection(sleiman, 'proofs')), OK);
  await t('second admin approves Bee\'s proof', updateDoc(doc(sleiman, 'proofs/bee_' + TB), { status: 'approved', reviewedAt: 1 }), OK);
  await t('second admin sets Lea\'s start date', updateDoc(doc(sleiman, 'progress/lea'), { start: '2026-11-01' }), OK);
  await t('second admin still can\'t tick his own future day', updateDoc(doc(sleiman, 'progress/sleiman'), { 'done.1': true }), DENY);
  const newbie = as('newbie', 'newbie@x.com');
  await t('a newcomer files their own pending request', setDoc(doc(newbie, 'members/newbie'), { name:'N', email:'newbie@x.com', status:'pending', requestedAt:1 }), OK);
  await t('a newcomer files themselves as approved', setDoc(doc(as('n2','n2@x.com'), 'members/n2'), { name:'N', email:'n2@x.com', status:'approved', requestedAt:1 }), DENY);
  await t('a newcomer approves themselves afterwards', updateDoc(doc(newbie, 'members/newbie'), { status:'approved' }), DENY);
  await t('someone taken off lets themselves back in', updateDoc(doc(as('gone', 'gone@x.com'), 'members/gone'), { status:'approved' }), DENY);
  await t('coach approves the newcomer', updateDoc(doc(coach, 'members/newbie'), { status:'approved' }), OK);
  await t('Sam reads the members list', getDocs(collection(sam, 'members')), DENY);
  await t('Sam sets his own display name', setDoc(doc(sam, 'names/sam'), { name:'Sam' }), OK);
  await t('Sam renames Lea', setDoc(doc(sam, 'names/lea'), { name:'loser' }), DENY);
  await t('Sam promotes himself to Advanced', setDoc(doc(sam, 'progress/_levels'), { levels:{ sam:'adv' }, updated:1 }), DENY);
  await t('coach assigns levels', setDoc(doc(coach, 'progress/_levels'), { levels:{ sam:'adv' }, updated:1 }), OK);
  await t('coach with a capitalised email is still the coach', updateDoc(doc(as('coach2','Rtrader2002@Gmail.com'), 'progress/sam'), { start: START.sam }), OK);

  console.log(`\n${pass} passed, ${fail} failed`);
  await env.cleanup(); process.exit(fail ? 1 : 0);
})();
