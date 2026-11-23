import { bingoCard, bingoLines } from './engine.js';

let celebrate = '';

export default {
  id: 'bingo',
  files: ['bingo.json'],
  groupInputs: () => ({}),
  render(ctx) {
    const { h, body, C, P, N } = ctx;
    const key = `lg.bingo.${C}.${P}`;
    const cells = bingoCard({ C, N, P }, ctx.data['bingo.json']);
    const saved = ctx.store.get(key, []);
    const marked = new Set(Array.isArray(saved) ? saved.filter(i => Number.isInteger(i) && i >= 0 && i < 25) : []);
    marked.add(12);
    const lines = bingoLines(marked);
    const fire = celebrate === key && lines.length > 0;
    celebrate = '';

    body.append(ctx.howTo('Spot things around the park and tap them on your own card. Five in a row, column or diagonal is a BINGO. Your card is different from everyone else\'s.'));

    const grid = h('div', { class: 'bingo', role: 'grid', 'aria-label': 'Bingo card' }, cells.map((c, i) => {
      const on = marked.has(i);
      const b = h('button', { type: 'button', role: 'gridcell', class: 'bcell' + (on ? ' on' : '') + (c.free ? ' free' : ''), 'aria-pressed': String(on), disabled: c.free ? true : null,
        onclick: () => {
          const m = new Set(marked); m.has(i) ? m.delete(i) : m.add(i); m.delete(12);
          const before = lines.length;
          const after = bingoLines(new Set([...m, 12])).length;
          if (after > before) celebrate = key;
          ctx.store.set(key, [...m]); ctx.rerender();
        } },
        h('span', { class: 'be', 'aria-hidden': 'true', text: c.emoji || '' }), h('span', { class: 'bt', text: c.text }));
      return b;
    }));

    const status = h('div', { class: 'panel' },
      h('h2', { text: `Marked ${marked.size - 1} of 24` }),
      lines.length ? h('div', { class: 'bingo-banner', 'data-testid': 'bingo-banner', role: 'status', text: `🎉 BINGO! ×${lines.length}` }) : h('p', { class: 'muted', text: 'No line yet. Keep spotting!' }),
      ctx.confirmButton({ label: 'Clear card', confirmLabel: 'Tap again to clear all marks', onConfirm: () => { ctx.store.remove(key); ctx.rerender(); } }));

    body.append(h('div', { class: 'split bingo-split' }, grid, status));
    if (fire) {
      const colors = ['var(--gold)', 'var(--pink)', 'var(--mint)', 'var(--sky)'];
      const conf = h('div', { class: 'confetti', 'aria-hidden': 'true' }, Array.from({ length: 40 }, (_, i) =>
        h('i', { style: `left:${(i * 37) % 100}%;background:${colors[i % 4]};animation-delay:${(i % 8) * 0.08}s;animation-duration:${1.6 + (i % 5) * 0.2}s` })));
      body.append(conf);
      setTimeout(() => conf.remove(), 3200);
    }
  },
};
