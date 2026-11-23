import { rideTrivia } from './engine.js';
import { renderQuiz, ensureQuizCss } from './ui-quiz.js';

const PARKS = { DL: 'Disneyland Park', DCA: 'California Adventure' };

function pickRide(ctx) {
  const rides = ctx.data['ridetrivia.json'].rides;
  const id = ctx.getSettings().rideId;
  return rides.find(r => r.id === id) || rides[0];
}

export default {
  id: 'ridetrivia',
  syncMode: 'ride',
  files: ['ridetrivia.json'],
  groupInputs(ctx) { return { rideId: pickRide(ctx).id }; },
  render(ctx) {
    ensureQuizCss();
    const { h, C, body } = ctx;
    const rides = ctx.data['ridetrivia.json'].rides;
    const ride = pickRide(ctx);
    body.append(ctx.howTo('Everyone picks the SAME ride (read it aloud). Answer its questions, lock in, reveal together, and compare scores.'));
    body.append(h('div', { class: 'say' },
      h('div', { class: 't', text: 'READ ALOUD · EVERYONE MUST MATCH' }),
      h('div', { class: 'big', text: `Ride: ${ride.name}` }),
      ctx.canControl ? h('details', { class: 'change' }, h('summary', { text: 'Change ride' }), picker(ctx, rides, ride)) : h('div', { class: 'small muted', text: '👑 The host picks the ride' })));
    const qs = rideTrivia({ rideId: ride.id, C }, ctx.data['ridetrivia.json']);
    renderQuiz(ctx, { key: `lg.ride.${ride.id}.${C}`, liveKey: `ride|${ride.id}|${C}`, questions: qs, label: ride.name });
  },
};

function picker(ctx, rides, cur) {
  const { h } = ctx;
  const wrap = h('div');
  for (const park of Object.keys(PARKS)) {
    const inPark = rides.filter(r => r.park === park);
    if (!inPark.length) continue;
    wrap.append(h('div', { class: 'qgroup', text: PARKS[park] }));
    const lands = [];
    inPark.forEach(r => { if (!lands.includes(r.land)) lands.push(r.land); });
    for (const land of lands) {
      wrap.append(h('div', { class: 'qland', text: land }),
        h('div', { class: 'qrides' }, inPark.filter(r => r.land === land).map(r =>
          h('button', { class: 'btn' + (r.id === cur.id ? ' on' : ''), onclick: () => ctx.setSettings({ rideId: r.id }), text: r.name }))));
    }
  }
  return wrap;
}
