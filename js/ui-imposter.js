import { imposterRound, effectiveImposters as effK } from './engine.js';


export default {
  id: 'imposter',
  files: ['imposter.json'],
  groupInputs(ctx) {
    const set = ctx.getSettings();
    const packs = ctx.data['imposter.json'].packs;
    const pack = set.pack && packs.some(p => p.id === set.pack) ? set.pack : 'any';
    return { N: ctx.N, pack, k: effK(set.two, ctx.N) };
  },
  render(ctx) {
    const { h, N, P, C, body } = ctx;
    const set = ctx.getSettings();
    const packs = ctx.data['imposter.json'].packs;
    const packId = set.pack && packs.some(p => p.id === set.pack) ? set.pack : 'any';
    const k = effK(set.two, N);
    const pack = packs.find(p => p.id === packId);
    const packLabel = pack ? `${pack.emoji} ${pack.name}` : '🎲 Any pack';

    // group settings, shown big so one person can read them aloud
    const sel = h('select', { 'aria-label': 'Word pack', onchange: e => ctx.setSettings({ pack: e.target.value }) },
      h('option', { value: 'any', selected: packId === 'any' || null, text: '🎲 Any pack' }),
      packs.map(p => h('option', { value: p.id, selected: p.id === packId || null, text: `${p.emoji} ${p.name}` })));
    const can2 = N >= 7;
    const chk = h('input', { type: 'checkbox', id: 'two-imp', checked: (can2 && set.two) || null, disabled: !can2 || null,
      onchange: e => ctx.setSettings({ two: e.target.checked }) });
    body.append(ctx.howTo('Everyone but the imposter sees the same secret word. Take turns giving one-word clues, then vote on who has no clue. One person taps Show answer at the end.'));
    body.append(h('div', { class: 'say' },
      h('div', { class: 't', text: 'READ ALOUD · EVERYONE MUST MATCH' }),
      h('div', { class: 'big' }, h('div', { text: `Pack: ${packLabel}` }), h('div', { text: `Imposters: ${k}, Players: ${N}` })),
      h('details', { class: 'change' }, h('summary', { text: 'Change pack / imposters' }),
        h('div', { class: 'setrow' }, sel,
          h('label', { class: 'toggle', for: 'two-imp', 'aria-disabled': can2 ? null : 'true' }, chk, '2 imposters')),
        can2 ? null : h('p', { class: 'small muted', text: '2 imposters needs 7 or more players.' }))));

    const r = imposterRound({ C, N, P, packId, imposters: k === 2 }, ctx.data['imposter.json']);

    body.append(h('div', { class: 'panel', style: 'text-align:center' },
      h('div', { class: 'muted small', text: 'CATEGORY' }),
      h('div', { style: 'font-size:34px;font-weight:900', text: r.packName || (pack && pack.name) || '' })));

    body.append(ctx.reveal({
      label: 'Hold to see your word',
      secret: r.isImposter ? "You're the IMPOSTER 🕵️" : r.word,
      sub: 'Only you should look',
    }));

    body.append(h('div', { class: 'first' }, 'Player ', h('b', { text: 'P' + r.firstSpeaker }), ' speaks first'));

    // deliberate end-of-round answer
    const ans = h('div');
    body.append(ans, ctx.confirmButton({
      label: 'Show answer (end of round)',
      confirmLabel: 'Tap again to show who it was',
      onConfirm: () => {
        let word = r.word;
        if (!word) {
          for (let p = 1; p <= N; p++) {
            if (!r.imposterNumbers.includes(p)) { word = imposterRound({ C, N, P: p, packId, imposters: k === 2 }, ctx.data['imposter.json']).word; break; }
          }
        }
        ans.replaceChildren(h('div', { class: 'answer', 'data-testid': 'answer' },
          h('div', { text: (r.imposterNumbers.length > 1 ? 'Imposters: ' : 'Imposter: ') + r.imposterNumbers.map(n => 'P' + n).join(', ') }),
          h('div', { class: 'muted', style: 'font-size:20px;margin-top:6px', text: 'The word was: ' + word })));
      },
    }));
  },
};
