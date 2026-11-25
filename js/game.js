// Game state and rules: movement, collisions, flood, deliveries, power-ups, rhythm.
import { COLS, BEAT_MS, BEAT_WINDOW, HOP_MS, FLOOD, POWERUPS, LANDMARKS } from './config.js';
import { World } from './world.js';

const SAFE_KINDS = new Set(['padi', 'prom', 'goal', 'start']);

export class Game {
  constructor(opts = {}) {
    this.opts = opts;
    this.settings = opts.settings || {};
    this.tutorial = !!opts.tutorial;
    const rate = { rare: 0.012, normal: 0.025, often: 0.05 }[this.settings.landmarkRate || 'normal'];
    this.world = new World({ seed: opts.seed, tutorial: this.tutorial, stampRate: rate, stampsOn: this.settings.landmarksOn !== false });
    this.knownLandmarks = new Set(opts.knownLandmarks || []);
    const cx = Math.floor(COLS / 2);
    this.p = { row: 0, x: cx, fromRow: 0, fromX: cx, toRow: 0, toX: cx, t: 1, hopping: false, dir: 'up', stun: 0, invuln: 0, onEnt: null, lastSafe: { row: 0, x: cx }, bumpT: 0, glide: false };
    this.buffer = null;
    this.flood = { level: -FLOOD.startBehind - 0.5, pause: 0, active: !this.tutorial };
    this.maxRow = 0; this.tips = 0; this.deliveries = 0; this.kuihDelivered = 0; this.dropped = 0; this.landmarks = [];
    this.carrying = false; this.order = null;
    this.combo = 0; this.comboPeak = 0;
    this.power = null;    // {id, t} timed or {id, hops}
    this.helmet = false; this.bait = 0; this.crocDistract = 0;
    this.time = 0; this.runTime = 0; this.clockStart = opts.now || 0;
    this.dead = false; this.cause = null; this.deadT = 0;
    this.particles = []; this.shake = 0; this.events = [];
    this.tutorialStep = 0;
    this.world.ensure(40);
  }

  emit(type, data = {}) { this.events.push(Object.assign({ type }, data)); }

  lane(r) { return this.world.lane(r); }

  // ---------- time-of-day ----------
  tod() {
    if (this.settings.dayNight === false) return 0;
    const c = (this.maxRow % 110) / 110; // 0..1 cycle
    if (c < 0.42) return 0;
    if (c < 0.55) return (c - 0.42) / 0.13;
    if (c < 0.9) return 1;
    return 1 - (c - 0.9) / 0.1;
  }
  isNight() { return this.tod() > 0.6; }

  speedMult(kind) {
    let m = 1;
    if (this.power && this.power.id === 'teh') m *= 0.5;
    if ((kind === 'road' || kind === 'market') && this.isNight()) m *= 1.25;
    return m;
  }

  // ---------- input ----------
  input(dir, now) {
    if (this.dead) return;
    if (this.p.hopping || this.p.stun > 0) { this.buffer = dir; return; }
    this.hop(dir, now);
  }

  useBait() {
    if (this.dead || this.bait <= 0) return;
    this.bait--; this.crocDistract = POWERUPS.durian.dur;
    this.emit('bait');
  }

  beatOffset(now) {
    const ph = (now - this.clockStart) % BEAT_MS;
    return Math.min(ph, BEAT_MS - ph);
  }
  comboMult() { return 1 + Math.min(4, Math.floor(this.combo / 2)); }

  hop(dir, now) {
    const p = this.p;
    let dr = dir === 'up' ? 1 : dir === 'down' ? -1 : 0;
    const dc = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
    let glide = false;
    if (dr === 1 && this.power && this.power.id === 'wau' && this.power.hops > 0) { dr = 2; glide = true; }
    const tr = p.row + dr;
    const curLane = this.lane(p.row);
    let tx = dr !== 0 ? Math.round(p.x) : (curLane.kind === 'river' && p.onEnt ? p.x + dc : Math.round(p.x) + dc);
    p.dir = dir;
    if (tr < 0 || Math.round(tx) < 0 || Math.round(tx) > COLS - 1 || tr < this.maxRow - 6) { this.bonk(); return; }
    const L = this.lane(tr);
    const c = Math.round(tx);
    if (L.block.has(c)) { this.bonk(); return; }
    if (L.goal && L.goal.col === c && !(this.carrying && this.order && this.order.goalRow === tr)) { this.bonk(); return; }
    if (glide) { this.power.hops--; if (this.power.hops <= 0) this.power = null; }
    // rhythm
    const off = this.beatOffset(now);
    if (off <= BEAT_WINDOW) { this.combo++; this.comboPeak = Math.max(this.comboPeak, this.combo); this.emit('hop', { onBeat: true, combo: this.combo }); }
    else { if (this.combo > 0) this.emit('comboLost'); this.combo = 0; this.emit('hop', { onBeat: false }); }
    Object.assign(p, { fromRow: p.row, fromX: p.x, toRow: tr, toX: tx, t: 0, hopping: true, glide, onEnt: dr === 0 ? p.onEnt : null });
  }

  bonk() { this.p.bumpT = 0.15; this.emit('bonk'); }

  // ---------- update ----------
  update(dt, now) {
    this.time += dt;
    if (this.dead) { this.deadT += dt; this.updateParticles(dt); return; }
    this.runTime += dt;
    const p = this.p;
    this.world.ensure(this.maxRow + 40);
    this.world.prune(Math.floor(this.flood.level) - 12);

    // moving things
    const lo = Math.floor(this.flood.level) - 3, hi = this.maxRow + 30;
    for (let r = Math.max(0, lo); r <= hi; r++) {
      const L = this.lane(r);
      if (!L) continue;
      const m = this.speedMult(L.kind);
      for (const e of L.ents) this.move(e, dt * m);
      for (const e of L.crocs) {
        if (this.crocDistract > 0) e.x += (Math.round(p.x) - e.x) * Math.min(1, dt * 0.6) * 0; // hold position while eating
        else this.move(e, dt * m);
        e.phase += dt;
      }
    }

    // timers
    if (p.stun > 0) p.stun -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.bumpT > 0) p.bumpT -= dt;
    if (this.crocDistract > 0) this.crocDistract -= dt;
    if (this.power && this.power.t !== undefined) { this.power.t -= dt; if (this.power.t <= 0) { this.emit('powerEnd', { id: this.power.id }); this.power = null; } }
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 30);

    // hop progress
    if (p.hopping) {
      p.t += (dt * 1000) / (p.glide ? HOP_MS * 1.8 : HOP_MS);
      if (p.onEnt === null && this.lane(p.fromRow).kind === 'river' && p.toRow === p.fromRow) { /* sideways off a boat */ }
      if (p.t >= 1) { p.t = 1; p.hopping = false; p.row = p.toRow; p.x = p.toX; this.land(now); }
    } else if (p.onEnt) {
      const L = this.lane(p.row);
      p.x += p.onEnt.speed * this.speedMult(L.kind) * dt;
      if (p.x < -0.55 || p.x > COLS - 0.45) this.die('swept');
    }
    if (this.dead) return;

    // buffered input
    if (!p.hopping && p.stun <= 0 && this.buffer) { const b = this.buffer; this.buffer = null; this.hop(b, now); }

    this.collide();
    if (this.dead) return;
    this.updateFlood(dt);
    if (this.dead) return;
    this.magnet();
    this.orders();
    if (this.settings.timeLimit && this.runTime >= this.settings.timeLimit) this.die('time');
    this.updateParticles(dt);
    if (this.tutorial && this.flood.active === false && this.maxRow >= 12) { this.flood.active = true; this.flood.level = Math.min(this.flood.level, this.p.row - 5.5); this.emit('tutorialDone'); }
  }

  // menus: only animate the moving things in a range of lanes
  animate(dt, lo, hi) {
    this.time += dt;
    this.world.ensure(hi);
    this.world.prune(lo - 4);
    for (let r = Math.max(0, lo); r <= hi; r++) {
      const L = this.lane(r);
      if (!L) continue;
      for (const e of L.ents) this.move(e, dt);
      for (const e of L.crocs) { this.move(e, dt); e.phase += dt; }
    }
  }

  move(e, dt) {
    e.x += e.speed * dt;
    const L = -4, R = COLS + 4, S = R - L;
    if (e.speed > 0 && e.x > R) e.x -= S;
    if (e.speed < 0 && e.x + e.w < L) e.x += S;
  }

  // world position of the player's centre (rows, cols), interpolated while hopping
  pos() {
    const p = this.p;
    if (!p.hopping) return { v: p.row, c: p.x + 0.5, t: 1 };
    const t = p.t;
    return { v: p.fromRow + (p.toRow - p.fromRow) * t, c: p.fromX + (p.toX - p.fromX) * t + 0.5, t };
  }

  land(now) {
    const p = this.p;
    const L = this.lane(p.row);
    const g = this.world.ground(p.row, p.x);
    if (L.kind === 'river' || (L.kind === 'split' && g === 'water')) {
      const ent = L.kind === 'river' ? this.platformAt(L, p.x + 0.5) : null;
      if (!ent) { this.die('splash'); return; }
      p.onEnt = ent;
      this.emit('boat');
    } else if (g === 'gap') { this.die('fell'); return; }
    else {
      p.onEnt = null; p.x = Math.round(p.x);
      if (SAFE_KINDS.has(L.kind) || (L.kind === 'split' && L.splitKinds[p.x] === 'prom')) p.lastSafe = { row: p.row, x: p.x };
    }
    this.emit('land');
    if (p.row > this.maxRow) {
      this.maxRow = p.row;
      if (L.checkpoint && !L.visited) { L.visited = true; this.flood.pause = Math.max(this.flood.pause, FLOOD.checkpointPause); this.emit('checkpoint'); }
    }
    this.collect(p.row, Math.round(p.x));
    if (L.goal && this.carrying && this.order && this.order.goalRow === p.row && L.goal.col === Math.round(p.x)) this.deliver();
  }

  platformAt(L, cx) {
    for (const e of L.ents) if (cx >= e.x - 0.1 && cx <= e.x + e.w + 0.1) return e;
    return null;
  }

  collide() {
    const p = this.p;
    if (p.invuln > 0) return;
    const { v, c, t } = this.pos();
    const row = Math.round(v);
    const L = this.lane(row);
    if (!L) return;
    const half = 0.3;
    if (!(p.hopping && t > 0.25 && t < 0.75)) {
      for (const e of L.ents) {
        if (e.type === 'boat' || e.type === 'tambang') continue;
        if (c + half > e.x + 0.08 && c - half < e.x + e.w - 0.08) { this.bump(e); return; }
      }
    }
    if (L.kind === 'river' && !p.hopping && this.crocDistract <= 0) {
      for (const e of L.crocs) {
        if (this.crocUp(e) && c + half > e.x + 0.2 && c - half < e.x + e.w - 0.2) { this.die('croc'); return; }
      }
    }
  }

  crocUp(e) { return (e.phase % 4.2) < 2.6; }

  bump(e) {
    const p = this.p;
    this.shake = this.settings.reduceMotion ? 0 : 6;
    this.particlesAt(this.pos(), this.carrying ? 'crumbs' : 'feathers', 10);
    if (this.helmet) { this.helmet = false; p.invuln = 1.2; this.emit('helmet'); return; }
    if (this.carrying) { this.carrying = false; this.order = null; this.dropped++; this.emit('drop'); }
    this.combo = 0;
    this.emit('bump', { by: e.type });
    p.hopping = false; p.row = p.lastSafe.row; p.x = p.lastSafe.x; p.onEnt = null; p.t = 1;
    p.stun = 0.45; p.invuln = 1.5;
    if (this.flood.level >= p.row) this.die('flood');
  }

  updateFlood(dt) {
    const f = this.flood;
    if (!f.active) return;
    if (f.pause > 0) { f.pause -= dt; return; }
    if (this.power && this.power.id === 'payung') return;
    const p = this.p;
    let sp = Math.min(FLOOD.maxSpeed, FLOOD.baseSpeed + FLOOD.speedPerLane * this.maxRow);
    if (p.row - f.level > FLOOD.catchUpGap) sp += FLOOD.catchUpBoost;
    f.level += sp * dt;
    const { v } = this.pos();
    if (f.level >= v - 0.05) this.die('flood');
  }

  floodGap() { return this.p.row - this.flood.level; }

  collect(row, col) {
    const L = this.lane(row);
    const it = L.pick.get(col);
    if (!it) return;
    L.pick.delete(col);
    const at = { v: row, c: col + 0.5 };
    if (it.type === 'tip') {
      const add = it.value * this.comboMult();
      this.tips += add; this.particlesAt(at, 'sparkle', 6); this.emit('tip', { add });
    } else if (it.type === 'kuih') {
      if (!this.carrying) this.startOrder(row);
      this.emit('kuih');
    } else if (it.type === 'power') {
      if (it.id === 'durian') this.bait++;
      else if (it.id === 'helmet') this.helmet = true;
      else if (it.id === 'wau') this.power = { id: 'wau', hops: POWERUPS.wau.hops };
      else this.power = { id: it.id, t: POWERUPS[it.id].dur };
      this.particlesAt(at, 'sparkle', 10);
      this.emit('power', { id: it.id });
    } else if (it.type === 'stamp') {
      const left = LANDMARKS.filter((l) => !this.knownLandmarks.has(l) && !this.landmarks.includes(l));
      const pool = left.length ? left : LANDMARKS.filter((l) => !this.landmarks.includes(l));
      if (pool.length) {
        const name = pool[Math.floor(Math.random() * pool.length)];
        this.landmarks.push(name);
        this.emit('stamp', { name, isNew: !this.knownLandmarks.has(name) });
      }
      this.particlesAt(at, 'petals', 12);
    }
  }

  startOrder(row) {
    this.world.ensure(row + 45);
    let goalRow = null;
    for (let r = row + 4; r <= row + 45; r++) { const L = this.lane(r); if (L && L.goal) { goalRow = r; break; } }
    if (goalRow === null) return;
    const G = this.lane(goalRow).goal;
    this.carrying = true;
    this.order = { qty: 1 + Math.floor(Math.random() * 3), goalRow, goalCol: G.col, customer: G.customer, no: this.deliveries + 1 };
  }

  orders() {
    const p = this.p;
    if (this.carrying && this.order && p.row > this.order.goalRow + 2) {
      // missed the stall: re-route to the next one
      const qty = this.order.qty;
      this.startOrder(p.row);
      if (this.order) this.order.qty = qty;
      this.emit('reroute');
    }
    if (!this.carrying) {
      // make sure a kuih pickup exists ahead
      for (let r = p.row; r <= p.row + 22; r++) {
        const L = this.lane(r);
        for (const it of L.pick.values()) if (it.type === 'kuih') return;
      }
      for (let r = Math.max(p.row + 3, this.maxRow + 3); r <= p.row + 30; r++) {
        const L = this.lane(r);
        if (!['padi', 'prom', 'start'].includes(L.kind)) continue;
        const free = [];
        for (let c = 0; c < COLS; c++) if (!L.block.has(c) && !L.pick.has(c)) free.push(c);
        if (free.length) { L.pick.set(free[Math.floor(Math.random() * free.length)], { type: 'kuih' }); return; }
      }
    }
  }

  deliver() {
    const qty = this.order.qty;
    const add = 10 * qty * this.comboMult();
    this.tips += add; this.deliveries++; this.kuihDelivered += qty;
    this.flood.level -= FLOOD.deliveryPushback * qty;
    this.carrying = false; this.order = null;
    this.particlesAt(this.pos(), 'petals', 24);
    this.emit('deliver', { qty, add });
  }

  magnet() {
    if (!this.power || this.power.id !== 'tiffin') return;
    const p = this.p;
    for (let r = p.row - 2; r <= p.row + 2; r++) {
      if (r < 0) continue;
      const L = this.lane(r);
      for (const [c, it] of [...L.pick.entries()]) {
        if (it.type === 'tip' && Math.abs(c - p.x) <= 2.2) { L.pick.delete(c); this.tips += it.value * this.comboMult(); this.particlesAt({ v: r, c: c + 0.5 }, 'sparkle', 4); this.emit('tip', { add: it.value }); }
      }
    }
  }

  die(cause) {
    if (this.dead) return;
    this.dead = true; this.cause = cause; this.deadT = 0;
    this.shake = this.settings.reduceMotion ? 0 : 10;
    this.particlesAt(this.pos(), cause === 'splash' || cause === 'flood' || cause === 'swept' ? 'splash' : 'feathers', 18);
    this.emit('dead', { cause });
  }

  // ---------- particles ----------
  particlesAt(at, kind, n) {
    if (this.settings.reduceMotion) n = Math.ceil(n / 2);
    const colors = { sparkle: ['#FFC94A', '#FFFFFF'], petals: ['#D94F70', '#F28C38', '#FFC94A', '#1F7A80'], feathers: ['#FFFFFF', '#26222B'], crumbs: ['#D94F70', '#FFC94A', '#7FB24A'], splash: ['#BFEFF0', '#FFFFFF', '#4FC3C4'] }[kind];
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, s = 1 + Math.random() * 3;
      this.particles.push({ v: at.v, c: at.c, vv: Math.sin(a) * s + (kind === 'splash' ? 2 : 0), vc: Math.cos(a) * s, life: 0.6 + Math.random() * 0.6, max: 1.2, color: colors[i % colors.length], kind, size: kind === 'petals' ? 0.12 : 0.08 });
    }
  }

  updateParticles(dt) {
    for (const q of this.particles) { q.life -= dt; q.v += q.vv * dt; q.c += q.vc * dt; q.vv -= 6 * dt * (q.kind === 'petals' ? 0.3 : 1); q.vc *= 0.96; }
    this.particles = this.particles.filter((q) => q.life > 0);
  }

  result() {
    return { dist: this.maxRow, kuih: this.kuihDelivered, deliveries: this.deliveries, dropped: this.dropped, tips: this.tips, landmarks: this.landmarks.slice(), cause: this.cause, combo: this.comboPeak, seconds: Math.round(this.runTime) };
  }
}
