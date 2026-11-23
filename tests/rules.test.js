/* Security-rules tests, run against Google's real Firestore emulator.

   These rules are the only thing stopping an athlete from marking their own
   days done or reading a teammate's photos, so re-run this after any edit to
   firestore.rules:

       npm install
       npm run test:rules

   Needs Java (the emulator is a Java program). Uses a demo project: nothing
   touches your real database.                                               */
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, query, where, getDocs } = require('firebase/firestore');
const fs = require('fs');
const path = require('path');
let pass = 0, fail = 0;
async function t(name, p, expectOk) {
  try { await (expectOk ? assertSucceeds(p) : assertFails(p)); pass++; console.log('  PASS', name); }
  catch (e) { fail++; console.log('  FAIL', name, '->', (e && e.message || e).toString().slice(0, 160)); }
}
const OK = true, DENY = false;
/* start dates relative to the real date, so these tests mean the same thing whenever they run */
const utcDay = n => { const d = new Date(); d.setUTCDate(d.getUTCDate() - n); return d.toISOString().slice(0, 10); };
(async () => {
  /* host and port come from FIRESTORE_EMULATOR_HOST, which `npm run test:rules` sets */
  const env = await initializeTestEnvironment({ projectId: 'demo-eagle',
    firestore: { rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8') } });
  const as = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true }).firestore();
  const coach = as('coach', 'rtrader2002@gmail.com'), sam = as('sam', 'sam@x.com'), lea = as('lea', 'lea@x.com'),
        nina = as('nina', 'nina@x.com'), pend = as('pend', 'pend@x.com'), stranger = as('stranger', 'who@x.com');
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore(), m = (n, s) => ({ name: n, email: n + '@x.com', status: s, requestedAt: 1 });
    await setDoc(doc(db, 'members/coach'), { name:'Raji', email:'rtrader2002@gmail.com', status:'approved', requestedAt:1 });
    await setDoc(doc(db, 'members/sam'), m('sam', 'approved'));
    await setDoc(doc(db, 'members/lea'), m('lea', 'approved'));
    await setDoc(doc(db, 'members/nina'), m('nina', 'approved'));
    await setDoc(doc(db, 'members/pend'), m('pend', 'pending'));
    await setDoc(doc(db, 'progress/sam'), { done: { '1': true }, start: '2026-11-20', updated: 1 });
    await setDoc(doc(db, 'progress/lea'), { done: {}, start: '', updated: 1 });
    for (const [id, start] of [['dee', utcDay(5)], ['fut', utcDay(-100)], ['nos', ''], ['odd', 'soon']]) {
      await setDoc(doc(db, 'members/' + id), m(id, 'approved'));
      await setDoc(doc(db, 'progress/' + id), { done: {}, start, updated: 1 });
    }
    await setDoc(doc(db, 'progress/coach'), { done: {}, start: utcDay(2), updated: 1 });
  });
  const img = 'data:image/jpeg;base64,' + 'A'.repeat(200000);
  const proof = (uid, day, extra) => Object.assign({ uid, day, status: 'pending', note: 'did it', submittedAt: 1 }, extra || {});

  console.log('\n[progress] athletes cannot mark days done');
  await t('Sam ticks his own day 2', updateDoc(doc(sam, 'progress/sam'), { 'done.2': true }), DENY);
  await t('Sam rewrites his whole record with an extra day', setDoc(doc(sam, 'progress/sam'), { done: { '1': true, '2': true }, start: '2026-11-20', updated: 2 }), DENY);
  await t('Sam unticks his own day 1', setDoc(doc(sam, 'progress/sam'), { done: {}, start: '2026-11-20', updated: 2 }), DENY);
  await t('Sam moves his start date (already set)', updateDoc(doc(sam, 'progress/sam'), { start: '2026-11-01' }), DENY);
  await t('Sam re-saves his record unchanged', setDoc(doc(sam, 'progress/sam'), { done: { '1': true }, start: '2026-11-20', updated: 3 }), OK);
  await t('Lea sets her start date while it is empty', updateDoc(doc(lea, 'progress/lea'), { start: '2026-11-22', updated: 2 }), OK);
  await t('Lea then changes it', updateDoc(doc(lea, 'progress/lea'), { start: '2026-11-01', updated: 3 }), DENY);
  await t('Nina creates her empty record on first visit', setDoc(doc(nina, 'progress/nina'), { done: {}, start: '', updated: 1 }), OK);
  await t('a newcomer creates a record with days already done', setDoc(doc(nina, 'progress/nina'), { done: { '5': true }, start: '', updated: 1 }), DENY);
  await t('Sam writes Lea\'s record', updateDoc(doc(sam, 'progress/lea'), { start: '2026-01-01' }), DENY);
  await t('a pending applicant reads the squad', getDoc(doc(pend, 'progress/sam')), DENY);
  await t('coach ticks Sam\'s day 5 (any day)', updateDoc(doc(coach, 'progress/sam'), { 'done.5': true }), OK);
  await t('coach unticks Sam\'s day 1', updateDoc(doc(coach, 'progress/sam'), { done: { '5': true } }), OK);
  await t('coach moves Sam\'s start date', updateDoc(doc(coach, 'progress/sam'), { start: '2026-11-18' }), OK);
  await t('coach ticks Lea\'s future day 40', updateDoc(doc(coach, 'progress/lea'), { 'done.40': true }), OK);

  console.log('\n[proofs] sending, privacy, approval');
  await t('Sam sends proof for day 2', setDoc(doc(sam, 'proofs/sam_2'), proof('sam', 2)), OK);
  await t('Sam sends his photo for day 2', setDoc(doc(sam, 'proofImages/sam_2'), { uid:'sam', day:2, image: img }), OK);
  await t('Sam sends proof already marked approved', setDoc(doc(sam, 'proofs/sam_3'), proof('sam', 3, { status: 'approved' })), DENY);
  await t('Sam approves his own pending proof', updateDoc(doc(sam, 'proofs/sam_2'), { status: 'approved' }), DENY);
  await t('Sam sends proof in Lea\'s name', setDoc(doc(sam, 'proofs/lea_2'), proof('lea', 2)), DENY);
  await t('Sam files day 2 under another day\'s id', setDoc(doc(sam, 'proofs/sam_9'), proof('sam', 2)), DENY);
  await t('Sam sends proof for day 61', setDoc(doc(sam, 'proofs/sam_61'), proof('sam', 61)), DENY);
  await t('Sam sends a 300-character note', setDoc(doc(sam, 'proofs/sam_4'), proof('sam', 4, { note: 'x'.repeat(300) })), DENY);
  await t('Sam sends a photo over 1 MB', setDoc(doc(sam, 'proofImages/sam_4'), { uid:'sam', day:4, image: 'data:' + 'A'.repeat(1000001) }), DENY);
  await t('a pending applicant sends proof', setDoc(doc(pend, 'proofs/pend_1'), proof('pend', 1)), DENY);
  await t('Sam reads his own proof', getDoc(doc(sam, 'proofs/sam_2')), OK);
  await t('Lea reads Sam\'s proof', getDoc(doc(lea, 'proofs/sam_2')), DENY);
  await t('Lea looks at Sam\'s photo', getDoc(doc(lea, 'proofImages/sam_2')), DENY);
  await t('a stranger looks at Sam\'s photo', getDoc(doc(stranger, 'proofImages/sam_2')), DENY);
  await t('Lea lists her own proofs', getDocs(query(collection(lea, 'proofs'), where('uid', '==', 'lea'))), OK);
  await t('Lea lists everyone\'s proofs', getDocs(collection(lea, 'proofs')), DENY);
  await t('coach lists every proof', getDocs(collection(coach, 'proofs')), OK);
  await t('coach views Sam\'s photo', getDoc(doc(coach, 'proofImages/sam_2')), OK);
  await t('coach approves Sam\'s day 2', updateDoc(doc(coach, 'proofs/sam_2'), { status: 'approved', reviewedAt: 2 }), OK);
  await t('Sam overwrites his approved proof', setDoc(doc(sam, 'proofs/sam_2'), proof('sam', 2)), DENY);
  await t('Sam swaps the photo on his approved day', setDoc(doc(sam, 'proofImages/sam_2'), { uid:'sam', day:2, image: img }), DENY);
  await t('Sam sends day 3', setDoc(doc(sam, 'proofs/sam_3'), proof('sam', 3)), OK);
  await t('coach rejects day 3 with a reason', updateDoc(doc(coach, 'proofs/sam_3'), { status: 'rejected', reason: 'blurry', reviewedAt: 3 }), OK);
  await t('Sam resends day 3 after the rejection', setDoc(doc(sam, 'proofs/sam_3'), proof('sam', 3)), OK);
  await t('Sam resends day 3 smuggling a reason field', setDoc(doc(sam, 'proofs/sam_3'), proof('sam', 3, { reason: '' })), DENY);
  await t('coach deletes Sam\'s proof and photo', Promise.all([deleteDoc(doc(coach, 'proofs/sam_3')), deleteDoc(doc(coach, 'proofImages/sam_2'))]), OK);
  await t('Sam deletes his own proof', deleteDoc(doc(sam, 'proofs/sam_2')), DENY);


  console.log('\n[dates] by Google\'s clock, not the phone\'s');
  const dee = as('dee', 'dee@x.com'), fut = as('fut', 'fut@x.com'), nos = as('nos', 'nos@x.com'), odd = as('odd', 'odd@x.com');
  await t('Dee (on day 6) sends proof for today', setDoc(doc(dee, 'proofs/dee_6'), proof('dee', 6)), OK);
  await t('Dee sends proof for a day already gone', setDoc(doc(dee, 'proofs/dee_1'), proof('dee', 1)), OK);
  await t('Dee sends proof for day 8, two days early', setDoc(doc(dee, 'proofs/dee_8'), proof('dee', 8)), DENY);
  await t('Dee uploads a photo for day 8', setDoc(doc(dee, 'proofImages/dee_8'), { uid:'dee', day:8, image: img }), DENY);
  await t('starting in 100 days: proof for day 1', setDoc(doc(fut, 'proofs/fut_1'), proof('fut', 1)), DENY);
  await t('no start date yet: proof for day 1', setDoc(doc(nos, 'proofs/nos_1'), proof('nos', 1)), DENY);
  await t('a garbled start date: proof for day 1', setDoc(doc(odd, 'proofs/odd_1'), proof('odd', 1)), DENY);
  await t('coach (on day 3) ticks his own today', updateDoc(doc(coach, 'progress/coach'), { 'done.3': true }), OK);
  await t('coach ticks his own day 5, ahead', updateDoc(doc(coach, 'progress/coach'), { 'done.5': true }), DENY);
  await t('coach moves his own start to the future and ticks day 1', setDoc(doc(coach, 'progress/coach'), { done: { '1': true, '3': true }, start: utcDay(-30), updated: 2 }), DENY);
  await t('coach unticks his own day', updateDoc(doc(coach, 'progress/coach'), { done: {} }), OK);
  await t('coach sets his own start date in the future (no days)', setDoc(doc(coach, 'progress/coach'), { done: {}, start: utcDay(-30), updated: 3 }), OK);
  await t('...and re-saves his record while nothing has begun', setDoc(doc(coach, 'progress/coach'), { done: {}, start: utcDay(-30), updated: 4 }), OK);
  await t('...and ticks day 1, a month early', updateDoc(doc(coach, 'progress/coach'), { 'done.1': true }), DENY);
  await t('coach clears his own start date', updateDoc(doc(coach, 'progress/coach'), { start: '', updated: 5 }), OK);
  await t('coach moves his start back, so today is day 2, and ticks it', setDoc(doc(coach, 'progress/coach'), { done: { '2': true }, start: utcDay(1), updated: 6 }), OK);
  await t('coach ticks another player\'s day 50, far ahead', updateDoc(doc(coach, 'progress/fut'), { 'done.50': true }), OK);

  console.log('\n[unchanged] joining, names, levels');
  const newbie = as('newbie', 'newbie@x.com');
  await t('a newcomer files their own pending request', setDoc(doc(newbie, 'members/newbie'), { name:'N', email:'newbie@x.com', status:'pending', requestedAt:1 }), OK);
  await t('a newcomer files themselves as approved', setDoc(doc(as('n2','n2@x.com'), 'members/n2'), { name:'N', email:'n2@x.com', status:'approved', requestedAt:1 }), DENY);
  await t('a newcomer approves themselves afterwards', updateDoc(doc(newbie, 'members/newbie'), { status:'approved' }), DENY);
  await t('coach approves the newcomer', updateDoc(doc(coach, 'members/newbie'), { status:'approved' }), OK);
  await t('Sam reads the members list', getDocs(collection(sam, 'members')), DENY);
  await t('Sam sets his own display name', setDoc(doc(sam, 'names/sam'), { name:'Sam' }), OK);
  await t('Sam renames Lea', setDoc(doc(sam, 'names/lea'), { name:'loser' }), DENY);
  await t('Sam promotes himself to Advanced', setDoc(doc(sam, 'progress/_levels'), { levels:{ sam:'adv' }, updated:1 }), DENY);
  await t('coach assigns levels', setDoc(doc(coach, 'progress/_levels'), { levels:{ sam:'adv' }, updated:1 }), OK);
  await t('coach with a capitalised email is still the coach', updateDoc(doc(as('coach2','Rtrader2002@Gmail.com'), 'progress/sam'), { start:'2026-11-10' }), OK);

  console.log(`\n${pass} passed, ${fail} failed`);
  await env.cleanup(); process.exit(fail ? 1 : 0);
})();
