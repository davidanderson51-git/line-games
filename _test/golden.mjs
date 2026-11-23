// Golden snapshot builder. Shared by Node (scripts/make-golden.mjs, engine tests) and tests/golden.html.
// data = { imposter, spyfall, bingo, spectra, missions, trivia, ridetrivia, twotruths, overunder } (parsed JSON).
import { cyrb53, syncEmoji, rng, nextCode, prevCode, canonicalCode } from '../js/seed.js';
import * as E from '../js/engine.js';

export const GOLDEN_FILES = ['imposter', 'spyfall', 'bingo', 'spectra', 'missions', 'trivia', 'ridetrivia', 'twotruths', 'overunder'];
export const GOLDEN_CODES = [1, 7, 9999];
export const GOLDEN_DATES = ['2026-11-24', '2026-11-25', '2026-12-31'];

export function computeGolden(data) {
  const obj = { seed: {}, imposter: [], spyfall: [], bingo: [], wavelength: [], missions: [], trivia: [], ride: [], twotruths: [], overunder: [], sync: [] };
  const raw = {};
  for (const f of GOLDEN_FILES) raw[f] = JSON.stringify(data[f]);

  obj.seed.cyrb = ['', 'a', 'hello', 'café ✨🍩', 'imposter|1|8|any|1'].map((s) => cyrb53(s));
  obj.seed.draws = ['x', 'imposter|7|8|food|2', 'é🍩'].map((k) => { const r = rng(k); return [r.next(), r.next(), r.int(7), r.shuffle([1, 2, 3, 4, 5, 6])]; });
  obj.seed.codes = [nextCode(9999), prevCode(1), canonicalCode('07'), canonicalCode(' 12 '), canonicalCode('0')];
  obj.seed.emoji = syncEmoji(['a', 1]);

  const packOpts = ['any', ...data.imposter.packs.map((p) => p.id)];
  for (let N = 3; N <= 10; N++) {
    for (const C of GOLDEN_CODES) {
      for (let P = 1; P <= N; P++) {
        for (const packId of packOpts) for (const imposters of [false, true]) {
          obj.imposter.push([N, C, P, packId, imposters, E.imposterRound({ C, N, P, packId, imposters }, data.imposter)]);
        }
        const s = E.spyfallRound({ C, N, P }, data.spyfall);
        obj.spyfall.push([N, C, P, s.location, s.role, s.isSpy, s.spyNumber, s.firstAsker]);
        obj.bingo.push([N, C, P, E.bingoCard({ C, N, P }, data.bingo).map((c) => c.id)]);
        obj.wavelength.push([N, C, P, E.wavelengthRound({ C, N, P }, data.spectra)]);
      }
      obj.sync.push(E.syncCheck('imposter', { C, N, pack: 'any', k: E.effectiveImposters(true, N) }, raw.imposter).emoji);
      obj.sync.push(E.syncCheck('spyfall', { C, N }, raw.spyfall).emoji);
      obj.sync.push(E.syncCheck('wavelength', { C, N }, raw.spectra).emoji);
    }
    for (const date of GOLDEN_DATES) for (let P = 1; P <= N; P++) {
      obj.missions.push([N, date, P, E.missionFor({ date, N, P }, data.missions).id]);
    }
  }
  for (const C of GOLDEN_CODES) {
    for (const D of E.DIFFICULTIES) {
      obj.trivia.push([C, D, E.triviaRound({ C, D }, data.trivia).map((q) => [q.id, q.choices, q.correctIndex])]);
    }
    for (const ride of data.ridetrivia.rides) {
      obj.ride.push([C, ride.id, E.rideTrivia({ rideId: ride.id, C }, data.ridetrivia).map((q) => [q.q, q.choices, q.correctIndex])]);
    }
    obj.twotruths.push([C, E.twoTruthsRound({ C }, data.twotruths)]);
    obj.overunder.push([C, E.overUnderPrompt({ C }, data.overunder).id]);
    obj.sync.push(E.syncCheck('bingo', { C }, raw.bingo).emoji);
    obj.sync.push(E.syncCheck('trivia', { C }, raw.trivia).emoji);
    obj.sync.push(E.syncCheck('ride', { C, rideId: data.ridetrivia.rides[0].id }, raw.ridetrivia).emoji);
    obj.sync.push(E.syncCheck('twotruths', { C }, raw.twotruths).emoji);
    obj.sync.push(E.syncCheck('overunder', { C }, raw.overunder).emoji);
  }
  for (const date of GOLDEN_DATES) obj.sync.push(E.syncCheck('missions', { date }, raw.missions).emoji);

  const json = JSON.stringify(obj);
  return {
    hash: cyrb53(json),
    length: json.length,
    sample: {
      imposter_N8_C7_P3_any: E.imposterRound({ C: 7, N: 8, P: 3, packId: 'any', imposters: true }, data.imposter),
      spyfall_N8_C7_P1: E.spyfallRound({ C: 7, N: 8, P: 1 }, data.spyfall).spyNumber,
      wavelength_N8_C7: E.wavelengthRound({ C: 7, N: 8, P: 1 }, data.spectra).target,
      sync: obj.sync.slice(0, 3),
    },
  };
}
