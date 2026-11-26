// Line Games app shell: router, setup, home, round header, reveal widget, wake lock.
//
// MODE PLUG-IN INTERFACE (see also /UI-INTERFACE.md). Each js/ui-<mode>.js:
//   export default {
//     id: 'imposter',              // matches MODES[].id and the #hash route
//     files: ['imposter.json'],    // data files in data/ (fetched, raw text feeds the sync check)
//     syncMode?: 'ride',           // engine SYNC_FIELDS key if different from id (ridetrivia -> 'ride')
//     usesCode?: false,            // Missions: hides ROUND and the prev/next buttons (header shows P and sync only)
//     groupInputs(ctx) -> object   // fields per engine SYNC_FIELDS except C (App adds C), e.g. {N,pack,k}, {difficulty}, {rideId}, {date}. Never P.
//     render(ctx),                 // append into ctx.body
//     onLeave?()                   // cleanup (timers)
//   }
// ctx = { mode, C, N, P, name, body, data{file:json}, raw{file:text}, h(tag,attrs,...kids), store,
//         reveal({label,secret,sub,onHide}) -> Node   // hold-to-reveal; secret = string|Node|fn. Never style by role: all roles look identical.
//         confirmButton({label,confirmLabel,onConfirm,cls}) -> Node   // two-tap button
//         howTo(text) -> Node                  // collapsible 'How to play' card
//         getSettings(), setSettings(obj)      // per-mode group settings in lg.set.<mode>; setSettings redraws
//         rerender(), toast(msg), vibrate(ms) }
// RULES: render() re-runs FROM SCRATCH on every redraw (round change, setting change, theme). Mode state that must
// survive (timers, in-progress quiz answers) lives in module scope or ctx.store (localStorage), NEVER in the DOM.
// Exceptions thrown by groupInputs/render are caught: the user sees a message and a Fix-in-Setup link.
// Secrets auto-hide on redraw, tab hide, and after 5 s in tap mode. Page scroll resets only on route change.
import { APP_VERSION } from './version.js';
import { canonicalCode, nextCode, prevCode } from './seed.js';
import { syncCheck } from './engine.js';
import * as store from './store.js';
import * as live from './live.js';
import { makeLive, board as liveBoard } from './ui-live.js';

export const MODES = [
  { id: 'imposter',   emoji: '🕵️', name: 'Imposter',          how: 'Everyone gets a secret word. One player has none. Find them.', built: true },
  { id: 'spyfall',    emoji: '🗺️', name: 'Spyfall',           how: 'Ask clever questions to spot the spy before they guess the place.', built: true },
  { id: 'bingo',      emoji: '🎯', name: 'Bingo',             how: 'Spot things around the park and mark your own card.', built: true },
  { id: 'wavelength', emoji: '📡', name: 'Wavelength',        how: 'Give a clue so friends slide to the hidden spot on the dial.', built: true },
  { id: 'missions',   emoji: '🎭', name: 'Secret Missions',   how: 'Sneak a secret mission into the day. Reveal it at dinner.', built: true },
  { id: 'trivia',     emoji: '🧠', name: 'Trivia Showdown',   how: 'Ten questions, four choices. Pick your level and race.', built: true },
  { id: 'ridetrivia', emoji: '🎢', name: 'Ride Trivia',       how: 'Pick a ride and test what you know about it.', built: true },
  { id: 'twotruths',  emoji: '🤥', name: 'Two Truths & a Lie', how: 'Three statements, one fib. Vote, then find the lie.', built: true },
  { id: 'fib',        emoji: '🃏', name: 'Fib Finder',        how: 'Write a fake answer, then spot the real one. Fool your family!', built: true },
  { id: 'rare',       emoji: '💎', name: 'Rare Find',         how: 'Everyone answers the same question. The rarest answer wins!', built: true },
  { id: 'overunder',  emoji: '⚖️', name: 'Over / Under',      how: 'Guess over or under the real number, then check it.', built: true },
];

const $app = document.getElementById('app');
const h = (tag, attrs, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') el.className = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'value') el.value = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
  }
  return el;
};

// ---------- prefs / setup ----------
const prefs = () => store.get('lg.prefs', {}) || {};
const setPref = (k, v) => store.set('lg.prefs', { ...prefs(), [k]: v });
const getSetup = () => store.get('lg.setup', null);
export const canonCode = s => canonicalCode(String(s ?? ''));
function applyTheme() { document.documentElement.setAttribute('data-theme', prefs().sun ? 'sun' : 'dark'); }

let toastTimer = 0;
function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const t = h('div', { class: 'toast', role: 'status', text: msg });
  document.body.append(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), 2200);
}

// ---------- wake lock ----------
let wake = null, wantWake = false;
async function acquireWake() {
  wantWake = true;
  try {
    if (navigator.wakeLock && !wake && document.visibilityState === 'visible') {
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => { wake = null; });
    }
  } catch (e) { /* unsupported or denied: ignore */ }
}
function releaseWake() {
  wantWake = false;
  try { if (wake) wake.release(); } catch (e) { /* ignore */ }
  wake = null;
}

// ---------- reveal widget ----------
const reveals = new Set();
let uid = 0;
export function hideAllSecrets() { reveals.forEach(r => r.hide()); }
function reveal({ label, secret, sub = 'Only you should look', onHide }) {
  let shown = false, autoT = 0;
  const btn = h('button', { type: 'button', class: 'reveal', 'aria-pressed': 'false' });
  const tapNote = h('span', { class: 'small muted' });
  const tapChk = h('input', { type: 'checkbox', id: 'tapmode-' + (++uid) });
  const tapLbl = h('label', { class: 'toggle small', for: tapChk.id }, tapChk, 'Tap mode (tap to show / hide)');
  const inst = { hide() { if (shown) { shown = false; draw(); } }, isShown: () => shown };
  const isTap = () => !!prefs().tapMode;
  function draw() {
    btn.className = 'reveal' + (shown ? ' shown' : '');
    clearTimeout(autoT);
    if (shown && isTap()) autoT = setTimeout(() => inst.hide(), 5000);
    btn.setAttribute('aria-pressed', String(shown));
    btn.replaceChildren();
    if (shown) {
      btn.append(h('div', { class: 'secret' }, typeof secret === 'function' ? secret() : secret),
        h('div', { class: 'sub', text: isTap() ? 'Tap to hide' : 'Release to hide' }));
    } else {
      btn.append(h('div', { text: '👆 ' + (label || (isTap() ? 'Tap to reveal' : 'Hold to reveal')) }),
        h('div', { class: 'sub', text: sub }));
    }
    tapChk.checked = isTap();
  }
  const show = () => { if (!shown) { shown = true; draw(); } };
  inst.hide = () => { if (shown) { shown = false; draw(); if (onHide) setTimeout(onHide, 0); } };
  btn.addEventListener('pointerdown', e => { if (!isTap() && e.isPrimary !== false) { e.preventDefault(); show(); } });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => btn.addEventListener(ev, () => { if (!isTap()) inst.hide(); }));
  btn.addEventListener('click', () => { if (isTap()) { shown ? inst.hide() : show(); } });
  btn.addEventListener('contextmenu', e => e.preventDefault());
  btn.addEventListener('keydown', e => { if (!isTap() && (e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); show(); } });
  btn.addEventListener('keyup', e => { if (!isTap() && (e.key === ' ' || e.key === 'Enter')) inst.hide(); });
  btn.addEventListener('blur', () => { if (!isTap()) inst.hide(); });
  tapChk.addEventListener('change', () => { setPref('tapMode', tapChk.checked); reveals.forEach(r => { r.hide(); r.refresh && r.refresh(); }); });
  inst.refresh = draw;
  reveals.add(inst);
  draw();
  return h('div', { class: 'reveal-wrap', 'data-reveal': '' }, btn, h('div', { class: 'reveal-opts' }, tapLbl, tapNote));
}

// Armed state survives redraws (live rooms redraw when other phones act), keyed by label, for 4 s.
const armedAt = new Map();
function confirmButton({ label, confirmLabel = 'Tap again to confirm', onConfirm, cls = 'btn block' }) {
  const left = () => 4000 - (Date.now() - (armedAt.get(label) || 0));
  let armed = left() > 0, t = 0;
  const b = h('button', { type: 'button', class: cls, text: label });
  const disarm = () => { armed = false; armedAt.delete(label); b.textContent = label; b.classList.remove('confirm'); };
  const arm = ms => { armed = true; b.textContent = confirmLabel; b.classList.add('confirm'); t = setTimeout(() => { if (b.isConnected) disarm(); else armed = false; }, ms); };
  if (armed) arm(left());
  b.addEventListener('click', () => {
    if (!armed) { armedAt.set(label, Date.now()); arm(4000); }
    else { clearTimeout(t); disarm(); onConfirm(); }
  });
  return b;
}

// ---------- data ----------
const rawCache = new Map();
async function loadRaw(file) {
  if (rawCache.has(file)) return rawCache.get(file);
  const res = await fetch('data/' + file);
  if (!res.ok) throw new Error(file + ' ' + res.status);
  const text = await res.text();
  JSON.parse(text);
  rawCache.set(file, text);
  return text;
}

// ---------- screens ----------
let current = null; // { mode module, cleanup }
function appBar(title, { home = false } = {}) {
  const sun = !!prefs().sun;
  return [
    h('div', { class: 'bunting', 'aria-hidden': 'true' }),
    h('div', { class: 'appbar' },
      home ? h('a', { class: 'ibtn', href: '#home', 'aria-label': 'Home', text: '🏠' }) : null,
      h('h1', {}, title),
      h('button', { type: 'button', class: 'ibtn', 'aria-label': sun ? 'Switch to dark mode' : 'Switch to Sun mode', 'aria-pressed': String(sun), text: sun ? '🌙' : '☀️',
        onclick: () => { setPref('sun', !prefs().sun); applyTheme(); route(); } }),
      h('a', { class: 'ibtn', href: '#setup', 'aria-label': 'Settings', text: '⚙' })),
  ];
}
let scrollNext = true;
function mount(...nodes) { $app.replaceChildren(h('div', { class: 'wrap' }, nodes)); if (scrollNext) { scrollNext = false; window.scrollTo(0, 0); } }
function howTo(text) {
  const d = h('details', { class: 'howto' }, h('summary', { text: '❓ How to play' }), h('p', { text }));
  return d;
}
const vibrate = ms => { try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) { /* ignore */ } };

function homeScreen() {
  const s = getSetup();
  const tiles = MODES.map(m => {
    const tile = h(m.built ? 'a' : 'button', {
      class: 'tile', 'data-mode': m.id, href: m.built ? '#' + m.id : null, type: m.built ? null : 'button',
      'aria-disabled': m.built ? null : 'true',
      onclick: m.built ? null : () => toast(m.name + ' is coming soon'),
    },
      m.built ? null : h('span', { class: 'soon', text: 'Coming soon' }),
      h('span', { class: 'emo', 'aria-hidden': 'true', text: m.emoji }),
      h('span', { class: 'nm', text: m.name }),
      h('span', { class: 'how', text: m.how }));
    return tile;
  });
  mount(appBar(h('span', {}, h('span', { class: 'star', text: '⭐ ' }), 'Line Games')),
    liveCard(),
    h('p', { class: 'muted' }, s.name ? `Hi ${s.name}! ` : '', `You are P${s.P} of ${s.N}.`),
    h('div', { class: 'tiles' }, tiles),
    h('div', { class: 'footlinks' },
      h('a', { class: 'btn', href: 'rules.html', text: '📜 Rules sheet' }),
      h('a', { class: 'btn', href: '#setup', text: '⚙ Setup' })));
}

function stepper(label, get, min, max, onChange, fmt = v => v) {
  const val = h('div', { class: 'val', 'aria-live': 'polite', text: fmt(get()) });
  const set = d => { const v = Math.max(min, Math.min(max, get() + d)); onChange(v); val.textContent = fmt(v); };
  return h('div', { class: 'field' }, h('span', { class: 'muted', text: label }),
    h('div', { class: 'stepper' },
      h('button', { type: 'button', class: 'btn', 'aria-label': 'Decrease ' + label, text: '−', onclick: () => set(-1) }),
      val,
      h('button', { type: 'button', class: 'btn', 'aria-label': 'Increase ' + label, text: '+', onclick: () => set(1) })));
}

function setupScreen() {
  const saved = getSetup();
  const st = { name: saved?.name || '', P: saved?.P || 1, N: saved?.N || 8, code: saved?.code || 1 };
  const warn = h('p', { class: 'warn', 'aria-live': 'polite' });
  const checkWarn = () => { warn.textContent = st.P > st.N ? `Your number P${st.P} is higher than the player count ${st.N}. Pick 1–${st.N}.` : ''; };
  const nameIn = h('input', { class: 'input', type: 'text', autocomplete: 'nickname', maxlength: '20', value: st.name, oninput: e => { st.name = e.target.value.trim(); } });
  const codeIn = h('input', { class: 'input', type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: '4', autocomplete: 'off', value: String(st.code), 'aria-label': 'Starting round code' });
  const codeErr = h('p', { class: 'warn' });
  codeIn.addEventListener('input', () => { const c = canonCode(codeIn.value); codeErr.textContent = c ? '' : 'Use 1–9999'; if (c) st.code = c; });
  const pStep = stepper('Your player number', () => st.P, 1, 10, v => { st.P = v; checkWarn(); }, v => 'P' + v);
  const nStep = stepper('Player count', () => st.N, 3, 10, v => { st.N = v; checkWarn(); });
  checkWarn();
  const stOut = h('div');
  const save = () => {
    const c = canonCode(codeIn.value);
    if (!c) { codeErr.textContent = 'Use 1–9999'; codeIn.focus(); return; }
    st.code = c;
    store.set('lg.setup', { name: nameIn.value.trim(), P: st.P, N: st.N, code: c });
    location.hash = '#home';
  };
  const resetCodes = () => { MODES.forEach(m => store.remove('lg.code.' + m.id)); toast('Round codes reset to start code on next open'); };
  mount(appBar('Setup', { home: !!saved }),
    saved ? null : liveCard(),
    saved ? null : h('p', { class: 'small muted', style: 'text-align:center', text: 'Or play offline: set your number and count below.' }),
    h('div', { class: 'panel' },
      h('label', { class: 'field' }, h('span', { text: 'Your name' }), nameIn),
      pStep, nStep, warn,
      h('label', { class: 'field' }, h('span', { text: 'Starting round code (1–9999)' }), codeIn), codeErr,
      h('p', { class: 'small muted', text: 'Everyone must use the same player count and starting code. Numbers go 1..N with no gaps.' }),
      h('button', { type: 'button', class: 'btn primary block', text: saved ? 'Save' : 'Save & play', onclick: save }),
      h('button', { type: 'button', class: 'btn block', style: 'margin-top:10px', text: 'Reset round codes to start code', onclick: () => { save(); resetCodes(); } })),
    h('div', { class: 'panel' },
      h('h2', { text: 'App version' }),
      h('p', { class: 'big', style: 'font-size:28px;font-weight:900', text: APP_VERSION }),
      h('p', { class: 'small muted', text: 'Everyone must see the same version, or your games will not match.' }),
      h('button', { type: 'button', class: 'btn block', text: '⚙ Run self-test', onclick: () => runSelfTest(stOut) }),
      stOut));
}

async function runSelfTest(out) {
  out.replaceChildren(h('p', { text: 'Running…' }));
  try {
    const mod = await import('./selftest.js');
    const r = await mod.selfTest();
    const pass = r === true || (r && (r.pass === true || r.ok === true || r.passed === true));
    out.replaceChildren(h('p', { class: pass ? 'pass' : 'fail', text: pass ? 'PASS' : 'FAIL' }),
      typeof r === 'object' ? h('div', { class: 'selftest', text: JSON.stringify(r, null, 1) }) : null);
  } catch (e) {
    out.replaceChildren(h('p', { class: 'fail', text: 'FAIL' }), h('div', { class: 'selftest', text: String(e && e.stack || e) }));
  }
}

function blockScreen(s, title) {
  mount(appBar(title, { home: true }),
    h('div', { class: 'block-screen' },
      h('div', { class: 'big', text: `Pick your number (1–${s.N})` }),
      h('p', { text: `You are set to P${s.P} but there are ${s.N} players.` }),
      h('a', { class: 'btn primary', href: '#setup', text: 'Fix in Setup' })));
}

let navAt = 0, routeSeq = 0;
async function modeScreen(id) {
  const seq = routeSeq;
  const meta = MODES.find(m => m.id === id);
  const s = getSetup();
  if (!meta || !meta.built) { location.hash = '#home'; return; }
  acquireWake();
  if (!live.session() && !(Number.isInteger(s.N) && s.N >= 3 && s.N <= 10)) { mount(appBar(meta.name, { home: true }), h('div', { class: 'block-screen' }, h('div', { class: 'big', text: 'Player count must be 3–10' }), h('a', { class: 'btn primary', href: '#setup', text: 'Fix in Setup' }))); return; }
  if (!(Number.isInteger(s.P) && s.P >= 1 && s.P <= Math.max(s.N, 3))) { blockScreen(s, meta.name); return; }
  let mod;
  try { mod = (await import(`./ui-${id}.js`)).default; if (seq !== routeSeq) return; }
  catch (e) { mount(appBar(meta.name, { home: true }), h('div', { class: 'panel' }, h('p', { class: 'warn', text: 'Could not load this game.' }), h('pre', { class: 'selftest', text: String(e) }))); return; }
  const codeKey = 'lg.code.' + id;
  let C = canonCode(store.get(codeKey, null));
  if (!C) { C = canonCode(s.code) || 1; store.set(codeKey, C); }
  const raw = {}, data = {};
  try {
    for (const f of mod.files) { raw[f] = await loadRaw(f); data[f] = JSON.parse(raw[f]); }
    if (seq !== routeSeq) return;
  } catch (e) {
    mount(appBar(meta.name, { home: true }), h('div', { class: 'panel' }, h('p', { class: 'warn', text: 'Game content failed to load.' }), h('p', { class: 'small muted', text: String(e) }),
      h('button', { type: 'button', class: 'btn primary', text: 'Retry', onclick: () => route() })));
    return;
  }
  const settingsKey = 'lg.set.' + id;
  const draw = () => {
    if (current && current.id !== id) return; // route changed during async work
    reveals.clear();
    const s2 = getSetup();
    C = canonCode(store.get(codeKey, null)) || C;
    const snap = live.snapshot();
    const L = makeLive(snap);
    if (L && L.isHost) { live.setMode(id); live.setCode(id, C); live.setSettings(id, store.get(settingsKey, {}) || {}); }
    if (!(Number.isInteger(s2.N) && s2.N >= 3 && s2.N <= 10)) {
      mount(appBar(meta.name, { home: true }), liveBar(snap), h('div', { class: 'block-screen' }, h('div', { class: 'big', text: L ? 'Need 3 or more players' : 'Player count must be 3–10' }),
        L ? h('p', { text: `${s2.N} in room ${L.code} so far. Get everyone to join.` }) : null,
        h('a', { class: 'btn primary', href: L ? '#lobby' : '#setup', text: L ? 'Back to the lobby' : 'Fix in Setup' })));
      return;
    }
    const body = h('div', { class: 'modebody' });
    const ctx = {
      mode: id, C, N: s2.N, P: s2.P, name: s2.name, body, data, raw, h, store, toast,
      reveal, confirmButton, howTo, vibrate, live: L, canControl: !L || L.canControl,
      getSettings: () => store.get(settingsKey, {}) || {},
      setSettings: o => {
        if (L && !L.canControl) { toast('The host picks this'); return; }
        const next = { ...(store.get(settingsKey, {}) || {}), ...o };
        store.set(settingsKey, next); if (L && L.isHost) live.setSettings(id, next); draw();
      },
      rerender: () => draw(),
    };
    const fail = e => {
      mount(appBar(meta.name, { home: true }), h('div', { class: 'panel' }, h('p', { class: 'warn', text: 'Something is wrong with your settings or this game.' }),
        h('pre', { class: 'selftest', text: String(e && e.message || e) }), h('a', { class: 'btn primary', href: '#setup', text: 'Fix in Setup' })));
    };
    let sc;
    try { sc = syncCheck(mod.syncMode || id, { ...mod.groupInputs(ctx), C }, mod.files.map(f => raw[f]).join('\n')); }
    catch (e) { fail(e); return; }
    const go = d => {
      const now = Date.now(); if (now - navAt < 400) return; navAt = now;
      if (L && !L.canControl) return;
      C = d > 0 ? nextCode(C) : prevCode(C);
      store.set(codeKey, C); if (L && L.isHost) live.setCode(id, C); draw();
    };
    const you = h('div', { class: 'you', text: `You are P${s2.P} of ${s2.N}` + (L ? ` · ${L.name(s2.P)}` : '') });
    const follow = L && !L.canControl;
    const syncEl = h('div', { class: 'sync' }, 'Sync check', h('b', { 'data-testid': 'sync', 'aria-label': 'sync check ' + sc.names.join(', '), text: sc.emoji }));
    const header = mod.usesCode === false
      ? h('div', { class: 'round' }, you, syncEl)
      : h('div', { class: 'round' },
        h('div', { class: 'row1' },
          follow ? null : h('button', { type: 'button', class: 'btn nav', 'aria-label': 'Previous round', text: '◀', onclick: () => go(-1) }),
          h('div', { class: 'mid' }, h('div', { class: 'lbl', text: 'ROUND' }), h('div', { class: 'code', 'data-testid': 'code', text: String(C) })),
          follow ? null : h('button', { type: 'button', class: 'btn nav primary', 'aria-label': 'Next round', 'data-testid': 'next-round', text: '▶', onclick: () => go(1) })),
        follow ? h('div', { class: 'small muted', style: 'text-align:center', text: '👑 The host moves everyone to the next round' }) : null,
        you, syncEl);
    try { mod.render(ctx); } catch (e) { fail(e); return; }
    mount(appBar('Line Games', { home: true }), liveBar(snap), h('div', { class: 'modename' }, h('span', { text: meta.emoji }), meta.name), header, body,
      L ? liveBoard(h, snap) : null);
  };
  current = { id, mod, draw };
  draw();
}

// ---------- live rooms (lobby, status bar, sync from the host) ----------
const STATUS_TEXT = {
  online: '🟢 Live', connecting: '⏳ Connecting…', offline: '📴 Offline · keep playing, your games still match',
  hostlost: '⚠️ Host phone is offline · keep playing', notfound: '🔎 Looking for the room…',
};
function liveBar(snap) {
  if (!snap || !snap.sess) return null;
  const st = snap.status;
  const bar = h('div', { class: 'livebar ' + (st === 'online' ? 'on' : 'off'), 'data-testid': 'livebar', 'data-status': st },
    h('a', { href: '#lobby', class: 'lb-main' },
      h('b', { text: `Room ${snap.sess.code}` }),
      h('span', { text: st === 'online' ? ` · ${snap.N} players${snap.isHost ? ' · 👑 you host' : ''}` : '' }),
      h('span', { class: 'lb-st', text: STATUS_TEXT[st] || st })));
  if (st === 'hostlost') bar.append(h('button', { type: 'button', class: 'btn', 'data-testid': 'claim', text: '👑 Become host', onclick: () => { live.claimHost(); toast('You are the host now'); } }));
  return bar;
}

function liveCard() {
  const snap = live.snapshot();
  if (!snap.sess) {
    return h('a', { class: 'tile livecard', href: '#lobby', 'data-testid': 'play-together' },
      h('span', { class: 'emo', 'aria-hidden': 'true', text: '📡' }),
      h('span', { class: 'nm', text: 'Play together' }),
      h('span', { class: 'how', text: 'One phone hosts a room code, everyone joins, and reveals and points sync live.' }));
  }
  return liveBar(snap);
}

function playerRow(p, snap) {
  const L = snap.isHost;
  return h('div', { class: 'prow' + (p.on ? '' : ' away') + (p.you ? ' you' : ''), 'data-testid': 'player' },
    h('span', { class: 'pnum', text: 'P' + p.P }),
    h('span', { class: 'pname', text: p.name + (p.you ? ' (you)' : '') }),
    p.host ? h('span', { class: 'ptag', text: '👑 host' }) : null,
    h('span', { class: 'pdot', title: p.on ? 'online' : 'offline', text: p.on ? '🟢' : '⚪' }),
    L && p.P > 1 ? h('button', { type: 'button', class: 'ibtn sm', 'aria-label': 'Move up', text: '▲', onclick: () => live.movePlayer(p.id, -1) }) : null,
    L && !p.you && !p.on ? h('button', { type: 'button', class: 'ibtn sm', 'aria-label': 'Remove ' + p.name, text: '✕', onclick: () => live.removePlayer(p.id) }) : null);
}

function lobbyScreen() {
  const snap = live.snapshot();
  const s = getSetup();
  if (!snap.sess) {
    const nameIn = h('input', { class: 'input', type: 'text', autocomplete: 'nickname', maxlength: '20', value: s?.name || '', 'aria-label': 'Your name', 'data-testid': 'live-name' });
    const codeIn = h('input', { class: 'input roomin', type: 'text', maxlength: '4', autocomplete: 'off', autocapitalize: 'characters', spellcheck: 'false', placeholder: 'ABCD', 'aria-label': 'Room code', 'data-testid': 'room-in' });
    const err = h('p', { class: 'warn', 'aria-live': 'polite' });
    const needName = () => { const n = nameIn.value.trim(); if (!n) { err.textContent = 'Type your name first'; nameIn.focus(); } return n; };
    const ensureSetup = n => { store.set('lg.setup', { ...(s || { P: 1, N: 3, code: 1 }), name: n }); };
    codeIn.addEventListener('input', () => { codeIn.value = codeIn.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    mount(appBar('Play together', { home: !!s }),
      h('div', { class: 'panel' },
        h('label', { class: 'field' }, h('span', { text: 'Your name' }), nameIn),
        h('button', { type: 'button', class: 'btn primary block', 'data-testid': 'host-btn', text: '👑 Host a new room',
          onclick: () => { const n = needName(); if (!n) return; ensureSetup(n); live.host(n); lobbyScreen(); } }),
        h('div', { class: 'ordiv', text: 'or join one' }),
        h('label', { class: 'field' }, h('span', { text: 'Room code from the host' }), codeIn),
        h('button', { type: 'button', class: 'btn block', 'data-testid': 'join-btn', text: '🚪 Join room',
          onclick: () => { const n = needName(); if (!n) return; const c = live.canonRoom(codeIn.value); if (!c) { err.textContent = 'Room codes are 4 letters'; codeIn.focus(); return; } ensureSetup(n); live.join(c, n); lobbyScreen(); } }),
        err),
      h('p', { class: 'small muted', text: 'Needs internet. If the signal drops in line, everyone keeps playing offline and catches up when it comes back.' }));
    return;
  }
  const st = snap.status, code = snap.sess.code;
  const parts = [appBar('Play together', { home: true })];
  parts.push(h('div', { class: 'panel roomcard' },
    h('div', { class: 'muted small', text: 'ROOM CODE' }),
    h('div', { class: 'roomcode', 'data-testid': 'room-code', 'aria-label': 'Room code ' + code }, [...code].map(ch => h('span', { text: ch }))),
    h('div', { class: 'small', text: snap.isHost ? 'Everyone: open Line Games → Play together → type this code.' : `Joined as ${snap.sess.name}` }),
    h('div', { class: 'lb-st', 'data-testid': 'lobby-status', 'data-status': st, text: STATUS_TEXT[st] || st })));
  if (st === 'notfound') parts.push(h('div', { class: 'panel' }, h('p', { class: 'warn', text: `No room ${code} found yet. Check the code with the host, and make sure their phone has the app open.` })));
  if (st === 'hostlost') parts.push(liveBar(snap));
  if (snap.players.length) {
    parts.push(h('div', { class: 'panel' }, h('h2', { text: `Players (${snap.N})` }),
      h('p', { class: 'small muted', text: 'Player numbers are set by the room. Nobody needs to pick one.' }),
      h('div', { class: 'plist' }, snap.players.map(p => playerRow(p, snap))),
      snap.N < 3 ? h('p', { class: 'warn', text: 'Most games need at least 3 players.' }) : null));
  }
  if (snap.state) {
    if (snap.isHost) {
      parts.push(h('h2', { class: 'lobbyh', text: 'Pick a game · everyone follows you' }),
        h('div', { class: 'tiles' }, MODES.map(m => h('a', { class: 'tile', 'data-mode': m.id, href: '#' + m.id },
          h('span', { class: 'emo', 'aria-hidden': 'true', text: m.emoji }), h('span', { class: 'nm', text: m.name }), h('span', { class: 'how', text: m.how })))));
    } else if (st === 'online') {
      parts.push(h('div', { class: 'first', text: '⏳ Waiting for the host to pick a game…' }));
    }
    parts.push(liveBoard(h, snap, { open: true }));
    if (snap.isHost) parts.push(confirmButton({ label: 'Reset party points', confirmLabel: 'Tap again to reset everyone\'s points', onConfirm: () => live.resetScores() }));
  }
  const nameIn = h('input', { class: 'input', type: 'text', maxlength: '20', value: snap.sess.name, 'aria-label': 'Your name' });
  parts.push(h('details', { class: 'howto' }, h('summary', { text: '✏️ Change my name' }),
    h('div', { class: 'setrow' }, nameIn, h('button', { type: 'button', class: 'btn', text: 'Save', onclick: () => { const n = nameIn.value.trim(); if (n) { live.rename(n); store.set('lg.setup', { ...(getSetup() || {}), name: n }); toast('Saved'); } } }))));
  parts.push(confirmButton({ label: snap.isHost ? 'Close room (leave)' : 'Leave room', confirmLabel: 'Tap again to leave', cls: 'btn block',
    onConfirm: () => { live.leave(); location.hash = '#home'; } }));
  mount(...parts);
}

let appliedMode, liveSig = '', liveT = 0;
/** Apply the host's room state to this phone (guests), and redraw what is on screen. */
function onLive(snap) {
  let changed = false;
  if (snap.state && snap.myP > 0) {
    const s = getSetup() || { code: 1 };
    const want = { ...s, name: snap.sess.name, P: snap.myP, N: snap.N };
    if (s.P !== want.P || s.N !== want.N || s.name !== want.name) { store.set('lg.setup', want); changed = true; }
  }
  if (snap.state && !snap.isHost && snap.online) {
    for (const [m, c] of Object.entries(snap.state.C || {})) {
      if (store.get('lg.code.' + m, null) !== c) { store.set('lg.code.' + m, c); changed = true; }
    }
    for (const [m, o] of Object.entries(snap.state.set || {})) {
      if (JSON.stringify(store.get('lg.set.' + m, {}) || {}) !== JSON.stringify(o || {})) { store.set('lg.set.' + m, o || {}); changed = true; }
    }
    if (snap.state.mode !== appliedMode) {
      appliedMode = snap.state.mode;
      const want = appliedMode ? '#' + appliedMode : '#lobby';
      if (location.hash !== want) { location.hash = want; return; }
    }
  }
  if (!snap.sess) appliedMode = undefined;
  const sig = [snap.state ? snap.state.v : 0, snap.status, snap.myP, snap.N, snap.sess ? snap.sess.code : ''].join('|');
  if (sig === liveSig && !changed) return;
  liveSig = sig;
  clearTimeout(liveT);
  liveT = setTimeout(liveRedraw, 30);
}
function liveRedraw() {
  if (!current || !current.draw) return;
  const a = document.activeElement;
  const busy = [...reveals].some(r => r.isShown && r.isShown()) ||
    (a && a.tagName === 'INPUT' && /^(text|number|range)$/.test(a.type) && $app.contains(a)) ||
    (a && a.tagName === 'SELECT' && $app.contains(a));
  if (busy) { clearTimeout(liveT); liveT = setTimeout(liveRedraw, 400); return; }
  const y = window.scrollY;
  current.draw();
  window.scrollTo(0, y);
}

function leaveCurrent() {
  if (current && current.mod && current.mod.onLeave) { try { current.mod.onLeave(); } catch (e) { /* ignore */ } }
  current = null; reveals.clear();
}

function route() {
  routeSeq++;
  scrollNext = true;
  leaveCurrent();
  const id = (location.hash || '').replace(/^#/, '');
  document.body.dataset.route = id || 'home';
  if (live.isHost() && !MODES.some(m => m.id === id)) live.setMode(null);
  if (id === 'lobby') { releaseWake(); current = { id: 'lobby', draw: lobbyScreen }; lobbyScreen(); return; }
  if (!getSetup() || id === 'setup') { releaseWake(); if (!getSetup() && id !== 'setup') { location.replace('#setup'); return; } setupScreen(); return; }
  if (MODES.some(m => m.id === id)) { modeScreen(id); return; }
  releaseWake();
  current = { id: 'home', draw: homeScreen };
  homeScreen();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') hideAllSecrets();
  else if (wantWake) acquireWake();
});
window.addEventListener('pagehide', hideAllSecrets);
window.addEventListener('hashchange', route);
applyTheme();
live.subscribe(onLive);
live.resume();
route();

// ---------- service worker + update banner ----------
if ('serviceWorker' in navigator) {
  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (!refreshing && window.__lgUpdate) { refreshing = true; location.reload(); } });
  const banner = document.getElementById('update-banner');
  const offer = w => { banner.hidden = false; document.getElementById('update-btn').onclick = () => { window.__lgUpdate = true; w.postMessage({ type: 'SKIP_WAITING' }); }; };
  navigator.serviceWorker.register('sw.js').then(reg => {
    if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
    reg.addEventListener('updatefound', () => {
      const w = reg.installing;
      if (w) w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) offer(w); });
    });
  }).catch(() => { /* offline support unavailable */ });
}
