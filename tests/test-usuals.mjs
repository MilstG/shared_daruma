// Morning routine presets: once a question has been answered on enough days, Pulse offers the
// answers you keep giving (and, for a setup question, your setups) as one-tap fills.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, eq, ok, report, makeExtractor } from './harness.mjs';
import { readAppSource } from '../app-source.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readAppSource(join(here, '..', 'ledger.html'));
const { grabFn } = makeExtractor(html);
const usual = new Function(html.match(/^const PZ_USUAL_AFTER=\d+;$/m)[0] + '\n' + grabFn('pzUsualAnswers') + '\nreturn pzUsualAnswers;')();
const Q = 'What’s your bias today, and what would prove it wrong?', S = 'Which setup are you waiting for?';
const day = (i, am) => ['day:2026-09-' + String(i).padStart(2, '0'), { am }];
const J = (rows) => Object.fromEntries(rows);

t('nothing for the first few check-ins', () => {
  eq(usual(J([1, 2, 3, 4].map(i => day(i, { [Q]: 'Long above VWAP' }))), Q, '2026-10-01'), []);
});
t('after five, the answers you repeat — case and spacing aside — most used first, then most recent', () => {
  const rows = [day(1, { [Q]: 'Short below the open' }), day(2, { [Q]: 'long above  vwap' }), day(3, { [Q]: 'Long above VWAP' }),
    day(4, { [Q]: 'Short below the open' }), day(5, { [Q]: 'Long above VWAP' }), day(6, { [Q]: 'something new' }), day(7, { [Q]: 'Range day, fade the edges' })];
  eq(usual(J(rows), Q, '2026-10-01'), [{ text: 'Long above VWAP', n: 3 }, { text: 'Short below the open', n: 2 }]);
});
t('today’s own answer doesn’t count toward the usuals; at most four', () => {
  const rows = []; for (let i = 1; i <= 25; i++) rows.push(day(i, { [Q]: 'idea ' + (i % 6) }));
  const r = usual(J(rows), Q, '2026-09-25'); eq(r.length, 4); ok(r.every(x => x.n >= 2));
});
t('a setup question also offers your setups, without repeating one you already use', () => {
  const rows = [1, 2, 3, 4, 5].map(i => day(i, { [S]: i < 4 ? 'ORB' : 'VWAP reclaim' }));
  eq(usual(J(rows), S, '2026-10-01', ['VWAP reclaim', 'orb', 'Breakout retest', 'Fade', 'More']),
    [{ text: 'ORB', n: 3 }, { text: 'VWAP reclaim', n: 2 }, { text: 'Breakout retest', n: 0, setup: true }]);
  eq(usual(J(rows), Q, '2026-10-01', ['ORB']), [], 'other questions don’t get setups');
});
t('the morning card wires the chips to the inputs', () => {
  ok(grabFn('pzMorningHtml').includes('data-pz-amfill'), 'chips rendered');
  ok(html.includes("if(ds.pzAmfill!==undefined)"), 'tap fills the answer');
});

report('usuals');
