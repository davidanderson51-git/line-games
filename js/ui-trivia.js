import { triviaRound, DIFFICULTIES } from './engine.js';
import { renderQuiz, ensureQuizCss } from './ui-quiz.js';

const NAMES = { kid: 'Kid', teen: 'Teen', adult: 'Adult' };
const EMO = { kid: '🧒', teen: '🧑‍🎤', adult: '🧑' };

export default {
  id: 'trivia',
  files: ['trivia.json'],
  groupInputs() { return {}; }, // difficulty is per player, not a group input
  render(ctx) {
    ensureQuizCss();
    const { h, C, body, store } = ctx;
    body.append(ctx.howTo('Pick your own level, then everyone answers the same ten questions at their own pace. Lock in, reveal together, then compare "Score x/10" out loud.'));
    const D = store.get('lg.trivia.diff', null);
    if (!DIFFICULTIES.includes(D)) {
      body.append(h('div', { class: 'qtext', text: 'Pick your level' }),
        h('div', { class: 'qpick' }, DIFFICULTIES.map(d =>
          h('button', { class: 'btn primary block', 'data-testid': 'diff-' + d, onclick: () => { store.set('lg.trivia.diff', d); ctx.rerender(); }, text: `${EMO[d]} ${NAMES[d]}` }))),
        h('p', { class: 'muted small', style: 'text-align:center', text: 'Each player can choose a different level.' }));
      return;
    }
    const qs = triviaRound({ C, D }, ctx.data['trivia.json']);
    renderQuiz(ctx, { key: `lg.trivia.${C}.${D}`, questions: qs, label: NAMES[D],
      extra: h('button', { class: 'btn block', onclick: () => { store.remove('lg.trivia.diff'); ctx.rerender(); }, text: 'Change my level' }) });
    if (store.get(`lg.trivia.${C}.${D}`, null) && !(store.get(`lg.trivia.${C}.${D}`).i >= qs.length)) {
      body.append(h('div', { style: 'text-align:center;margin:6px 0' },
        h('button', { class: 'btn', onclick: () => { store.remove('lg.trivia.diff'); ctx.rerender(); }, text: `Level: ${NAMES[D]} (change)` })));
    }
  },
};
