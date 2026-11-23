import { spyfallRound } from './engine.js';

// Timer + struck-off locations live in module scope so they survive redraws.
const T = { key: '', remaining: 480, running: false, endAt: 0, iv: 0, buzzed: false };
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
    if (T.key !== key) { stopTick(); Object.assign(T, { key, remaining: 480, running: false, buzzed: false }); }
    if (strikeKey !== key) { struck.clear(); strikeKey = key; }
    const r = spyfallRound({ C, N, P }, ctx.data['spyfall.json']);

    body.append(ctx.howTo('One player is the spy and does not know the place. Take turns asking each other questions about it. Spy: work out the place. Others: find the spy before time runs out.'));

    body.append(ctx.reveal({
      label: 'Hold to see your place',
      secret: r.isSpy
        ? "You're the SPY 🕵️"
        : h('div', {}, h('div', { text: r.location }), h('div', { style: 'font-size:22px;font-weight:700;margin-top:6px', text: 'Role: ' + r.role })),
    }));
    body.append(h('div', { class: 'first' }, h('b', { text: 'P' + r.firstAsker }), ' asks first'));

    // timer
    if (T.running && left() <= 0) { T.running = false; T.remaining = 0; }
    const time = h('div', { id: 'spy-time', class: 'code', 'data-testid': 'timer', style: 'font-size:64px;font-weight:900;text-align:center;font-variant-numeric:tabular-nums', text: fmt(left()) });
    const startBtn = h('button', { type: 'button', class: 'btn primary', text: T.running ? '⏸ Pause' : (T.remaining === 0 ? 'Time!' : '▶ Start'), disabled: T.remaining === 0 && !T.running ? true : null,
      onclick: () => {
        if (T.running) { T.remaining = left(); T.running = false; stopTick(); }
        else {
          T.running = true; T.endAt = Date.now() + T.remaining * 1000; T.buzzed = false;
          stopTick(); T.iv = setInterval(() => {
            paint();
            if (left() <= 0) { T.running = false; T.remaining = 0; stopTick(); if (!T.buzzed) { T.buzzed = true; ctx.vibrate([400, 150, 400, 150, 800]); } ctx.rerender(); }
          }, 250);
        }
        ctx.rerender();
      } });
    const resetBtn = h('button', { type: 'button', class: 'btn', text: '↺ Reset', onclick: () => { stopTick(); Object.assign(T, { remaining: 480, running: false, buzzed: false }); ctx.rerender(); } });
    if (T.running && !T.iv) { T.iv = setInterval(() => { paint(); if (left() <= 0) { T.running = false; T.remaining = 0; stopTick(); if (!T.buzzed) { T.buzzed = true; ctx.vibrate([400, 150, 400, 150, 800]); } ctx.rerender(); } }, 250); }

    const timerPanel = h('div', { class: 'panel' }, h('div', { class: 'muted small', style: 'text-align:center', text: 'TIMER' }), time,
      h('div', { class: 'setrow', style: 'justify-content:center;margin-top:8px' }, startBtn, resetBtn));

    const list = h('div', { class: 'locgrid' }, r.locations.map(name =>
      h('button', { type: 'button', class: 'loc' + (struck.has(name) ? ' struck' : ''), 'aria-pressed': String(struck.has(name)), text: name,
        onclick: e => { struck.has(name) ? struck.delete(name) : struck.add(name); e.currentTarget.classList.toggle('struck'); e.currentTarget.setAttribute('aria-pressed', String(struck.has(name))); } })));
    const listPanel = h('div', { class: 'panel' }, h('h2', { text: '📍 Possible places' }), h('p', { class: 'small muted', text: 'Tap to cross off (just for you).' }), list);

    body.append(h('div', { class: 'split' }, timerPanel, listPanel));
  },
};
