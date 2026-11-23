// Shared multiple-choice question flow for Trivia Showdown and Ride Trivia.
// State lives in ctx.store (persisted), never in the DOM. The answer key is only in JS memory until Reveal.
let cssDone = false;
export function ensureQuizCss() {
  if (cssDone || typeof document === 'undefined') return;
  cssDone = true;
  try {
    const l = document.createElement('link');
    l.rel = 'stylesheet';
    l.href = new URL('../css/quiz.css', import.meta.url).href;
    document.head.append(l);
  } catch (e) { /* styles optional */ }
}

import { lockStatus, forceReveal, roundPoints } from './ui-live.js';

let selKey = '', sel = null; // unlocked selection, module scope (cleared when question changes)
const LET = ['A', 'B', 'C', 'D'];

function loadState(ctx, key, n) {
  const s = ctx.store.get(key, null);
  if (s && Array.isArray(s.picks) && s.picks.length === n && Array.isArray(s.rev) && s.rev.length === n && Number.isInteger(s.i)) return s;
  return { i: 0, picks: Array(n).fill(null), rev: Array(n).fill(false) };
}

/** opts: {key, questions (engine shape), label, onAgain?: fn, againLabel?} */
export function renderQuiz(ctx, opts) {
  ensureQuizCss();
  const { h } = ctx;
  const qs = opts.questions, n = qs.length, key = opts.key;
  const st = loadState(ctx, key, n);
  const save = () => { ctx.store.set(key, st); ctx.rerender(); };
  const score = () => qs.reduce((a, q, i) => a + (st.rev[i] && st.picks[i] === q.correctIndex ? 1 : 0), 0);
  // live room: the host moves everyone question by question; reveals happen together
  const L = ctx.live && ctx.live.online && opts.liveKey ? ctx.live : null;
  const base = opts.liveKey;
  if (L) {
    const ptr = Math.min(n, L.round(base).ptr || 0);
    let dirty = false;
    if (st.i !== ptr) { st.i = ptr; dirty = true; }
    for (let j = 0; j < Math.min(ptr + 1, n); j++) {
      const R = L.round(base + '#' + j);
      if (R.rev && !st.rev[j]) { st.rev[j] = true; dirty = true; }
      if (st.rev[j] && R.rev) L.score(base + '#' + j, st.picks[j] === qs[j].correctIndex ? 1 : 0);
      if (st.picks[j] !== null && !R.rev) L.lock(base + '#' + j, st.picks[j]);
    }
    if (dirty) ctx.store.set(key, st);
  }

  if (st.i >= n) {
    ctx.body.append(h('div', { class: 'panel qend' },
      h('div', { class: 'qsub', text: opts.label }),
      h('div', { class: 'qbig', 'data-testid': 'final-score', text: `Score ${score()}/${n}` }),
      h('div', { class: 'qsub', text: 'Compare with everyone out loud!' })),
      h('div', { class: 'qactions' },
        L ? null : h('button', { class: 'btn', onclick: () => { st.i = 0; st.picks = Array(n).fill(null); st.rev = Array(n).fill(false); sel = null; save(); }, text: 'Play this round again' }),
        opts.extra || null));
    if (L) {
      const tot = new Map();
      for (let j = 0; j < n; j++) for (const [id, p] of Object.entries(L.scoresFor(base + '#' + j))) tot.set(id, (tot.get(id) || 0) + p);
      const rows = L.players.map(p => ({ p, t: tot.get(p.id) || 0 })).sort((a, b) => b.t - a.t);
      ctx.body.append(h('div', { class: 'panel lpanel', 'data-testid': 'quiz-results' }, h('div', { class: 'lhead', text: 'This round' }),
        rows.map(({ p, t }, k) => h('div', { class: 'lrow' + (p.you ? ' you' : '') }, h('span', { text: `${['🥇', '🥈', '🥉'][k] || ''} ${p.name}` }), h('b', { text: `${t}/${n}` })))),
        h('p', { class: 'muted small', style: 'text-align:center', text: L.isHost ? 'Tap ▶ at the top for a new round.' : 'The host starts the next round.' }));
    }
    return;
  }

  const i = st.i, q = qs[i];
  const locked = st.picks[i] !== null, revealed = st.rev[i];
  const sk = key + '#' + i;
  if (selKey !== sk) { selKey = sk; sel = null; }

  ctx.body.append(h('div', { class: 'qidx' },
    h('div', { class: 'qn', 'data-testid': 'qindex', text: 'Q' + (i + 1) }),
    h('div', { class: 'qm', text: `of ${n} · ${opts.label}` })));
  ctx.body.append(h('div', { class: 'qtext', text: q.q }));

  const list = h('div', { class: 'qchoices', role: 'group', 'aria-label': 'Answers' });
  q.choices.forEach((c, ci) => {
    const classes = ['qchoice'];
    let tag = null;
    if (revealed) {
      if (ci === q.correctIndex) { classes.push('right'); tag = '✓ Correct'; }
      else if (st.picks[i] === ci) { classes.push('wrong'); tag = '✗ Your pick'; }
      if (st.picks[i] === ci && ci === q.correctIndex) tag = '✓ Your pick';
    } else if (locked && st.picks[i] === ci) { classes.push('picked'); tag = 'Locked'; }
    else if (!locked && sel === ci) classes.push('sel');
    list.append(h('button', {
      class: classes.join(' '), disabled: locked || null, 'aria-pressed': (!locked && sel === ci) ? 'true' : 'false',
      onclick: () => { sel = ci; ctx.rerender(); },
    }, h('span', { class: 'ql', text: LET[ci] }), h('span', { text: c }), tag ? h('span', { class: 'qtag', text: tag }) : null));
  });
  ctx.body.append(list);

  const act = h('div', { class: 'qactions' });
  if (!locked && !revealed) {
    act.append(h('button', { class: 'btn primary block', disabled: sel === null || null, 'data-testid': 'lock',
      onclick: () => { st.picks[i] = sel; sel = null; save(); }, text: sel === null ? 'Pick an answer' : 'Lock answer' }));
  } else if (!revealed && L) {
    act.append(lockStatus(ctx, base + '#' + i));
    const f = forceReveal(ctx, base + '#' + i);
    if (f) act.append(f);
  } else if (!revealed) {
    act.append(h('div', { class: 'muted', style: 'text-align:center', text: 'Answer locked. Wait until everyone has locked in.' }),
      h('button', { class: 'btn pink block', 'data-testid': 'reveal', onclick: () => { st.rev[i] = true; save(); }, text: 'Reveal (everyone tap together)' }));
  } else if (L) {
    if (q.source) act.append(h('div', { class: 'small muted qsrc', style: 'text-align:center', text: 'Source: ' + q.source }));
    act.append(roundPoints(ctx, base + '#' + i, p => (p ? '✓' : '✗')) || '');
    if (L.isHost) act.append(h('button', { class: 'btn primary block', 'data-testid': 'next', onclick: () => { L.setPtr(base, i + 1); }, text: i + 1 >= n ? 'Everyone to final scores' : 'Next question for everyone' }));
    else act.append(h('div', { class: 'muted', style: 'text-align:center', text: 'The host moves everyone to the next question.' }));
  } else {
    if (q.source) act.append(h('div', { class: 'small muted qsrc', style: 'text-align:center', text: 'Source: ' + q.source }));
    act.append(h('button', { class: 'btn primary block', 'data-testid': 'next', onclick: () => { st.i = i + 1; sel = null; save(); },
      text: i + 1 >= n ? 'See final score' : 'Next question' }));
  }
  ctx.body.append(act);
  ctx.body.append(h('div', { class: 'qscore', text: `Score so far: ${score()} / ${st.rev.filter(Boolean).length}` }));
}

export default { id: '_quiz', files: [], groupInputs: () => ({}), render() {} };
