import { overUnderPrompt } from './engine.js';
import { ensureQuizCss } from './ui-quiz.js';
import { lockStatus, roundPoints } from './ui-live.js';

let side = null, num = '', selC = null;
const fmt = (v, unit) => (unit === '$' ? '$' + v : unit ? `${v} ${unit}` : String(v));

export default {
  id: 'overunder',
  files: ['overunder.json'],
  groupInputs() { return {}; },
  render(ctx) {
    ensureQuizCss();
    const { h, C, body, store } = ctx;
    if (selC !== C) { selC = C; side = null; num = ''; }
    const p = overUnderPrompt({ C }, ctx.data['overunder.json']);
    const key = 'lg.ou.round.' + C;
    const st = store.get(key, null) || { lock: null, result: null };
    const tk = 'lg.ou.tally';
    const L = ctx.live && ctx.live.online ? ctx.live : null;
    const lkey = `ou|${C}`;
    const R = L ? L.round(lkey) : null;
    const mark = res => { st.result = res; const t = store.get(tk, { right: 0, wrong: 0 }); t[res]++; store.set(tk, t); store.set(key, st); };
    if (L) {
      if (st.lock && !R.rev) L.lock(lkey, st.lock);
      if (R.rev && R.rev.ans && st.lock && !st.result) mark(st.lock.side === R.rev.ans ? 'right' : 'wrong');
      if (R.rev && R.rev.ans) L.score(lkey, st.lock && st.lock.side === R.rev.ans ? 1 : 0);
    }
    const tally = store.get(tk, { right: 0, wrong: 0 });
    const save = () => { store.set(key, st); ctx.rerender(); };

    body.append(ctx.howTo(L ? 'Is the real number over or under the reference? Everyone locks a guess. The host checks the real answer and taps it, and points are scored for everyone.'
      : 'Is the real number over or under the reference? Lock a guess (a number is optional), check it in real life, then tap right or wrong.'));
    body.append(h('div', { class: 'qtext', text: p.text }),
      h('div', { class: 'qm muted', style: 'text-align:center', text: 'REFERENCE' }),
      h('div', { class: 'qref', 'data-testid': 'ref', text: fmt(p.ref, p.unit) }));

    if (!st.lock && !(R && R.rev)) {
      body.append(h('div', { class: 'qrow2' },
        ['over', 'under'].map(s => h('button', { class: 'qchoice' + (side === s ? ' sel' : ''), style: 'justify-content:center;font-size:24px', 'data-testid': 'ou-' + s,
          'aria-pressed': side === s ? 'true' : 'false', onclick: () => { side = s; ctx.rerender(); }, text: s === 'over' ? '⬆️ Over' : '⬇️ Under' }))));
      body.append(h('div', { style: 'margin:12px 0' },
        h('input', { class: 'qinput', type: 'number', inputmode: 'decimal', placeholder: 'Optional: your number', 'aria-label': 'Your number guess',
          value: num, oninput: e => { num = e.target.value; } })));
      body.append(h('div', { class: 'qactions' }, h('button', { class: 'btn primary block', disabled: side === null || null, 'data-testid': 'lock',
        onclick: () => { st.lock = { side, num: num.trim() }; save(); }, text: side === null ? 'Pick Over or Under' : 'Lock guess' })));
    } else if (st.lock) {
      body.append(h('div', { class: 'panel', style: 'text-align:center;font-size:24px;font-weight:800' },
        `Your guess: ${st.lock.side === 'over' ? 'Over' : 'Under'}` + (st.lock.num ? ` (about ${fmt(st.lock.num, p.unit)})` : '')));
    }
    if (L) {
      // everyone's guesses are shown once you have locked yours
      const rows = L.players.filter(x => R.l[x.id]).map(x => ({ x, g: R.l[x.id] }));
      if (st.lock || R.rev) {
        body.append(h('div', { class: 'panel lpanel', 'data-testid': 'ou-guesses' }, h('div', { class: 'lhead', text: 'Everyone\'s guesses' }),
          rows.map(({ x, g }) => h('div', { class: 'lrow' + (x.you ? ' you' : '') + (R.rev && R.rev.ans === g.side ? ' hit' : '') },
            h('span', { text: x.name }), h('b', { text: (g.side === 'over' ? '⬆️ Over' : '⬇️ Under') + (g.num ? ` · ${fmt(g.num, p.unit)}` : '') })))));
      }
      if (!R.rev) {
        body.append(lockStatus(ctx, lkey, { auto: false, text: 'Guesses in' }));
        body.append(h('div', { class: 'qexp', style: 'border-color:var(--sky)' }, h('b', { text: 'Check it: ' }), p.verify));
        if (L.isHost) {
          body.append(h('div', { class: 'muted small', style: 'text-align:center', text: 'Host: once you know the real answer, tap it.' }),
            h('div', { class: 'qrow2' },
              h('button', { class: 'btn primary', 'data-testid': 'ans-over', onclick: () => L.reveal(lkey, { ans: 'over' }), text: 'It was ⬆️ Over' }),
              h('button', { class: 'btn pink', 'data-testid': 'ans-under', onclick: () => L.reveal(lkey, { ans: 'under' }), text: 'It was ⬇️ Under' })));
        } else body.append(h('div', { class: 'muted', style: 'text-align:center', text: 'The host checks the real answer and taps it.' }));
      } else {
        body.append(h('div', { class: 'answer', 'data-testid': 'ou-answer', text: `It was ${R.rev.ans === 'over' ? '⬆️ Over' : '⬇️ Under'}!` + (st.result ? (st.result === 'right' ? ' You got it ✓' : ' Not this time ✗') : '') }),
          roundPoints(ctx, lkey, x => (x ? '✓' : '✗')) || '');
      }
    } else if (st.lock) {
      body.append(h('div', { class: 'qexp', style: 'border-color:var(--sky)' }, h('b', { text: 'Check it: ' }), p.verify));
      if (!st.result) {
        body.append(h('div', { class: 'qrow2' },
          h('button', { class: 'btn primary', onclick: () => { mark('right'); ctx.rerender(); }, text: 'I was right' }),
          h('button', { class: 'btn pink', onclick: () => { mark('wrong'); ctx.rerender(); }, text: 'I was wrong' })));
      } else {
        body.append(h('div', { class: 'answer', text: st.result === 'right' ? 'Nice, marked right ✓' : 'Marked wrong ✗' }));
      }
    }
    body.append(h('div', { class: 'qscore', 'data-testid': 'tally', text: `Tally: ${tally.right} right · ${tally.wrong} wrong` }));
    body.append(ctx.confirmButton({ label: 'Reset tally', confirmLabel: 'Tap again to reset the tally',
      onConfirm: () => { store.set(tk, { right: 0, wrong: 0 }); ctx.rerender(); } }));
  },
};
