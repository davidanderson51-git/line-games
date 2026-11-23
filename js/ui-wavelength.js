import { wavelengthRound, wavelengthScore } from './engine.js';
import { lockStatus, roundPoints } from './ui-live.js';

// per-round local state (module scope: render re-runs from scratch)
const S = { key: '', guess: 50, revealed: false };

export default {
  id: 'wavelength',
  files: ['spectra.json'],
  groupInputs: ctx => ({ N: ctx.N }),
  render(ctx) {
    const { h, body, C, N, P } = ctx;
    const key = `${C}|${N}|${P}`;
    if (S.key !== key) Object.assign(S, { key, guess: 50, revealed: false });
    const r = wavelengthRound({ C, N, P }, ctx.data['spectra.json']);
    const L = ctx.live && ctx.live.online ? ctx.live : null;
    const lkey = `wl|${C}|${N}`;
    const R = L ? L.round(lkey) : null;
    const myLock = R ? R.l[L.me] : undefined;
    if (L) {
      if (R.rev) S.revealed = true;
      if (Number.isInteger(myLock)) S.guess = myLock;
    }

    body.append(ctx.howTo('The clue-giver secretly sees a target on the dial and says one clue between the two ends. Everyone else slides to where they think the target is. Reveal to see the points.'));
    body.append(h('div', { class: 'first' }, h('b', { text: L ? L.label(r.clueGiver) : 'P' + r.clueGiver }), ' gives the clue'));

    const bar = (target, guess, others = []) => h('div', { class: 'wl' },
      h('div', { class: 'wl-ends' }, h('span', { text: r.spectrum.left }), h('span', { text: r.spectrum.right })),
      h('div', { class: 'wl-bar' },
        others.map(o => h('div', { class: 'wl-mark other', style: `left:${o.g}%`, title: o.name }, h('b', { text: o.name.slice(0, 1).toUpperCase() }))),
        target != null ? h('div', { class: 'wl-mark target', style: `left:${target}%`, 'aria-label': 'target ' + target }, h('b', { text: '🎯' })) : null,
        guess != null ? h('div', { class: 'wl-mark guess', style: `left:${guess}%`, 'aria-label': 'guess ' + guess }, h('b', { text: '▼' })) : null));

    // everyone's guesses (live, after the reveal)
    const guesses = L ? L.players.filter(p => Number.isInteger(R.l[p.id])).map(p => ({ P: p.P, name: p.name, you: p.you, g: R.l[p.id], pts: wavelengthScore(R.l[p.id], r.target) })) : [];

    if (r.isClueGiver) {
      body.append(ctx.reveal({ label: 'Hold to see the target', secret: () => bar(r.target, null), sub: 'Only you should look' }));
      if (S.revealed) {
        body.append(h('div', { class: 'answer' }, h('div', { text: `Target was ${r.target}` })));
        if (L) body.append(h('div', { class: 'panel' }, bar(r.target, null, guesses)));
      }
    } else {
      const locked = L && myLock !== undefined;
      body.append(h('div', { class: 'panel' }, bar(S.revealed ? r.target : null, S.guess, S.revealed ? guesses.filter(g => !g.you) : []),
        h('label', { class: 'field' }, h('span', { text: 'Your guess: ' }, h('b', { id: 'wl-val', text: String(S.guess) })),
          h('input', { type: 'range', class: 'slider', min: '0', max: '100', step: '1', value: String(S.guess), disabled: S.revealed || locked ? true : null, 'aria-label': 'Your guess 0 to 100', 'data-testid': 'wl-slider',
            oninput: e => { S.guess = parseInt(e.target.value, 10); document.getElementById('wl-val').textContent = S.guess; const g = body.querySelector('.wl-mark.guess'); if (g) g.style.left = S.guess + '%'; } }))));
      if (L && !locked && !S.revealed) {
        body.append(h('button', { type: 'button', class: 'btn primary block', 'data-testid': 'wl-lock', text: 'Lock my guess', onclick: () => { L.lock(lkey, S.guess); ctx.rerender(); } }));
      }
      if (S.revealed && (!L || locked)) {
        const pts = wavelengthScore(S.guess, r.target);
        body.append(h('div', { class: 'answer', 'data-testid': 'points' }, h('div', { text: `Target ${r.target} · You guessed ${S.guess}` }), h('div', { style: 'color:var(--gold);font-size:32px', text: `+${pts} points` })));
      }
    }
    if (L) {
      if (S.revealed) {
        // guessers score their own guess; the clue-giver earns the best guess's points
        const mine = r.isClueGiver ? guesses.reduce((m, g) => Math.max(m, g.pts), 0) : (myLock !== undefined ? wavelengthScore(myLock, r.target) : 0);
        L.score(lkey, mine);
        body.append(h('div', { class: 'panel lpanel' }, h('div', { class: 'lhead', text: 'Guesses' }),
          guesses.sort((a, b) => b.pts - a.pts).map(g => h('div', { class: 'lrow' + (g.you ? ' you' : '') }, h('span', { text: `${g.name} · ${g.g}` }), h('b', { text: `+${g.pts}` })))),
          roundPoints(ctx, lkey) || '');
      } else {
        body.append(lockStatus(ctx, lkey, { excludeP: [r.clueGiver], text: 'Guesses in' }));
        if (L.isHost || r.isClueGiver) body.append(ctx.confirmButton({ label: 'Reveal target for everyone', confirmLabel: 'Tap again to reveal', cls: 'btn pink block', onConfirm: () => L.reveal(lkey) }));
      }
      return;
    }
    if (!S.revealed) body.append(ctx.confirmButton({ label: 'Reveal target', confirmLabel: 'Tap again to reveal', onConfirm: () => { S.revealed = true; ctx.rerender(); } }));
  },
};
