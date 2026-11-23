import { wavelengthRound, wavelengthScore } from './engine.js';

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

    body.append(ctx.howTo('The clue-giver secretly sees a target on the dial and says one clue between the two ends. Everyone else slides to where they think the target is. Reveal to see the points.'));
    body.append(h('div', { class: 'first' }, h('b', { text: 'P' + r.clueGiver }), ' gives the clue'));

    const bar = (target, guess) => h('div', { class: 'wl' },
      h('div', { class: 'wl-ends' }, h('span', { text: r.spectrum.left }), h('span', { text: r.spectrum.right })),
      h('div', { class: 'wl-bar' },
        target != null ? h('div', { class: 'wl-mark target', style: `left:${target}%`, 'aria-label': 'target ' + target }, h('b', { text: '🎯' })) : null,
        guess != null ? h('div', { class: 'wl-mark guess', style: `left:${guess}%`, 'aria-label': 'guess ' + guess }, h('b', { text: '▼' })) : null));

    if (r.isClueGiver) {
      body.append(ctx.reveal({ label: 'Hold to see the target', secret: () => bar(r.target, null), sub: 'Only you should look' }));
      if (S.revealed) body.append(h('div', { class: 'answer' }, h('div', { text: `Target was ${r.target}` })));
    } else {
      body.append(h('div', { class: 'panel' }, bar(S.revealed ? r.target : null, S.guess),
        h('label', { class: 'field' }, h('span', { text: 'Your guess: ' }, h('b', { id: 'wl-val', text: String(S.guess) })),
          h('input', { type: 'range', class: 'slider', min: '0', max: '100', step: '1', value: String(S.guess), disabled: S.revealed ? true : null, 'aria-label': 'Your guess 0 to 100',
            oninput: e => { S.guess = parseInt(e.target.value, 10); document.getElementById('wl-val').textContent = S.guess; const g = body.querySelector('.wl-mark.guess'); if (g) g.style.left = S.guess + '%'; } }))));
      if (S.revealed) {
        const pts = wavelengthScore(S.guess, r.target);
        body.append(h('div', { class: 'answer', 'data-testid': 'points' }, h('div', { text: `Target ${r.target} · You guessed ${S.guess}` }), h('div', { style: 'color:var(--gold);font-size:32px', text: `+${pts} points` })));
      }
    }
    if (!S.revealed) body.append(ctx.confirmButton({ label: 'Reveal target', confirmLabel: 'Tap again to reveal', onConfirm: () => { S.revealed = true; ctx.rerender(); } }));
  },
};
