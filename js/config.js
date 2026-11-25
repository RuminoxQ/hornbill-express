// Hornbill Express — game configuration. Tweak numbers here.
export const VERSION = '1.0.0';

export const COLS = 11;            // playable columns
export const BPM = 100;            // kompang beat
export const BEAT_MS = 60000 / BPM;
export const BEAT_WINDOW = 140;    // ms either side of a beat that counts as "on beat"
export const HOP_MS = 130;

export const FLOOD = {
  startBehind: 4,        // lanes behind the start
  baseSpeed: 0.30,       // lanes per second at the start
  speedPerLane: 0.0028,  // added per lane travelled
  maxSpeed: 1.25,
  catchUpGap: 9,         // if the player is further ahead than this, flood speeds up
  catchUpBoost: 0.9,
  checkpointPause: 2.0,  // seconds the flood pauses at a new waterfront lane
  deliveryPushback: 2,   // lanes pushed back per kuih in the order
};

export const PALETTE = {
  ink: '#2A1B3D', cream: '#FFF1DC', orange: '#F28C38', orangeD: '#C46A1F', teal: '#1F7A80',
  padi: '#A7CF5E', road: '#6E5C68', terra: '#C8553D', mag: '#D94F70', gold: '#FFC94A',
  night: '#22163A', prom: '#EBD3B0', market: '#8A5A44', alley: '#3B2D3F', goal: '#FFE3B8',
};

export const LANE_COLORS = {
  day:   { padi: '#A7CF5E', padi2: '#9AC553', road: '#6E5C68', river: '#1F7A80', market: '#8A5A44', roofs: '#3B2D3F', prom: '#EBD3B0', goal: '#FFE3B8', start: '#EBD3B0' },
  dusk:  { padi: '#9DB85A', padi2: '#90AE52', road: '#5E4B5C', river: '#1C6772', market: '#7A4A3E', roofs: '#33263A', prom: '#D9B99A', goal: '#F4CDA0', start: '#D9B99A' },
  night: { padi: '#4D6B3A', padi2: '#466335', road: '#3E3346', river: '#174E5A', market: '#5A3A33', roofs: '#21182B', prom: '#6E5A62', goal: '#7A4E3A', start: '#6E5A62' },
};

export const VEHICLE_COLORS = ['#D94F70', '#FFC94A', '#1F7A80', '#F28C38', '#7B5EA7'];
// Colour-blind safe set: blue/orange/yellow with strong lightness differences
export const CB_VEHICLE_COLORS = ['#0072B2', '#E69F00', '#F0E442', '#56B4E9', '#D55E00'];

export const POWERUPS = {
  durian: { name: 'Durian bait', desc: 'Crocs swim to it for 5s', color: '#9DB33E', shape: 'circle', dur: 5 },
  payung: { name: 'Payung', desc: 'Holds back the banjir for 6s', color: '#D94F70', shape: 'square', dur: 6 },
  wau:    { name: 'Wau kite', desc: 'Next 4 hops glide 2 lanes', color: '#F28C38', shape: 'diamond', hops: 4 },
  teh:    { name: 'Teh tarik', desc: 'Traffic slows for 5s', color: '#B07A4F', shape: 'cup', dur: 5 },
  helmet: { name: 'Rattan helmet', desc: 'Survive one bump', color: '#FFC94A', shape: 'dome' },
  tiffin: { name: 'Tiffin carrier', desc: 'Pulls in nearby tips for 8s', color: '#1F7A80', shape: 'tiffin', dur: 8 },
};

export const LANDMARKS = [
  'Kuching Waterfront', 'Darul Hana Bridge', 'Fort Margherita', 'Main Bazaar', 'Carpenter Street',
  'Cat statue', 'Satok market', 'Tua Pek Kong temple', 'Sarawak River',
];

export const COURIERS = [
  { id: 'hornbill', name: 'Kenyalang', desc: 'Hornbill · default', cost: 0, body: '#26222B', accent: '#FFC94A' },
  { id: 'pangolin', name: 'Pangolin', desc: 'Scaly and steady', cost: 150, body: '#9C7B5B', accent: '#6E553E' },
  { id: 'proboscis', name: 'Proboscis', desc: 'Big hop sound', cost: 250, body: '#E09A5A', accent: '#F4C9A0' },
  { id: 'orangutan', name: 'Orangutan', desc: 'Shaggy legend', cost: 400, body: '#C8553D', accent: '#8E3A2A' },
  { id: 'sunbear', name: 'Sun bear', desc: 'Unlock: all 9 landmarks', cost: -1, body: '#3A3036', accent: '#FFC94A' },
];

export const CUSTOMERS = ["Mak Siti's stall", "Uncle Lim's kopitiam", "Auntie Rose's kuih shop", "Pak Din's jetty", "Ah Seng's noodle cart", "Kak Yah's laksa stall"];

export const DEFAULT_SETTINGS = {
  music: 70, sfx: 90, master: 80,
  showBeat: true, showPad: 'auto', reduceMotion: false, colorBlind: false,
  // operator
  pin: '1234',
  timeLimit: 0,            // seconds, 0 = off
  attractAfter: 30,        // seconds back to attract after a run
  tutorialEveryPlayer: true,
  shopEnabled: false,
  dayNight: true,
  blockRude: true,
  dailyReset: true,
  tvTop: 8,
  landmarksOn: true,
  landmarkRate: 'normal',  // rare | normal | often
  showEvent: false, eventName: '',
  showPrize: false, prizeText: '',
  kioskLock: false,
  kioskMode: false,        // attract screen + auto return
};
