// Persistence: Firebase (shared, when configured) + this device's localStorage (always, for offline + CSV).
// Everything older than 7 days is dropped locally; in Firestore a TTL policy on `expireAt` deletes it.
import { DEFAULT_SETTINGS, LANDMARKS } from './config.js';
import { initCloud, watchScores, cloudScores, onCloud, pushScore, pushPassport, fetchPassport, cloudStatus, RETENTION_DAYS } from './cloud.js';

const KEY = 'hornbill-express:v1';
const DAY_MS = 86400000;
const listeners = new Set();

function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return JSON.parse(raw); } catch (e) { /* ignore */ }
  return {};
}

let db = Object.assign({ settings: {}, scores: [], passports: {}, passportsT: {}, wallet: 0, unlocked: ['hornbill'], courier: 'hornbill', tutorialSeen: false, booth: '' }, load());
db.settings = Object.assign({}, DEFAULT_SETTINGS, db.settings);
if (!db.booth) db.booth = 'booth-' + Math.random().toString(36).slice(2, 8);
prune();

export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch (e) { /* ignore */ }
  listeners.forEach((f) => f(db));
}
export function onChange(f) { listeners.add(f); }

// drop anything older than the retention window from this device
function prune() {
  const cut = Date.now() - RETENTION_DAYS * DAY_MS;
  db.scores = (db.scores || []).filter((s) => (s.ts || 0) >= cut);
  db.passportsT = db.passportsT || {};
  for (const n of Object.keys(db.passports || {})) {
    if (!db.passportsT[n] || db.passportsT[n] < cut) { delete db.passports[n]; delete db.passportsT[n]; }
  }
}

try {
  window.addEventListener('storage', (e) => {
    if (e.key === KEY) { db = Object.assign(db, load()); db.settings = Object.assign({}, DEFAULT_SETTINGS, db.settings); listeners.forEach((f) => f(db)); }
  });
} catch (e) { /* ignore */ }

export const store = {
  get db() { return db; },
  get settings() { return db.settings; },
  setSetting(k, v) { db.settings[k] = v; save(); if (k === 'dailyReset') syncWindow(); },
  reload() { db = Object.assign(db, load()); db.settings = Object.assign({}, DEFAULT_SETTINGS, db.settings); return db; },
};

export function todayKey(ts = Date.now()) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function startOfToday() { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); }

// ---------- cloud wiring ----------
let windowDay = '';
function syncWindow() {
  windowDay = todayKey();
  const since = db.settings.dailyReset ? startOfToday() : Date.now() - RETENTION_DAYS * DAY_MS;
  watchScores(since);
}
initCloud().then((ok) => { if (ok) syncWindow(); });
onCloud(() => listeners.forEach((f) => f(db)));
setInterval(() => { if (windowDay && windowDay !== todayKey()) { prune(); save(); syncWindow(); } }, 60000);

export { cloudStatus };

// scores currently on the board: cloud list when connected, otherwise this device's own
function source() {
  const hide = db.settings.hideBefore || 0;
  const cut = Math.max(hide, Date.now() - RETENTION_DAYS * DAY_MS);
  const cloud = cloudScores();
  let list = cloud ? cloud : db.scores;
  list = list.filter((s) => s.ts >= cut);
  if (db.settings.dailyReset) { const t = todayKey(); list = list.filter((s) => (s.day || todayKey(s.ts)) === t); }
  return list;
}

export function addScore(entry) {
  db.scores.push(Object.assign({ ts: Date.now(), day: todayKey(), booth: db.booth }, entry));
  if (db.scores.length > 5000) db.scores = db.scores.slice(-5000);
  save();
}

// push a finished run to Firebase exactly once (after the name step)
export function syncRun(entry) {
  if (!entry || entry.synced) return;
  entry.synced = true;
  save();
  pushScore(entry, db.booth);
}

export function scoresToday() { return source(); }

export function topRuns(n = 10) {
  const best = new Map();
  for (const s of source()) {
    if (!s.name) continue;
    if (!best.has(s.name) || best.get(s.name).dist < s.dist) best.set(s.name, s);
  }
  return [...best.values()].sort((a, b) => b.dist - a.dist || a.ts - b.ts).slice(0, n);
}

export function rankFor(dist) { return topRuns(1000).filter((s) => s.dist > dist).length + 1; }

export function latestRuns(n = 6) { return source().slice().sort((a, b) => b.ts - a.ts).slice(0, n); }

export function stats() {
  const list = source();
  return {
    runs: list.length,
    kuih: list.reduce((a, s) => a + (s.kuih || 0), 0),
    best: list.reduce((a, s) => Math.max(a, s.dist || 0), 0),
    landmarks: list.reduce((a, s) => a + ((s.landmarks && s.landmarks.length) || 0), 0),
  };
}

// ---------- passports ----------
export function passportFor(name) { return (name && db.passports[name]) || []; }

function mergePassport(name, list) {
  const cur = new Set(db.passports[name] || []);
  list.forEach((l) => cur.add(l));
  db.passports[name] = [...cur];
  db.passportsT[name] = Date.now();
  if (cur.size >= LANDMARKS.length && !db.unlocked.includes('sunbear')) db.unlocked.push('sunbear');
  return db.passports[name];
}

// fetch the shared passport (other booths) and merge into this device
export async function refreshPassport(name) {
  if (!name) return [];
  const remote = await fetchPassport(name);
  if (remote && remote.length) { mergePassport(name, remote); save(); }
  return passportFor(name);
}

export function addLandmarks(name, list) {
  if (!name || !list || !list.length) return passportFor(name);
  const out = mergePassport(name, list);
  save();
  pushPassport(name, list);
  return out;
}

export function exportCSV() {
  const rows = [['date', 'time', 'name', 'distance_m', 'kuih_delivered', 'tips', 'landmarks', 'booth']];
  const list = (cloudScores() || db.scores).slice().sort((a, b) => a.ts - b.ts);
  for (const s of list) {
    const d = new Date(s.ts);
    rows.push([s.day || todayKey(s.ts), d.toTimeString().slice(0, 8), s.name || '', s.dist, s.kuih || 0, s.tips || 0, (s.landmarks || []).join('; '), s.booth || '']);
  }
  return rows.map((r) => r.map((c) => '"' + String(c).replace(/"/g, '""') + '"').join(',')).join('\n');
}

// The game can't delete shared records (security rules), so "clear" hides everything up to now on this device.
export function clearScores() { db.scores = []; db.settings.hideBefore = Date.now(); save(); }
export function resetPassports() { db.passports = {}; db.passportsT = {}; db.unlocked = db.unlocked.filter((u) => u !== 'sunbear'); save(); }
