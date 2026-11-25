// Fib Finder: a bluffing game. Everyone writes a fake answer to a fill-in-the-blank fact, then all the fakes and
// the real answer are shown mixed together and everyone votes for the one they think is true.
// +2 for finding the truth, +1 for each player your fib fools.
// Live room: each phone writes and votes on its own (keys fib|<cat>|<C>|w and |v). Offline: pass-the-phone on one phone.
import { fibRound, fibBoard, fibIsTruth, FIB_MIX, FIB_TRUTH_PTS, FIB_FOOL_PTS } from './engine.js';
import { ensureQuizCss } from './ui-quiz.js';
import { lockStatus, forceReveal, roundPoints } from './ui-live.js';

export const MAX_FIB = 40;
const LET = 'ABCDEFGHIJKLMN';
let draft = '', draftKey = '', err = '', sel = null, selKey = '', lieTry = 0;
const resetLocal = k => { if (draftKey !== k) { draftKey = k; draft = ''; err = ''; sel = null; selKey = ''; lieTry = 0; } };

function catOf(ctx) {
  const cats = ctx.data['fibs.json'].categories || [];
  const c = (ctx.getSettings() || {}).cat;
  return c && cats.some(x => x.id === c) ? c : FIB_MIX;
}

/** Check a typed fib. Returns an error string, or '' when it is fine. */
export function fibProblem(text, round) {
  const t = String(text || '').trim();
  if (!t) return 'Type a fake answer first.';
  if (fibIsTruth(t, round)) return "Whoa, that's actually the real answer! Write a fake one so nobody knows.";
  return '';
}

function lieForMe(round, P) {
  const ds = (round.decoys || []).filter(d => !fibIsTruth(d, round));
  if (!ds.length) return '';
  const d = ds[(P - 1 + lieTry) % ds.length];
  lieTry++;
  return d;
}

function questionCard(h, round) {
  return h('div', { class: 'panel fibcard' },
    h('div', { class: 'qm muted', style: 'text-align:center', text: `${round.catEmoji || ''} ${round.catName}`.trim().toUpperCase() }),
    h('div', { class: 'qtext', 'data-testid': 'fib-q', text: round.q }));
}

function writeBox(ctx, round, P, onLock, label = 'Lock my fib') {
  const { h } = ctx;
  const errEl = h('p', { class: 'warn', 'aria-live': 'polite', 'data-testid': 'fib-err', text: err });
  const input = h('input', { class: 'qinput', type: 'text', maxlength: String(MAX_FIB), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    enterkeyhint: 'done', placeholder: 'Type a believable fake answer', 'aria-label': 'Your fake answer', 'data-testid': 'fib-input', value: draft,
    oninput: e => { draft = e.target.value; if (err) { err = ''; errEl.textContent = ''; } },
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); tryLock(); } } });
  function tryLock() {
    const p = fibProblem(draft, round);
    if (p) { err = p; errEl.textContent = p; ctx.vibrate(60); return; }
    const t = draft.trim().slice(0, MAX_FIB);
    draft = ''; err = '';
    input.blur();
    onLock(t);
  }
  return h('div', { class: 'fibwrite' },
    h('p', { class: 'small muted', style: 'text-align:center;margin:0 0 8px', text: 'Fill in the blank with something fake that sounds real.' }),
    input, errEl,
    h('div', { class: 'qrow2' },
      h('button', { type: 'button', class: 'btn', 'data-testid': 'fib-lieforme', text: '🎲 Lie for me',
        onclick: () => { draft = lieForMe(round, P); err = ''; input.value = draft; errEl.textContent = ''; } }),
      h('button', { type: 'button', class: 'btn primary', 'data-testid': 'fib-lock', text: label, onclick: tryLock })));
}

function voteList(ctx, options, { mineKeys = [], onPick, picked = null }) {
  const { h } = ctx;
  return h('div', { class: 'qchoices', role: 'group', 'aria-label': 'Answers' }, options.map((o, i) => {
    const mine = mineKeys.includes(o.key);
    const cl = ['qchoice'];
    let tag = null;
    if (mine) tag = 'Your fib';
    else if (picked === o.key) { cl.push('picked'); tag = 'Locked'; }
    else if (picked === null && sel === o.key) cl.push('sel');
    return h('button', { type: 'button', class: cl.join(' '), disabled: mine || picked !== null || null, 'data-testid': 'fib-opt',
      onclick: () => { sel = o.key; ctx.rerender(); } },
      h('span', { class: 'ql', text: LET[i] }), h('span', { text: o.text }), tag ? h('span', { class: 'qtag', text: tag }) : null);
  }));
}

/** Results board. nameOf(who) -> display name; votes {who: key}. */
function results(ctx, round, board, votes, nameOf, points) {
  const { h } = ctx;
  const by = new Map();
  for (const [w, k] of Object.entries(votes)) { if (!by.has(k)) by.set(k, []); by.get(k).push(nameOf(w)); }
  const rows = board.options.slice().sort((a, b) => (a.truth ? 1 : 0) - (b.truth ? 1 : 0));
  const list = h('div', { class: 'qchoices', 'data-testid': 'fib-results' }, rows.map(o => {
    const fooled = by.get(o.key) || [];
    const cl = 'qchoice' + (o.truth ? ' right' : fooled.length ? ' wrong' : '');
    const who = o.truth ? (fooled.length ? `🔎 Found it: ${fooled.join(', ')}` : '🔎 Nobody found it!')
      : `${o.house ? '🏠 House fib' : '🤥 Fib by ' + o.authors.map(nameOf).join(' & ')}` + (fooled.length ? ` · fooled ${fooled.join(', ')}` : '');
    return h('div', { class: cl, 'data-testid': o.truth ? 'fib-truth' : 'fib-lie' },
      h('span', { class: 'ql', text: o.truth ? '✓' : '✗' }),
      h('span', {}, o.text, h('span', { class: 'qwho', text: who })),
      h('span', { class: 'qtag', text: o.truth ? 'THE TRUTH' : '' }));
  }));
  const out = [list];
  if (points) {
    const ps = Object.entries(points).sort((a, b) => b[1] - a[1]);
    out.push(h('div', { class: 'lchips', 'data-testid': 'fib-points', style: 'justify-content:center;margin:8px 0' },
      ps.map(([w, p]) => h('span', { class: 'lchip' + (p > 0 ? ' done' : '') }, `${nameOf(w)} ${p > 0 ? '+' + p : '0'}`))));
  }
  out.push(h('div', { class: 'qexp' }, h('div', { text: round.fact || `The real answer: ${round.a}.` }),
    round.source ? h('div', { class: 'small muted qsrc', style: 'margin-top:6px', text: 'Source: ' + round.source }) : null));
  return out;
}

function catPicker(ctx, cat) {
  const { h } = ctx;
  const cats = ctx.data['fibs.json'].categories || [];
  const cur = cat === FIB_MIX ? '🎲 Mix it up' : (c => `${c.emoji} ${c.name}`)(cats.find(c => c.id === cat));
  const opts = [{ id: FIB_MIX, label: '🎲 Mix it up' }, ...cats.map(c => ({ id: c.id, label: `${c.emoji} ${c.name}` }))];
  return h('div', { class: 'say' },
    h('div', { class: 't', text: 'CATEGORY' }),
    h('div', { class: 'big', 'data-testid': 'fib-cat', text: cur }),
    !ctx.canControl ? h('div', { class: 'small muted', text: '👑 The host picks the category' })
      : h('details', { class: 'change' }, h('summary', { text: 'Change category' }),
        h('div', { class: 'fibcats' }, opts.map(o => h('button', { type: 'button', class: 'btn' + (o.id === cat ? ' on' : ''), 'data-testid': 'fibcat-' + o.id,
          onclick: () => ctx.setSettings({ cat: o.id }), text: o.label })))));
}

const HOW = `Everyone writes a FAKE answer that sounds real. Then all the fakes and the real answer are mixed together, and everyone votes for the one they think is true. +${FIB_TRUTH_PTS} for finding the truth, +${FIB_FOOL_PTS} for every player your fib fools. You can't vote for your own fib.`;

// ---------------- live room ----------------
function renderLive(ctx, round, cat) {
  const { h, body, C } = ctx;
  const L = ctx.live;
  const base = `fib|${cat}|${C}`, wk = base + '|w', vk = base + '|v';
  resetLocal(base);
  const W = L.round(wk), V = L.round(vk);
  const ids = L.players.map(p => p.id);
  const nameOf = id => { const P = L.pOf(id); return P ? L.name(P) : 'Someone'; };
  const myLie = W.l[L.me];
  body.append(questionCard(h, round));

  if (!W.rev) {
    if (myLie === undefined) {
      body.append(writeBox(ctx, round, L.myP, t => { L.lock(wk, t); ctx.rerender(); }));
    } else {
      body.append(h('div', { class: 'first', 'data-testid': 'fib-mine', text: `Your fib: “${myLie}”` }));
    }
    body.append(lockStatus(ctx, wk, { text: 'Fibs in' }));
    const f = forceReveal(ctx, wk, 'Start voting now'); if (f) body.append(f);
    return;
  }
  const board = fibBoard({ C, round, lies: W.l, order: ids });
  const mineKeys = board.options.filter(o => o.authors.includes(L.me)).map(o => o.key);
  const myVote = V.l[L.me];
  if (!V.rev) {
    if (selKey !== vk) { selKey = vk; sel = null; }
    body.append(h('div', { class: 'qm muted', style: 'text-align:center;margin:4px 0 8px', text: 'WHICH ONE IS THE TRUTH?' }));
    body.append(voteList(ctx, board.options, { mineKeys, picked: myVote === undefined ? null : myVote }));
    if (myVote === undefined) {
      body.append(h('div', { class: 'qactions' }, h('button', { type: 'button', class: 'btn primary block', 'data-testid': 'fib-vote', disabled: sel === null || null,
        onclick: () => { L.lock(vk, sel); sel = null; ctx.rerender(); }, text: sel === null ? 'Pick the one you think is true' : 'Lock vote' })));
    }
    body.append(lockStatus(ctx, vk, { text: 'Votes in' }));
    const f = forceReveal(ctx, vk, 'Show the truth now'); if (f) body.append(f);
    return;
  }
  const { points } = fibBoard({ C, round, lies: W.l, votes: V.l, order: ids });
  L.score(base, points[L.me] || 0);
  body.append(...results(ctx, round, board, V.l, nameOf, null));
  body.append(roundPoints(ctx, base) || '');
  body.append(h('div', { class: 'muted small', style: 'text-align:center', text: L.isHost ? 'Tap ▶ at the top for the next question.' : 'The host moves everyone to the next question.' }));
}

// ---------------- pass-the-phone ----------------
function renderPass(ctx, round, cat) {
  const { h, body, C, N, store } = ctx;
  const key = `lg.fib.pp.${cat}.${C}.${N}`;
  resetLocal(key);
  const fresh = () => ({ phase: 'write', turn: 1, gate: true, lies: {}, votes: {}, scored: false });
  let st = store.get(key, null);
  if (!st || typeof st !== 'object' || !st.lies || !st.votes || !['write', 'vote', 'done'].includes(st.phase)) st = fresh();
  const save = () => { store.set(key, st); ctx.rerender(); };
  const nameOf = w => 'P' + w;
  const order = Array.from({ length: N }, (_, i) => String(i + 1));
  const totKey = 'lg.fib.tot';

  body.append(h('div', { class: 'small muted', style: 'text-align:center;margin:0 0 6px', 'data-testid': 'fib-mode', text: `📱 Pass-the-phone · ${N} players` }));
  body.append(questionCard(h, round));
  const gate = (P, verb) => h('div', { class: 'panel fibgate', style: 'text-align:center' },
    h('div', { style: 'font-size:46px', text: '📱' }),
    h('div', { style: 'font-size:26px;font-weight:900', 'data-testid': 'fib-turn', text: `Pass the phone to P${P}` }),
    h('p', { class: 'muted', text: `P${P}: ${verb}. Don't let anyone peek!` }),
    h('button', { type: 'button', class: 'btn primary block', 'data-testid': 'fib-ready', text: `I'm P${P}, ready`, onclick: () => { st.gate = false; save(); } }));
  const progress = (what, n) => h('div', { class: 'qscore', text: `${what}: ${n} of ${N}` });

  if (st.phase === 'write') {
    const P = st.turn;
    if (st.gate) body.append(gate(P, 'write a fake answer'));
    else body.append(writeBox(ctx, round, P, t => {
      st.lies[String(P)] = t;
      st.gate = true;
      if (P >= N) { st.phase = 'vote'; st.turn = 1; } else st.turn = P + 1;
      save();
    }, P >= N ? 'Lock fib & start voting' : 'Lock fib & pass'));
    body.append(progress('Fibs written', Object.keys(st.lies).length));
  } else if (st.phase === 'vote') {
    const P = st.turn;
    const board = fibBoard({ C, round, lies: st.lies, order });
    if (st.gate) body.append(gate(P, 'vote for the answer you think is true'));
    else {
      const vk = key + '|v|' + P;
      if (selKey !== vk) { selKey = vk; sel = null; }
      const mineKeys = board.options.filter(o => o.authors.includes(String(P))).map(o => o.key);
      body.append(h('div', { class: 'qm muted', style: 'text-align:center;margin:4px 0 8px', text: `P${P}: WHICH ONE IS THE TRUTH?` }));
      body.append(voteList(ctx, board.options, { mineKeys }));
      body.append(h('div', { class: 'qactions' }, h('button', { type: 'button', class: 'btn primary block', 'data-testid': 'fib-vote', disabled: sel === null || null,
        onclick: () => {
          st.votes[String(P)] = sel; sel = null; st.gate = true;
          if (P >= N) st.phase = 'done'; else st.turn = P + 1;
          save();
        }, text: sel === null ? 'Pick the one you think is true' : (P >= N ? 'Lock vote & reveal' : 'Lock vote & pass') })));
    }
    body.append(progress('Votes', Object.keys(st.votes).length));
  } else {
    const { options, points } = fibBoard({ C, round, lies: st.lies, votes: st.votes, order });
    if (!st.scored) {
      const tot = store.get(totKey, {}) || {};
      for (const [w, p] of Object.entries(points)) tot[w] = (tot[w] || 0) + p;
      store.set(totKey, tot); st.scored = true; store.set(key, st);
    }
    body.append(...results(ctx, round, { options }, st.votes, nameOf, points));
    const tot = store.get(totKey, {}) || {};
    const rows = order.map(w => ({ w, t: tot[w] || 0 })).sort((a, b) => b.t - a.t || a.w - b.w);
    body.append(h('div', { class: 'panel lpanel', 'data-testid': 'fib-totals' }, h('div', { class: 'lhead', text: 'Fib Finder totals on this phone' }),
      rows.map(({ w, t }, i) => h('div', { class: 'lrow' }, h('span', { text: `${['🥇', '🥈', '🥉'][i] || ''} P${w}` }), h('b', { text: String(t) })))));
    body.append(h('div', { class: 'muted small', style: 'text-align:center', text: 'Tap ▶ at the top for the next question.' }));
    body.append(ctx.confirmButton({ label: 'Reset totals', confirmLabel: 'Tap again to reset the totals', cls: 'btn block', onConfirm: () => { store.set(totKey, {}); ctx.rerender(); } }));
  }
  if (st.phase !== 'done' && (Object.keys(st.lies).length || !st.gate)) {
    body.append(ctx.confirmButton({ label: 'Start this question over', confirmLabel: 'Tap again to start over', cls: 'btn block', onConfirm: () => { store.set(key, fresh()); draft = ''; err = ''; ctx.rerender(); } }));
  }
  body.append(h('p', { class: 'small muted', style: 'text-align:center', text: 'Tip: in a live room (Play together) everyone writes and votes on their own phone.' }));
}

export default {
  id: 'fib',
  files: ['fibs.json'],
  groupInputs(ctx) { return { cat: catOf(ctx) }; },
  render(ctx) {
    ensureQuizCss();
    const cat = catOf(ctx);
    const round = fibRound({ C: ctx.C, cat }, ctx.data['fibs.json']);
    ctx.body.append(ctx.howTo(HOW));
    ctx.body.append(catPicker(ctx, cat));
    if (ctx.live) renderLive(ctx, round, cat);
    else renderPass(ctx, round, cat);
  },
};
