import { overUnderPrompt } from './engine.js';
import { ensureQuizCss } from './ui-quiz.js';

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
    const tally = store.get(tk, { right: 0, wrong: 0 });
    const save = () => { store.set(key, st); ctx.rerender(); };

    body.append(ctx.howTo('Is the real number over or under the reference? Lock a guess (a number is optional), check it in real life, then tap right or wrong.'));
    body.append(h('div', { class: 'qtext', text: p.text }),
      h('div', { class: 'qm muted', style: 'text-align:center', text: 'REFERENCE' }),
      h('div', { class: 'qref', 'data-testid': 'ref', text: fmt(p.ref, p.unit) }));

    if (!st.lock) {
      body.append(h('div', { class: 'qrow2' },
        ['over', 'under'].map(s => h('button', { class: 'qchoice' + (side === s ? ' sel' : ''), style: 'justify-content:center;font-size:24px',
          'aria-pressed': side === s ? 'true' : 'false', onclick: () => { side = s; ctx.rerender(); }, text: s === 'over' ? '⬆️ Over' : '⬇️ Under' }))));
      body.append(h('div', { style: 'margin:12px 0' },
        h('input', { class: 'qinput', type: 'number', inputmode: 'decimal', placeholder: 'Optional: your number', 'aria-label': 'Your number guess',
          value: num, oninput: e => { num = e.target.value; } })));
      body.append(h('div', { class: 'qactions' }, h('button', { class: 'btn primary block', disabled: side === null || null,
        onclick: () => { st.lock = { side, num: num.trim() }; save(); }, text: side === null ? 'Pick Over or Under' : 'Lock guess' })));
    } else {
      body.append(h('div', { class: 'panel', style: 'text-align:center;font-size:24px;font-weight:800' },
        `Your guess: ${st.lock.side === 'over' ? 'Over' : 'Under'}` + (st.lock.num ? ` (about ${fmt(st.lock.num, p.unit)})` : '')));
      body.append(h('div', { class: 'qexp', style: 'border-color:var(--sky)' }, h('b', { text: 'Check it: ' }), p.verify));
      if (!st.result) {
        body.append(h('div', { class: 'qrow2' },
          h('button', { class: 'btn primary', onclick: () => { st.result = 'right'; const t = store.get(tk, { right: 0, wrong: 0 }); t.right++; store.set(tk, t); save(); }, text: 'I was right' }),
          h('button', { class: 'btn pink', onclick: () => { st.result = 'wrong'; const t = store.get(tk, { right: 0, wrong: 0 }); t.wrong++; store.set(tk, t); save(); }, text: 'I was wrong' })));
      } else {
        body.append(h('div', { class: 'answer', text: st.result === 'right' ? 'Nice, marked right ✓' : 'Marked wrong ✗' }));
      }
    }
    body.append(h('div', { class: 'qscore', 'data-testid': 'tally', text: `Tally: ${tally.right} right · ${tally.wrong} wrong` }));
    body.append(ctx.confirmButton({ label: 'Reset tally', confirmLabel: 'Tap again to reset the tally',
      onConfirm: () => { store.set(tk, { right: 0, wrong: 0 }); ctx.rerender(); } }));
  },
};
