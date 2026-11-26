// Hornbill Express · © 2026 Kiu Kwan Tai. All rights reserved.
// Name cleaning and a small rude-word filter. Extend BLOCKED for your audience.
const BLOCKED = [
  'fuck', 'fuk', 'shit', 'bitch', 'cunt', 'cock', 'pussy', 'slut', 'whore', 'nigger', 'nigga', 'fag', 'rape', 'penis', 'vagina', 'porn', 'sex', 'nazi', 'hitler', 'asshole', 'bastard', 'wank', 'twat',
  // Malay
  'babi', 'bodoh', 'pukimak', 'puki', 'pantat', 'sial', 'celaka', 'lancau', 'butoh', 'kote', 'pepek', 'jubur', 'bangsat', 'anjing', 'keparat', 'pundek', 'bahlul',
];

const LEET = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '8': 'b', '9': 'g', '@': 'a', '$': 's' };

export const MAX_NAME = 12;

export function cleanName(raw) {
  let s = String(raw || '').toUpperCase().replace(/[^A-Z0-9 ]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s.slice(0, MAX_NAME).trim();
}

export function isRude(name) {
  const flat = String(name || '').toLowerCase().replace(/\s+/g, '').split('').map((c) => LEET[c] || c).join('')
    .replace(/(.)\1+/g, '$1');
  return BLOCKED.some((w) => flat.includes(w.replace(/(.)\1+/g, '$1')));
}
