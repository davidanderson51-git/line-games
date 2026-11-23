import { spyfallRound } from './engine.js';
import { voteBlock, voteTally, roundPoints } from './ui-live.js';
import { imposterPoints } from './ui-imposter.js';

// Timer + struck-off locations live in module scope so they survive redraws.
// In a live room the host's timer is the truth: T is rebuilt from it on every draw.
const T = { key: '', remaining: 480, running: false, endAt: 0, iv: 0, buzzed: false };
const FULL = 480;
const struck = new Set();
let strikeKey = '';
const fmt = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
const left = () => (T.running ? Math.max(0, Math.ceil((T.endAt - Date.now()) / 1000)) : T.remaining);

function paint() {
  const el = document.getElementById('spy-time');
  if (el) el.textContent = fmt(left());
}
function stopTick() { clearInterval(T.iv); T.iv = 0; }

export default {
  id: 'spyfall',
  files: ['spyfall.json'],
  groupInputs: ctx => ({ N: ctx.N }),
  onLeave() { stopTick(); T.running = false; },
  render(ctx) {
    const { h, body, C, N, P } = ctx;
    const key = `${C}|${N}`;
    const L = ctx.live && ctx.live.online ? ctx.live : null;
    const lkey = `spy|${C}|${N}`;
    if (T.key !== key) { stopTick(); Object.assign(T, { key, remaining: FULL, running: false, buzzed: false }); }
    if (strikeKey !== key) { struck.clear(); strikeKey = key; }
    if (L) {
      const tm = L.timer(lkey);
      if (tm) {
        const wasRunning = T.running;
        T.running = !!tm.run; T.remaining = tm.left;
        if (T.running) T.endAt = L.toLocalMs(tm.at) + tm.left * 1000;
        if (T.running && !wasRunning) T.buzzed = false;
      } else if (T.running || T.remaining !== FULL) { stopTick(); Object.assign(T, { remaining: FULL, running: false, buzzed: false }); }
    }
    const r = spyfallRound({ C, N, P }, ctx.data['spyfall.json']);
    const placeName = () => r.location || spyfallRound({ C, N, P: r.spyNumber === 1 ? 2 : 1 }, ctx.data['spyfall.json']).location;

    body.append(ctx.howTo('One player is the spy and does not know the place. Take turns asking each other questions about it. Spy: work out the place. Others: find the spy before time runs out.'));

    body.append(ctx.reveal({
      label: 'Hold to see your place',
      secret: r.isSpy
        ? "You're the SPY 🕵️"
        : h('div', {}, h('div', { text: r.location }), h('div', { style: 'font-size:22px;font-weight:700;margin-top:6px', text: 'Role: ' + r.role })),
    }));
    body.append(h('div', { class: 'first' }, h('b', { text: 'P' + r.firstAsker }), ' asks first'));

    // timer
    const onEnd = () => { T.running = false; T.remaining = 0; stopTick(); if (!T.buzzed) { T.buzzed = true; ctx.vibrate([400, 150, 400, 150, 800]); } ctx.rerender(); };
    if (T.running && left() <= 0) { T.running = false; T.remaining = 0; }
    const canTime = !L || L.isHost;
    const time = h('div', { id: 'spy-time', class: 'code', 'data-testid': 'timer', style: 'font-size:64px;font-weight:900;text-align:center;font-variant-numeric:tabular-nums', text: fmt(left()) });
    const startBtn = h('button', { type: 'button', class: 'btn primary', 'data-testid': 'timer-start', text: T.running ? '⏸ Pause' : (T.remaining === 0 ? 'Time!' : '▶ Start'), disabled: T.remaining === 0 && !T.running ? true : null,
      onclick: () => {
        if (L) {
          if (T.running) L.setTimer(lkey, { run: false, left: left(), at: L.hostNow() });
          else L.setTimer(lkey, { run: true, left: T.remaining, at: L.hostNow() });
          return;
        }
        if (T.running) { T.remaining = left(); T.running = false; stopTick(); }
        else {
          T.running = true; T.endAt = Date.now() + T.remaining * 1000; T.buzzed = false;
          stopTick(); T.iv = setInterval(() => { paint(); if (left() <= 0) onEnd(); }, 250);
        }
        ctx.rerender();
      } });
    const resetBtn = h('button', { type: 'button', class: 'btn', text: '↺ Reset', onclick: () => {
      if (L) { L.setTimer(lkey, { run: false, left: FULL, at: L.hostNow() }); return; }
      stopTick(); Object.assign(T, { remaining: FULL, running: false, buzzed: false }); ctx.rerender();
    } });
    if (T.running && !T.iv) { T.iv = setInterval(() => { paint(); if (left() <= 0) onEnd(); }, 250); }
    if (!T.running && T.iv) stopTick();

    const timerPanel = h('div', { class: 'panel' }, h('div', { class: 'muted small', style: 'text-align:center', text: 'TIMER' }), time,
      canTime ? h('div', { class: 'setrow', style: 'justify-content:center;margin-top:8px' }, startBtn, resetBtn)
        : h('div', { class: 'small muted', style: 'text-align:center', text: '👑 The host runs the timer for everyone' }));

    const list = h('div', { class: 'locgrid' }, r.locations.map(name =>
      h('button', { type: 'button', class: 'loc' + (struck.has(name) ? ' struck' : ''), 'aria-pressed': String(struck.has(name)), text: name,
        onclick: e => { struck.has(name) ? struck.delete(name) : struck.add(name); e.currentTarget.classList.toggle('struck'); e.currentTarget.setAttribute('aria-pressed', String(struck.has(name))); } })));
    const listPanel = h('div', { class: 'panel' }, h('h2', { text: '📍 Possible places' }), h('p', { class: 'small muted', text: 'Tap to cross off (just for you).' }), list);

    body.append(h('div', { class: 'split' }, timerPanel, listPanel));

    if (L) {
      const v = voteBlock(ctx, lkey, { title: 'Vote: who is the spy?', selKey: lkey });
      body.append(v.node);
      if (v.rev) {
        L.score(lkey, imposterPoints(v.votes, [r.spyNumber], P, v.myVote));
        body.append(h('div', { class: 'answer', 'data-testid': 'answer' },
          h('div', { text: 'Spy: ' + L.label(r.spyNumber) }),
          h('div', { class: 'muted', style: 'font-size:20px;margin-top:6px', text: 'The place was: ' + placeName() })),
          voteTally(ctx, v.votes, [r.spyNumber]), roundPoints(ctx, lkey) || '');
      }
      return;
    }
    const ans = h('div');
    body.append(ans, ctx.confirmButton({
      label: 'Show answer (end of round)', confirmLabel: 'Tap again to show the spy',
      onConfirm: () => ans.replaceChildren(h('div', { class: 'answer', 'data-testid': 'answer' },
        h('div', { text: 'Spy: P' + r.spyNumber }), h('div', { class: 'muted', style: 'font-size:20px;margin-top:6px', text: 'The place was: ' + placeName() }))),
    }));
  },
};
