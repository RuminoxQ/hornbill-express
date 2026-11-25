// Procedural Kuching: lanes, moving things, pickups.
import { COLS, VEHICLE_COLORS, CUSTOMERS } from './config.js';

export const SPAN_L = -4, SPAN_R = COLS + 4, SPAN = SPAN_R - SPAN_L;
const CENTER = Math.floor(COLS / 2);

// simple seeded RNG so a run is reproducible for testing
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s >>> 0) / 4294967296; };
}

export class World {
  constructor(opts = {}) {
    this.rand = rng(opts.seed || (Date.now() & 0xffffffff));
    this.rows = new Map();
    this.next = 0;
    this.tutorial = !!opts.tutorial;
    this.stampRate = opts.stampRate || 0.025;
    this.stampsOn = opts.stampsOn !== false;
    this.nextGoal = this.tutorial ? 11 : 9;
    this.pickupAt = this.tutorial ? 3 : 3;
    this.lastRoof = null;
    this.queue = [];
    this.lastKinds = [];
  }

  r(a, b) { return a + this.rand() * (b - a); }
  ri(a, b) { return Math.floor(this.r(a, b + 1)); }
  pick(arr) { return arr[Math.floor(this.rand() * arr.length)]; }

  lane(row) {
    while (this.next <= row) this.gen(this.next++);
    return this.rows.get(row);
  }

  ensure(upTo) { while (this.next <= upTo) this.gen(this.next++); }

  prune(below) { for (const k of this.rows.keys()) if (k < below) this.rows.delete(k); }

  diff(row) { return Math.min(1, Math.max(0, row / 320)); }

  // ---- lane planning ----
  planKind(row) {
    if (row <= 1) return 'start';
    if (this.tutorial && row <= 12) {
      return ['start', 'start', 'padi', 'padi', 'road', 'padi', 'padi', 'river', 'padi', 'prom', 'padi', 'goal', 'padi'][row];
    }
    if (row === this.nextGoal) return 'goal';
    if (this.queue.length) return this.queue.shift();
    const d = this.diff(row);
    const last = this.lastKinds[this.lastKinds.length - 1];
    // segment choices with weights shifting by difficulty
    const opts = [
      ['safe', 2.1 - d], ['road', 2.6 + d], ['river', 1.8 + d], ['market', 1.0 + 0.5 * d],
      ['roofs', row > 25 ? 0.8 + 0.6 * d : 0], ['prom', 0.9], ['split', row > 40 ? 0.45 + 0.3 * d : 0],
    ].filter(([k]) => !(k === last && (k === 'prom' || k === 'split')));
    let tot = opts.reduce((a, o) => a + o[1], 0), x = this.rand() * tot, seg = 'safe';
    for (const [k, w] of opts) { if ((x -= w) <= 0) { seg = k; break; } }
    let n = 1;
    if (seg === 'safe') n = this.ri(1, 2);
    if (seg === 'road') n = this.ri(1, 2 + Math.round(d * 2));
    if (seg === 'river') n = this.ri(1, 2 + Math.round(d));
    if (seg === 'market') n = this.ri(1, 2);
    if (seg === 'roofs') n = this.ri(2, 3);
    if (seg === 'split') n = 3;
    const kind = seg === 'safe' ? 'padi' : seg;
    const list = [];
    for (let i = 0; i < n; i++) list.push(kind);
    // a breather after a hard segment
    if (['road', 'river', 'market', 'roofs', 'split'].includes(seg) && n >= 2 && this.rand() < 0.7) list.push('padi');
    this.queue.push(...list.slice(1));
    return list[0];
  }

  gen(row) {
    let kind = this.planKind(row);
    if (kind === 'goal') this.nextGoal = row + this.ri(14, 20);
    // never let a planned goal be swallowed by a queue: if queue runs past goal, flush
    if (this.queue.length && row + this.queue.length >= this.nextGoal) this.queue = this.queue.slice(0, Math.max(0, this.nextGoal - row - 1));
    const d = this.diff(row);
    const L = { row, kind, ents: [], crocs: [], block: new Set(), pick: new Map(), cells: null, goal: null, checkpoint: false, speed: 0, variant: (row % 2) };
    const T = this.tutorial && row <= 12;

    if (kind === 'padi' || kind === 'start') {
      if (kind === 'padi') this.obstacles(L, T ? 0 : this.ri(1, 4), 'tree');
      this.safeExtras(L, row);
    } else if (kind === 'prom') {
      L.checkpoint = true;
      this.obstacles(L, T ? 0 : this.ri(0, 2), 'lamp');
      if (!T && this.rand() < 0.6) this.fill(L, 'cyclist', this.r(0.9, 1.5) * (this.rand() < 0.5 ? 1 : -1), 0.8, 1, 2);
      this.safeExtras(L, row);
    } else if (kind === 'goal') {
      const col = T ? CENTER : this.ri(2, COLS - 3);
      L.goal = { col, customer: this.pick(CUSTOMERS) };
      this.obstacles(L, T ? 0 : this.ri(0, 2), 'tree', [col - 1, col, col + 1]);
    } else if (kind === 'road') {
      const dir = this.rand() < 0.5 ? 1 : -1;
      if (T) { L.speed = 1.0 * dir; this.fill(L, 'moto', L.speed, 0.9, 1, 1); }
      else if (this.rand() < 0.35) { L.speed = this.r(0.9, 1.5 + d * 0.6) * dir; this.fill(L, 'trishaw', L.speed, 1.8, 2, 3); }
      else { L.speed = this.r(2.2, 3.4 + d * 2.0) * dir; this.fill(L, 'moto', L.speed, 0.9, 2, 3 + Math.round(d * 2)); }
    } else if (kind === 'market') {
      const dir = this.rand() < 0.5 ? 1 : -1;
      L.speed = this.r(0.6, 1.1 + d * 0.5) * dir;
      this.fill(L, 'cart', L.speed, 2.0, 2, 3);
    } else if (kind === 'river') {
      const dir = this.rand() < 0.5 ? 1 : -1;
      L.speed = (T ? 0.8 : this.r(0.8, 1.6 + d * 0.9)) * dir;
      this.platforms(L, T);
      if (!T && row > 18 && this.rand() < 0.25 + d * 0.4) {
        L.crocs.push({ type: 'croc', x: this.r(SPAN_L, SPAN_R), w: 1.6, speed: -L.speed * 0.55, phase: this.r(0, 4) });
      }
    } else if (kind === 'roofs') {
      L.cells = this.roofCells();
      this.tipsOn(L, (c) => L.cells[c], 0.35);
    } else if (kind === 'split') {
      // left: rooftops (risky, double tips); centre channel; right: waterfront (safe)
      const roofs = this.roofCells(0, CENTER - 1);
      L.cells = Array.from({ length: COLS }, (_, c) => c < CENTER ? roofs[c] : c === CENTER ? false : true);
      L.splitKinds = Array.from({ length: COLS }, (_, c) => c < CENTER ? 'roof' : c === CENTER ? 'channel' : 'prom');
      this.tipsOn(L, (c) => c < CENTER && L.cells[c], 0.6, 2);
    }
    if (kind !== 'roofs' && kind !== 'split') this.lastRoof = null;
    this.lastKinds.push(kind);
    if (this.lastKinds.length > 6) this.lastKinds.shift();
    // first lane of a split segment gets the signpost
    L.forkSign = kind === 'split' && this.rows.get(row - 1) && this.rows.get(row - 1).kind !== 'split';
    this.rows.set(row, L);
  }

  roofCells(from = 0, to = COLS - 1) {
    const cells = Array.from({ length: COLS }, () => false);
    for (let c = from; c <= to; c++) cells[c] = this.rand() > 0.33;
    // guarantee overlap with previous roof lane so a path exists
    const prev = this.lastRoof;
    let forced = 0;
    const want = 2;
    const range = [];
    for (let c = from; c <= to; c++) range.push(c);
    if (prev) {
      const shared = range.filter((c) => prev[c] && cells[c]).length;
      const cand = range.filter((c) => prev[c]);
      while (forced < want - shared && cand.length) { const c = cand.splice(Math.floor(this.rand() * cand.length), 1)[0]; cells[c] = true; forced++; }
    } else {
      // entering from a safe lane: make sure at least 3 roofs
      while (range.filter((c) => cells[c]).length < 3) cells[range[Math.floor(this.rand() * range.length)]] = true;
    }
    this.lastRoof = cells;
    return cells;
  }

  obstacles(L, n, type, avoid = []) {
    const free = [];
    for (let c = 0; c < COLS; c++) if (!avoid.includes(c)) free.push(c);
    for (let i = 0; i < n && free.length > 4; i++) {
      const c = free.splice(Math.floor(this.rand() * free.length), 1)[0];
      L.block.add(c);
    }
    L.obstacleType = type;
  }

  safeExtras(L, row) {
    const free = [];
    for (let c = 0; c < COLS; c++) if (!L.block.has(c)) free.push(c);
    const take = () => free.splice(Math.floor(this.rand() * free.length), 1)[0];
    if (row === this.pickupAt && free.length) {
      L.pick.set(this.tutorial && row <= 12 ? CENTER : take(), { type: 'kuih' });
      return;
    }
    if (row < 3) return;
    if (this.stampsOn && this.rand() < this.stampRate && free.length) L.pick.set(take(), { type: 'stamp' });
    if (this.rand() < 0.085 && free.length) L.pick.set(take(), { type: 'power', id: this.pick(['durian', 'payung', 'wau', 'teh', 'helmet', 'tiffin']) });
    const tips = this.rand() < 0.55 ? this.ri(1, 2) : 0;
    for (let i = 0; i < tips && free.length; i++) L.pick.set(take(), { type: 'tip', value: 1 });
  }

  tipsOn(L, ok, p, value = 1) {
    for (let c = 0; c < COLS; c++) if (ok(c) && this.rand() < p * 0.35) L.pick.set(c, { type: 'tip', value });
  }

  fill(L, type, speed, w, minGap, count) {
    const slots = count;
    const seg = SPAN / slots;
    for (let i = 0; i < slots; i++) {
      const jitter = this.r(0, Math.max(0, seg - w - minGap));
      L.ents.push({ type, x: SPAN_L + i * seg + jitter, w, speed, color: this.pick(VEHICLE_COLORS), id: Math.floor(this.rand() * 1e6) });
    }
  }

  platforms(L, T) {
    // boats of width 2.2–4 with gaps 1–2.4 so the lane is always crossable
    let x = SPAN_L + this.r(0, 1.5);
    while (x < SPAN_R - 2) {
      const tamb = !T && this.rand() < 0.25;
      const w = tamb ? 2.2 : (T ? 4 : this.r(2.4, 4.0));
      L.ents.push({ type: tamb ? 'tambang' : 'boat', x, w, speed: L.speed, id: Math.floor(this.rand() * 1e6) });
      x += w + (T ? 1.2 : this.r(1.0, 2.4));
    }
  }

  // what is underfoot at (row, col)? 'solid' | 'water' | 'gap'
  ground(row, x) {
    const L = this.lane(row);
    const c = Math.round(x);
    if (L.kind === 'river') return 'water';
    if (L.kind === 'roofs') return (c >= 0 && c < COLS && L.cells[c]) ? 'solid' : 'gap';
    if (L.kind === 'split') {
      if (c < 0 || c >= COLS) return 'gap';
      if (L.splitKinds[c] === 'channel') return 'water';
      return L.cells[c] ? 'solid' : 'gap';
    }
    return 'solid';
  }
}
