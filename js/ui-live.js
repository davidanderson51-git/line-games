// Live-room helpers for the game screens: ctx.live, lock-in chips, voting and the points board.
import * as live from './live.js';

/** Build ctx.live from a live snapshot, or null when this phone is not in a room. */
export function makeLive(snap) {
  if (!snap || !snap.state || snap.myP < 1) return null;
  const s = snap.state, players = snap.players;
  const L = {
    online: snap.online, isHost: snap.isHost, canControl: snap.isHost || !snap.online,
    me: snap.me, myP: snap.myP, N: snap.N, players, code: s.code,
    name: P => (players[P - 1] ? players[P - 1].name : 'P' + P),
    label: P => `P${P} ${players[P - 1] ? players[P - 1].name : ''}`.trim(),
    pOf: id => players.findIndex(p => p.id === id) + 1,
    round: key => s.r[key] || { l: {}, rev: null },
    scoresFor: key => s.sk[key] || {},
    timer: key => s.tm && s.tm[key],
    lock: live.lock, score: live.score, reveal: live.reveal, setPtr: live.setPtr, setTimer: live.setTimer,
    hostNow: live.hostNow, toLocalMs: live.toLocalMs,
    /** ids of players we wait for: online, not excluded (by P number) */
    expected: (excludeP = []) => players.filter(p => p.on && !excludeP.includes(p.P)).map(p => p.id),
  };
  L.allLocked = (key, excludeP = []) => { const r = L.round(key); const ex = L.expected(excludeP); return ex.length > 0 && ex.every(id => r.l[id] !== undefined); };
  return L;
}

const autoT = new Map();
/** Chips showing who has locked in. On the host, reveals automatically once everyone online is in. */
export function lockStatus(ctx, key, { excludeP = [], auto = true, text = 'Locked in' } = {}) {
  const { h, live: L } = ctx;
  const r = L.round(key);
  const chips = L.players.filter(p => !excludeP.includes(p.P)).map(p => {
    const done = r.l[p.id] !== undefined;
    return h('span', { class: 'lchip' + (done ? ' done' : '') + (p.on ? '' : ' away'), title: p.on ? '' : 'offline' },
      done ? '✓ ' : '⏳ ', `${p.name}`);
  });
  const waiting = L.expected(excludeP).filter(id => r.l[id] === undefined).length;
  if (L.isHost && auto && !r.rev && L.allLocked(key, excludeP) && !autoT.has(key)) {
    autoT.set(key, setTimeout(() => { autoT.delete(key); L.reveal(key); }, 900));
  }
  return h('div', { class: 'panel lpanel', 'data-testid': 'lockstatus' },
    h('div', { class: 'lhead', text: r.rev ? text : (waiting ? `Waiting for ${waiting} more…` : 'Everyone is in! Revealing…') }),
    h('div', { class: 'lchips' }, chips));
}

/** Host-only "reveal now" for when someone is slow or has wandered off. */
export function forceReveal(ctx, key, label = 'Reveal now for everyone') {
  const { live: L } = ctx;
  if (!L.isHost || L.round(key).rev) return null;
  return ctx.confirmButton({ label, confirmLabel: 'Tap again to reveal for everyone', cls: 'btn pink block', onConfirm: () => L.reveal(key) });
}

/** Vote for a player (Imposter / Spyfall). Returns {node, myVote, rev, votes: Map P->[names]} */
export function voteBlock(ctx, key, { title, selKey }) {
  const { h, live: L } = ctx;
  const r = L.round(key);
  const mine = r.l[L.me];
  const votes = new Map();
  for (const [id, P] of Object.entries(r.l)) { const who = L.pOf(id); if (!votes.has(P)) votes.set(P, []); votes.get(P).push(who ? L.name(who) : '?'); }
  const wrap = h('div');
  if (!r.rev) {
    if (mine === undefined) {
      wrap.append(h('div', { class: 'panel lpanel' },
        h('div', { class: 'lhead', text: title }),
        h('div', { class: 'lvote' }, L.players.filter(p => p.P !== L.myP).map(p =>
          h('button', { type: 'button', class: 'btn' + (voteSel.get(selKey) === p.P ? ' on' : ''), 'data-testid': 'vote-' + p.P,
            onclick: () => { voteSel.set(selKey, p.P); ctx.rerender(); } }, `P${p.P} ${p.name}`))),
        h('button', { type: 'button', class: 'btn primary block', style: 'margin-top:10px', 'data-testid': 'lockvote', disabled: voteSel.get(selKey) ? null : true,
          onclick: () => { L.lock(key, voteSel.get(selKey)); ctx.rerender(); }, text: voteSel.get(selKey) ? `Lock vote: ${L.label(voteSel.get(selKey))}` : 'Pick someone' })));
    } else {
      wrap.append(h('div', { class: 'first', text: `You voted ${L.label(mine)}` }));
    }
    wrap.append(lockStatus(ctx, key, { text: 'Votes in' }));
    const f = forceReveal(ctx, key, 'Show answer now (end of round)');
    if (f) wrap.append(f);
  }
  return { node: wrap, myVote: mine, rev: r.rev, votes };
}
const voteSel = new Map();

/** Votes per player as a small table, after the reveal. */
export function voteTally(ctx, votes, highlightPs = []) {
  const { h, live: L } = ctx;
  const rows = [...votes.entries()].sort((a, b) => b[1].length - a[1].length || a[0] - b[0]);
  if (!rows.length) return h('p', { class: 'muted small', style: 'text-align:center', text: 'No votes were cast.' });
  return h('div', { class: 'panel lpanel' }, h('div', { class: 'lhead', text: 'Votes' }),
    rows.map(([P, names]) => h('div', { class: 'lrow' + (highlightPs.includes(Number(P)) ? ' hit' : '') },
      h('b', { text: `${L.label(Number(P))}: ${names.length}` }), h('span', { class: 'muted small', text: names.join(', ') }))));
}

/** Points earned this round, shown to everyone after a reveal: [{P, pts}] */
export function roundPoints(ctx, key, fmt = p => (p > 0 ? `+${p}` : '0')) {
  const { h, live: L } = ctx;
  const sc = L.scoresFor(key);
  const rows = L.players.filter(p => sc[p.id] !== undefined).sort((a, b) => sc[b.id] - sc[a.id]);
  if (!rows.length) return null;
  return h('div', { class: 'lchips', style: 'justify-content:center;margin:8px 0' },
    rows.map(p => h('span', { class: 'lchip' + (sc[p.id] > 0 ? ' done' : '') }, `${p.name} ${fmt(sc[p.id])}`)));
}

/** Party points across all games played in this room. */
export function board(h, snap, { open = false } = {}) {
  const s = snap.state;
  if (!s) return null;
  const rows = snap.players.map(p => ({ ...p, pts: s.tot[p.id] || 0 })).sort((a, b) => b.pts - a.pts || a.P - b.P);
  const medal = i => ['🥇', '🥈', '🥉'][i] || '';
  return h('details', { class: 'howto lboard', open: open || null },
    h('summary', { text: '🏆 Party points' }),
    h('div', { 'data-testid': 'board' }, rows.map((p, i) => h('div', { class: 'lrow' + (p.you ? ' you' : '') },
      h('span', { text: `${medal(i)} ${p.name}${p.you ? ' (you)' : ''}` }), h('b', { text: String(p.pts) })))));
}
