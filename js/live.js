// Live rooms: one phone hosts, everyone joins with a 4-letter room code, and the host's phone is the
// single source of truth for the room (who is playing, which game, which round, locks, reveals, points).
//
// Transport: Supabase Realtime "broadcast" on channel lg-<CODE> (no accounts, no database tables).
// The game content itself is still computed on every phone by the deterministic engine, so only tiny
// facts travel over the wire (mode, round code, settings, votes, reveal flags, points).
// If the connection drops, every phone keeps playing offline: P, N and the round code are already
// stored locally, so the existing seeded game still matches. When the connection comes back, phones
// re-sync to the host.
//
// Messages (all on broadcast event "m"):
//   {t:'st', s:<state>, hnow}            host -> all   full state (sent on change)
//   {t:'hb', v, host, hnow}              host -> all   heartbeat every 3 s
//   {t:'act', from, name, k, key, val}   guest -> host  hello | ping | lock | score | rev
//   {t:'need', from}                     guest -> host  please send full state
import * as store from './store.js';

export const CFG = {
  url: 'https://fomojvbvvicaokmeljil.supabase.co',
  key: 'sb_publishable_29BM9CtQWO243ANeaBzBRg_5mIb0CSu',
};
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const K = { sess: 'lg.live.sess', room: 'lg.live.room', id: 'lg.live.id', url: 'lg.live.url' };
export const MAX_PLAYERS = 10;
const HB_MS = 3000, HOST_LOST_MS = 12000, RESEND_MS = 2000, PING_MS = 4000, PLAYER_OFF_MS = 15000;

const rid = () => { let s = ''; for (let i = 0; i < 10; i++) s += 'abcdefghijkmnpqrstuvwxyz23456789'[Math.floor(Math.random() * 32)]; return s; };
export const me = (() => { let id = store.get(K.id, null); if (typeof id !== 'string' || id.length < 6) { id = rid(); store.set(K.id, id); } return id; })();
export const canonRoom = s => { const c = String(s || '').toUpperCase().replace(/[^A-Z]/g, ''); return c.length === 4 ? c : null; };
const newCode = () => { let c = ''; for (let i = 0; i < 4; i++) c += ALPH[Math.floor(Math.random() * ALPH.length)]; return c; };
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

let sess = store.get(K.sess, null);        // {code, role:'host'|'guest', name}
let state = null;                          // room state (see freshState)
let chOnline = false, chSince = 0, hostSeenAt = 0, offset = 0, joinedAt = 0;
let client = null, ch = null, tickIv = 0, lastPing = 0, lastResend = 0, sendT = 0;
const seen = new Map();                    // host: player id -> last message time
const pending = new Map();                 // guest: unacked acts
const listeners = new Set();
let lastStatus = '';

function freshState(code, name) {
  return { v: 1, code, host: me, players: [{ id: me, name, on: true }], mode: null, C: {}, set: {}, r: {}, ro: [], sk: {}, so: [], tot: {}, tm: {} };
}

// ---------- public read API ----------
export const session = () => sess;
export const isHost = () => !!(sess && sess.role === 'host');
export const hostNow = () => Date.now() - offset;
export const toHostMs = local => local - offset;
export const toLocalMs = host => host + offset;
export function status() {
  if (!sess) return 'off';
  if (!chOnline) return state ? 'offline' : 'connecting';
  if (isHost()) return 'online';
  if (!state) return Date.now() - joinedAt > 9000 ? 'notfound' : 'connecting';
  return Date.now() - hostSeenAt < HOST_LOST_MS ? 'online' : 'hostlost';
}
export function snapshot() {
  const st = status();
  const players = state ? state.players.map((p, i) => ({ ...p, P: i + 1, host: p.id === state.host, you: p.id === me })) : [];
  const idx = players.findIndex(p => p.you);
  return { sess, state, status: st, online: st === 'online', isHost: isHost(), me, players, myP: idx + 1, N: players.length };
}
export function subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function notify() { const s = snapshot(); lastStatus = s.status; listeners.forEach(f => { try { f(s); } catch (e) { console.error(e); } }); }

// ---------- transport ----------
let libP = null;
function loadLib() {
  if (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) return Promise.resolve();
  if (!libP) {
    libP = new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = new URL('./vendor/supabase.js', import.meta.url).href;
      s.onload = () => res();
      s.onerror = () => { libP = null; rej(new Error('Could not load live library')); };
      document.head.append(s);
    });
  }
  return libP;
}

async function openChannel() {
  chSince = Date.now();
  try { await loadLib(); } catch (e) { chOnline = false; notify(); return; }
  if (!sess) return;
  if (!client) {
    const url = store.get(K.url, null) || CFG.url;
    client = window.supabase.createClient(url, CFG.key, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: 'lg-live-auth' },
      realtime: { vsn: '1.0.0', params: { eventsPerSecond: 40 }, heartbeatIntervalMs: 15000 },
    });
  }
  if (ch) { const old = ch; ch = null; try { client.removeChannel(old); } catch (e) { /* ignore */ } }
  const c = client.channel('lg-' + sess.code, { config: { broadcast: { self: false, ack: false } } });
  ch = c; chOnline = false; chSince = Date.now();
  c.on('broadcast', { event: 'm' }, msg => { if (ch === c) onMsg(msg && msg.payload); });
  c.subscribe(s => {
    if (ch !== c) return;
    const on = s === 'SUBSCRIBED';
    if (on !== chOnline) { chOnline = on; chSince = Date.now(); if (on) onConnected(); notify(); }
  });
}
function send(msg) {
  if (!ch || !chOnline) return false;
  try { const p = ch.send({ type: 'broadcast', event: 'm', payload: msg }); if (p && p.catch) p.catch(() => {}); } catch (e) { return false; }
  return true;
}
function onConnected() {
  if (isHost()) { broadcastState(); }
  else { send({ t: 'need', from: me }); hello(); }
}

// ---------- host side ----------
function persistRoom() { if (isHost() && state) store.set(K.room, state); }
function broadcastState() { clearTimeout(sendT); sendT = 0; if (state) send({ t: 'st', s: state, hnow: Date.now() }); }
function broadcastSoon() { if (!sendT) sendT = setTimeout(broadcastState, 40); }
function bump() { state.v++; persistRoom(); broadcastSoon(); notify(); }
function pruneList(list, map, max) { while (list.length > max) { const k = list.shift(); delete map[k]; } }
function roundOf(key, create) {
  let r = state.r[key];
  if (!r && create) { r = state.r[key] = { l: {}, rev: null }; state.ro.push(key); pruneList(state.ro, state.r, 80); }
  return r;
}

/** Apply one action on the host. Returns true if state changed. */
function apply(a) {
  if (!state || !a || typeof a.from !== 'string') return false;
  seen.set(a.from, Date.now());
  let changed = false;
  let p = state.players.find(x => x.id === a.from);
  if (!p) {
    if (state.players.length >= MAX_PLAYERS || typeof a.name !== 'string') return false;
    p = { id: a.from, name: a.name.slice(0, 20) || 'Player', on: true };
    state.players.push(p); changed = true;
  } else {
    if (typeof a.name === 'string' && a.name && a.name.slice(0, 20) !== p.name) { p.name = a.name.slice(0, 20); changed = true; }
    if (!p.on) { p.on = true; changed = true; }
  }
  if (a.k === 'lock' && typeof a.key === 'string') {
    const r = roundOf(a.key, true);
    if (!r.rev && !same(r.l[a.from], a.val)) { r.l[a.from] = a.val; changed = true; }
  } else if (a.k === 'score' && typeof a.key === 'string' && Number.isFinite(a.val)) {
    let sc = state.sk[a.key];
    if (!sc) { sc = state.sk[a.key] = {}; state.so.push(a.key); pruneList(state.so, state.sk, 150); }
    if (sc[a.from] !== a.val) {
      state.tot[a.from] = (state.tot[a.from] || 0) - (sc[a.from] || 0) + a.val;
      sc[a.from] = a.val; changed = true;
    }
  } else if (a.k === 'rev' && typeof a.key === 'string') {
    const r = roundOf(a.key, true);
    if (!r.rev) { r.rev = a.val && typeof a.val === 'object' ? a.val : { at: Date.now() }; changed = true; }
  }
  return changed;
}

function hostTick() {
  const now = Date.now();
  let changed = false;
  for (const p of state.players) {
    const on = p.id === me ? true : now - (seen.get(p.id) || 0) < PLAYER_OFF_MS;
    if (p.on !== on) { p.on = on; changed = true; }
  }
  if (changed) bump();
  send({ t: 'hb', v: state.v, host: state.host, hnow: now });
}

/** Host-only mutation helper. fn(state) may return false to signal "no change". */
export function hostSet(fn) {
  if (!isHost() || !state) return;
  if (fn(state) === false) return;
  bump();
}
export const setMode = mode => hostSet(s => { if (s.mode === mode) return false; s.mode = mode; });
export const setCode = (mode, C) => hostSet(s => { if (s.C[mode] === C) return false; s.C[mode] = C; });
export const setSettings = (mode, obj) => hostSet(s => { if (same(s.set[mode], obj)) return false; s.set[mode] = obj; });
export const setPtr = (key, i) => hostSet(s => { const r = roundOf(key, true); if (r.ptr === i) return false; r.ptr = i; });
export const setTimer = (key, t) => hostSet(s => { s.tm = { [key]: t }; });
export const resetScores = () => hostSet(s => { s.sk = {}; s.so = []; s.tot = {}; });
export const removePlayer = id => hostSet(s => { if (id === me) return false; const n = s.players.length; s.players = s.players.filter(p => p.id !== id); delete s.tot[id]; seen.delete(id); return s.players.length !== n; });
export const movePlayer = (id, d) => hostSet(s => {
  const i = s.players.findIndex(p => p.id === id), j = i + d;
  if (i < 0 || j < 0 || j >= s.players.length) return false;
  [s.players[i], s.players[j]] = [s.players[j], s.players[i]];
});

// ---------- guest side ----------
function hello() { if (sess) send({ t: 'act', from: me, name: sess.name, k: 'hello' }); }
function reflected(a) {
  if (!state) return false;
  if (a.k === 'lock') { const r = state.r[a.key]; return !!r && (!!r.rev || same(r.l[me], a.val)); }
  if (a.k === 'score') { const s = state.sk[a.key]; return !!s && s[me] === a.val; }
  if (a.k === 'rev') { const r = state.r[a.key]; return !!(r && r.rev); }
  return true;
}
/** Send an action (lock / score / rev). Hosts apply directly; guests send and resend until the host's state shows it. */
export function act(k, key, val) {
  if (!sess) return;
  const a = { t: 'act', from: me, name: sess.name, k, key, val };
  if (isHost()) { if (apply(a)) bump(); return; }
  if (state && reflected(a)) { pending.delete(k + '|' + key); return; }
  const pk = k + '|' + key;
  const prev = pending.get(pk);
  if (prev && same(prev.val, val)) return; // already queued
  pending.set(pk, a);
  send(a);
}
export const lock = (key, val) => act('lock', key, val);
export const score = (key, pts) => act('score', key, pts);
export const reveal = (key, data) => act('rev', key, data || { at: Date.now() });

// ---------- receive ----------
function adopt(s, hnow) {
  const wasHost = isHost();
  state = s;
  if (Number.isFinite(hnow)) offset = Date.now() - hnow;
  if (wasHost && s.host !== me) { sess = { ...sess, role: 'guest' }; store.set(K.sess, sess); store.remove(K.room); }
  for (const [pk, a] of pending) if (reflected(a)) pending.delete(pk);
}
function onMsg(m) {
  if (!m || typeof m !== 'object' || !sess) return;
  if (m.t === 'st' && m.s && m.s.code === sess.code) {
    if (isHost()) {
      if (m.s.host === me) return; // an old copy of our own state
      if (state && m.s.v > state.v) { adopt(m.s, m.hnow); hostSeenAt = Date.now(); notify(); } // someone took over: step down
      else broadcastState();
      return;
    }
    if (!state || m.s.v > state.v || (m.s.host !== state.host && m.s.v >= state.v)) {
      adopt(m.s, m.hnow); hostSeenAt = Date.now(); notify();
    } else if (m.s.host === state.host) { hostSeenAt = Date.now(); if (Number.isFinite(m.hnow)) offset = Date.now() - m.hnow; }
    return;
  }
  if (m.t === 'hb') {
    if (isHost()) {
      if (m.host !== me) { if (state && m.v > state.v) send({ t: 'need', from: me }); else broadcastState(); }
      return;
    }
    if (state && m.host === state.host) { const was = status(); hostSeenAt = Date.now(); if (Number.isFinite(m.hnow)) offset = Date.now() - m.hnow; if (was !== 'online') notify(); }
    if (!state || m.v > state.v || m.host !== state.host) send({ t: 'need', from: me });
    return;
  }
  if (!isHost()) return;
  if (m.t === 'need') { seen.set(m.from, Date.now()); broadcastState(); return; }
  if (m.t === 'act') { if (apply(m)) bump(); else if (m.k === 'hello') broadcastSoon(); }
}

// ---------- lifecycle ----------
function tick() {
  if (!sess) return;
  const now = Date.now();
  // watchdog: a channel that has not come up in 12 s gets rebuilt (phones that slept, flaky signal)
  if (!chOnline && now - chSince > 12000) openChannel();
  if (isHost()) { if (state) hostTick(); }
  else {
    if (now - lastPing > PING_MS) { lastPing = now; send({ t: 'act', from: me, name: sess.name, k: 'ping' }); if (state && !state.players.some(p => p.id === me)) hello(); }
    if (now - lastResend > RESEND_MS && pending.size) { lastResend = now; for (const a of pending.values()) send(a); }
  }
  if (status() !== lastStatus) notify();
}
function startTick() { if (!tickIv) tickIv = setInterval(tick, 1000); }

export function host(name) {
  leave(true);
  sess = { code: newCode(), role: 'host', name: name || 'Host' };
  store.set(K.sess, sess);
  state = freshState(sess.code, sess.name);
  persistRoom();
  joinedAt = Date.now();
  startTick(); openChannel(); notify();
  return sess.code;
}
export function join(code, name) {
  const c = canonRoom(code);
  if (!c) throw new Error('Room codes are 4 letters');
  leave(true);
  sess = { code: c, role: 'guest', name: name || 'Player' };
  store.set(K.sess, sess);
  joinedAt = Date.now(); hostSeenAt = 0;
  startTick(); openChannel(); notify();
}
export function rename(name) {
  if (!sess || !name) return;
  sess = { ...sess, name: name.slice(0, 20) }; store.set(K.sess, sess);
  if (isHost()) hostSet(s => { const p = s.players.find(x => x.id === me); if (!p || p.name === sess.name) return false; p.name = sess.name; });
  else hello();
}
/** Take over as host using the last state this phone saw (when the host's phone died). */
export function claimHost() {
  if (!sess || !state || isHost()) return;
  sess = { ...sess, role: 'host' }; store.set(K.sess, sess);
  state = { ...state, host: me, v: state.v + 1000 + Math.floor(Math.random() * 100) };
  for (const p of state.players) seen.set(p.id, Date.now());
  persistRoom(); broadcastState(); notify();
}
export function leave(silent) {
  if (ch && client) { try { client.removeChannel(ch); } catch (e) { /* ignore */ } }
  ch = null; chOnline = false; state = null; sess = null; pending.clear(); seen.clear();
  store.remove(K.sess); store.remove(K.room);
  if (!silent) notify();
}
/** Resume a saved session after a reload. */
export function resume() {
  if (!sess || !canonRoom(sess.code)) { sess = null; return; }
  if (isHost()) {
    const saved = store.get(K.room, null);
    if (saved && saved.code === sess.code && Array.isArray(saved.players)) state = saved;
    else state = freshState(sess.code, sess.name);
    for (const p of state.players) seen.set(p.id, Date.now());
  }
  joinedAt = Date.now();
  startTick(); openChannel();
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !sess) return;
    // phones kill sockets in the background: ask for fresh state, rebuild if the channel is dead
    if (!chOnline) openChannel(); else if (!isHost()) send({ t: 'need', from: me });
  });
  window.addEventListener('online', () => { if (sess && !chOnline) openChannel(); });
}

// test hooks (used by the multi-phone e2e test only)
export const _debug = { get state() { return state; }, get chOnline() { return chOnline; }, kill() { if (ch && client) { try { client.removeChannel(ch); } catch (e) { /* ignore */ } } ch = null; chOnline = false; chSince = Date.now(); notify(); } };
