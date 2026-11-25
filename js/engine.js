// Line Games engine: pure per-mode round logic. No DOM, no Math.random, no Date.
// RNG draw order inside every function is part of the spec (PLAN.md section 2). Do not reorder.
import { cyrb53, hash32, rng, seedKey, syncEmoji, syncNames, CODE_MIN, CODE_MAX } from './seed.js';
import { APP_VERSION } from './version.js';

export const N_MIN = 3;
export const N_MAX = 10;
export const DIFFICULTIES = ['kid', 'teen', 'adult'];
export const TRIVIA_PER_ROUND = 10;
export const RIDE_MAX_Q = 8;
export const BINGO_FREE_INDEX = 12;
export const BINGO_FREE = Object.freeze({ id: 'free', text: 'FREE', emoji: '⭐', free: true });

// ---------- validation ----------

export class InputError extends Error {
  constructor(message) { super(message); this.name = 'InputError'; }
}

function assertC(C) {
  if (!Number.isInteger(C) || C < CODE_MIN || C > CODE_MAX) {
    throw new InputError(`Round code must be an integer 1..9999, got ${C}`);
  }
}
function assertN(N) {
  if (!Number.isInteger(N) || N < N_MIN || N > N_MAX) {
    throw new InputError(`Player count must be an integer ${N_MIN}..${N_MAX}, got ${N}`);
  }
}

/** Never clamps. Returns {ok:true} or {ok:false, error}. */
export function validatePlayer(P, N) {
  if (!Number.isInteger(N) || N < N_MIN || N > N_MAX) {
    return { ok: false, error: `Player count must be ${N_MIN}–${N_MAX}` };
  }
  if (!Number.isInteger(P) || P < 1 || P > N) {
    return { ok: false, error: `Pick your number (1–${N})` };
  }
  return { ok: true };
}
function assertPN(P, N) {
  assertN(N);
  const v = validatePlayer(P, N);
  if (!v.ok) throw new InputError(v.error);
}
function assertArr(a, min, what) {
  if (!Array.isArray(a) || a.length < min) throw new InputError(`Data: ${what} needs at least ${min} items`);
}
function range1(n) {
  const a = [];
  for (let i = 1; i <= n; i++) a.push(i);
  return a;
}
function range0(n) {
  const a = [];
  for (let i = 0; i < n; i++) a.push(i);
  return a;
}

// ---------- helpers ----------

export function effectiveImposters(toggle, N) {
  return toggle && N >= 7 ? 2 : 1;
}

export function clueGiver(C, N) {
  assertC(C); assertN(N);
  return ((C - 1) % N) + 1;
}

export function wavelengthScore(guess, target) {
  if (!Number.isInteger(guess) || !Number.isInteger(target)) throw new InputError('wavelengthScore: integers only');
  const d = Math.abs(guess - target);
  if (d <= 4) return 4;
  if (d <= 10) return 3;
  if (d <= 18) return 2;
  if (d <= 28) return 1;
  return 0;
}

export const BINGO_LINES = (() => {
  const L = [];
  for (let r = 0; r < 5; r++) L.push([0, 1, 2, 3, 4].map((c) => r * 5 + c));
  for (let c = 0; c < 5; c++) L.push([0, 1, 2, 3, 4].map((r) => r * 5 + c));
  L.push([0, 6, 12, 18, 24]);
  L.push([4, 8, 12, 16, 20]);
  return L;
})();

/** marked: Set<int> or array of indices. FREE (12) always counts. Returns completed lines (arrays of 5 indices). */
export function bingoLines(marked) {
  const s = new Set(marked instanceof Set ? marked : Array.from(marked || []));
  s.add(BINGO_FREE_INDEX);
  return BINGO_LINES.filter((line) => line.every((i) => s.has(i))).map((l) => l.slice());
}

function makeQuestion(index, q, r) {
  assertArr(q.wrong, 3, 'question.wrong');
  const choices = r.shuffle([q.a, q.wrong[0], q.wrong[1], q.wrong[2]]);
  return { index, id: q.id, q: q.q, choices, correctIndex: choices.indexOf(q.a), source: q.source };
}

// ---------- modes ----------

/** Key imposter|C|N|pack|k. Draws: [pick pack if any], pick word, shuffle 1..N, int(N). */
export function imposterRound({ C, N, P, packId = 'any', imposters = false }, data) {
  assertC(C); assertPN(P, N);
  const packs = data && data.packs;
  assertArr(packs, 1, 'packs');
  const k = effectiveImposters(imposters, N);
  const pk = packId === 'any' ? 'any' : String(packId);
  const r = rng(seedKey(['imposter', C, N, pk, k]));
  let pack;
  if (pk === 'any') pack = r.pick(packs);
  else {
    pack = packs.find((p) => p.id === pk);
    if (!pack) throw new InputError(`Unknown pack "${pk}"`);
  }
  const word = r.pick(pack.words);
  const order = r.shuffle(range1(N));
  const imposterNumbers = order.slice(0, k);
  const firstSpeaker = 1 + r.int(N);
  const isImposter = imposterNumbers.includes(P);
  return {
    k, packId: pack.id, category: pack.name, packName: pack.name, packEmoji: pack.emoji,
    word: isImposter ? null : word, isImposter, imposterNumbers, firstSpeaker,
  };
}

/** Key spyfall|C|N. Draws: pick location, int(N) spy, shuffle roles, int(N) first asker. */
export function spyfallRound({ C, N, P }, data) {
  assertC(C); assertPN(P, N);
  const locs = data && data.locations;
  assertArr(locs, 1, 'locations');
  const r = rng(seedKey(['spyfall', C, N]));
  const loc = r.pick(locs);
  const spyNumber = 1 + r.int(N);
  assertArr(loc.roles, 1, 'location.roles');
  const roles = r.shuffle(loc.roles);
  const firstAsker = 1 + r.int(N);
  const isSpy = P === spyNumber;
  let role = null;
  if (!isSpy) {
    let i = 0;
    for (let p = 1; p <= N; p++) {
      if (p === spyNumber) continue;
      if (p === P) { role = roles[i % roles.length]; break; }
      i++;
    }
  }
  return {
    location: isSpy ? null : loc.name, locationId: isSpy ? null : loc.id, role, isSpy,
    spyNumber, firstAsker, locations: locs.map((l) => l.name),
  };
}

/** Key bingo|C|P (N excluded on purpose). 25 cells, index 12 = FREE. */
export function bingoCard({ C, N, P }, data) {
  assertC(C);
  if (N !== undefined) assertPN(P, N);
  else if (!Number.isInteger(P) || P < 1 || P > N_MAX) throw new InputError(`Pick your number (1–${N_MAX})`);
  const sq = data && data.squares;
  assertArr(sq, 24, 'squares');
  const picked = rng(seedKey(['bingo', C, P])).shuffle(sq).slice(0, 24);
  const cells = picked.slice(0, 12).concat([BINGO_FREE], picked.slice(12));
  return cells;
}

/** Key wavelength|C|N. Draws: pick spectrum, int(101). */
export function wavelengthRound({ C, N, P }, data) {
  assertC(C); assertPN(P, N);
  const sp = data && data.spectra;
  assertArr(sp, 1, 'spectra');
  const r = rng(seedKey(['wavelength', C, N]));
  const s = r.pick(sp);
  const target = r.int(101);
  const cg = clueGiver(C, N);
  return { spectrum: { left: s.left, right: s.right }, target, clueGiver: cg, isClueGiver: P === cg };
}

/** Key missions|YYYY-MM-DD. mission = shuffle(missions)[P-1]. C is NOT used. */
export function missionFor({ date, N, P }, data) {
  if (typeof date !== 'string' || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(date)) {
    throw new InputError(`Mission date must be YYYY-MM-DD, got ${date}`);
  }
  if (N !== undefined) assertPN(P, N);
  else if (!Number.isInteger(P) || P < 1 || P > N_MAX) throw new InputError(`Pick your number (1–${N_MAX})`);
  const ms = data && data.missions;
  assertArr(ms, N_MAX, 'missions');
  return rng(seedKey(['missions', date])).shuffle(ms)[P - 1];
}

/** Permutation trivia|D over that difficulty's questions (file order). Q i = perm[(C*10+i) mod len]. */
export function triviaRound({ C, D }, data) {
  assertC(C);
  if (!DIFFICULTIES.includes(D)) throw new InputError(`Difficulty must be kid/teen/adult, got ${D}`);
  const all = data && data.questions;
  assertArr(all, 1, 'questions');
  const pool = all.filter((q) => q.difficulty === D);
  assertArr(pool, TRIVIA_PER_ROUND, `${D} questions`);
  const perm = rng(seedKey(['trivia', D])).shuffle(range0(pool.length));
  const out = [];
  for (let i = 0; i < TRIVIA_PER_ROUND; i++) {
    const q = pool[perm[(C * TRIVIA_PER_ROUND + i) % pool.length]];
    out.push(makeQuestion(i, q, rng(seedKey(['trivia-q', C, i, D]))));
  }
  return out;
}

/** Permutation ride|rideId|C, first min(8,len). Choice order ride-q|rideId|C|i. */
export function rideTrivia({ rideId, C }, data) {
  assertC(C);
  const rides = data && data.rides;
  assertArr(rides, 1, 'rides');
  const ride = rides.find((x) => x.id === rideId);
  if (!ride) throw new InputError(`Unknown ride "${rideId}"`);
  assertArr(ride.questions, 1, 'ride.questions');
  const perm = rng(seedKey(['ride', ride.id, C])).shuffle(range0(ride.questions.length));
  const n = Math.min(RIDE_MAX_Q, perm.length);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(makeQuestion(i, ride.questions[perm[i]], rng(seedKey(['ride-q', ride.id, C, i]))));
  }
  return out;
}

/** Permutation twotruths, round = perm[C mod len]; statement order twotruths-o|C. */
export function twoTruthsRound({ C }, data) {
  assertC(C);
  const rounds = data && data.rounds;
  assertArr(rounds, 1, 'rounds');
  const perm = rng('twotruths').shuffle(range0(rounds.length));
  const rd = rounds[perm[C % rounds.length]];
  assertArr(rd.truths, 2, 'round.truths');
  const statements = rng(seedKey(['twotruths-o', C])).shuffle([rd.truths[0], rd.truths[1], rd.lie]);
  return {
    id: rd.id, statements, lieIndex: statements.indexOf(rd.lie), explanation: rd.explanation,
    source: (rd.sources || [])[0] || null, sources: (rd.sources || []).slice(),
  };
}

/** Permutation overunder, prompt = perm[C mod len]. */
export function overUnderPrompt({ C }, data) {
  assertC(C);
  const ps = data && data.prompts;
  assertArr(ps, 1, 'prompts');
  const perm = rng('overunder').shuffle(range0(ps.length));
  const p = ps[perm[C % ps.length]];
  return { id: p.id, text: p.text, ref: p.ref, unit: p.unit, verify: p.verify };
}

/** Fib Finder. Permutation fib|<cat> over that category's questions (file order; 'mix' = all). Q = perm[C mod len]. */
export const FIB_MIX = 'mix';
export function fibRound({ C, cat = FIB_MIX }, data) {
  assertC(C);
  const all = data && data.questions;
  assertArr(all, 1, 'questions');
  const c = String(cat || FIB_MIX);
  const pool = c === FIB_MIX ? all : all.filter((q) => q.cat === c);
  if (!pool.length) throw new InputError(`Unknown category "${c}"`);
  const perm = rng(seedKey(['fib', c])).shuffle(range0(pool.length));
  const q = pool[perm[C % pool.length]];
  const meta = ((data.categories || []).find((x) => x.id === q.cat)) || { id: q.cat, name: q.cat, emoji: '' };
  return { id: q.id, cat: q.cat, catName: meta.name, catEmoji: meta.emoji, q: q.q, a: q.a, alt: (q.alt || []).slice(), decoys: (q.decoys || []).slice(), fact: q.fact || '', source: q.source };
}

/** Normalise an answer so "The Platter!" and "platter" count as the same. */
export function fibNorm(s) {
  let t = String(s == null ? '' : s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  t = t.replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  t = t.replace(/^(a|an|the|some)\s+/, '');
  return t.replace(/\s+/g, ' ');
}
/** True when a typed fib is really the true answer. */
export function fibIsTruth(text, round) {
  const n = fibNorm(text);
  if (!n) return false;
  return [round.a, ...(round.alt || [])].some((x) => fibNorm(x) === n);
}
/** Points: +2 for finding the truth, +1 for each player fooled by your fib (shared fibs credit every author). */
export const FIB_TRUTH_PTS = 2, FIB_FOOL_PTS = 1;
/**
 * Build the answer board and score a round.
 * lies: {who: text} (who = any player key). votes: {who: optionKey}. Returns {options:[{key,text,truth,house,authors:[who]}], points:{who:n}}.
 * Options are sorted by a hash of (C, key) so every phone shows the same order. House fibs fill up to minOptions.
 */
export function fibBoard({ C, round, lies = {}, votes = null, order = null, minOptions = 4 }) {
  const opts = new Map();
  const tkey = fibNorm(round.a);
  opts.set(tkey, { key: tkey, text: round.a, truth: true, house: false, authors: [] });
  const who = order || Object.keys(lies);
  for (const w of who) {
    const text = lies[w];
    if (typeof text !== 'string' || !text.trim()) continue;
    if (fibIsTruth(text, round)) continue;
    const k = fibNorm(text);
    if (!k) continue;
    if (!opts.has(k)) opts.set(k, { key: k, text: text.trim(), truth: false, house: false, authors: [] });
    opts.get(k).authors.push(w);
  }
  for (const d of round.decoys || []) {
    if (opts.size >= minOptions) break;
    const k = fibNorm(d);
    if (!opts.has(k) && !fibIsTruth(d, round)) opts.set(k, { key: k, text: d, truth: false, house: true, authors: [] });
  }
  const options = [...opts.values()].sort((a, b) => hash32(seedKey(['fib-o', C, a.key])) - hash32(seedKey(['fib-o', C, b.key])) || (a.key < b.key ? -1 : 1));
  let points = null;
  if (votes) {
    points = {};
    for (const w of who) points[w] = 0;
    for (const [w, k] of Object.entries(votes)) {
      if (!(w in points)) points[w] = 0;
      const o = opts.get(k);
      if (!o) continue;
      if (o.truth) points[w] += FIB_TRUTH_PTS;
      else for (const a of o.authors) if (a !== w) points[a] = (points[a] || 0) + FIB_FOOL_PTS;
    }
  }
  return { options, points };
}

// ---------- sync check ----------

// Group inputs per mode, in key order. Never P, never RNG output.
export const SYNC_FIELDS = {
  imposter: ['C', 'N', 'pack', 'k'],
  spyfall: ['C', 'N'],
  bingo: ['C'],
  wavelength: ['C', 'N'],
  missions: ['date'],
  trivia: ['C'], // difficulty is per player, so not a group input (midpoint review #2)
  ride: ['C', 'rideId'],
  twotruths: ['C'],
  overunder: ['C'],
  fib: ['C', 'cat'],
};

/** Parts hashed for the sync check: APP_VERSION|dataHash|mode|<group inputs>. */
export function syncParts(mode, groupInputs, dataText) {
  const fields = SYNC_FIELDS[mode];
  if (!fields) throw new InputError(`Unknown mode "${mode}"`);
  if (typeof dataText !== 'string') throw new InputError('syncCheck: dataText must be the raw JSON text');
  const g = groupInputs || {};
  const parts = [APP_VERSION, cyrb53(dataText), mode];
  for (const f of fields) {
    const v = g[f];
    if (v === undefined || v === null || v === '') throw new InputError(`syncCheck(${mode}): missing ${f}`);
    if (f === 'C') assertC(v);
    if (f === 'N') assertN(v);
    parts.push(v);
  }
  return parts;
}

/** Returns {emoji, names, hash}. emoji is the 3-emoji string to read aloud. */
export function syncCheck(mode, groupInputs, dataText) {
  const parts = syncParts(mode, groupInputs, dataText);
  return { emoji: syncEmoji(parts), names: syncNames(parts), hash: hash32(seedKey(parts)) };
}
