import { missionFor } from './engine.js';
import { localDateString } from './seed.js';

const CUR = 'lg.mission.current';
const today = () => localDateString(new Date());

export default {
  id: 'missions',
  files: ['missions.json'],
  usesCode: false,
  groupInputs: () => ({ date: today() }),
  render(ctx) {
    const { h, body, N, P, store } = ctx;
    const date = today();
    const data = ctx.data['missions.json'];
    ctx.body.append(ctx.howTo('Everyone gets a different secret mission for today. Do it sneakily. At dinner, reveal your mission and say whether it worked.'));

    let cur = store.get(CUR, null);
    if (cur && cur.P !== P) cur = null;
    // an unfinished mission from an earlier day stays visible until dismissed
    if (cur && cur.date !== date && !cur.dismissed) {
      body.append(h('div', { class: 'panel' }, h('p', { class: 'warn', text: `Mission from ${cur.date} not dismissed yet.` })));
      dinner(ctx, cur, true);
      return;
    }
    body.append(h('div', { class: 'first', 'data-testid': 'date' }, "Today's date: ", h('b', { text: date })));
    const latchKey = `lg.mission.${date}.${P}`;
    const latched = store.get(latchKey, null);
    const get = () => {
      let m = store.get(latchKey, null);
      if (!m) {
        const mm = missionFor({ date, N, P }, data);
        m = { id: mm.id, text: mm.text };
        store.set(latchKey, m);
        store.set(CUR, { date, P, id: m.id, text: m.text, success: false, dinner: false, dismissed: false });
      }
      return m.text;
    };
    body.append(ctx.reveal({ label: 'Hold to see your mission', secret: () => h('span', { style: 'font-size:26px' }, get()), sub: latched ? 'Your mission is locked in for today' : 'Locked in once you look', onHide: () => { if (!latched) ctx.rerender(); } }));
    if (latched) {
      cur = store.get(CUR, null);
      if (cur && cur.date === date && cur.P === P) {
        if (cur.dinner) dinner(ctx, cur, false);
        else body.append(ctx.confirmButton({ label: '🍽️ Reveal at dinner', confirmLabel: 'Tap again to show mission text', onConfirm: () => { store.set(CUR, { ...cur, dinner: true }); ctx.rerender(); } }));
      }
    }
  },
};

function dinner(ctx, cur, stale) {
  const { h, body, store } = ctx;
  body.append(h('div', { class: 'answer', 'data-testid': 'dinner' }, h('div', { class: 'muted small', text: 'MY MISSION · ' + cur.date }), h('div', { text: cur.text })),
    h('label', { class: 'toggle' }, h('input', { type: 'checkbox', checked: cur.success || null, onchange: e => { store.set(CUR, { ...cur, success: e.target.checked, dinner: true }); if (ctx.live) ctx.live.score('mis|' + cur.date, e.target.checked ? 3 : 0); } }), ctx.live ? 'Mission accomplished! (+3 party points)' : 'Mission accomplished!'),
    stale || cur.dinner ? ctx.confirmButton({ label: 'Done for the day', confirmLabel: 'Tap again to clear this mission', onConfirm: () => { store.set(CUR, { ...cur, dismissed: true }); ctx.rerender(); } }) : null);
}
