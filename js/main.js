// Hornbill Express · © 2026 Kiu Kwan Tai. All rights reserved.
// Hornbill Express — app shell: screens, input, loop, audio cues, kiosk behaviour.
import { COLS, BEAT_MS, POWERUPS, LANDMARKS, COURIERS, FLOOD } from './config.js';
import { Game } from './game.js';
import { Renderer } from './render.js';
import { Renderer3D, webglAvailable } from './render3d.js';
import { LIVES, BUILD, VERSION, sig } from './config.js';
import { Audio } from './audio.js';
import { store, save, onChange, addScore, syncRun, topRuns, rankFor, stats, passportFor, refreshPassport, addLandmarks, exportCSV, clearScores, resetPassports, cloudStatus } from './storage.js';
import { RETENTION_DAYS } from './cloud.js';
import { cleanName, isRude, MAX_NAME } from './names.js';

const $ = (id) => document.getElementById(id);
const S = () => store.settings;
const canvas = $('game');
let R, USE3D = false;
try { if (webglAvailable()) { R = new Renderer3D(canvas); USE3D = true; } } catch (e) { USE3D = false; }
if (!R) R = new Renderer(canvas);
document.body.classList.toggle('three', USE3D);
const A = new Audio();
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
if (isTouch) document.body.classList.add('touch');

let mode = 'title';        // title | play | paused | over | name | page | pin | operator
let game = null;           // current run
let demo = null;           // background world on menus
let demoV = 2;
let lastRun = null;        // {result, entry}
let overTimer = null, nameTimer = null, idleTimer = null;
let lastName = '';
let tutorialActive = false;

// ---------------------------------------------------------------- screens
const SCREENS = ['s-title', 's-pause', 's-over', 's-name', 's-board', 's-passport', 's-couriers', 's-pin', 's-operator'];
function show(id) {
  SCREENS.forEach((s) => $(s).classList.toggle('hidden', s !== id));
  $('hud').classList.toggle('hidden', !(mode === 'play' || mode === 'paused'));
  updatePad();
  const first = id && $(id).querySelector('button:not([disabled]), input, a');
  if (first && !isTouch && id !== 's-name') setTimeout(() => first.focus({ preventScroll: true }), 30);
}

function applySettings() {
  const s = S();
  A.set({ music: s.music / 100, sfx: s.sfx / 100, master: s.master / 100 });
  document.body.classList.toggle('reduce', !!s.reduceMotion);
  document.body.classList.toggle('kiosk', !!s.kioskMode);
  updatePad();
  refreshTitle();
}

function updatePad() {
  const s = S();
  const want = (mode === 'play') && (s.showPad === 'on' || (s.showPad === 'auto' && isTouch));
  $('pad').classList.toggle('hidden', !want);
  document.body.classList.toggle('pad-on', want);
}

function toast(text, cls = '') {
  const el = document.createElement('div');
  el.className = 'toast ' + cls; el.textContent = text;
  $('toasts').appendChild(el);
  setTimeout(() => el.remove(), 1900);
  while ($('toasts').children.length > 3) $('toasts').firstChild.remove();
}

// ---------------------------------------------------------------- title / attract
function makeDemo() {
  demo = new Game({ settings: Object.assign({}, S(), { timeLimit: 0, landmarksOn: false }), seed: 7 + Math.floor(Math.random() * 1000), courier: store.db.courier });
  demo.flood.active = false;
  demoV = 6;
}

function refreshTitle() {
  const s = S();
  const kiosk = !!s.kioskMode;
  $('eventChip').classList.toggle('hidden', !(s.showEvent && s.eventName));
  $('eventChip').textContent = s.eventName || '';
  $('prizeLine').classList.toggle('hidden', !(s.showPrize && s.prizeText));
  $('prizeLine').textContent = s.prizeText || '';
  $('startText').textContent = kiosk ? (isTouch ? 'Tap to start' : 'Tap or press any key') : 'Start delivery';
  $('attractBoard').classList.toggle('hidden', !kiosk);
  const top = topRuns(5);
  const st = stats();
  $('bestChip').textContent = 'Best today ' + st.best + ' m';
  if (kiosk) {
    $('attractList').innerHTML = top.length ? top.map((r) => `<li><span class="n">${esc(r.name)}</span><span class="k">${r.kuih || 0} kuih</span><span>${r.dist} m</span></li>`).join('') : '<li><span class="n">Be the first today!</span></li>';
    $('stRuns').textContent = st.runs; $('stKuih').textContent = st.kuih; $('stLand').textContent = st.landmarks;
  }
}

function esc(t) { return String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

function flushRun() { if (lastRun && lastRun.entry) syncRun(lastRun.entry); }

function goTitle() {
  stopTimers();
  flushRun();
  mode = 'title';
  A.stopMusic(); A.rain(0);
  game = null;
  makeDemo();
  refreshTitle();
  drawBird($('titleBird'), store.db.courier, true);
  show('s-title');
}

function drawBird(cv, courierId, carrying) {
  if (USE3D) { try { Renderer3D.portrait(cv, courierId, carrying); return; } catch (e) { /* fall back to 2D */ } }
  const r = new Renderer(cv);
  r.ctx.setTransform(1, 0, 0, 1, 0, 0);
  r.ctx.clearRect(0, 0, cv.width, cv.height);
  r.ctx.save(); r.ctx.translate(cv.width / 2, cv.height * 0.6);
  r.creature(COURIERS.find((c) => c.id === courierId) || COURIERS[0], cv.width * 0.62, carrying, 'up');
  r.ctx.restore();
}

// ---------------------------------------------------------------- run lifecycle
function startRun(forceTutorial) {
  stopTimers();
  flushRun();
  A.unlock();
  if (S().kioskLock) fullscreen(true);
  const s = S();
  tutorialActive = forceTutorial !== undefined ? forceTutorial : (s.kioskMode ? s.tutorialEveryPlayer : !store.db.tutorialSeen);
  const known = passportFor(lastName);
  game = new Game({ settings: s, tutorial: tutorialActive, courier: goldenNext ? 'golden' : store.db.courier, now: performance.now(), knownLandmarks: known });
  goldenNext = false;
  mode = 'play';
  R.camV = 0; R.camC = COLS / 2; R.follow(game, 0, true);
  show(null);
  $('hud').classList.remove('hidden');
  $('hint').classList.toggle('hidden', !tutorialActive);
  updatePad();
  A.startMusic(game.clockStart);
  updateHud(true);
}

function endRun() {
  const res = game.result();
  const entry = { name: '', dist: res.dist, kuih: res.kuih, tips: res.tips, landmarks: res.landmarks, cause: res.cause };
  addScore(entry);
  const db = store.db;
  db.wallet += res.tips;
  if (tutorialActive) db.tutorialSeen = true;
  save();
  lastRun = { res, entry: db.scores[db.scores.length - 1] };
  A.stopMusic(); A.rain(0);
  mode = 'over';
  const titles = { flood: 'Swept away by the banjir!', splash: 'Splash! Into the river', croc: 'Snapped by a croc!', fell: 'Oops! Fell off the roofs', swept: 'Carried off downstream!', time: "Time's up!", moto: 'Hit by a motorbike!', trishaw: 'Bumped by a trishaw!', cart: 'Flattened by a market cart!', cyclist: 'Knocked over by a cyclist!' };
  $('overTitle').textContent = titles[res.cause] || 'Run complete';
  $('oDist').textContent = res.dist + ' m';
  $('oKuih').textContent = res.kuih;
  $('oDrop').textContent = res.dropped;
  $('oTips').textContent = '+' + res.tips + ' tips earned';
  const rank = rankFor(res.dist);
  $('oRank').textContent = '#' + rank + ' today';
  const land = res.landmarks;
  $('oLand').classList.toggle('hidden', !land.length);
  $('oLand').textContent = land.length ? 'Landmark found: ' + land.join(', ') : '';
  const qualifies = res.dist > 0 && rank <= 10;
  $('nameBtn').textContent = qualifies ? 'New high score: enter your name' : 'Save to leaderboard';
  $('nameBtn').classList.toggle('hidden', res.dist <= 0);
  drawBird($('overBird'), store.db.courier, false);
  show('s-over');
  if (S().kioskMode) {
    if (qualifies || land.length) overTimer = setTimeout(() => openName(), 3500);
    else idleCountdown($('overAuto'), S().attractAfter, goTitle);
  }
}

function stopTimers() { clearTimeout(overTimer); clearInterval(nameTimer); clearInterval(idleTimer); $('overAuto').textContent = ''; }

function idleCountdown(el, secs, done) {
  clearInterval(idleTimer);
  let left = secs;
  el.textContent = `Back to start in ${left}s`;
  idleTimer = setInterval(() => { left--; el.textContent = `Back to start in ${left}s`; if (left <= 0) { clearInterval(idleTimer); done(); } }, 1000);
}

// ---------------------------------------------------------------- name entry
let nameBuf = '';
function openName() {
  stopTimers();
  if (!lastRun) return;
  mode = 'name';
  nameBuf = '';
  const rank = rankFor(lastRun.res.dist);
  $('nameChip').textContent = rank <= 10 ? 'NEW HIGH SCORE · #' + rank + ' TODAY' : 'SAVE YOUR RUN';
  $('nameScore').textContent = lastRun.res.dist + ' m';
  $('nameErr').textContent = '';
  renderSlots();
  show('s-name');
  if (!isTouch) $('nameInput').focus();
  let left = 25;
  $('nameAuto').textContent = '';
  nameTimer = setInterval(() => {
    left--;
    if (left <= 10) $('nameAuto').textContent = nameBuf.trim() ? `Auto-saves as "${cleanName(nameBuf)}" in ${left}s` : `Closing in ${left}s`;
    if (left <= 0) { clearInterval(nameTimer); if (nameBuf.trim()) saveName(true); else finishName(); }
  }, 1000);
}

function renderSlots() {
  let html = '';
  for (let i = 0; i < MAX_NAME; i++) {
    const ch = nameBuf[i];
    const cls = i < nameBuf.length ? 'on' : i === nameBuf.length ? 'cur' : '';
    html += `<span class="${cls}">${ch === undefined ? '_' : ch === ' ' ? '·' : esc(ch)}</span>`;
  }
  $('slots').innerHTML = html;
}

function typeChar(ch) {
  if (nameBuf.length >= MAX_NAME) return;
  if (ch === ' ' && (nameBuf.length === 0 || nameBuf.endsWith(' '))) return;
  nameBuf += ch; $('nameErr').textContent = ''; renderSlots(); A.click();
}
function delChar() { nameBuf = nameBuf.slice(0, -1); renderSlots(); A.click(); }

function saveName(auto) {
  const n = cleanName(nameBuf);
  if (!n) { $('nameErr').textContent = 'Type at least one letter or number.'; return; }
  if (S().blockRude && isRude(n)) { $('nameErr').textContent = 'Please choose a different name.'; nameBuf = ''; renderSlots(); if (auto) finishName(); return; }
  lastRun.entry.name = n; lastName = n;
  save();
  const found = lastRun.res.landmarks;
  refreshPassport(n).then(() => {
    if (!found.length) return;
    const pp = addLandmarks(n, found);
    toast(`${n}: ${pp.length} / ${LANDMARKS.length} landmarks`, 'teal');
  });
  finishName();
}

function finishName() {
  clearInterval(nameTimer);
  flushRun();
  if (S().kioskMode) goTitle();
  else { mode = 'over'; show('s-over'); $('nameBtn').classList.add('hidden'); }
}

function buildKeys() {
  const k = $('keys');
  let html = '';
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890') html += `<button type="button" data-k="${c}" class="${/\d/.test(c) ? 'num' : ''}">${c}</button>`;
  html += '<button type="button" data-k=" " class="space">Space</button>';
  k.innerHTML = html;
  k.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) typeChar(b.dataset.k); });
}

// ---------------------------------------------------------------- pages
function openBoard() {
  mode = 'page';
  const top = topRuns(10);
  $('boardList').innerHTML = top.map((r) => `<li><span class="n">${esc(r.name)}</span><span class="k">${r.kuih || 0} kuih</span><span>${r.dist} m</span></li>`).join('');
  $('boardEmpty').classList.toggle('hidden', top.length > 0);
  show('s-board');
}

function openPassport() {
  mode = 'page';
  $('ppName').value = lastName;
  renderPassport();
  if (lastName) refreshPassport(lastName).then(renderPassport);
  show('s-passport');
}
function renderPassport() {
  const n = cleanName($('ppName').value);
  const got = new Set(passportFor(n));
  const cols = ['#F28C38', '#D94F70', '#1F7A80'];
  $('ppGrid').innerHTML = LANDMARKS.map((l, i) => got.has(l) ? `<div class="got" style="background:${cols[i % 3]};transform:rotate(${[-8, 6, -3][i % 3]}deg)">${l}</div>` : `<div>${l}</div>`).join('');
  $('ppCount').textContent = got.size + ' / ' + LANDMARKS.length;
}

function openCouriers() {
  mode = 'page';
  renderCouriers();
  show('s-couriers');
}
function renderCouriers() {
  const db = store.db, shop = S().shopEnabled;
  $('walletChip').textContent = db.wallet + ' tips';
  $('walletChip').classList.toggle('hidden', !shop);
  $('courierNote').textContent = shop ? 'Tips are earned from deliveries and coins. Couriers are just for looks.' : 'All couriers are free to pick at this booth (except the Sun bear: collect all 9 landmarks).';
  const g = $('courierGrid');
  g.innerHTML = '';
  for (const c of COURIERS) {
    const owned = db.unlocked.includes(c.id) || (!shop && c.cost >= 0);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = db.courier === c.id ? 'sel' : '';
    const price = db.courier === c.id ? 'Selected' : owned ? 'Tap to pick' : c.cost < 0 ? 'Locked' : c.cost + ' tips';
    b.innerHTML = `<canvas width="144" height="144" aria-hidden="true"></canvas><b>${c.name}</b><span>${c.desc}</span><i>${price}</i>`;
    if (!owned && (c.cost < 0 || db.wallet < c.cost)) b.disabled = true;
    b.addEventListener('click', () => {
      if (!owned) { db.wallet -= c.cost; db.unlocked.push(c.id); }
      db.courier = c.id; save(); A.click(); renderCouriers();
    });
    g.appendChild(b);
    drawBird(b.querySelector('canvas'), c.id, false);
  }
}

// ---------------------------------------------------------------- pause & settings
function pause() {
  if (mode !== 'play') return;
  mode = 'paused';
  A.stopMusic();
  syncSettingsForm();
  $('pauseTitle').textContent = 'Paused';
  $('pauseBtns').classList.remove('hidden');
  $('quitBtn').textContent = 'Quit to menu';
  show('s-pause');
}
function resume() {
  if (mode !== 'paused') return;
  mode = 'play';
  show(null);
  $('hud').classList.remove('hidden');
  updatePad();
  if (game) { game.clockStart = performance.now() - ((performance.now() - game.clockStart) % BEAT_MS); A.startMusic(game.clockStart); }
}
function openSettingsFromTitle() {
  mode = 'page';
  syncSettingsForm();
  $('pauseTitle').textContent = 'Settings';
  $('pauseBtns').classList.add('hidden');
  $('quitBtn').textContent = 'Back';
  show('s-pause');
}
function syncSettingsForm() {
  const s = S();
  $('setMusic').value = s.music; $('setSfx').value = s.sfx; $('setBeat').checked = s.showBeat !== false;
  $('setPad').value = s.showPad || 'auto'; $('setMotion').checked = !!s.reduceMotion; $('setCB').checked = !!s.colorBlind;
  $('setFull').checked = !!document.fullscreenElement;
}

function fullscreen(on) {
  try {
    if (on && !document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    if (!on && document.fullscreenElement) document.exitFullscreen().catch(() => {});
  } catch (e) { /* not supported */ }
}

// ---------------------------------------------------------------- operator
let pinBuf = '';
function openPin() {
  if (mode === 'play') pause();
  mode = 'pin'; pinBuf = ''; $('pinErr').textContent = '';
  renderPin(); show('s-pin');
}
function renderPin() { $('pinDots').innerHTML = '<i></i>'.repeat(pinBuf.length); }
function pinKey(k) {
  if (k === 'C') pinBuf = '';
  else if (k === '⌫') pinBuf = pinBuf.slice(0, -1);
  else if (pinBuf.length < 8) pinBuf += k;
  renderPin();
  if (pinBuf === String(S().pin || '1234')) openOperator();
  else if (pinBuf.length >= String(S().pin || '1234').length) { $('pinErr').textContent = 'Wrong PIN'; pinBuf = ''; setTimeout(renderPin, 300); }
}
function openOperator() {
  mode = 'operator';
  const st = stats();
  renderCloud();
  $('opRuns').textContent = st.runs; $('opKuih').textContent = st.kuih; $('opBest').textContent = st.best + ' m'; $('opLand').textContent = st.landmarks;
  document.querySelectorAll('[data-set]').forEach((el) => {
    const v = S()[el.dataset.set];
    if (el.type === 'checkbox') el.checked = !!v; else el.value = v == null ? '' : v;
  });
  show('s-operator');
}
function confirmBtn(btn, label, action) {
  if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = label; action(); toast('Done', 'teal'); return; }
  btn.dataset.armed = '1'; btn.textContent = 'Tap again to confirm';
  setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; btn.textContent = label; } }, 3000);
}

// ---------------------------------------------------------------- HUD
let hudCache = {};
function setText(id, t) { if (hudCache[id] !== t) { hudCache[id] = t; $(id).textContent = t; } }
function updateHud(force) {
  if (!game) return;
  if (force) hudCache = {};
  const g = game;
  setText('dist', g.maxRow + ' m');
  const hearts = Array.from({ length: Math.max(LIVES.start, g.lives) }, (_, i) => `<i class="${i < g.lives ? 'on' : ''}"></i>`).join('');
  if (hudCache.hearts !== hearts) { hudCache.hearts = hearts; $('lives').innerHTML = hearts; $('lives').setAttribute('aria-label', g.lives + (g.lives === 1 ? ' life' : ' lives') + ' left'); }
  setText('tipsText', g.tips + ' tips');
  const m = g.comboMult();
  setText('comboText', g.combo > 0 ? `On beat ×${m}` : 'Hop on the beat');
  $('comboChip').classList.toggle('off', g.combo === 0);
  // ticket
  const t = $('ticket');
  if (g.carrying && g.order) {
    const lanes = Math.max(0, g.order.goalRow - g.p.row);
    setText('ticketNo', 'ORDER #' + g.order.no);
    setText('ticketMain', `${g.order.qty} × kuih lapis → ${g.order.customer}`);
    setText('ticketSub', lanes > 0 ? `${lanes} lane${lanes === 1 ? '' : 's'} to go` : 'Hop into the stall!');
    t.classList.add('carry');
  } else {
    setText('ticketNo', 'FIND THE KUIH');
    setText('ticketMain', 'Pick up a box of kuih lapis');
    setText('ticketSub', g.dropped && !g.deliveries ? 'You dropped it! Grab another one' : "It's on the lanes ahead");
    t.classList.remove('carry');
  }
  // gauge: full when the water is at your feet
  const gap = g.floodGap();
  const lvl = Math.max(0, Math.min(100, 100 - (gap / 10) * 100));
  $('gaugeFill').style.height = lvl + '%';
  $('gauge').classList.toggle('danger', gap < 2.5);
  $('gauge').setAttribute('aria-label', `Flood is ${Math.max(0, gap).toFixed(0)} lanes behind`);
  const warn = g.flood.active && gap < 2.6 && !g.dead;
  $('warn').classList.toggle('hidden', !warn);
  if (warn) setText('warn', `Water is ${Math.max(0, Math.floor(gap))} lane${Math.floor(gap) === 1 ? '' : 's'} behind you!`);
  // power chip
  const pc = $('powerChip');
  if (g.power) {
    const P = POWERUPS[g.power.id];
    pc.classList.remove('hidden');
    setText('powerChip', g.power.hops !== undefined ? `${P.name} · ${g.power.hops} hops` : `${P.name} · ${Math.ceil(g.power.t)}s`);
  } else if (g.helmet) { pc.classList.remove('hidden'); setText('powerChip', 'Rattan helmet on'); }
  else pc.classList.add('hidden');
  $('baitBtn').classList.toggle('hidden', g.bait <= 0);
  setText('baitN', String(g.bait));
  const tl = S().timeLimit;
  $('timeChip').classList.toggle('hidden', !tl);
  if (tl) setText('timeChip', `Time ${Math.max(0, Math.ceil(tl - g.runTime))}s`);
  // time of day
  const tod = g.tod();
  $('todFill').style.width = Math.round(tod * 100) + '%';
  setText('todText', tod > 0.6 ? 'Night · bikes faster, headlights on' : tod > 0.1 ? 'Sunset' : 'Day');
  $('todChip').classList.toggle('hidden', S().dayNight === false);
  // tutorial hints
  if (tutorialActive) {
    let step = 0, title = 'Hop forward', text = isTouch ? 'Tap the screen or swipe up.' : 'Press ↑ or W. Hop on the drum beat for a combo.';
    if (g.p.row >= 1 && !g.carrying && g.deliveries === 0) { step = 1; title = 'Grab the kuih'; text = 'Hop onto the box of kuih lapis. Hitting anything costs a life (not in practice).'; }
    if (g.carrying) { step = 2; title = 'Cross the road'; text = 'Wait for the motorbike to pass, then hop.'; }
    if (g.carrying && g.p.row >= 5) { step = 3; title = 'Ride a longboat'; text = 'Hop onto a boat. The river is too deep to swim!'; }
    if (g.carrying && g.p.row >= 8) { step = 4; title = 'Deliver it'; text = 'Hop into the stall marked DELIVER HERE.'; }
    if (g.deliveries > 0) { step = 5; title = 'Now run!'; text = 'The banjir starts rising behind you. Keep hopping!'; }
    setText('hintTitle', title); setText('hintText', text);
    const dots = Array.from({ length: 6 }, (_, i) => `<i class="${i <= step ? 'on' : ''}"></i>`).join('');
    if (hudCache.dots !== dots) { hudCache.dots = dots; $('hintDots').innerHTML = dots; }
    if (g.flood.active && g.maxRow >= 16) { tutorialActive = false; $('hint').classList.add('hidden'); }
  }
}

// ---------------------------------------------------------------- events → sound + toasts
let lastBikeSound = 0, lastThunder = 0;
function handleEvents(now) {
  for (const e of game.events) {
    switch (e.type) {
      case 'hop': A.hop(e.onBeat, e.combo, store.db.courier === 'proboscis'); if (e.onBeat && e.combo === 4) toast('On beat ×3!', 'mag'); break;
      case 'tip': A.tip(); break;
      case 'kuih': A.kuih(); toast(game.order ? `Deliver to ${game.order.customer}` : 'Kuih!', 'good'); break;
      case 'deliver': A.gong(); toast(`Delivered! +${e.add} tips · flood pushed back`, 'good'); break;
      case 'power': A.power(); toast(POWERUPS[e.id].name + ': ' + POWERUPS[e.id].desc, 'teal'); break;
      case 'stamp': A.stamp(); toast((e.isNew ? 'New landmark: ' : 'Landmark: ') + e.name, 'teal'); break;
      case 'lifeLost': {
        if (['splash', 'flood', 'swept'].includes(e.cause)) A.splash(); else if (e.cause === 'fell') A.fall(); else A.bump();
        const what = { splash: 'Splash!', flood: 'The banjir got you!', swept: 'Swept away!', fell: 'Fell off the roof!', croc: 'Croc bite!', moto: 'Hit by a motorbike!', trishaw: 'Hit by a trishaw!', cart: 'Hit by a cart!', cyclist: 'Hit by a cyclist!' }[e.cause] || 'Ouch!';
        toast(`${what} ${e.lives} ${e.lives === 1 ? 'life' : 'lives'} left`, 'mag');
        $('lives').classList.remove('hurt'); void $('lives').offsetWidth; $('lives').classList.add('hurt');
        break;
      }
      case 'life': A.power(); toast(e.got ? `Extra life! ${e.lives} lives` : 'Lives full: +10 tips', 'good'); break;
      case 'drop': toast('Kuih dropped', 'mag'); break;
      case 'helmet': A.bump(); toast('Helmet saved you!', 'teal'); break;
      case 'bonk': A.bonk(); break;
      case 'boat': A.boat(); break;
      case 'checkpoint': A.check(); toast('Waterfront checkpoint · flood pauses', 'teal'); break;
      case 'bait': A.power(); toast('Durian bait! Crocs distracted', 'teal'); break;
      case 'reroute': toast(`Missed it! New stall: ${game.order ? game.order.customer : ''}`, 'mag'); break;
      case 'tutorialDone': toast('Practice done. Here comes the banjir!', 'mag'); break;
      case 'dead': if (['splash', 'flood', 'swept'].includes(e.cause)) A.splash(); else if (e.cause === 'fell') A.fall(); else A.bump(); break;
    }
  }
  game.events.length = 0;
  // ambient cues
  const gap = game.floodGap();
  A.rain(game.flood.active && !game.dead ? Math.max(0, Math.min(1, (4 - gap) / 3)) : 0);
  if (game.flood.active && gap < 2 && now - lastThunder > 6000) { lastThunder = now; A.thunder(); }
  const L = game.lane(game.p.row + 1);
  if (L && L.kind === 'road' && now - lastBikeSound > 1500) {
    const cx = game.p.x + 0.5;
    if (L.ents.some((en) => en.type === 'moto' && Math.abs(en.x + en.w / 2 - cx) < 1.6)) { lastBikeSound = now; A.bike(); }
  }
}

// ---------------------------------------------------------------- loop
let prev = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
  if (mode === 'play' && game) {
    game.update(dt, now);
    handleEvents(now);
    R.follow(game, dt);
    if (game.dead && game.deadT > 1.1 && mode === 'play') endRun();
    updateHud();
  } else if (demo && (mode === 'title' || mode === 'page' || mode === 'pin' || mode === 'operator')) {
    demoV += dt * 0.6;
    demo.animate(dt, Math.floor(demoV) - 12, Math.ceil(demoV) + 16);
    R.camV = demoV; R.camC = COLS / 2;
  }
  const g = (mode === 'title' || mode === 'page' || mode === 'pin' || mode === 'operator') ? demo : game;
  if (g) {
    const phase = game ? ((now - game.clockStart) % BEAT_MS) / BEAT_MS : 0;
    R.draw(g, { now, beat: g === game && mode === 'play', beatPhase: phase, hidePlayer: g === demo });
  }
  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- input
const KEYS = { ArrowUp: 'up', KeyW: 'up', Space: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey && e.shiftKey && e.code === 'KeyO') { e.preventDefault(); openPin(); return; }
  if (mode === 'name') {
    if (e.key === 'Enter') { e.preventDefault(); saveName(); }
    else if (e.key === 'Backspace') { e.preventDefault(); delChar(); }
    else if (/^[a-zA-Z0-9 ]$/.test(e.key)) { e.preventDefault(); typeChar(e.key.toUpperCase()); }
    return;
  }
  if (mode === 'pin') { if (/^\d$/.test(e.key)) pinKey(e.key); else if (e.key === 'Backspace') pinKey('⌫'); else if (e.key === 'Escape') goTitle(); return; }
  if (mode === 'play') {
    const d = KEYS[e.code];
    if (d) { e.preventDefault(); if (!e.repeat) game.input(d, performance.now()); return; }
    if (e.code === 'KeyE') { game.useBait(); return; }
    if (e.code === 'KeyP' || e.code === 'Escape') { pause(); return; }
    if (e.code === 'KeyM') { toast(A.toggleMute() ? 'Sound off' : 'Sound on'); return; }
    return;
  }
  if (mode === 'paused' && (e.code === 'KeyP' || e.code === 'Escape')) { resume(); return; }
  if (mode === 'title' && S().kioskMode && !e.ctrlKey && !e.metaKey && !e.altKey && e.key !== 'Tab' && e.key !== 'Shift') { e.preventDefault(); startRun(); return; }
  if (mode === 'title' && (e.code === 'Enter' || e.code === 'Space') && document.activeElement === document.body) { e.preventDefault(); startRun(); }
});

// touch: tap = forward, swipe = direction
let touch0 = null;
canvas.addEventListener('pointerdown', (e) => {
  A.unlock();
  if (mode === 'title' && S().kioskMode) { startRun(); return; }
  if (mode !== 'play') return;
  touch0 = { x: e.clientX, y: e.clientY, t: performance.now() };
});
canvas.addEventListener('pointerup', (e) => {
  if (mode !== 'play' || !touch0) return;
  const dx = e.clientX - touch0.x, dy = e.clientY - touch0.y, d = Math.hypot(dx, dy);
  const when = touch0.t; touch0 = null;
  let dir = 'up';
  if (d > 24) dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
  game.input(dir, when);
});
canvas.addEventListener('pointercancel', () => { touch0 = null; });
$('pad').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('button[data-dir]'); if (!b || mode !== 'play') return;
  e.preventDefault(); A.unlock(); game.input(b.dataset.dir, performance.now());
});
document.addEventListener('contextmenu', (e) => e.preventDefault());

// hold the top-left corner for 5 s → operator PIN
let holdT = null;
$('hotspot').addEventListener('pointerdown', () => { holdT = setTimeout(openPin, 5000); });
['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => $('hotspot').addEventListener(ev, () => clearTimeout(holdT)));

// buttons
$('startBtn').addEventListener('click', () => startRun());
$('s-title').addEventListener('pointerdown', (e) => { if (S().kioskMode && mode === 'title' && !e.target.closest('button, a, #titleBird, #hotspot')) { A.unlock(); startRun(); } });
$('couriersBtn').addEventListener('click', openCouriers);
$('boardBtn').addEventListener('click', openBoard);
$('passportBtn').addEventListener('click', openPassport);
$('settingsBtn').addEventListener('click', openSettingsFromTitle);
document.querySelectorAll('.back').forEach((b) => b.addEventListener('click', goTitle));
$('pauseBtn').addEventListener('click', pause);
$('resumeBtn').addEventListener('click', resume);
$('restartBtn').addEventListener('click', () => startRun(false));
$('quitBtn').addEventListener('click', () => { if (mode === 'paused') goTitle(); else goTitle(); });
$('againBtn').addEventListener('click', () => startRun(false));
$('menuBtn').addEventListener('click', goTitle);
$('nameBtn').addEventListener('click', openName);
$('saveBtn').addEventListener('click', () => saveName());
$('delBtn').addEventListener('click', delChar);
$('baitBtn').addEventListener('click', () => game && game.useBait());
$('skipTut').addEventListener('click', () => { if (!game) return; tutorialActive = false; $('hint').classList.add('hidden'); game.flood.active = true; game.flood.level = game.p.row - FLOOD.startBehind - 0.5; store.db.tutorialSeen = true; save(); });
let ppT = null;
$('ppName').addEventListener('input', () => { renderPassport(); clearTimeout(ppT); ppT = setTimeout(() => { const n = cleanName($('ppName').value); if (n) refreshPassport(n).then(renderPassport); }, 400); });
$('setMusic').addEventListener('input', (e) => { store.setSetting('music', +e.target.value); applySettings(); });
$('setSfx').addEventListener('input', (e) => { store.setSetting('sfx', +e.target.value); applySettings(); });
$('setBeat').addEventListener('change', (e) => store.setSetting('showBeat', e.target.checked));
$('setPad').addEventListener('change', (e) => { store.setSetting('showPad', e.target.value); applySettings(); });
$('setMotion').addEventListener('change', (e) => { store.setSetting('reduceMotion', e.target.checked); applySettings(); });
$('setCB').addEventListener('change', (e) => store.setSetting('colorBlind', e.target.checked));
$('setFull').addEventListener('change', (e) => fullscreen(e.target.checked));
// pin pad
$('pinPad').innerHTML = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'C', '0', '⌫'].map((k) => `<button type="button" data-k="${k}">${k}</button>`).join('');
$('pinPad').addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) pinKey(b.dataset.k); });
$('pinCancel').addEventListener('click', goTitle);
// operator form
document.querySelectorAll('[data-set]').forEach((el) => {
  el.addEventListener(el.type === 'text' || el.type === 'range' ? 'input' : 'change', () => {
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (el.dataset.num) v = +v;
    if (el.dataset.set === 'pin') { v = String(v).replace(/\D/g, ''); if (v.length < 4) return; }
    store.setSetting(el.dataset.set, v);
    applySettings();
  });
});
$('opClose').addEventListener('click', goTitle);
$('opExport').addEventListener('click', () => {
  const blob = new Blob([exportCSV()], { type: 'text/csv' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'hornbill-express-scores.csv'; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
});
$('opClear').addEventListener('click', (e) => confirmBtn(e.target, 'Clear leaderboard…', () => { clearScores(); openOperator(); }));
$('opResetPP').addEventListener('click', (e) => confirmBtn(e.target, 'Reset all passports…', () => resetPassports()));

window.addEventListener('resize', () => R.resize());
document.addEventListener('visibilitychange', () => { if (document.hidden && mode === 'play') pause(); });
function renderCloud() {
  const c = cloudStatus();
  const txt = { off: 'Not set up: scores stay on this device (see README to connect Firebase).', connecting: 'Connecting to Firebase…', online: 'Connected: scores are shared with every booth device and the TV.', offline: 'Offline: runs are saved on this device and sync when the Wi-Fi is back.', error: 'Firebase error: ' + (c.error || 'unknown') + '. Scores stay on this device.' }[c.status];
  $('opCloud').textContent = txt + ` Records are deleted automatically after ${RETENTION_DAYS} days.`;
  $('opCloud').dataset.status = c.status;
}
onChange(() => { if (mode === 'title') refreshTitle(); if (mode === 'operator') renderCloud(); });

// ---------------------------------------------------------------- about (hidden)
// Opens from the title screen: tap the hornbill 7 times, or type K-I-U (keyboard, when not in kiosk mode).
let eggTaps = [], eggKeys = '', goldenNext = false;
function about() {
  if (document.getElementById('egg')) return;
  const el = document.createElement('div');
  el.id = 'egg'; el.className = 'egg'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'About');
  el.innerHTML = '<div class="egg-card"><canvas width="200" height="200" aria-hidden="true"></canvas>' +
    '<b class="egg-title">Hornbill Express</b><span class="egg-by">designed &amp; developed by</span>' +
    '<b class="egg-name"></b><span class="egg-meta"></span>' +
    '<div class="egg-row"><button type="button" class="btn" data-a="gold">Fly as Golden Kenyalang</button>' +
    '<button type="button" class="btn btn-cream" data-a="close">Close</button></div></div>';
  el.querySelector('.egg-name').textContent = sig();
  el.querySelector('.egg-meta').textContent = 'Kuching, Sarawak · ' + new Date(2026, 10).getFullYear() + ' · v' + VERSION + ' · ' + BUILD.id;
  document.body.appendChild(el);
  drawBird(el.querySelector('canvas'), 'golden', true);
  A.unlock(); A.gong();
  for (let i = 0; i < 18; i++) {
    const p = document.createElement('i'); p.className = 'egg-p';
    p.style.left = Math.random() * 100 + '%'; p.style.animationDelay = (Math.random() * 0.8) + 's';
    p.style.background = ['#FFC94A', '#F28C38', '#D94F70', '#FFF1A8'][i % 4];
    el.appendChild(p);
  }
  el.addEventListener('click', (e) => {
    const a = e.target.closest('[data-a]'); if (!a) return;
    if (a.dataset.a === 'gold') { goldenNext = true; toast('Golden Kenyalang ready for your next run', 'good'); }
    el.remove();
  });
}
$('titleBird').addEventListener('pointerdown', (e) => {
  e.stopPropagation();
  const now = performance.now();
  eggTaps = eggTaps.filter((t) => now - t < 4000); eggTaps.push(now);
  if (eggTaps.length >= 7) { eggTaps = []; about(); }
});
window.addEventListener('keydown', (e) => {
  if (mode !== 'title' || S().kioskMode || e.repeat) return;
  eggKeys = (eggKeys + e.key.toLowerCase()).slice(-3);
  if (eggKeys === 'kiu') { eggKeys = ''; about(); }
});

// ---------------------------------------------------------------- boot
buildKeys();
applySettings();
goTitle();
requestAnimationFrame(frame);
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
// debug/test hook
window.__hornbill = { get game() { return game; }, get mode() { return mode; }, get renderer() { return R; }, startRun, store, about };
