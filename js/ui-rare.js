// Rare Find: a rarest-answer game. Everyone answers the same prompt ("Name a Disney villain") on their own.
// Answers are matched to the prompt's answer list (typos, plurals and "the" are forgiven) and grouped.
// The fewer people who said it and the rarer it is on the list, the more it scores. Rarest answer wins the round.
// Answers that aren't on the list go to a group vote: they count only if more votes say yes than no.
// Live room: each phone answers and votes on its own (keys rare|<cat>|<C>|a and |v). Offline: pass-the-phone.
import { rareRound, rareBoard, rareMatch, RARE_MIX, RARE_MAX, RARE_SHARE_PTS, RARE_TIER_PTS, RARE_WIN_PTS } from './engine.js';
import { ensureQuizCss } from './ui-quiz.js';
import { lockStatus, forceReveal, roundPoints } from './ui-live.js';

const TIER = ['Common', 'Uncommon', '💎 Rare'];
let draft = '', draftKey = '', warn = '', warnFor = '', judge = {}, judgeKey = '';
const resetLocal = k => { if (draftKey !== k) { draftKey = k; draft = ''; warn = ''; warnFor = ''; judge = {}; judgeKey = ''; } };

function catOf(ctx) {
  const cats = ctx.data['rare.json'].categories || [];
  const c = (ctx.getSettings() || {}).cat;
  return c && cats.some(x => x.id === c) ? c : RARE_MIX;
}

function promptCard(h, round) {
  return h('div', { class: 'panel fibcard rarecard' },
    h('div', { class: 'qm muted', style: 'text-align:center', text: `${round.catEmoji || ''} ${round.catName}`.trim().toUpperCase() }),
    h('div', { class: 'qtext', 'data-testid': 'rare-q', text: round.q }),
    round.note ? h('div', { class: 'small muted', style: 'text-align:center', text: round.note }) : null);
}

/** Answer box. First tap on an answer that isn't on the list warns; a second tap locks it for the group vote. */
function answerBox(ctx, round, onLock, label = 'Lock my answer') {
  const { h } = ctx;
  const warnEl = h('p', { class: 'warn', 'aria-live': 'polite', 'data-testid': 'rare-warn', text: warn });
  const lockBtn = h('button', { type: 'button', class: 'btn primary block', 'data-testid': 'rare-lock', text: warnFor ? 'Lock it anyway' : label, onclick: () => tryLock() });
  const input = h('input', { class: 'qinput', type: 'text', maxlength: String(RARE_MAX), autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
    enterkeyhint: 'done', placeholder: 'Your rarest answer', 'aria-label': 'Your answer', 'data-testid': 'rare-input', value: draft,
    oninput: e => { draft = e.target.value; if (warn) { warn = ''; warnFor = ''; warnEl.textContent = ''; lockBtn.textContent = label; } },
    onkeydown: e => { if (e.key === 'Enter') { e.preventDefault(); tryLock(); } } });
  function tryLock() {
    const t = draft.trim().slice(0, RARE_MAX);
    if (!t) { warn = 'Type an answer first.'; warnFor = ''; warnEl.textContent = warn; ctx.vibrate(60); return; }
    if (!rareMatch(t, round) && warnFor !== t) {
      warn = "That one isn't on our list. Lock it anyway and everyone votes on whether it counts.";
      warnFor = t; warnEl.textContent = warn; lockBtn.textContent = 'Lock it anyway'; ctx.vibrate(40); return;
    }
    draft = ''; warn = ''; warnFor = '';
    input.blur();
    onLock(t);
  }
  return h('div', { class: 'fibwrite' },
    h('p', { class: 'small muted', style: 'text-align:center;margin:0 0 8px', text: 'Think of an answer nobody else will say!' }),
    input, warnEl, h('div', { class: 'qactions' }, lockBtn));
}

function myAnswerLine(h, round, text) {
  const m = rareMatch(text, round);
  return h('div', { class: 'first', 'data-testid': 'rare-mine' }, `Your answer: “${text}”`,
    h('div', { class: 'small muted', text: m ? (m.a.toLowerCase() !== text.trim().toLowerCase() ? `✓ On the list as ${m.a}` : '✓ On the list') : '🗳️ Not on the list: the group will vote' }));
}

/** Thumbs up / down for each off-list answer. groups: off-list groups this player may judge. */
function judgeList(ctx, groups, key, onLock, { lockLabel = 'Lock my votes', nameOf = null } = {}) {
  const { h } = ctx;
  if (judgeKey !== key) { judgeKey = key; judge = {}; }
  const done = groups.every(g => typeof judge[g.key] === 'boolean');
  return h('div', { class: 'panel lpanel', 'data-testid': 'rare-judge' },
    h('div', { class: 'lhead', text: 'Does it count? Is it a real answer to the question?' }),
    groups.map(g => h('div', { class: 'rarejudge' },
      h('div', { class: 'rarej-text' }, `“${g.typed.join(' / ')}”`, nameOf ? h('span', { class: 'qwho', text: 'by ' + g.authors.map(nameOf).join(' & ') }) : null),
      h('div', { class: 'rarej-btns' },
        h('button', { type: 'button', class: 'btn' + (judge[g.key] === true ? ' on yes' : ''), 'data-testid': 'rare-yes', 'aria-label': 'Counts', text: '👍 Counts', onclick: () => { judge[g.key] = true; ctx.rerender(); } }),
        h('button', { type: 'button', class: 'btn' + (judge[g.key] === false ? ' on no' : ''), 'data-testid': 'rare-no', 'aria-label': "Doesn't count", text: '👎 Nope', onclick: () => { judge[g.key] = false; ctx.rerender(); } })))),
    h('button', { type: 'button', class: 'btn primary block', style: 'margin-top:10px', 'data-testid': 'rare-judge-lock', disabled: done ? null : true,
      text: done ? lockLabel : 'Vote on every answer', onclick: () => { const v = { ...judge }; judge = {}; onLock(v); } }));
}

/** Results board, rarest first. nameOf(who) -> display name. */
function results(ctx, round, board, nameOf, points) {
  const { h } = ctx;
  const rows = board.groups.map(g => {
    const cl = 'qchoice rarerow' + (!g.valid ? ' wrong' : g.win ? ' right' : '');
    const bits = [];
    if (!g.valid) bits.push(`❌ Didn't count (${g.yes} yes, ${g.no} no)`);
    else if (!g.listed) bits.push(`🗳️ Group said yes (${g.yes} yes, ${g.no} no)`);
    else bits.push(TIER[g.t]);
    if (g.valid) bits.push(g.authors.length === 1 ? 'only one!' : `${g.authors.length} said it`);
    const typed = g.typed.filter(t => t.toLowerCase() !== g.text.toLowerCase());
    return h('div', { class: cl, 'data-testid': g.valid ? 'rare-row' : 'rare-vetoed' },
      h('span', { class: 'ql', text: g.win ? '👑' : g.valid ? '✓' : '✗' }),
      h('span', {}, g.text, h('span', { class: 'qwho', text: `${g.authors.map(nameOf).join(', ')}${typed.length ? ` · typed “${typed.join('”, “')}”` : ''}` }),
        h('span', { class: 'qwho', text: bits.join(' · ') })),
      h('span', { class: 'qtag', text: g.valid ? `+${g.pts + (g.win ? RARE_WIN_PTS : 0)}` : '0' }));
  });
  const out = [];
  const winners = board.groups.filter(g => g.win);
  out.push(h('div', { class: 'say', 'data-testid': 'rare-winner', style: 'text-align:center' },
    h('div', { class: 't', text: 'RAREST ANSWER' }),
    winners.length ? winners.map(g => h('div', { class: 'big', text: `👑 ${g.authors.map(nameOf).join(' & ')}: ${g.text}` }))
      : h('div', { class: 'big', text: 'Nobody scored this round!' })));
  out.push(h('div', { class: 'qchoices', 'data-testid': 'rare-results' }, rows));
  if (points) {
    const ps = Object.entries(points).sort((a, b) => b[1] - a[1]);
    out.push(h('div', { class: 'lchips', 'data-testid': 'rare-points', style: 'justify-content:center;margin:8px 0' },
      ps.map(([w, p]) => h('span', { class: 'lchip' + (p > 0 ? ' done' : '') }, `${nameOf(w)} ${p > 0 ? '+' + p : '0'}`))));
  }
  if (board.missed.length) {
    out.push(h('div', { class: 'qexp', 'data-testid': 'rare-missed' }, h('div', { text: '💎 Rare answers nobody said: ' + board.missed.slice(0, 6).join(', ') + (board.missed.length > 6 ? '…' : '') })));
  }
  return out;
}

function catPicker(ctx, cat) {
  const { h } = ctx;
  const cats = ctx.data['rare.json'].categories || [];
  const cur = cat === RARE_MIX ? '🎲 Mix it up' : (c => `${c.emoji} ${c.name}`)(cats.find(c => c.id === cat));
  const opts = [{ id: RARE_MIX, label: '🎲 Mix it up' }, ...cats.map(c => ({ id: c.id, label: `${c.emoji} ${c.name}` }))];
  return h('div', { class: 'say' },
    h('div', { class: 't', text: 'CATEGORY' }),
    h('div', { class: 'big', 'data-testid': 'rare-cat', text: cur }),
    !ctx.canControl ? h('div', { class: 'small muted', text: '👑 The host picks the category' })
      : h('details', { class: 'change' }, h('summary', { text: 'Change category' }),
        h('div', { class: 'fibcats' }, opts.map(o => h('button', { type: 'button', class: 'btn' + (o.id === cat ? ' on' : ''), 'data-testid': 'rarecat-' + o.id,
          onclick: () => ctx.setSettings({ cat: o.id }), text: o.label })))));
}

const HOW = `Everyone answers the same question in secret. The rarer your answer, the more it scores: +${RARE_SHARE_PTS[1]} if nobody else said it, +${RARE_SHARE_PTS[2]} if one other person did, +${RARE_SHARE_PTS[3]} if more did. ` +
  `Answers on our list also earn a rarity bonus: +${RARE_TIER_PTS[1]} uncommon, +${RARE_TIER_PTS[2]} rare. Typos and plurals are fine. ` +
  `If an answer isn't on our list, everyone else votes on it: it counts only if more say yes than no (then it's worth the uncommon bonus). ` +
  `The rarest answer wins the round and gets +${RARE_WIN_PTS} extra. Ties share the crown.`;

// ---------------- live room ----------------
function renderLive(ctx, round, cat) {
  const { h, body, C } = ctx;
  const L = ctx.live;
  const base = `rare|${cat}|${C}`, ak = base + '|a', vk = base + '|v';
  resetLocal(base);
  const A = L.round(ak), V = L.round(vk);
  const ids = L.players.map(p => p.id);
  const nameOf = id => { const P = L.pOf(id); return P ? L.name(P) : 'Someone'; };
  const mine = A.l[L.me];
  body.append(promptCard(h, round));

  if (!A.rev) {
    if (mine === undefined) body.append(answerBox(ctx, round, t => { L.lock(ak, t); ctx.rerender(); }));
    else body.append(myAnswerLine(h, round, mine));
    body.append(lockStatus(ctx, ak, { text: 'Answers in' }));
    const f = forceReveal(ctx, ak, 'Show answers now'); if (f) body.append(f);
    return;
  }
  const pre = rareBoard({ round, answers: A.l, order: ids });
  if (pre.offList.length && !V.rev) {
    body.append(h('div', { class: 'qm muted', style: 'text-align:center;margin:4px 0 8px', text: 'THESE AREN’T ON OUR LIST' }));
    const toJudge = pre.groups.filter(g => !g.listed && !g.authors.includes(L.me));
    const myVote = V.l[L.me];
    if (myVote === undefined) {
      if (!toJudge.length) { L.lock(vk, {}); body.append(h('div', { class: 'first', text: 'Everyone else is voting on your answer…' })); }
      else body.append(judgeList(ctx, toJudge, vk, v => { L.lock(vk, v); ctx.rerender(); }, { nameOf }));
    } else {
      body.append(h('div', { class: 'first', 'data-testid': 'rare-voted', text: toJudge.length ? 'Votes locked. Waiting for everyone…' : 'Everyone else is voting on your answer…' }));
    }
    body.append(lockStatus(ctx, vk, { text: 'Votes in' }));
    const f = forceReveal(ctx, vk, 'Show results now'); if (f) body.append(f);
    return;
  }
  const board = rareBoard({ round, answers: A.l, verdicts: pre.offList.length ? V.l : {}, order: ids });
  L.score(base, board.points[L.me] || 0);
  body.append(...results(ctx, round, board, nameOf, null));
  body.append(roundPoints(ctx, base) || '');
  body.append(h('div', { class: 'muted small', style: 'text-align:center', text: L.isHost ? 'Tap ▶ at the top for the next question.' : 'The host moves everyone to the next question.' }));
}

// ---------------- pass-the-phone ----------------
function renderPass(ctx, round, cat) {
  const { h, body, C, N, store } = ctx;
  const key = `lg.rare.pp.${cat}.${C}.${N}`;
  resetLocal(key);
  const fresh = () => ({ phase: 'write', turn: 1, gate: true, ans: {}, verdict: null, scored: false });
  let st = store.get(key, null);
  if (!st || typeof st !== 'object' || !st.ans || !['write', 'judge', 'done'].includes(st.phase)) st = fresh();
  const save = () => { store.set(key, st); ctx.rerender(); };
  const nameOf = w => 'P' + w;
  const order = Array.from({ length: N }, (_, i) => String(i + 1));
  const totKey = 'lg.rare.tot';

  body.append(h('div', { class: 'small muted', style: 'text-align:center;margin:0 0 6px', 'data-testid': 'rare-mode', text: `📱 Pass-the-phone · ${N} players` }));
  body.append(promptCard(h, round));

  if (st.phase === 'write') {
    const P = st.turn;
    if (st.gate) {
      body.append(h('div', { class: 'panel fibgate', style: 'text-align:center' },
        h('div', { style: 'font-size:46px', text: '📱' }),
        h('div', { style: 'font-size:26px;font-weight:900', 'data-testid': 'rare-turn', text: `Pass the phone to P${P}` }),
        h('p', { class: 'muted', text: `P${P}: type your answer. Don't let anyone peek!` }),
        h('button', { type: 'button', class: 'btn primary block', 'data-testid': 'rare-ready', text: `I'm P${P}, ready`, onclick: () => { st.gate = false; save(); } })));
    } else {
      body.append(answerBox(ctx, round, t => {
        st.ans[String(P)] = t; st.gate = true;
        if (P >= N) st.phase = rareBoard({ round, answers: st.ans, order }).offList.length ? 'judge' : 'done';
        else st.turn = P + 1;
        save();
      }, P >= N ? 'Lock & show answers' : 'Lock & pass'));
    }
    body.append(h('div', { class: 'qscore', text: `Answers in: ${Object.keys(st.ans).length} of ${N}` }));
  } else if (st.phase === 'judge') {
    const pre = rareBoard({ round, answers: st.ans, order });
    body.append(h('p', { class: 'small muted', style: 'text-align:center', text: 'Show everyone. Talk it over, then tap what most people (not the writer) think.' }));
    body.append(judgeList(ctx, pre.groups.filter(g => !g.listed), key + '|j', v => { st.verdict = v; st.phase = 'done'; save(); }, { lockLabel: 'Show the results', nameOf }));
  } else {
    // The table decides together: one "voter" ('table') who wrote nothing.
    const verdicts = st.verdict ? { table: st.verdict } : {};
    const board = rareBoard({ round, answers: st.ans, verdicts, order });
    if (!st.scored) {
      const tot = store.get(totKey, {}) || {};
      for (const [w, p] of Object.entries(board.points)) tot[w] = (tot[w] || 0) + p;
      store.set(totKey, tot); st.scored = true; store.set(key, st);
    }
    body.append(...results(ctx, round, board, nameOf, board.points));
    const tot = store.get(totKey, {}) || {};
    const rows = order.map(w => ({ w, t: tot[w] || 0 })).sort((a, b) => b.t - a.t || a.w - b.w);
    body.append(h('div', { class: 'panel lpanel', 'data-testid': 'rare-totals' }, h('div', { class: 'lhead', text: 'Rare Find totals on this phone' }),
      rows.map(({ w, t }, i) => h('div', { class: 'lrow' }, h('span', { text: `${['🥇', '🥈', '🥉'][i] || ''} P${w}` }), h('b', { text: String(t) })))));
    body.append(h('div', { class: 'muted small', style: 'text-align:center', text: 'Tap ▶ at the top for the next question.' }));
    body.append(ctx.confirmButton({ label: 'Reset totals', confirmLabel: 'Tap again to reset the totals', cls: 'btn block', onConfirm: () => { store.set(totKey, {}); ctx.rerender(); } }));
  }
  if (st.phase !== 'done' && (Object.keys(st.ans).length || !st.gate)) {
    body.append(ctx.confirmButton({ label: 'Start this question over', confirmLabel: 'Tap again to start over', cls: 'btn block', onConfirm: () => { store.set(key, fresh()); draft = ''; warn = ''; ctx.rerender(); } }));
  }
  body.append(h('p', { class: 'small muted', style: 'text-align:center', text: 'Tip: in a live room (Play together) everyone answers and votes on their own phone.' }));
}

export default {
  id: 'rare',
  files: ['rare.json'],
  groupInputs(ctx) { return { cat: catOf(ctx) }; },
  render(ctx) {
    ensureQuizCss();
    const cat = catOf(ctx);
    const round = rareRound({ C: ctx.C, cat }, ctx.data['rare.json']);
    ctx.body.append(ctx.howTo(HOW));
    ctx.body.append(catPicker(ctx, cat));
    if (ctx.live) renderLive(ctx, round, cat);
    else renderPass(ctx, round, cat);
  },
};
