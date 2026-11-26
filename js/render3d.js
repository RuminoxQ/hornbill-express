// Hornbill Express · © 2026 Kiu Kwan Tai. All rights reserved.
// 3D voxel renderer (Three.js): angled orthographic camera, lanes run diagonally across the screen.
// World units: 1 = one tile. x = column (lanes run along x), z = -row (forward is -z), y = up.
import * as THREE from '../vendor/three.module.min.js';
import { COLS, COURIERS, VEHICLE_COLORS, CB_VEHICLE_COLORS } from './config.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const mats = new Map();
function mat(color, emissive) {
  const k = color + (emissive ? '*' : '');
  if (!mats.has(k)) {
    const m = emissive ? new THREE.MeshBasicMaterial({ color }) : new THREE.MeshLambertMaterial({ color });
    mats.set(k, m);
  }
  return mats.get(k);
}
// one voxel: centre-bottom anchored at (x, y, z), size (w, h, d)
function vox(parent, x, y, z, w, h, d, color, opts = {}) {
  const m = new THREE.Mesh(BOX, opts.material || mat(color, opts.emissive));
  m.scale.set(w, h, d);
  m.position.set(x, y + h / 2, z);
  m.castShadow = opts.shadow !== false;
  m.receiveShadow = !!opts.receive;
  parent.add(m);
  return m;
}


// Merge every unit-box voxel inside `src` into one mesh per material (far fewer draw calls).
function mergeInto(src, dest, { shadow = true, receive = true } = {}) {
  src.updateMatrixWorld(true);
  const byMat = new Map();
  src.traverse((o) => { if (o.isMesh && o.geometry === BOX) { if (!byMat.has(o.material)) byMat.set(o.material, []); byMat.get(o.material).push(o); } });
  const P = BOX.attributes.position, N = BOX.attributes.normal, I = BOX.index;
  const v = new THREE.Vector3(), nm = new THREE.Matrix3();
  for (const [m, list] of byMat) {
    const pos = new Float32Array(list.length * P.count * 3), nor = new Float32Array(list.length * P.count * 3);
    const idx = new (list.length * P.count > 65535 ? Uint32Array : Uint16Array)(list.length * I.count);
    list.forEach((o, k) => {
      nm.getNormalMatrix(o.matrixWorld);
      for (let i = 0; i < P.count; i++) {
        v.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); pos.set([v.x, v.y, v.z], (k * P.count + i) * 3);
        v.fromBufferAttribute(N, i).applyMatrix3(nm).normalize(); nor.set([v.x, v.y, v.z], (k * P.count + i) * 3);
      }
      for (let i = 0; i < I.count; i++) idx[k * I.count + i] = I.getX(i) + k * P.count;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = shadow && !(m.isMeshBasicMaterial); mesh.receiveShadow = receive;
    dest.add(mesh);
  }
  // keep non-voxel children (sprites, rings)
  [...src.children].forEach((o) => { if (!(o.isMesh && o.geometry === BOX)) dest.add(o); });
  return dest;
}

const TOP = { padi: 0, start: 0, prom: 0, goal: 0, road: -0.08, market: -0.05, river: -0.32, roofs: -0.35, split: -0.35 };
const DAY = { padi: '#9FD15A', padi2: '#93C750', road: '#6E5C68', market: '#8A5A44', river: '#2A8C93', roofs: '#3B2D3F', prom: '#EBD3B0', goal: '#FFE3B8', start: '#EBD3B0' };

function textSprite(text, bg, fg, scale = 1) {
  const cv = document.createElement('canvas');
  const ctx = cv.getContext('2d');
  const font = '700 44px Fredoka, "Trebuchet MS", sans-serif';
  ctx.font = font;
  const w = Math.ceil(ctx.measureText(text).width) + 48;
  cv.width = w; cv.height = 72;
  ctx.font = font;
  ctx.fillStyle = bg; const r = 36;
  ctx.beginPath(); ctx.moveTo(r, 0); ctx.arcTo(w, 0, w, 72, r); ctx.arcTo(w, 72, 0, 72, r); ctx.arcTo(0, 72, 0, 0, r); ctx.arcTo(0, 0, w, 0, r); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, w / 2, 38);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set((w / 72) * 0.55 * scale, 0.55 * scale, 1);
  sp.renderOrder = 10;
  return sp;
}

let glowTex = null;
function glowSprite(color, size) {
  if (!glowTex) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const g = cv.getContext('2d'); const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    glowTex = new THREE.CanvasTexture(cv);
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  sp.scale.set(size, size, 1);
  sp.userData.glow = true;
  return sp;
}

// ------------------------------------------------------------------ models
export function buildCourier(id) {
  const gold = id === 'golden';
  const c = gold ? { id: 'hornbill' } : (COURIERS.find((k) => k.id === id) || COURIERS[0]);
  const K = gold ? { b: '#D9A21B', w: '#B8860B', t: '#FFF1A8', k: '#FFF1A8', c: '#FF7A1A' } : { b: '#26222B', w: '#3A3442', t: '#FFFFFF', k: '#FFC94A', c: '#F28C38' };
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body); g.userData.body = body;
  if (c.id === 'hornbill') {
    vox(body, 0, 0.08, 0.05, 0.56, 0.46, 0.62, K.b);                     // body
    vox(body, 0, 0.12, 0.42, 0.34, 0.12, 0.26, K.t);                     // tail
    vox(body, 0, 0.12, 0.52, 0.34, 0.05, 0.1, K.b);                      // tail band
    vox(body, -0.32, 0.16, 0.05, 0.1, 0.3, 0.44, K.w);                   // wings
    vox(body, 0.32, 0.16, 0.05, 0.1, 0.3, 0.44, K.w);
    vox(body, 0, 0.42, -0.18, 0.4, 0.36, 0.38, K.b);                     // head
    vox(body, 0, 0.5, -0.52, 0.16, 0.16, 0.36, K.k);                     // beak
    vox(body, 0, 0.66, -0.44, 0.14, 0.12, 0.3, K.c);                     // casque
    vox(body, -0.21, 0.6, -0.24, 0.03, 0.1, 0.1, '#FFFFFF'); vox(body, 0.21, 0.6, -0.24, 0.03, 0.1, 0.1, '#FFFFFF');
    vox(body, -0.225, 0.62, -0.26, 0.02, 0.05, 0.05, '#2A1B3D'); vox(body, 0.225, 0.62, -0.26, 0.02, 0.05, 0.05, '#2A1B3D');
    vox(body, -0.12, 0, 0.05, 0.08, 0.1, 0.1, '#FFC94A'); vox(body, 0.12, 0, 0.05, 0.08, 0.1, 0.1, '#FFC94A');
  } else {
    vox(body, 0, 0.06, 0.05, 0.56, 0.44, 0.6, c.body);
    vox(body, 0, 0.42, -0.14, 0.44, 0.38, 0.4, c.body);
    if (c.id === 'pangolin') { for (let i = 0; i < 3; i++) vox(body, 0, 0.5 - i * 0.02, 0.1 + i * 0.16, 0.6, 0.06, 0.1, c.accent); vox(body, 0, 0.42, -0.4, 0.16, 0.14, 0.14, c.accent); }
    if (c.id === 'proboscis') { vox(body, 0, 0.42, -0.36, 0.3, 0.26, 0.06, c.accent); vox(body, 0, 0.36, -0.42, 0.14, 0.2, 0.12, '#D9805A'); }
    if (c.id === 'orangutan') { vox(body, -0.34, 0.08, 0.05, 0.14, 0.4, 0.3, c.accent); vox(body, 0.34, 0.08, 0.05, 0.14, 0.4, 0.3, c.accent); vox(body, 0, 0.44, -0.35, 0.3, 0.24, 0.04, '#E9A27A'); }
    if (c.id === 'sunbear') { vox(body, 0, 0.3, -0.26, 0.36, 0.08, 0.04, c.accent); vox(body, -0.17, 0.78, -0.14, 0.1, 0.1, 0.1, c.body); vox(body, 0.17, 0.78, -0.14, 0.1, 0.1, 0.1, c.body); vox(body, 0, 0.44, -0.36, 0.18, 0.14, 0.06, '#C9A27A'); }
    vox(body, -0.12, 0.6, -0.35, 0.08, 0.08, 0.02, '#FFFFFF'); vox(body, 0.12, 0.6, -0.35, 0.08, 0.08, 0.02, '#FFFFFF');
    vox(body, -0.12, 0.61, -0.36, 0.04, 0.04, 0.02, '#2A1B3D'); vox(body, 0.12, 0.61, -0.36, 0.04, 0.04, 0.02, '#2A1B3D');
  }
  // carried kuih (toggled)
  const k = new THREE.Group();
  ['#D94F70', '#FFC94A', '#7FB24A'].forEach((col, i) => vox(k, 0, i * 0.07, 0, 0.26, 0.07, 0.26, col));
  k.position.set(0, 0.86, -0.3); k.visible = false; body.add(k); g.userData.kuih = k;
  const helmet = new THREE.Group();
  vox(helmet, 0, 0, 0, 0.46, 0.12, 0.44, '#FFC94A'); vox(helmet, 0, 0.12, 0, 0.32, 0.08, 0.3, '#E2A92A');
  helmet.position.set(0, 0.78, -0.18); helmet.visible = false; body.add(helmet); g.userData.helmet = helmet;
  const umb = new THREE.Group();
  vox(umb, 0, 0, 0, 0.04, 0.7, 0.04, '#3A3442'); vox(umb, 0, 0.7, 0, 1.0, 0.1, 1.0, '#D94F70'); vox(umb, 0, 0.8, 0, 0.6, 0.08, 0.6, '#E8758F');
  umb.position.set(0.3, 0.6, 0.1); umb.visible = false; body.add(umb); g.userData.umbrella = umb;
  return g;
}

const vehCache = new Map();
function vehicle(e, cb) {
  const list0 = cb ? CB_VEHICLE_COLORS : VEHICLE_COLORS;
  const key = [e.type, e.w.toFixed(2), list0[(e.id || 0) % list0.length], Math.sign(e.speed), e.type === 'boat' ? e.id % 7 : 0].join('|');
  if (!vehCache.has(key)) vehCache.set(key, mergeInto(vehicleRaw(e, cb), new THREE.Group(), { receive: e.type === 'boat' || e.type === 'tambang' }));
  const out = new THREE.Group();
  vehCache.get(key).children.forEach((m) => { const c = new THREE.Mesh(m.geometry, m.material); c.castShadow = m.castShadow; c.receiveShadow = m.receiveShadow; out.add(c); });
  return out;
}
function vehicleRaw(e, cb) {
  const g = new THREE.Group();
  const list = cb ? CB_VEHICLE_COLORS : VEHICLE_COLORS;
  const col = list[(e.id || 0) % list.length];
  const w = e.w, dir = e.speed > 0 ? 1 : -1;
  const front = (w / 2 - 0.08) * dir;
  if (e.type === 'moto') {
    vox(g, 0, 0.12, 0, w, 0.26, 0.38, col);
    vox(g, -0.12 * dir, 0.38, 0, 0.3, 0.06, 0.3, '#2A1B3D');
    vox(g, -0.1 * dir, 0.44, 0, 0.22, 0.26, 0.26, '#3F6FB0');            // rider
    vox(g, -0.1 * dir, 0.7, 0, 0.26, 0.24, 0.26, '#F4F1EA');             // helmet
    vox(g, w / 2 * dir * 0.85, 0, 0, 0.18, 0.18, 0.12, '#2A2A2A'); vox(g, -w / 2 * dir * 0.85, 0, 0, 0.18, 0.18, 0.12, '#2A2A2A');
    vox(g, front, 0.22, 0, 0.06, 0.1, 0.16, '#FFF6C8', { emissive: true, shadow: false });
  } else if (e.type === 'trishaw') {
    vox(g, 0, 0.1, 0, w, 0.22, 0.7, '#5B4A3F');
    vox(g, front * 0.35, 0.32, 0, w * 0.5, 0.4, 0.66, col);
    vox(g, front * 0.35, 0.72, 0, w * 0.56, 0.08, 0.74, col);
    vox(g, -front * 0.7, 0.32, 0, 0.26, 0.3, 0.26, '#7A5A9E');
    vox(g, -front * 0.7, 0.62, 0, 0.24, 0.22, 0.24, '#F4F1EA');
    vox(g, front, 0.18, 0, 0.06, 0.1, 0.2, '#FFF6C8', { emissive: true, shadow: false });
  } else if (e.type === 'cart') {
    vox(g, 0, 0.12, 0, w - 0.1, 0.5, 0.72, '#E9D2B0');
    for (let i = 0; i < 6; i++) vox(g, -w / 2 + (i + 0.5) * w / 6, 0.85, 0, w / 6, 0.1, 0.86, i % 2 ? '#FFF1DC' : col);
    vox(g, -w / 2 + 0.1, 0.62, 0.3, 0.06, 0.24, 0.06, '#5B4A3F'); vox(g, w / 2 - 0.1, 0.62, 0.3, 0.06, 0.24, 0.06, '#5B4A3F');
    for (let i = 0; i < 5; i++) vox(g, -w / 2 + 0.2 + i * (w - 0.4) / 4, 0.78, -0.42, 0.07, 0.07, 0.07, '#FFE08A', { emissive: true, shadow: false });
  } else if (e.type === 'cyclist') {
    vox(g, 0, 0.1, 0, w, 0.06, 0.08, '#3A3442');
    vox(g, -w / 2 + 0.1, 0, 0, 0.2, 0.2, 0.06, '#2A2A2A'); vox(g, w / 2 - 0.1, 0, 0, 0.2, 0.2, 0.06, '#2A2A2A');
    vox(g, 0, 0.18, 0, 0.2, 0.3, 0.2, col);
    vox(g, 0, 0.48, 0, 0.2, 0.2, 0.2, '#E9B98E');
  } else if (e.type === 'boat') {
    vox(g, 0, 0, 0, w, 0.2, 0.74, '#6E4528', { receive: true });
    vox(g, 0, 0.2, 0, w - 0.18, 0.06, 0.6, '#8B5A3C', { receive: true });
    vox(g, w / 2 - 0.06, 0.2, 0, 0.12, 0.14, 0.4, '#6E4528'); vox(g, -w / 2 + 0.06, 0.2, 0, 0.12, 0.14, 0.4, '#6E4528');
    const n = Math.max(1, Math.floor(w) - 1);
    for (let i = 0; i < n; i++) { const x = -w / 2 + (i + 1) * w / (n + 1); vox(g, x, 0.26, 0.18, 0.18, 0.2, 0.18, ['#FFC94A', '#D94F70', '#FFF1DC'][((e.id % 7) + i) % 3]); }
  } else if (e.type === 'tambang') {
    vox(g, 0, 0, 0, w, 0.26, 0.82, '#F4F1EA', { receive: true });
    vox(g, 0, 0.26, 0, w - 0.3, 0.06, 0.7, '#D8D2C4', { receive: true });
    vox(g, w * 0.15, 0.32, 0, w * 0.45, 0.06, 0.74, '#1F7A80');
    vox(g, w * 0.15 - w * 0.2, 0.0, 0.3, 0.05, 0.36, 0.05, '#1F7A80'); vox(g, w * 0.15 + w * 0.2, 0.0, 0.3, 0.05, 0.36, 0.05, '#1F7A80');
  }
  g.position.y = 0;
  return g;
}

function croc() {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  vox(body, 0, 0, 0, 1.3, 0.2, 0.46, '#4E7A3A');
  for (let i = 0; i < 4; i++) vox(body, -0.45 + i * 0.25, 0.2, 0, 0.12, 0.06, 0.18, '#3E6530');
  vox(body, 0.75, 0, 0, 0.4, 0.14, 0.34, '#5E8C46');
  const eyes = new THREE.Group(); g.add(eyes);
  vox(eyes, 0.62, 0.16, -0.12, 0.1, 0.1, 0.1, '#FFC94A', { shadow: false }); vox(eyes, 0.62, 0.16, 0.12, 0.1, 0.1, 0.1, '#FFC94A', { shadow: false });
  g.userData.body = body; g.userData.eyes = eyes;
  return g;
}

function pickupModel(it) {
  const g = new THREE.Group();
  const inner = new THREE.Group(); g.add(inner); g.userData.spin = inner;
  if (it.type === 'tip') {
    vox(inner, 0, 0, 0, 0.36, 0.36, 0.08, '#FFC94A'); vox(inner, 0, 0.1, 0, 0.16, 0.16, 0.1, '#E2A92A');
  } else if (it.type === 'kuih') {
    ['#D94F70', '#FFC94A', '#7FB24A', '#D94F70'].forEach((c, i) => vox(inner, 0, i * 0.1, 0, 0.44, 0.1, 0.44, c));
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 24), new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
    ring.rotation.x = -Math.PI / 2; ring.position.y = -0.3; g.add(ring); g.userData.ring = ring;
  } else if (it.type === 'power') {
    const id = it.id;
    if (id === 'durian') { vox(inner, 0, 0, 0, 0.42, 0.42, 0.42, '#9DB33E'); for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; vox(inner, Math.cos(a) * 0.24, 0.16, Math.sin(a) * 0.24, 0.08, 0.08, 0.08, '#7E922E'); } }
    if (id === 'payung') { vox(inner, 0, 0, 0, 0.04, 0.4, 0.04, '#3A3442'); vox(inner, 0, 0.4, 0, 0.6, 0.08, 0.6, '#D94F70'); vox(inner, 0, 0.48, 0, 0.34, 0.06, 0.34, '#E8758F'); }
    if (id === 'wau') { const d = vox(inner, 0, 0, 0, 0.36, 0.36, 0.06, '#F28C38'); d.rotation.z = Math.PI / 4; vox(inner, 0, -0.06, 0.04, 0.04, 0.5, 0.02, '#FFFFFF'); }
    if (id === 'teh') { vox(inner, 0, 0, 0, 0.32, 0.4, 0.32, '#B07A4F'); vox(inner, 0, 0.4, 0, 0.32, 0.08, 0.32, '#F4E1C1'); vox(inner, 0.2, 0.12, 0, 0.08, 0.18, 0.06, '#B07A4F'); }
    if (id === 'helmet') { vox(inner, 0, 0, 0, 0.46, 0.14, 0.46, '#FFC94A'); vox(inner, 0, 0.14, 0, 0.32, 0.12, 0.32, '#E2A92A'); }
    if (id === 'tiffin') { for (let i = 0; i < 3; i++) vox(inner, 0, i * 0.15, 0, 0.36, 0.13, 0.36, i % 2 ? '#3FA7A8' : '#1F7A80'); vox(inner, 0, 0.45, 0, 0.06, 0.12, 0.3, '#B8C2C8'); }
    const glow = glowSprite('#FFF1C0', 1.2); glow.material.opacity = 0.5; glow.position.y = 0.2; g.add(glow); glow.userData.glow = false;
  } else if (it.type === 'life') {
    const H = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
    const s = 0.08;
    H.forEach((row, j) => [...row].forEach((ch, i) => { if (ch === 'X') vox(inner, (i - 3) * s, (5 - j) * s, 0, s, s, 0.12, '#E23B5A'); }));
    const glow = glowSprite('#FF8FA3', 1.1); glow.material.opacity = 0.55; glow.position.y = 0.25; g.add(glow); glow.userData.glow = false;
  } else if (it.type === 'stamp') {
    vox(inner, 0, 0, 0, 0.46, 0.46, 0.04, '#FFF1DC'); vox(inner, 0, 0.15, 0.03, 0.16, 0.16, 0.02, '#D94F70');
    vox(inner, 0, 0.02, 0.025, 0.38, 0.03, 0.01, '#C46A1F'); vox(inner, 0, 0.41, 0.025, 0.38, 0.03, 0.01, '#C46A1F');
  }
  inner.position.y = 0.3;
  return g;
}

// small tufts in the verge left of the board (3x5 cells, 3 glyphs)
const VG = [[1,0,1,1,1,0,1,0,0,1,1,0,1,0,1], [1,0,1,1,1,0,1,0,0,1,1,0,1,0,1], [1,1,1,0,1,0,0,1,0,0,1,0,0,1,0]];
function verge(g, top) {
  VG.forEach((bits, k) => bits.forEach((b, i) => {
    if (!b) return;
    const col = i % 3, row = Math.floor(i / 3);
    vox(g, -9.2 + k * 0.95 + col * 0.24, top, -0.42 + row * 0.2, 0.18, 0.05, 0.16, '#6E8F3C', { shadow: false });
  }));
}

// ------------------------------------------------------------------ renderer
export class Renderer3D {
  constructor(canvas) {
    this.cv = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.r.shadowMap.enabled = true;
    this.r.shadowMap.type = THREE.PCFSoftShadowMap;
    this.r.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-5, 5, 5, -5, 0.1, 200);
    this.offset = new THREE.Vector3(-3.6, 13, 8.6);   // angled view: lanes run diagonally up-right
    this.hemi = new THREE.HemisphereLight('#FFF4E0', '#6E7F96', 1.15);
    this.sun = new THREE.DirectionalLight('#FFFFFF', 1.7);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    Object.assign(this.sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.hemi, this.sun, this.sun.target);
    this.world = new THREE.Group(); this.scene.add(this.world);
    // deep base under everything, so nothing shows the sky (e.g. under the flood or behind the start)
    this.base = vox(this.scene, COLS / 2, -1.6, 0, COLS + 60, 0.6, 400, '#1E4A50', { shadow: false });
    this.lanes = new Map();
    this.camV = 0; this.camC = COLS / 2;
    this.player = null; this.playerId = null;
    this.flood = this.makeFlood();
    this.particles = this.makeParticles();
    this.rain = this.makeRain();
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.54, 32), new THREE.MeshBasicMaterial({ color: '#FFFFFF', transparent: true, opacity: 0.6, depthWrite: false }));
    this.ring.rotation.x = -Math.PI / 2; this.scene.add(this.ring);
    this.magnet = new THREE.Mesh(new THREE.RingGeometry(2.1, 2.2, 48), new THREE.MeshBasicMaterial({ color: '#3FA7A8', transparent: true, opacity: 0.7, depthWrite: false }));
    this.magnet.rotation.x = -Math.PI / 2; this.scene.add(this.magnet);
    this.bg = new THREE.Color('#2A1B3D');
    this.resize();
  }

  resize() {
    const W = this.cv.clientWidth || window.innerWidth, H = this.cv.clientHeight || window.innerHeight;
    this.W = W; this.H = H;
    const big = W * H > 1400 * 900;
    this.r.setPixelRatio(Math.min(big ? 1.5 : 2, window.devicePixelRatio || 1));
    this.r.setSize(W, H, false);
    // world units visible across: ~9.5 tiles on a phone, more on wide screens
    const across = W > H ? Math.min(21, 10.5 * (W / H)) : 10.2;
    this.viewCols = across;
    const hw = across / 2, hh = hw * H / W;
    Object.assign(this.cam, { left: -hw, right: hw, top: hh, bottom: -hh });
    this.cam.updateProjectionMatrix();
  }

  follow(game, dt, snap) {
    const pos = game.pos();
    const targetV = Math.max(pos.v, 2);
    const vis = this.viewCols * 0.9;
    const targetC = vis >= COLS + 1 ? COLS / 2 : Math.max(vis / 2 - 0.5, Math.min(COLS - vis / 2 + 0.5, pos.c));
    const k = snap ? 1 : 1 - Math.exp(-dt * 5);
    this.camV += (targetV - this.camV) * k;
    this.camC += (targetC - this.camC) * k;
  }

  // ---------------------------------------------------------------- lanes
  laneColor(L) {
    if (L.kind === 'padi') return L.variant ? DAY.padi : DAY.padi2;
    if (L.kind === 'split') return DAY.roofs;
    return DAY[L.kind] || DAY.padi;
  }

  buildLane(game, r) {
    const L = game.lane(r);
    const g = new THREE.Group();
    const s = new THREE.Group();   // static voxels, merged at the end
    g.position.z = -r;
    const top = TOP[L.kind] ?? 0;
    const col = this.laneColor(L);
    const dark = '#' + new THREE.Color(col).multiplyScalar(0.62).getHexString();
    const ground = (x0, x1, c, y = top) => vox(s, (x0 + x1) / 2, y - 0.8, 0, x1 - x0, 0.8, 1.001, c, { shadow: false, receive: true });
    ground(-14, 0, dark); ground(COLS, COLS + 14, dark);
    if (L.kind === 'roofs' || L.kind === 'split') {
      for (let c = 0; c < COLS; c++) {
        const kind = L.splitKinds ? L.splitKinds[c] : 'roof';
        if (kind === 'channel') { ground(c, c + 1, '#2A8C93', TOP.river); continue; }
        if (kind === 'prom') { ground(c, c + 1, DAY.prom, 0); continue; }
        ground(c, c + 1, DAY.roofs);
        if (L.cells[c]) {
          const rc = (c + r) % 3 === 0 ? '#9AA3AE' : '#C8553D';
          vox(s, c + 0.5, top, 0, 1.001, 0.38, 0.96, rc, { receive: true });
          vox(s, c + 0.5, top + 0.38, 0, 1.001, 0.08, 0.2, '#' + new THREE.Color(rc).multiplyScalar(0.8).getHexString(), { receive: true });
        }
      }
    } else {
      ground(0, COLS, col);
    }
    if (L.kind === 'river') {
      const water = vox(s, COLS / 2, top + 0.14, 0, COLS + 28, 0.04, 1.001, '#3FB3C0', { shadow: false });
      water.material = new THREE.MeshLambertMaterial({ color: '#3FB3C0', transparent: true, opacity: 0.85 });
      g.userData.water = water;
    }
    if (L.kind === 'padi') for (let c = (r % 2); c < COLS; c += 3) vox(s, c + 0.5, top, -0.3, 0.08, 0.06, 0.08, '#7FAE45', { shadow: false });
    if (L.kind === 'road') {
      const nr = game.lane(r + 1);
      if (nr && nr.kind === 'road') for (let c = -4; c < COLS + 4; c += 1.5) vox(s, c, top, -0.5, 0.6, 0.02, 0.08, '#E9DCC4', { shadow: false });
    }
    if (L.kind === 'prom' || L.kind === 'start') vox(s, COLS / 2, top, -0.49, COLS, 0.01, 0.03, '#D8BE98', { shadow: false });
    // static obstacles
    for (const c of L.block) {
      const x = c + 0.5;
      if (L.obstacleType === 'lamp') {
        vox(s, x, top, 0, 0.12, 1.1, 0.12, '#3A3442');
        vox(s, x, top + 1.1, 0, 0.26, 0.2, 0.26, '#FFC94A', { emissive: true });
        const gl = glowSprite('#FFC94A', 2.6); gl.position.set(x, top + 1.2, 0); g.add(gl);
      } else {
        const tall = (c * 7 + r * 3) % 3 === 0 ? 1.4 : 1;
        vox(s, x, top, 0, 0.26, 0.4, 0.26, '#7A4E2D');
        vox(s, x, top + 0.4, 0, 0.82, 0.6 * tall, 0.82, '#3E8E5A');
        vox(s, x, top + 0.4 + 0.6 * tall, 0, 0.56, 0.3, 0.56, '#58A86F');
      }
    }
    // goal stall
    if (L.goal) {
      const x = L.goal.col + 0.5;
      vox(s, x, top, 0.05, 0.9, 0.55, 0.7, '#E9D2B0');
      vox(s, x, top + 0.55, 0.05, 0.94, 0.06, 0.74, '#C9A97E');
      for (let i = 0; i < 5; i++) vox(s, x - 0.45 + (i + 0.5) * 0.18, top + 0.95, 0.05, 0.18, 0.1, 0.86, i % 2 ? '#FFF1DC' : '#D94F70');
      vox(s, x - 0.4, top + 0.55, 0.38, 0.06, 0.4, 0.06, '#5B4A3F'); vox(s, x + 0.4, top + 0.55, 0.38, 0.06, 0.4, 0.06, '#5B4A3F');
      vox(s, x, top + 0.6, -0.1, 0.24, 0.16, 0.24, '#D94F70');
      const sign = textSprite('DELIVER HERE', '#F28C38', '#FFFFFF', 0.9); sign.position.set(x, top + 1.7, 0); sign.visible = false; g.add(sign);
      g.userData.sign = sign;
      const gl = glowSprite('#FFC94A', 3); gl.position.set(x, top + 1, 0); g.add(gl);
    }
    if (L.forkSign) {
      const half = Math.floor(COLS / 2);
      const a = textSprite('◀ Rooftops · tips ×2', '#C8553D', '#FFFFFF', 0.8); a.position.set(half / 2, 0.9, 0.6); g.add(a);
      const b = textSprite('Waterfront · safe ▶', '#FFF1DC', '#2A1B3D', 0.8); b.position.set(half + 1 + half / 2, 0.9, 0.6); g.add(b);
    }
    mergeInto(s, g);
    if (r % 500 === 88) verge(g, top);
    g.userData.top = top;
    g.userData.ents = new Map();
    g.userData.picks = new Map();
    this.world.add(g);
    return g;
  }

  syncLane(game, r, g, t) {
    const L = game.lane(r);
    const top = g.userData.top;
    // moving things
    const em = g.userData.ents;
    for (const e of L.ents) {
      let m = em.get(e);
      if (!m) { m = vehicle(e, this.cb); em.set(e, m); g.add(m); }
      m.position.x = e.x + e.w / 2;
      const float = e.type === 'boat' || e.type === 'tambang';
      m.position.y = float ? TOP.river + 0.08 + Math.sin(t * 2 + e.id) * 0.02 : top;
      if (e.type === 'moto' || e.type === 'trishaw') {
        if (!m.userData.glow) { const gl = glowSprite('#FFE6A0', 2.4); gl.position.set((e.w / 2 + 0.6) * Math.sign(e.speed), 0.3, 0); m.add(gl); m.userData.glow = gl; }
      }
    }
    for (const e of L.crocs) {
      let m = em.get(e);
      if (!m) { m = croc(); em.set(e, m); g.add(m); m.rotation.y = e.speed > 0 ? 0 : Math.PI; }
      const up = game.crocUp(e) && game.crocDistract <= 0;
      m.position.x = e.x + e.w / 2;
      const ty = up ? TOP.river + 0.04 : TOP.river - 0.2;
      m.position.y += (ty - m.position.y) * 0.2;
      m.userData.body.visible = up || m.position.y > TOP.river - 0.12;
    }
    // pickups
    const pm = g.userData.picks;
    for (const [c, it] of L.pick) {
      let m = pm.get(c);
      if (!m || m.userData.item !== it) { if (m) g.remove(m); m = pickupModel(it); m.userData.item = it; pm.set(c, m); g.add(m); m.position.set(c + 0.5, top, 0); }
      const s = m.userData.spin;
      s.position.y = 0.3 + Math.sin(t * 3 + c) * 0.06;
      if (it.type === 'tip' || it.type === 'stamp' || it.type === 'life') s.rotation.y = t * 2 + c;
      else s.rotation.y = Math.sin(t + c) * 0.5;
      if (m.userData.ring) { const k = 1 + Math.sin(t * 5) * 0.08; m.userData.ring.scale.set(k, k, k); }
    }
    for (const [c, m] of pm) if (!L.pick.has(c) || L.pick.get(c) !== m.userData.item) { g.remove(m); pm.delete(c); }
    if (g.userData.sign) g.userData.sign.visible = !!(game.order && game.order.goalRow === r);
  }

  // ---------------------------------------------------------------- effects
  makeFlood() {
    const g = new THREE.Group();
    const water = new THREE.Mesh(BOX, new THREE.MeshLambertMaterial({ color: '#1F8A92', transparent: true, opacity: 0.9 }));
    water.scale.set(COLS + 40, 1.6, 80); water.position.set(COLS / 2, -0.6, 40);
    const foam = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: '#E8FBFB', transparent: true, opacity: 0.85 }));
    foam.scale.set(COLS + 40, 0.12, 0.35); foam.position.set(COLS / 2, 0.22, 0.1);
    const label = textSprite('BANJIR', 'rgba(31,122,128,0.0)', '#FFFFFF', 1.3); label.position.set(-0.3, 0.9, 0.8);
    g.add(water, foam, label); g.userData.foam = foam; g.userData.label = label;
    this.scene.add(g);
    return g;
  }

  makeParticles() {
    const n = 260;
    const m = new THREE.InstancedMesh(BOX, new THREE.MeshLambertMaterial({ color: '#FFFFFF' }), n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.count = 0; m.frustumCulled = false;
    this.scene.add(m);
    return m;
  }

  makeRain() {
    const n = 220, pos = new Float32Array(n * 6);
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const l = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: '#DDEFFF', transparent: true, opacity: 0.5 }));
    l.frustumCulled = false; l.visible = false;
    l.userData.seed = Array.from({ length: n }, () => [Math.random(), Math.random(), Math.random()]);
    this.scene.add(l);
    return l;
  }

  ensurePlayer(id) {
    if (this.playerId === id && this.player) return;
    if (this.player) this.scene.remove(this.player);
    this.player = buildCourier(id); this.playerId = id;
    this.player.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    this.scene.add(this.player);
  }

  // ---------------------------------------------------------------- frame
  draw(game, opts = {}) {
    const t = (opts.now || performance.now()) / 1000;
    const st = game.settings;
    if (this.cb !== !!st.colorBlind) { this.cb = !!st.colorBlind; this.lanes.forEach((g) => this.world.remove(g)); this.lanes.clear(); }
    if (this.game !== game) { this.lanes.forEach((g) => this.world.remove(g)); this.lanes.clear(); this.game = game; }
    const tod = game.tod();
    // visible lanes (camera looks forward, so more ahead than behind)
    const r0 = Math.max(0, Math.floor(this.camV - 10)), r1 = Math.ceil(this.camV + 18);
    for (let r = r0; r <= r1; r++) {
      if (!game.lane(r)) continue;
      let g = this.lanes.get(r);
      if (!g) { g = this.buildLane(game, r); this.lanes.set(r, g); }
      this.syncLane(game, r, g, t);
    }
    for (const [r, g] of this.lanes) if (r < r0 - 2 || r > r1 + 2) { this.world.remove(g); this.lanes.delete(r); }

    // player
    const pv = game.pos();
    if (!opts.hidePlayer) {
      this.ensurePlayer(game.opts.courier || 'hornbill');
      const P = this.player, p = game.p;
      P.visible = !(p.invuln > 0 && Math.floor(p.invuln * 10) % 2 === 0 && !game.dead);
      const L = game.lane(Math.round(pv.v));
      let base = L ? (TOP[L.kind] ?? 0) : 0;
      if (L && (L.kind === 'roofs' || (L.kind === 'split' && L.splitKinds[Math.round(pv.c - 0.5)] === 'roof'))) base = TOP.roofs + 0.38;
      if (L && L.kind === 'split' && L.splitKinds[Math.round(pv.c - 0.5)] === 'prom') base = 0;
      if (L && L.kind === 'river') base = TOP.river + 0.36;
      let lift = 0, sx = 1, sy = 1;
      if (p.hopping) {
        lift = Math.sin(pv.t * Math.PI) * (p.glide ? 1.1 : 0.55);
        if (!st.reduceMotion) { if (pv.t < 0.2) { sx = 1.2; sy = 0.75; } else { sx = 0.86; sy = 1.2; } }
      } else if (!st.reduceMotion && p.stun > 0) { sx = 1.15; sy = 0.8; }
      P.position.set(pv.c, base + lift, -pv.v);
      P.userData.body.scale.set(sx, sy, sx);
      const yaw = { up: 0, down: Math.PI, left: Math.PI / 2, right: -Math.PI / 2 }[p.dir] || 0;
      P.rotation.y += (yaw - P.rotation.y) * 0.45;
      P.userData.kuih.visible = game.carrying;
      P.userData.helmet.visible = game.helmet;
      P.userData.umbrella.visible = !!(game.power && game.power.id === 'payung');
      if (game.dead) { const k = Math.max(0.05, 1 - game.deadT); P.scale.set(1, k, 1); } else P.scale.set(1, 1, 1);
      // beat ring + magnet
      const ph = opts.beatPhase || 0, near = Math.min(ph, 1 - ph);
      this.ring.visible = !!opts.beat && st.showBeat !== false && !game.dead;
      this.ring.position.set(pv.c, base + 0.03, -pv.v);
      const rs = 1 + 0.6 * ph; this.ring.scale.set(rs, rs, rs);
      this.ring.material.color.set(near < 0.14 ? '#D94F70' : '#FFFFFF');
      this.ring.material.opacity = near < 0.14 ? 0.95 : 0.45;
      this.magnet.visible = !!(game.power && game.power.id === 'tiffin');
      this.magnet.position.set(pv.c, base + 0.04, -pv.v);
    } else {
      if (this.player) this.player.visible = false;
      this.ring.visible = false; this.magnet.visible = false;
    }

    // flood
    const f = game.flood;
    this.flood.visible = !!f.active || f.level > -1;
    this.flood.position.set(0, Math.sin(t * 2) * 0.04, -f.level);
    this.flood.userData.foam.position.y = 0.22 + Math.sin(t * 3) * 0.05;
    this.flood.userData.label.position.x = this.camC - this.viewCols / 2 + 1.6;

    // particles
    const P = this.particles, dummy = this.dummy || (this.dummy = new THREE.Object3D()), colr = this.colr || (this.colr = new THREE.Color());
    let n = 0;
    for (const q of game.particles) {
      if (n >= 260) break;
      const age = (q.max || 1.2) - q.life;
      dummy.position.set(q.c, 0.4 + age * 2.4 - age * age * 3.2, -q.v);
      const s = q.kind === 'petals' ? 0.12 : 0.09;
      dummy.scale.set(s, s, s); dummy.rotation.set(age * 6, age * 4, 0); dummy.updateMatrix();
      P.setMatrixAt(n, dummy.matrix); P.setColorAt(n, colr.set(q.color)); n++;
    }
    P.count = n; P.instanceMatrix.needsUpdate = true; if (P.instanceColor) P.instanceColor.needsUpdate = true;

    // rain when the flood is close
    const gap = game.floodGap();
    const rainOn = !!f.active && !game.dead && !st.reduceMotion && gap < 3.4 && !opts.hidePlayer;
    this.rain.visible = rainOn;
    if (rainOn) {
      const a = this.rain.geometry.attributes.position.array, seeds = this.rain.userData.seed;
      const cnt = Math.round(seeds.length * Math.min(1, (3.4 - gap) / 2.5));
      for (let i = 0; i < seeds.length; i++) {
        const [sx0, sz0, sp] = seeds[i];
        const y = 8 - ((t * (6 + sp * 4) + sp * 8) % 8);
        const x = this.camC - 8 + sx0 * 16, z = -this.camV - 6 + sz0 * 16;
        const on = i < cnt;
        a.set(on ? [x, y, z, x - 0.05, y - 0.45, z + 0.05] : [0, -50, 0, 0, -50, 0], i * 6);
      }
      this.rain.geometry.attributes.position.needsUpdate = true;
    }

    // day → night
    const day = new THREE.Color('#8FC7E8'), night = new THREE.Color('#1A1230');
    this.bg.copy(day).lerp(night, tod); this.r.setClearColor(this.bg);
    this.hemi.intensity = 1.15 - 0.8 * tod;
    this.sun.intensity = 1.7 - 1.45 * tod;
    this.sun.color.set(tod > 0.15 && tod < 0.7 ? '#FFC58A' : '#FFFFFF');
    const glowOn = Math.max(0, (tod - 0.25) / 0.75);
    this.world.traverse((o) => { if (o.userData && o.userData.glow === true && o.material) { o.material.opacity = glowOn * 0.8; o.visible = glowOn > 0.02; } });

    // camera
    const target = new THREE.Vector3(this.camC, 0, -this.camV);
    let sh = 0;
    if (game.shake > 0 && !st.reduceMotion) sh = game.shake * 0.012;
    this.cam.position.copy(target).add(this.offset).add(new THREE.Vector3((Math.random() - 0.5) * sh, 0, (Math.random() - 0.5) * sh));
    this.cam.lookAt(target);
    this.sun.position.copy(target).add(new THREE.Vector3(-6, 14, 5));
    this.sun.target.position.copy(target);
    this.r.render(this.scene, this.cam);
    this.calls = this.r.info.render.calls;
  }

  // ---------------------------------------------------------------- portraits for menus
  static portrait(canvas, courierId, carrying) {
    if (!Renderer3D._pr) {
      const cv = document.createElement('canvas'); cv.width = cv.height = 256;
      const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true, preserveDrawingBuffer: true });
      r.outputColorSpace = THREE.SRGBColorSpace;
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight('#FFF4E0', '#8090A8', 1.3));
      const d = new THREE.DirectionalLight('#FFFFFF', 1.6); d.position.set(-2, 4, 3); scene.add(d);
      const cam = new THREE.OrthographicCamera(-0.75, 0.75, 0.75, -0.75, 0.1, 20);
      cam.position.set(-1.6, 1.9, 2.6); cam.lookAt(0, 0.42, 0);
      Renderer3D._pr = { cv, r, scene, cam, model: null };
    }
    const P = Renderer3D._pr;
    if (P.model) P.scene.remove(P.model);
    P.model = buildCourier(courierId); P.model.rotation.y = -0.5;
    P.model.userData.kuih.visible = !!carrying;
    P.scene.add(P.model);
    P.r.setClearColor(0x000000, 0);
    P.r.render(P.scene, P.cam);
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(P.cv, 0, 0, canvas.width, canvas.height);
  }
}

export function webglAvailable() {
  try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl'))); } catch (e) { return false; }
}
