import { twoTruthsRound } from './engine.js';
import { ensureQuizCss } from './ui-quiz.js';

let sel = null, selC = null;
const LET = ['A', 'B', 'C'];

export default {
  id: 'twotruths',
  files: ['twotruths.json'],
  groupInputs() { return {}; },
  render(ctx) {
    ensureQuizCss();
    const { h, C, body, store } = ctx;
    if (selC !== C) { selC = C; sel = null; }
    const r = twoTruthsRound({ C }, ctx.data['twotruths.json']);
    const key = 'lg.tt.' + C;
    const st = store.get(key, null) || { pick: null, rev: false };
    const tk = 'lg.tt.tally';
    const tally = store.get(tk, { right: 0, total: 0 });
    const save = () => { store.set(key, st); ctx.rerender(); };

    body.append(ctx.howTo('Two of the three statements are true, one is a lie. Pick the lie, lock your vote, then reveal together.'));
    body.append(h('div', { class: 'qtext', text: 'Which one is the lie?' }));
    const list = h('div', { class: 'qchoices' });
    r.statements.forEach((s, i) => {
      const cl = ['qchoice'];
      let tag = null;
      if (st.rev) {
        if (i === r.lieIndex) { cl.push('right'); tag = '🤥 The lie'; }
        else if (st.pick === i) { cl.push('wrong'); tag = 'Your vote'; }
        if (st.pick === i && i === r.lieIndex) tag = '🤥 The lie · your vote';
      } else if (st.pick === i) { cl.push('picked'); tag = 'Locked'; }
      else if (st.pick === null && sel === i) cl.push('sel');
      list.append(h('button', { class: cl.join(' '), disabled: st.pick !== null || null,
        onclick: () => { sel = i; ctx.rerender(); } },
        h('span', { class: 'ql', text: LET[i] }), h('span', { text: s }), tag ? h('span', { class: 'qtag', text: tag }) : null));
    });
    body.append(list);
    const act = h('div', { class: 'qactions' });
    if (st.pick === null) {
      act.append(h('button', { class: 'btn primary block', disabled: sel === null || null,
        onclick: () => { st.pick = sel; sel = null; save(); }, text: sel === null ? 'Pick a statement' : 'Lock vote' }));
    } else if (!st.rev) {
      act.append(h('div', { class: 'muted', style: 'text-align:center', text: 'Vote locked. Wait for everyone.' }),
        h('button', { class: 'btn pink block', onclick: () => {
          st.rev = true;
          const t = store.get(tk, { right: 0, total: 0 });
          t.total++; if (st.pick === r.lieIndex) t.right++;
          store.set(tk, t); save();
        }, text: 'Reveal (everyone tap together)' }));
    } else {
      body.append(h('div', { class: 'qexp' }, h('div', { text: r.explanation }),
        r.source ? h('div', { class: 'small muted qsrc', style: 'margin-top:6px', text: 'Source: ' + r.source }) : null));
    }
    body.append(act);
    body.append(h('div', { class: 'qscore', text: `Lies caught on this phone: ${tally.right} / ${tally.total}` }));
  },
};
