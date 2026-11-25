// Canvas renderer: top-down with a slight tilt, soft papercraft shapes.
import { COLS, LANE_COLORS, CB_VEHICLE_COLORS, VEHICLE_COLORS, POWERUPS, COURIERS, BEAT_MS } from './config.js';

const TAU = Math.PI * 2;

function lerpColor(a, b, t) {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const r = Math.round(((pa >> 16) & 255) * (1 - t) + ((pb >> 16) & 255) * t);
  const g = Math.round(((pa >> 8) & 255) * (1 - t) + ((pb >> 8) & 255) * t);
  const bl = Math.round((pa & 255) * (1 - t) + (pb & 255) * t);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | bl).toString(16).slice(1);
}
function shade(hex, f) {
  const p = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return '#' + ((1 << 24) | (c((p >> 16) & 255) << 16) | (c((p >> 8) & 255) << 8) | c(p & 255)).toString(16).slice(1);
}

export class Renderer {
  constructor(canvas) {
    this.cv = canvas; this.ctx = canvas.getContext('2d');
    this.W = 0; this.H = 0; this.ts = 48; this.camV = 0; this.camC = COLS / 2;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = this.cv.clientWidth || window.innerWidth, H = this.cv.clientHeight || window.innerHeight;
    this.cv.width = Math.round(W * dpr); this.cv.height = Math.round(H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.W = W; this.H = H;
    // tile size: show ~9 columns on phones, ~12-13 rows of height
    this.ts = Math.max(34, Math.min(110, Math.min(W / 9.2, H / 12.5)));
    this.anchor = H * (W > H ? 0.64 : 0.66);
  }

  sy(v) { return this.anchor - (v - this.camV) * this.ts; }
  sx(c) { return this.W / 2 + (c - this.camC) * this.ts; }

  follow(game, dt, snap) {
    const pos = game.pos();
    const targetV = Math.max(pos.v, 2);
    const visCols = this.W / this.ts;
    const targetC = visCols >= COLS + 1 ? COLS / 2 : Math.max(visCols / 2 - 0.5, Math.min(COLS - visCols / 2 + 0.5, pos.c));
    const k = snap ? 1 : 1 - Math.exp(-dt * 6);
    this.camV += (targetV - this.camV) * k;
    this.camC += (targetC - this.camC) * k;
  }

  // ---------------- main draw ----------------
  draw(game, opts = {}) {
    const ctx = this.ctx, W = this.W, H = this.H, ts = this.ts;
    const st = game.settings;
    const cb = !!st.colorBlind;
    const tod = game.tod();
    const pal = tod < 0.5 ? this.mixPal(LANE_COLORS.day, LANE_COLORS.dusk, tod * 2) : this.mixPal(LANE_COLORS.dusk, LANE_COLORS.night, (tod - 0.5) * 2);
    this.pal = pal; this.night = tod; this.cb = cb; this.now = opts.now || 0;
    ctx.save();
    if (game.shake > 0 && !st.reduceMotion) ctx.translate((Math.random() - 0.5) * game.shake, (Math.random() - 0.5) * game.shake);
    ctx.fillStyle = pal.road; ctx.fillRect(-20, -20, W + 40, H + 40);

    const vTop = this.camV + this.anchor / ts + 1.5;
    const vBot = this.camV - (H - this.anchor) / ts - 1.5;
    const r0 = Math.max(0, Math.floor(vBot)), r1 = Math.ceil(vTop);
    // lanes
    for (let r = r1; r >= r0; r--) this.drawLane(game, r);
    // out of bounds shading
    const xl = this.sx(0), xr = this.sx(COLS);
    ctx.fillStyle = 'rgba(42,27,61,0.32)';
    if (xl > 0) ctx.fillRect(0, 0, xl, H);
    if (xr < W) ctx.fillRect(xr, 0, W - xr, H);
    // things, far to near
    const pos = game.pos();
    const pRow = Math.round(pos.v);
    for (let r = r1; r >= r0; r--) {
      this.drawThings(game, r);
      if (r === pRow && !opts.hidePlayer) this.drawPlayer(game);
    }
    this.drawParticles(game);
    this.drawFlood(game);
    // night tint + lights
    if (tod > 0.02) {
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = lerpColor('#FFFFFF', '#6F5FA0', tod * 0.85);
      ctx.fillRect(-20, -20, W + 40, H + 40);
      ctx.globalCompositeOperation = 'lighter';
      for (let r = r1; r >= r0; r--) this.drawLights(game, r, tod);
      ctx.globalCompositeOperation = 'source-over';
    }
    this.drawRain(game);
    if (st.showBeat !== false && !game.dead && opts.beat) this.drawBeat(game, opts.beatPhase);
    ctx.restore();
  }

  mixPal(a, b, t) { const o = {}; for (const k in a) o[k] = lerpColor(a[k], b[k], t); return o; }

  rr(x, y, w, h, r, fill) {
    const ctx = this.ctx; r = Math.min(r, w / 2, h / 2);
    ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  }

  // papercraft block: soft shadow + body + darker lip at the bottom
  block(x, y, w, h, color, r = 8, lip = 0.18) {
    const ctx = this.ctx;
    this.rr(x + 1, y + h * 0.16, w, h, r, 'rgba(42,27,61,0.22)');
    this.rr(x, y, w, h, r, shade(color, 0.78));
    this.rr(x, y, w, h * (1 - lip), r, color);
    ctx.fillStyle = 'rgba(255,255,255,0.14)';
    this.rr(x + w * 0.08, y + h * 0.08, w * 0.84, Math.max(2, h * 0.14), r * 0.6);
    ctx.fill();
  }

  circle(x, y, r, fill) { const c = this.ctx; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fillStyle = fill; c.fill(); }

  // ---------------- lanes ----------------
  drawLane(game, r) {
    const L = game.lane(r); if (!L) return;
    const ctx = this.ctx, ts = this.ts, pal = this.pal;
    const y = this.sy(r + 0.5), x0 = this.sx(-6), w = (COLS + 12) * ts;
    const k = L.kind;
    let base = { padi: L.variant ? pal.padi : pal.padi2, start: pal.prom, prom: pal.prom, goal: pal.goal, road: pal.road, market: pal.market, river: pal.river, roofs: pal.roofs, split: pal.roofs }[k];
    if (this.cb && k === 'river') base = shade(base, 0.8);
    ctx.fillStyle = base; ctx.fillRect(x0, y, w, ts + 1);
    // texture
    if (k === 'padi') {
      ctx.fillStyle = 'rgba(42,27,61,0.08)';
      for (let c = -6; c < COLS + 6; c += 0.5) ctx.fillRect(this.sx(c), y + ts * 0.15, Math.max(1.5, ts * 0.05), ts * 0.7);
    } else if (k === 'prom' || k === 'start') {
      ctx.fillStyle = 'rgba(42,27,61,0.07)';
      for (let c = -6; c < COLS + 6; c++) ctx.fillRect(this.sx(c), y, 2, ts);
    } else if (k === 'road') {
      const nr = game.lane(r + 1);
      if (nr && nr.kind === 'road') { ctx.fillStyle = this.night > 0.5 ? '#8C7E86' : '#E9DCC4'; for (let c = -6; c < COLS + 6; c += 1.4) ctx.fillRect(this.sx(c), y - 2, ts * 0.6, 4); }
    } else if (k === 'river') {
      ctx.fillStyle = 'rgba(255,255,255,0.09)';
      const off = (this.now / 900) % 1;
      for (let i = 0; i < 3; i++) ctx.fillRect(x0, y + ts * (0.2 + i * 0.3) + Math.sin(off * TAU + i) * 2, w, 2);
    } else if (k === 'market') {
      ctx.fillStyle = 'rgba(0,0,0,0.1)'; for (let c = -6; c < COLS + 6; c += 2) ctx.fillRect(this.sx(c), y, ts, ts);
    } else if (k === 'goal') {
      ctx.fillStyle = 'rgba(242,140,56,0.18)'; for (let c = -6; c < COLS + 6; c += 2) ctx.fillRect(this.sx(c), y, ts, ts);
    }
    if (k === 'roofs' || k === 'split') {
      for (let c = 0; c < COLS; c++) {
        const kind = L.splitKinds ? L.splitKinds[c] : 'roof';
        const X = this.sx(c);
        if (kind === 'channel') { ctx.fillStyle = pal.river; ctx.fillRect(X, y, ts + 1, ts + 1); continue; }
        if (kind === 'prom') { ctx.fillStyle = pal.prom; ctx.fillRect(X, y, ts + 1, ts + 1); continue; }
        if (L.cells[c]) {
          const col = (c + r) % 3 === 0 ? '#9AA3AE' : '#C8553D';
          ctx.fillStyle = shade(col, 0.75); ctx.fillRect(X, y + ts * 0.82, ts + 1, ts * 0.18);
          ctx.fillStyle = col; ctx.fillRect(X, y + 2, ts + 1, ts * 0.8);
          ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 1; i < 4; i++) ctx.fillRect(X + i * ts / 4, y + 2, 2, ts * 0.8);
        }
      }
      // beyond the board: plain roofs/prom
      if (L.splitKinds) { ctx.fillStyle = pal.prom; ctx.fillRect(this.sx(COLS), y, 6 * ts, ts + 1); }
    }
    // lane lip
    ctx.fillStyle = 'rgba(0,0,0,0.10)'; ctx.fillRect(x0, y + ts - Math.max(2, ts * 0.06), w, Math.max(2, ts * 0.06));
  }

  // ---------------- things ----------------
  drawThings(game, r) {
    const L = game.lane(r); if (!L) return;
    const ts = this.ts, y = this.sy(r + 0.5), ctx = this.ctx;
    // static obstacles
    for (const c of L.block) {
      const X = this.sx(c);
      if (L.obstacleType === 'lamp') {
        this.rr(X + ts * 0.44, y + ts * 0.2, ts * 0.12, ts * 0.62, 3, '#3A3442');
        this.circle(X + ts * 0.5, y + ts * 0.22, ts * 0.16, '#FFC94A');
      } else {
        this.circle(X + ts * 0.52, y + ts * 0.62, ts * 0.38, 'rgba(42,27,61,0.22)');
        this.circle(X + ts * 0.5, y + ts * 0.48, ts * 0.4, '#3E8E5A');
        this.circle(X + ts * 0.42, y + ts * 0.4, ts * 0.22, '#58A86F');
      }
    }
    // goal stall
    if (L.goal) {
      const X = this.sx(L.goal.col), target = game.order && game.order.goalRow === r;
      this.block(X + ts * 0.05, y + ts * 0.25, ts * 0.9, ts * 0.65, '#E9D2B0', 8);
      for (let i = 0; i < 5; i++) { ctx.fillStyle = i % 2 ? '#FFF1DC' : '#D94F70'; ctx.fillRect(X + ts * (0.02 + i * 0.192), y + ts * 0.08, ts * 0.192, ts * 0.24); }
      if (target) {
        const bob = Math.sin(this.now / 200) * ts * 0.06;
        this.rr(X - ts * 0.6, y - ts * 0.55 + bob, ts * 2.2, ts * 0.42, ts * 0.2, '#F28C38');
        ctx.fillStyle = '#FFFFFF'; ctx.font = `700 ${Math.round(ts * 0.24)}px Fredoka, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('DELIVER HERE', X + ts * 0.5, y - ts * 0.34 + bob);
      }
    }
    // fork signs
    if (L.forkSign) {
      const half = Math.floor(COLS / 2);
      this.sign(this.sx(half / 2), y + ts * 0.9, '◀ Rooftops · tips ×2', '#C8553D', '#FFFFFF');
      this.sign(this.sx(half + 1 + half / 2), y + ts * 0.9, 'Waterfront · safe ▶', '#FFF1DC', '#2A1B3D');
    }
    // pickups
    for (const [c, it] of L.pick) this.drawPickup(it, this.sx(c), y);
    // platforms first, then hazards
    for (const e of L.ents) if (e.type === 'boat' || e.type === 'tambang') this.drawEnt(e, y);
    for (const e of L.crocs) this.drawCroc(game, e, y);
    for (const e of L.ents) if (!(e.type === 'boat' || e.type === 'tambang')) this.drawEnt(e, y);
  }

  sign(cx, y, text, bg, fg) {
    const ctx = this.ctx, ts = this.ts;
    ctx.font = `700 ${Math.round(ts * 0.26)}px Fredoka, sans-serif`;
    const w = ctx.measureText(text).width + ts * 0.5;
    this.rr(cx - w / 2, y - ts * 0.2, w, ts * 0.42, ts * 0.21, bg);
    ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, cx, y + ts * 0.01);
  }

  vcolor(e) { const list = this.cb ? CB_VEHICLE_COLORS : VEHICLE_COLORS; return list[(e.id || 0) % list.length]; }

  drawEnt(e, y) {
    const ts = this.ts, ctx = this.ctx, X = this.sx(e.x), w = e.w * ts;
    const right = e.speed > 0;
    if (e.type === 'boat') {
      this.rr(X, y + ts * 0.3, w, ts * 0.5, ts * 0.25, 'rgba(0,0,0,0.18)');
      this.rr(X, y + ts * 0.2, w, ts * 0.52, ts * 0.26, '#6E4528');
      this.rr(X + 2, y + ts * 0.22, w - 4, ts * 0.4, ts * 0.2, '#8B5A3C');
      const n = Math.max(1, Math.floor(e.w) - 1);
      for (let i = 0; i < n; i++) this.circle(X + w * (i + 1) / (n + 1), y + ts * 0.42, ts * 0.11, ['#FFC94A', '#D94F70', '#FFF1DC'][(e.id + i) % 3]);
    } else if (e.type === 'tambang') {
      this.block(X, y + ts * 0.15, w, ts * 0.66, '#F4F1EA', 10);
      this.rr(X + w * 0.15, y + ts * 0.22, w * 0.7, ts * 0.32, 6, '#1F7A80');
    } else if (e.type === 'moto') {
      this.block(X + ts * 0.02, y + ts * 0.28, w, ts * 0.46, this.vcolor(e), ts * 0.23);
      this.circle(X + w * (right ? 0.42 : 0.58), y + ts * 0.42, ts * 0.17, '#F4F1EA');
      this.circle(X + w * (right ? 0.42 : 0.58), y + ts * 0.42, ts * 0.09, 'rgba(42,27,61,0.35)');
    } else if (e.type === 'trishaw') {
      this.block(X, y + ts * 0.28, w, ts * 0.5, '#5B4A3F', 8);
      this.block(X + w * (right ? 0.05 : 0.4), y + ts * 0.14, w * 0.55, ts * 0.58, this.vcolor(e), 12);
      this.circle(X + w * (right ? 0.82 : 0.18), y + ts * 0.42, ts * 0.15, '#F4F1EA');
    } else if (e.type === 'cart') {
      this.block(X + ts * 0.05, y + ts * 0.32, w - ts * 0.1, ts * 0.5, '#E9D2B0', 8);
      for (let i = 0; i < 6; i++) { ctx.fillStyle = i % 2 ? '#FFF1DC' : this.vcolor(e); ctx.fillRect(X + i * w / 6, y + ts * 0.12, w / 6 + 0.5, ts * 0.26); }
      if (this.night > 0.4) for (let i = 0; i < 5; i++) this.circle(X + w * (0.1 + i * 0.2), y + ts * 0.1, ts * 0.05, '#FFE08A');
    } else if (e.type === 'cyclist') {
      this.rr(X, y + ts * 0.42, w, ts * 0.12, 4, '#3A3442');
      this.circle(X + w * 0.15, y + ts * 0.48, ts * 0.12, '#3A3442'); this.circle(X + w * 0.85, y + ts * 0.48, ts * 0.12, '#3A3442');
      this.circle(X + w * 0.5, y + ts * 0.32, ts * 0.16, this.vcolor(e));
    }
  }

  drawCroc(game, e, y) {
    const ts = this.ts, X = this.sx(e.x), w = e.w * ts, up = game.crocUp(e) && game.crocDistract <= 0;
    const ctx = this.ctx;
    if (up) {
      this.rr(X, y + ts * 0.28, w, ts * 0.44, ts * 0.22, this.cb ? '#2B2B2B' : '#4E7A3A');
      for (let i = 0; i < 4; i++) this.circle(X + w * (0.2 + i * 0.16), y + ts * 0.36, ts * 0.06, this.cb ? '#555' : '#3E6530');
      const hx = e.speed > 0 ? X + w * 0.88 : X + w * 0.12;
      this.circle(hx, y + ts * 0.34, ts * 0.07, '#FFC94A'); this.circle(hx, y + ts * 0.62, ts * 0.07, '#FFC94A');
      if (this.cb) { ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2; this.rr(X, y + ts * 0.28, w, ts * 0.44, ts * 0.22); ctx.stroke(); }
    } else {
      ctx.globalAlpha = 0.45;
      const hx = e.speed > 0 ? X + w * 0.88 : X + w * 0.12;
      this.circle(hx, y + ts * 0.4, ts * 0.05, '#FFC94A'); this.circle(hx, y + ts * 0.58, ts * 0.05, '#FFC94A');
      ctx.globalAlpha = 1;
    }
  }

  drawPickup(it, X, y) {
    const ts = this.ts, ctx = this.ctx, bob = Math.sin(this.now / 260 + X) * ts * 0.05;
    const cx = X + ts / 2, cy = y + ts * 0.45 + bob;
    this.circle(cx, y + ts * 0.72, ts * 0.18, 'rgba(42,27,61,0.18)');
    if (it.type === 'tip') {
      this.circle(cx, cy, ts * 0.17, '#C99A10'); this.circle(cx, cy - 2, ts * 0.17, '#FFC94A');
      ctx.strokeStyle = '#C46A1F'; ctx.lineWidth = Math.max(1.5, ts * 0.035); ctx.beginPath(); ctx.arc(cx, cy - 2, ts * 0.08, 0, TAU); ctx.stroke();
      if (it.value > 1) { ctx.fillStyle = '#2A1B3D'; ctx.font = `700 ${Math.round(ts * 0.18)}px Fredoka`; ctx.textAlign = 'center'; ctx.fillText('×2', cx + ts * 0.2, cy - ts * 0.18); }
    } else if (it.type === 'kuih') {
      this.kuih(cx - ts * 0.22, cy - ts * 0.22, ts * 0.44);
      ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, ts * 0.38 + Math.sin(this.now / 150) * 2, 0, TAU); ctx.stroke();
    } else if (it.type === 'power') {
      this.powerIcon(it.id, cx, cy, ts * 0.26);
    } else if (it.type === 'life') {
      ctx.fillStyle = '#E23B5A'; ctx.beginPath();
      const s = ts * 0.3; ctx.moveTo(cx, cy + s * 0.8); ctx.bezierCurveTo(cx - s * 1.4, cy - s * 0.2, cx - s * 0.6, cy - s * 1.2, cx, cy - s * 0.4); ctx.bezierCurveTo(cx + s * 0.6, cy - s * 1.2, cx + s * 1.4, cy - s * 0.2, cx, cy + s * 0.8); ctx.fill();
    } else if (it.type === 'stamp') {
      ctx.save(); ctx.translate(cx, cy); ctx.rotate(-0.15);
      this.rr(-ts * 0.24, -ts * 0.24, ts * 0.48, ts * 0.48, 6, '#FFF1DC');
      ctx.setLineDash([3, 3]); ctx.strokeStyle = '#C46A1F'; ctx.lineWidth = 2; this.rr(-ts * 0.18, -ts * 0.18, ts * 0.36, ts * 0.36, 4); ctx.stroke(); ctx.setLineDash([]);
      this.circle(0, 0, ts * 0.08, '#D94F70');
      ctx.restore();
    }
  }

  kuih(x, y, s) {
    const ctx = this.ctx;
    this.rr(x, y + s * 0.12, s, s, s * 0.15, 'rgba(42,27,61,0.25)');
    ctx.save(); this.rr(x, y, s, s, s * 0.15); ctx.clip();
    const cols = ['#D94F70', '#FFC94A', '#7FB24A'];
    for (let i = 0; i < 6; i++) { ctx.fillStyle = cols[i % 3]; ctx.fillRect(x, y + i * s / 6, s, s / 6 + 0.5); }
    ctx.restore();
  }

  powerIcon(id, cx, cy, r) {
    const ctx = this.ctx, P = POWERUPS[id];
    const col = P.color;
    ctx.save();
    ctx.shadowColor = 'rgba(42,27,61,0.3)'; ctx.shadowOffsetY = r * 0.25;
    if (P.shape === 'circle') { this.circle(cx, cy, r, col); ctx.shadowColor = 'transparent'; for (let i = 0; i < 6; i++) this.circle(cx + Math.cos(i) * r * 0.55, cy + Math.sin(i) * r * 0.55, r * 0.12, shade(col, 0.7)); }
    else if (P.shape === 'square') { this.rr(cx - r, cy - r, r * 2, r * 2, r * 0.35, col); ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#FFF'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy + r * 0.1, r * 0.6, Math.PI, 0); ctx.stroke(); ctx.beginPath(); ctx.moveTo(cx, cy + r * 0.1); ctx.lineTo(cx, cy + r * 0.7); ctx.stroke(); }
    else if (P.shape === 'diamond') { ctx.beginPath(); ctx.moveTo(cx, cy - r * 1.15); ctx.lineTo(cx + r, cy); ctx.lineTo(cx, cy + r * 1.15); ctx.lineTo(cx - r, cy); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); ctx.shadowColor = 'transparent'; ctx.strokeStyle = '#FFF'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy - r); ctx.lineTo(cx, cy + r); ctx.moveTo(cx - r * 0.8, cy); ctx.lineTo(cx + r * 0.8, cy); ctx.stroke(); }
    else if (P.shape === 'cup') { this.rr(cx - r * 0.8, cy - r, r * 1.6, r * 2, r * 0.3, col); ctx.shadowColor = 'transparent'; this.rr(cx - r * 0.8, cy - r, r * 1.6, r * 0.6, r * 0.3, '#F4E1C1'); }
    else if (P.shape === 'dome') { ctx.beginPath(); ctx.arc(cx, cy + r * 0.3, r, Math.PI, 0); ctx.closePath(); ctx.fillStyle = col; ctx.fill(); ctx.shadowColor = 'transparent'; ctx.strokeStyle = shade(col, 0.7); ctx.lineWidth = 2; for (let i = -1; i <= 1; i++) { ctx.beginPath(); ctx.moveTo(cx + i * r * 0.45, cy + r * 0.3); ctx.lineTo(cx + i * r * 0.2, cy - r * 0.6); ctx.stroke(); } }
    else { for (let i = 0; i < 3; i++) this.rr(cx - r * 0.8, cy - r + i * r * 0.68, r * 1.6, r * 0.58, r * 0.2, i % 2 ? shade(col, 1.25) : col); }
    ctx.restore();
  }

  // ---------------- player ----------------
  drawPlayer(game) {
    const ts = this.ts, ctx = this.ctx, p = game.p, pos = game.pos();
    let y = this.sy(pos.v + 0.5), x = this.sx(pos.c - 0.5);
    let sx = 1, sy = 1, lift = 0;
    const rm = game.settings.reduceMotion;
    if (p.hopping) {
      const t = pos.t;
      lift = Math.sin(t * Math.PI) * ts * (p.glide ? 0.55 : 0.28);
      if (!rm) { if (t < 0.2) { sx = 1.18; sy = 0.8; } else { sx = 0.88; sy = 1.14; } }
    } else if (!rm && p.bumpT > 0) { sx = 1.1; sy = 0.9; }
    if (game.dead && (game.cause === 'splash' || game.cause === 'flood' || game.cause === 'swept')) { ctx.globalAlpha = Math.max(0, 1 - game.deadT * 1.5); }
    if (game.dead && game.cause === 'fell') { sx = sy = Math.max(0.1, 1 - game.deadT * 1.6); }
    if (p.invuln > 0 && Math.floor(p.invuln * 10) % 2 === 0) ctx.globalAlpha *= 0.55;
    const cx = x + ts / 2, cy = y + ts * 0.55;
    // shadow
    this.circle(cx, y + ts * 0.8, ts * 0.3 * (1 - lift / ts), 'rgba(42,27,61,0.25)');
    ctx.save(); ctx.translate(cx, cy - lift); ctx.scale(sx, sy);
    const courier = COURIERS.find((c) => c.id === game.opts.courier) || COURIERS[0];
    this.creature(courier, ts * 0.9, game.carrying, p.dir);
    if (game.helmet) { ctx.beginPath(); ctx.arc(0, -ts * 0.22, ts * 0.2, Math.PI, 0); ctx.fillStyle = '#FFC94A'; ctx.fill(); }
    ctx.restore();
    if (game.power && game.power.id === 'tiffin') { ctx.strokeStyle = 'rgba(31,122,128,0.6)'; ctx.setLineDash([6, 5]); ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, ts * 2.2, 0, TAU); ctx.stroke(); ctx.setLineDash([]); }
    if (game.power && game.power.id === 'payung') { ctx.fillStyle = '#D94F70'; ctx.beginPath(); ctx.arc(cx, cy - ts * 0.6 - lift, ts * 0.45, Math.PI, 0); ctx.fill(); }
    ctx.globalAlpha = 1;
  }

  // draws a courier centred at 0,0 with size s
  creature(c, s, carrying, dir) {
    const ctx = this.ctx;
    const e = (x, y, rx, ry, col) => { ctx.beginPath(); ctx.ellipse(x * s, y * s, rx * s, ry * s, 0, 0, TAU); ctx.fillStyle = col; ctx.fill(); };
    if (c.id === 'hornbill') {
      e(0, 0.3, 0.15, 0.12, '#FFFFFF');                  // tail
      ctx.fillStyle = '#26222B'; ctx.fillRect(-0.15 * s, 0.3 * s, 0.3 * s, 0.04 * s);
      e(-0.33, 0.06, 0.12, 0.2, '#3A3442'); e(0.33, 0.06, 0.12, 0.2, '#3A3442'); // wings
      e(0, 0.06, 0.34, 0.26, '#26222B');                  // body
      e(0, -0.2, 0.22, 0.16, '#26222B');                  // head
      e(0, -0.44, 0.1, 0.17, '#FFC94A');                  // beak
      e(-0.02, -0.5, 0.14, 0.08, '#F28C38');              // casque
      e(-0.09, -0.22, 0.05, 0.04, '#FFFFFF'); e(0.09, -0.22, 0.05, 0.04, '#FFFFFF');
      e(-0.08, -0.215, 0.025, 0.025, '#2A1B3D'); e(0.1, -0.215, 0.025, 0.025, '#2A1B3D');
      if (carrying) this.kuih(-0.13 * s, -0.84 * s, 0.26 * s);
      return;
    }
    e(0, 0.06, 0.34, 0.3, c.body);
    e(0, -0.2, 0.24, 0.2, c.body);
    if (c.id === 'pangolin') { ctx.strokeStyle = c.accent; ctx.lineWidth = 2; for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(0, (-0.05 + i * 0.09) * s, 0.22 * s, 0.2 * Math.PI, 0.8 * Math.PI); ctx.stroke(); } e(0, -0.38, 0.08, 0.06, c.accent); }
    if (c.id === 'proboscis') { e(0, -0.16, 0.16, 0.13, c.accent); e(0, -0.08, 0.07, 0.09, '#D9805A'); }
    if (c.id === 'orangutan') { e(-0.3, 0.1, 0.14, 0.2, c.accent); e(0.3, 0.1, 0.14, 0.2, c.accent); e(0, -0.17, 0.15, 0.12, '#E9A27A'); }
    if (c.id === 'sunbear') { ctx.beginPath(); ctx.arc(0, 0.02 * s, 0.17 * s, 0.1 * Math.PI, 0.9 * Math.PI); ctx.lineWidth = 0.06 * s; ctx.strokeStyle = c.accent; ctx.stroke(); e(0, -0.13, 0.1, 0.08, '#C9A27A'); e(-0.18, -0.36, 0.06, 0.06, c.body); e(0.18, -0.36, 0.06, 0.06, c.body); }
    e(-0.09, -0.24, 0.045, 0.04, '#FFFFFF'); e(0.09, -0.24, 0.045, 0.04, '#FFFFFF');
    e(-0.08, -0.235, 0.022, 0.022, '#2A1B3D'); e(0.1, -0.235, 0.022, 0.022, '#2A1B3D');
    if (carrying) this.kuih(-0.13 * s, -0.7 * s, 0.26 * s);
  }

  // ---------------- effects ----------------
  drawParticles(game) {
    const ts = this.ts, ctx = this.ctx;
    for (const q of game.particles) {
      ctx.globalAlpha = Math.max(0, Math.min(1, q.life / 0.5));
      const X = this.sx(q.c), Y = this.sy(q.v);
      if (q.kind === 'petals' || q.kind === 'crumbs') { ctx.fillStyle = q.color; ctx.fillRect(X, Y, q.size * ts, q.size * ts * 0.7); }
      else this.circle(X, Y, q.size * ts * 0.6, q.color);
    }
    ctx.globalAlpha = 1;
  }

  drawFlood(game) {
    if (!game.flood.active && game.flood.level < -1) return;
    const ctx = this.ctx, W = this.W, H = this.H, ts = this.ts;
    const top = this.sy(game.flood.level);
    if (top > H + 20) return;
    ctx.fillStyle = this.cb ? 'rgba(0,70,140,0.88)' : 'rgba(31,122,128,0.88)';
    ctx.fillRect(0, top, W, H - top + 20);
    // wave edge
    const amp = ts * 0.12, len = ts * 0.7, ph = this.now / 260;
    ctx.beginPath(); ctx.moveTo(0, top);
    for (let x = 0; x <= W + len; x += len / 4) ctx.lineTo(x, top - amp * (0.5 + 0.5 * Math.sin(x / len * TAU + ph)));
    ctx.lineTo(W, top + 2); ctx.lineTo(0, top + 2); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3; ctx.beginPath();
    for (let x = 0; x <= W + len; x += len / 4) { const yy = top - amp * (0.5 + 0.5 * Math.sin(x / len * TAU + ph)); x === 0 ? ctx.moveTo(x, yy) : ctx.lineTo(x, yy); }
    ctx.stroke();
    if (top < H - 40) { ctx.fillStyle = '#FFFFFF'; ctx.font = `700 ${Math.round(Math.max(13, ts * 0.3))}px Fredoka, sans-serif`; ctx.textAlign = 'left'; ctx.textBaseline = 'top'; ctx.fillText('BANJIR', 16, top + 12); }
  }

  drawRain(game) {
    const gap = game.floodGap();
    if (!game.flood.active || gap > 3.2 || game.dead || game.settings.reduceMotion) return;
    const ctx = this.ctx, W = this.W, H = this.H, n = Math.round((3.2 - gap) * 40);
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5; ctx.beginPath();
    const t = this.now / 1000;
    for (let i = 0; i < n; i++) {
      const x = ((i * 97.3 + t * 300) % (W + 60)) - 30, y = ((i * 57.1 + t * 900) % (H + 60)) - 30;
      ctx.moveTo(x, y); ctx.lineTo(x - 6, y + 16);
    }
    ctx.stroke();
  }

  drawLights(game, r, tod) {
    const L = game.lane(r); if (!L) return;
    const ts = this.ts, y = this.sy(r + 0.5), ctx = this.ctx, a = Math.min(1, tod) * 0.55;
    const glow = (x, yy, rad, col) => { const g = ctx.createRadialGradient(x, yy, 0, x, yy, rad); g.addColorStop(0, col); g.addColorStop(1, 'rgba(0,0,0,0)'); ctx.fillStyle = g; ctx.fillRect(x - rad, yy - rad, rad * 2, rad * 2); };
    for (const e of L.ents) {
      if (e.type === 'moto' || e.type === 'trishaw') { const hx = this.sx(e.speed > 0 ? e.x + e.w + 0.8 : e.x - 0.8); glow(hx, y + ts * 0.5, ts * 1.2, `rgba(255,214,120,${a})`); }
      if (e.type === 'cart') glow(this.sx(e.x + e.w / 2), y + ts * 0.2, ts * 1.1, `rgba(255,201,74,${a})`);
    }
    if (L.obstacleType === 'lamp') for (const c of L.block) glow(this.sx(c + 0.5), y + ts * 0.22, ts * 1.4, `rgba(255,201,74,${a})`);
    if (L.goal) glow(this.sx(L.goal.col + 0.5), y + ts * 0.3, ts * 1.6, `rgba(255,201,74,${a})`);
    if (game.p.row === r && game.flood.active !== undefined && this.showPlayer !== false) glow(this.sx(game.pos().c), y + ts * 0.5, ts * 1.5, `rgba(255,241,220,${a * 0.6})`);
  }

  drawBeat(game, phase) {
    const ctx = this.ctx, ts = this.ts, pos = game.pos();
    const cx = this.sx(pos.c), cy = this.sy(pos.v);
    const k = 1 - phase; // 1 at the beat, shrinking towards the next
    const near = Math.min(phase, 1 - phase);
    ctx.strokeStyle = near < 0.14 ? 'rgba(217,79,112,0.9)' : 'rgba(255,255,255,0.45)';
    ctx.lineWidth = near < 0.14 ? 4 : 2;
    ctx.beginPath(); ctx.arc(cx, cy, ts * (0.5 + 0.45 * (1 - k)), 0, TAU); ctx.stroke();
  }
}
