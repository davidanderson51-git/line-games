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

  if (st.i >= n) {
    ctx.body.append(h('div', { class: 'panel qend' },
      h('div', { class: 'qsub', text: opts.label }),
      h('div', { class: 'qbig', 'data-testid': 'final-score', text: `Score ${score()}/${n}` }),
      h('div', { class: 'qsub', text: 'Compare with everyone out loud!' })),
      h('div', { class: 'qactions' },
        h('button', { class: 'btn', onclick: () => { st.i = 0; st.picks = Array(n).fill(null); st.rev = Array(n).fill(false); sel = null; save(); }, text: 'Play this round again' }),
        opts.extra || null));
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
  if (!locked) {
    act.append(h('button', { class: 'btn primary block', disabled: sel === null || null, 'data-testid': 'lock',
      onclick: () => { st.picks[i] = sel; sel = null; save(); }, text: sel === null ? 'Pick an answer' : 'Lock answer' }));
  } else if (!revealed) {
    act.append(h('div', { class: 'muted', style: 'text-align:center', text: 'Answer locked. Wait until everyone has locked in.' }),
      h('button', { class: 'btn pink block', 'data-testid': 'reveal', onclick: () => { st.rev[i] = true; save(); }, text: 'Reveal (everyone tap together)' }));
  } else {
    if (q.source) act.append(h('div', { class: 'small muted qsrc', style: 'text-align:center', text: 'Source: ' + q.source }));
    act.append(h('button', { class: 'btn primary block', 'data-testid': 'next', onclick: () => { st.i = i + 1; sel = null; save(); },
      text: i + 1 >= n ? 'See final score' : 'Next question' }));
  }
  ctx.body.append(act);
  ctx.body.append(h('div', { class: 'qscore', text: `Score so far: ${score()} / ${st.rev.filter(Boolean).length}` }));
}

export default { id: '_quiz', files: [], groupInputs: () => ({}), render() {} };
