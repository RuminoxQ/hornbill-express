// Hornbill Express · © 2026 Kiu Kwan Tai. All rights reserved.
// Firebase / Cloud Firestore sync. Shared leaderboard + passports across every booth device and the TV.
// Every document carries `expireAt` (now + 7 days). Expired documents are deleted by the game itself
// (sweepExpired, works on the free Spark plan). On the paid Blaze plan a Firestore TTL policy can do it too.
// If Firebase isn't configured or can't load, the game keeps working on local storage only.
import { firebaseConfig } from './firebase-config.js';

export const RETENTION_DAYS = 7;
const SDK = 'https://www.gstatic.com/firebasejs/13.4.0/';
const DAY_MS = 86400000;

const state = { status: firebaseConfig ? 'connecting' : 'off', scores: null, error: '' };
const subs = new Set();
let fs = null, db = null, unsub = null, sinceMs = 0;

export function cloudStatus() { return state; }
export function cloudScores() { return state.scores; }       // null until the first snapshot
export function onCloud(f) { subs.add(f); }
function notify() { subs.forEach((f) => { try { f(state); } catch (e) { /* ignore */ } }); }

export function expiry(fromMs = Date.now()) { return fromMs + RETENTION_DAYS * DAY_MS; }

let ready = null;
export function initCloud() {
  if (ready) return ready;
  if (!firebaseConfig) { ready = Promise.resolve(false); return ready; }
  // allow tests / other backends to inject a Firestore-like module
  const load = (window.__hornbillFirestore ? Promise.resolve(window.__hornbillFirestore) :
    Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-firestore.js')]).then(([app, f]) => Object.assign({ initializeApp: app.initializeApp }, f)));
  ready = load.then((m) => {
    fs = m;
    const app = m.initializeApp(firebaseConfig);
    try {
      // offline cache shared by all tabs on this device (game + TV display): writes queue while Wi-Fi is down
      db = m.initializeFirestore(app, { localCache: m.persistentLocalCache({ tabManager: m.persistentMultipleTabManager() }) });
    } catch (e) {
      db = m.getFirestore(app);
    }
    state.status = navigator.onLine === false ? 'offline' : 'connecting';
    window.addEventListener('offline', () => { state.status = 'offline'; notify(); });
    notify();
    setTimeout(sweepExpired, 15000);
    setInterval(sweepExpired, 30 * 60000);
    return true;
  }).catch((e) => {
    state.status = 'error'; state.error = String(e && e.message || e);
    notify();
    return false;
  });
  return ready;
}

// Live list of scores newer than `since` (ms). Re-subscribes when the window changes.
export async function watchScores(since) {
  if (!(await initCloud())) return;
  since = Math.max(since, Date.now() - RETENTION_DAYS * DAY_MS);
  if (unsub && Math.abs(since - sinceMs) < 1000) return;
  if (unsub) unsub();
  sinceMs = since;
  // `at` is the client clock in ms: unlike the server timestamp it is known immediately, so offline/pending runs show up too
  const q = fs.query(fs.collection(db, 'scores'), fs.where('at', '>=', since), fs.orderBy('at', 'desc'), fs.limit(1000));
  unsub = fs.onSnapshot(q, { includeMetadataChanges: true }, (snap) => {
    const now = Date.now();
    state.scores = snap.docs.map((d) => {
      const x = d.data({ serverTimestamps: 'estimate' });
      const ts = typeof x.at === 'number' ? x.at : (x.ts && x.ts.toMillis ? x.ts.toMillis() : now);
      const expireAt = x.expireAt && x.expireAt.toMillis ? x.expireAt.toMillis() : 0;
      return { id: d.id, name: x.name || '', dist: x.dist || 0, kuih: x.kuih || 0, tips: x.tips || 0, landmarks: x.landmarks || [], cause: x.cause || '', day: x.day || '', booth: x.booth || '', ts, expireAt };
    }).filter((s) => !s.expireAt || s.expireAt > now);
    // fromCache = not confirmed by the server yet (no Wi-Fi, or still connecting): runs are queued and sync later
    state.status = snap.metadata && snap.metadata.fromCache ? 'offline' : 'online';
    notify();
  }, (err) => { state.status = 'error'; state.error = err.message; notify(); });
}

// Create-only score document (security rules forbid edits and deletes from the game).
export async function pushScore(entry, booth) {
  if (!(await initCloud())) return false;
  try {
    await fs.addDoc(fs.collection(db, 'scores'), {
      name: entry.name || '', dist: entry.dist | 0, kuih: entry.kuih | 0, tips: entry.tips | 0,
      landmarks: (entry.landmarks || []).slice(0, 9), cause: entry.cause || '', day: entry.day || '', booth: booth || '',
      at: entry.ts || Date.now(), ts: fs.serverTimestamp(), expireAt: fs.Timestamp.fromMillis(expiry()),
    });
    return true;
  } catch (e) { state.error = e.message; notify(); return false; }
}

const ppId = (name) => name.replace(/\//g, '').slice(0, 12) || '_';

export async function fetchPassport(name) {
  if (!name || !(await initCloud())) return null;
  try {
    const snap = await fs.getDoc(fs.doc(db, 'passports', ppId(name)));
    if (!snap.exists()) return [];
    const x = snap.data();
    if (x.expireAt && x.expireAt.toMillis && x.expireAt.toMillis() < Date.now()) return [];
    return x.landmarks || [];
  } catch (e) { return null; }
}

// Adds landmarks to a passport and pushes its expiry 7 days out from now.
export async function pushPassport(name, landmarks) {
  if (!name || !landmarks.length || !(await initCloud())) return false;
  try {
    await fs.setDoc(fs.doc(db, 'passports', ppId(name)), {
      name, landmarks: fs.arrayUnion(...landmarks.slice(0, 9)), updatedAt: fs.serverTimestamp(), expireAt: fs.Timestamp.fromMillis(expiry()),
    }, { merge: true });
    return true;
  } catch (e) { state.error = e.message; notify(); return false; }
}

// Delete documents whose expireAt has passed. Any booth device or TV does this; the security rules only
// allow deleting a document once it has expired. Throttled so a room full of devices doesn't all sweep at once.
const SWEEP_KEY = 'hornbill-express:lastSweep';
export async function sweepExpired(force = false) {
  if (!db || !fs) return 0;
  try {
    const last = +localStorage.getItem(SWEEP_KEY) || 0;
    if (!force && Date.now() - last < 25 * 60000) return 0;
    localStorage.setItem(SWEEP_KEY, String(Date.now()));
  } catch (e) { /* storage blocked: sweep anyway */ }
  let removed = 0;
  for (const col of ['scores', 'passports']) {
    try {
      const q = fs.query(fs.collection(db, col), fs.where('expireAt', '<', fs.Timestamp.now()), fs.limit(200));
      const snap = await fs.getDocs(q);
      // don't wait for the server: offline deletes are queued and sent when the connection returns
      snap.docs.forEach((d) => { fs.deleteDoc(d.ref).catch(() => {}); removed++; });
    } catch (e) { /* offline or index still building: try next time */ }
  }
  return removed;
}
