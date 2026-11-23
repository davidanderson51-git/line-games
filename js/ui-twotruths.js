import { twoTruthsRound } from './engine.js';
import { ensureQuizCss } from './ui-quiz.js';
import { lockStatus, forceReveal, roundPoints } from './ui-live.js';

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
    const L = ctx.live && ctx.live.online ? ctx.live : null;
    const lkey = `tt|${C}`;
    const markRevealed = () => {
      st.rev = true;
      if (st.pick !== null) { const t = store.get(tk, { right: 0, total: 0 }); t.total++; if (st.pick === r.lieIndex) t.right++; store.set(tk, t); }
      store.set(key, st);
    };
    if (L) {
      const R = L.round(lkey);
      if (R.rev && !st.rev) markRevealed();
      if (st.pick !== null && !R.rev) L.lock(lkey, st.pick);
      if (R.rev) L.score(lkey, st.pick === r.lieIndex ? 1 : 0);
    }
    const tally = store.get(tk, { right: 0, total: 0 });
    const save = () => { store.set(key, st); ctx.rerender(); };
    const votesFor = i => (L ? L.players.filter(p => L.round(lkey).l[p.id] === i).map(p => p.name) : []);

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
      const who = st.rev ? votesFor(i) : [];
      list.append(h('button', { class: cl.join(' '), disabled: st.pick !== null || st.rev || null,
        onclick: () => { sel = i; ctx.rerender(); } },
        h('span', { class: 'ql', text: LET[i] }), h('span', {}, s, who.length ? h('span', { class: 'qwho', text: '🗳 ' + who.join(', ') }) : null), tag ? h('span', { class: 'qtag', text: tag }) : null));
    });
    body.append(list);
    const act = h('div', { class: 'qactions' });
    if (st.pick === null && !st.rev) {
      act.append(h('button', { class: 'btn primary block', disabled: sel === null || null, 'data-testid': 'lock',
        onclick: () => { st.pick = sel; sel = null; save(); }, text: sel === null ? 'Pick a statement' : 'Lock vote' }));
    } else if (!st.rev && L) {
      act.append(lockStatus(ctx, lkey, { text: 'Votes in' }));
      const f = forceReveal(ctx, lkey); if (f) act.append(f);
    } else if (!st.rev) {
      act.append(h('div', { class: 'muted', style: 'text-align:center', text: 'Vote locked. Wait for everyone.' }),
        h('button', { class: 'btn pink block', 'data-testid': 'reveal', onclick: () => { markRevealed(); ctx.rerender(); }, text: 'Reveal (everyone tap together)' }));
    } else {
      body.append(h('div', { class: 'qexp' }, h('div', { text: r.explanation }),
        r.source ? h('div', { class: 'small muted qsrc', style: 'margin-top:6px', text: 'Source: ' + r.source }) : null));
      if (L) {
        act.append(roundPoints(ctx, lkey, p => (p ? '✓' : '✗')) || '');
        act.append(h('div', { class: 'muted small', style: 'text-align:center', text: L.isHost ? 'Tap ▶ at the top for the next one.' : 'The host moves everyone to the next one.' }));
      }
    }
    body.append(act);
    body.append(h('div', { class: 'qscore', text: `Lies caught on this phone: ${tally.right} / ${tally.total}` }));
  },
};
