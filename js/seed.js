// Line Games seed module. Pure, deterministic, integer-only. See PLAN.md section 2.
// No Math.random, no Date-based randomness, no floats in choices, no locale-dependent code.

// cyrb53 by bryc (public domain). Hashes UTF-16 code units via charCodeAt; no normalisation.
export function cyrb53(str, seed = 0) {
  str = String(str);
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** Exact integer in [0, 2^32). */
export function hash32(str) {
  return cyrb53(str) % 4294967296;
}

/** mulberry32; each call returns a uint32 integer (NOT a float). */
export function mulberry32(a) {
  return function next() {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

export class Rng {
  constructor(nextFn) {
    if (typeof nextFn !== 'function') throw new TypeError('Rng needs a next() function');
    this._next = nextFn;
  }
  /** Raw uint32. */
  next() {
    return this._next();
  }
  /** Integer in [0, n). n must be an integer 1..2^31. */
  int(n) {
    if (!Number.isInteger(n) || n < 1 || n > 2147483648) {
      throw new RangeError(`Rng.int: n must be an integer 1..2^31, got ${n}`);
    }
    return this._next() % n;
  }
  pick(arr) {
    if (!Array.isArray(arr) || arr.length === 0) throw new RangeError('Rng.pick: empty or non-array');
    return arr[this.int(arr.length)];
  }
  /** Fisher-Yates on a copy: i from len-1 down to 1, j = int(i+1), swap. */
  shuffle(arr) {
    if (!Array.isArray(arr)) throw new TypeError('Rng.shuffle: not an array');
    const a = arr.slice();
    for (let i = a.length - 1; i >= 1; i--) {
      const j = this.int(i + 1);
      const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }
}

/** parts.join('|') with every part String()-ed. Numbers must be integers. */
export function seedKey(parts) {
  if (!Array.isArray(parts)) throw new TypeError('seedKey: parts must be an array');
  return parts.map((p) => {
    if (typeof p === 'number' && !Number.isInteger(p)) {
      throw new TypeError(`seedKey: non-integer number ${p}`);
    }
    if (p === undefined || p === null) throw new TypeError('seedKey: undefined/null part');
    return String(p);
  }).join('|');
}

export function rng(key) {
  return new Rng(mulberry32(hash32(key)));
}

export const CODE_MIN = 1;
export const CODE_MAX = 9999;

/** Canonical round code: trimmed /^[0-9]{1,4}$/, parsed base 10, 1..9999. Otherwise null. */
export function canonicalCode(input) {
  if (typeof input === 'number') {
    return Number.isInteger(input) && input >= CODE_MIN && input <= CODE_MAX ? input : null;
  }
  if (typeof input !== 'string') return null;
  const s = input.trim();
  if (!/^[0-9]{1,4}$/.test(s)) return null;
  const c = parseInt(s, 10);
  return c >= CODE_MIN && c <= CODE_MAX ? c : null;
}

function assertCode(c) {
  if (!Number.isInteger(c) || c < CODE_MIN || c > CODE_MAX) {
    throw new RangeError(`Round code must be an integer 1..9999, got ${c}`);
  }
}

export function nextCode(c) {
  assertCode(c);
  return c === CODE_MAX ? CODE_MIN : c + 1;
}

export function prevCode(c) {
  assertCode(c);
  return c === CODE_MIN ? CODE_MAX : c - 1;
}

function pad(n, w) {
  let s = String(n);
  while (s.length < w) s = '0' + s;
  return s;
}

/** Local calendar date YYYY-MM-DD (never toISOString / toLocaleDateString). */
export function localDateString(d) {
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) throw new TypeError('localDateString: invalid Date');
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1, 2)}-${pad(d.getDate(), 2)}`;
}

// 64 simple, distinct, easy-to-say emoji. Single code point each, default emoji presentation:
// no flags, no skin tones, no ZWJ sequences, no variation selectors. Order is part of the spec.
export const SYNC_EMOJI = [
  '🍩', '🚀', '🎈', '🐢', '🍕', '🌵', '🦄', '🐙',
  '🍦', '🎸', '🐳', '🍉', '🌈', '⚽', '🎩', '🦊',
  '🐝', '🍔', '🎃', '🐸', '🦁', '🍓', '🔑', '🎁',
  '🐧', '🍌', '🌻', '🐠', '🦋', '🍿', '🎲', '🚲',
  '🐘', '🍪', '🥕', '🍋', '🦉', '🐌', '🌮', '🎺',
  '🦀', '🍄', '🔔', '🐷', '🍒', '🎯', '🧁', '🐶',
  '🐱', '🥨', '🦒', '🦓', '🦔', '🦖', '🍍', '🍎',
  '🥑', '⭐', '🌙', '🔥', '💎', '🎤', '🧸', '🚂',
];
export const SYNC_EMOJI_NAMES = [
  'donut', 'rocket', 'balloon', 'turtle', 'pizza', 'cactus', 'unicorn', 'octopus',
  'ice cream', 'guitar', 'whale', 'watermelon', 'rainbow', 'soccer ball', 'top hat', 'fox',
  'bee', 'burger', 'pumpkin', 'frog', 'lion', 'strawberry', 'key', 'present',
  'penguin', 'banana', 'sunflower', 'fish', 'butterfly', 'popcorn', 'dice', 'bike',
  'elephant', 'cookie', 'carrot', 'lemon', 'owl', 'snail', 'taco', 'trumpet',
  'crab', 'mushroom', 'bell', 'pig', 'cherries', 'target', 'cupcake', 'dog',
  'cat', 'pretzel', 'giraffe', 'zebra', 'hedgehog', 'dinosaur', 'pineapple', 'apple',
  'avocado', 'star', 'moon', 'fire', 'diamond', 'microphone', 'teddy bear', 'train',
];

function syncIndices(parts) {
  const h = hash32(seedKey(parts));
  return [h & 63, (h >>> 6) & 63, (h >>> 12) & 63];
}

/** 3-emoji sync check string for the given key parts. */
export function syncEmoji(parts) {
  return syncIndices(parts).map((i) => SYNC_EMOJI[i]).join('');
}

/** Spoken names for the same triple, e.g. for aria-label. */
export function syncNames(parts) {
  return syncIndices(parts).map((i) => SYNC_EMOJI_NAMES[i]);
}
