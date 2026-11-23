// On-device self-test: hashes seed.js outputs for fixed keys plus engine.js outputs on an inline mini-dataset, and compares with the value computed in Node.
// Regenerate SELFTEST_EXPECTED with: node -e "import('./site/js/selftest.js').then(m=>console.log(m.selfTestHash()))"
import { cyrb53, hash32, rng, seedKey, syncEmoji, nextCode, prevCode, canonicalCode } from './seed.js';
import * as E from './engine.js';

// Inline mini-dataset (shaped like site/data/*.json) so the engine is exercised without fetching.
const L = (p, n) => Array.from({ length: n }, (_, i) => p + ' ' + (i + 1));
const Q = (p, i) => ({ id: p + i, q: p + ' q' + i + ' é?', a: p + ' a' + i, wrong: [p + ' x' + i, p + ' y' + i, p + ' z' + i], source: 'https://e.x/' + i });
const MINI = {
  imposter: { packs: ['food', 'rides', 'places'].map((id) => ({ id, name: id, emoji: '🍩', words: L(id + ' café', 25) })) },
  spyfall: { locations: Array.from({ length: 12 }, (_, i) => ({ id: 'l' + i, name: 'Loc ' + i, roles: L('Role' + i, 8) })) },
  bingo: { squares: Array.from({ length: 30 }, (_, i) => ({ id: 's' + i, text: 'Sq ' + i, emoji: '✨' })) },
  spectra: { spectra: Array.from({ length: 10 }, (_, i) => ({ left: 'L' + i, right: 'R' + i })) },
  missions: { missions: Array.from({ length: 12 }, (_, i) => ({ id: 'm' + i, text: 'M ' + i })) },
  trivia: { questions: ['kid', 'teen', 'adult'].flatMap((d) => Array.from({ length: 13 }, (_, i) => ({ ...Q(d, i), difficulty: d }))) },
  ridetrivia: { rides: [{ id: 'r1', questions: Array.from({ length: 6 }, (_, i) => Q('r1', i)) }, { id: 'r2', questions: Array.from({ length: 9 }, (_, i) => Q('r2', i)) }] },
  twotruths: { rounds: Array.from({ length: 7 }, (_, i) => ({ id: 't' + i, truths: ['T' + i + 'a', 'T' + i + 'b'], lie: 'Lie' + i, explanation: 'E', sources: ['https://e.x'] })) },
  overunder: { prompts: Array.from({ length: 5 }, (_, i) => ({ id: 'o' + i, text: 'P' + i, ref: i, unit: '$', verify: 'v' })) },
};

function engineOutputs() {
  const out = [];
  for (const C of [1, 7, 9999]) {
    for (const N of [3, 7, 10]) for (let P = 1; P <= N; P++) {
      out.push(E.imposterRound({ C, N, P, packId: 'any', imposters: true }, MINI.imposter));
      out.push(E.imposterRound({ C, N, P, packId: 'rides', imposters: false }, MINI.imposter));
      out.push(E.spyfallRound({ C, N, P }, MINI.spyfall));
      out.push(E.bingoCard({ C, N, P }, MINI.bingo).map((c) => c.id));
      out.push(E.wavelengthRound({ C, N, P }, MINI.spectra));
      out.push(E.missionFor({ date: '2026-11-24', N, P }, MINI.missions).id);
    }
    for (const D of E.DIFFICULTIES) out.push(E.triviaRound({ C, D }, MINI.trivia));
    for (const rideId of ['r1', 'r2']) out.push(E.rideTrivia({ rideId, C }, MINI.ridetrivia));
    out.push(E.twoTruthsRound({ C }, MINI.twotruths), E.overUnderPrompt({ C }, MINI.overunder));
    out.push(E.syncCheck('imposter', { C, N: 8, pack: 'any', k: 2 }, JSON.stringify(MINI.imposter)).emoji);
    out.push(E.syncCheck('trivia', { C }, JSON.stringify(MINI.trivia)).emoji);
  }
  out.push(E.bingoLines(new Set([0, 6, 18, 24, 2, 7, 17, 22])), E.wavelengthScore(40, 50), E.clueGiver(9999, 8));
  return out;
}

export const SELFTEST_EXPECTED = 5689407979266558;

export function selfTestHash() {
  const out = [];
  const strs = ['', 'a', 'hello', 'café', '🍩🚀🎈', 'Ω≈ç√', 'imposter|42|8|any|2'];
  for (const s of strs) out.push(cyrb53(s), cyrb53(s, 7), hash32(s));
  for (let i = 0; i < 300; i++) {
    const r = rng(seedKey(['selftest', i, 'é🍩']));
    out.push(r.next(), r.next(), r.int(7), r.int(101), r.int(2147483648), r.shuffle([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]));
  }
  for (let C = 1; C <= 9999; C += 97) out.push(syncEmoji(['1.0.0', C, 'spyfall', 8]));
  out.push(nextCode(9999), prevCode(1), canonicalCode('07'), canonicalCode(' 12 '), canonicalCode('0'), canonicalCode('10000'));
  out.push(engineOutputs());
  return cyrb53(JSON.stringify(out));
}

export function selfTest() {
  let got;
  try { got = selfTestHash(); } catch (e) { return { pass: false, got: String(e), expected: SELFTEST_EXPECTED }; }
  return { pass: got === SELFTEST_EXPECTED, got, expected: SELFTEST_EXPECTED };
}
