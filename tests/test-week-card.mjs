// "Share my week": the card's data model (pzWeekCardModel). The card draws only what the model
// returns, so the model is where "no dollar amounts, no P&L" is held.
import { t, ok, eq, report, makeExtractor } from './harness.mjs';
import { readAppSource } from '../app-source.js';

const { evalModule } = makeExtractor(readAppSource(new URL('../ledger.html', import.meta.url).pathname));
const { pzWeekCardModel } = await evalModule(['pzWeekCardModel']);

// a week with money everywhere in its inputs: none of it may come out
const src = () => ({
  from: '2026-09-28', to: '2026-10-04',
  days: [{ key: '2026-09-25', score: 10, net: -900 }, { key: '2026-09-28', score: 90, net: 1200, n: 4 }, { key: '2026-09-29', score: 60, net: -300 },
    { key: '2026-10-01', score: 70, net: 50 }, { key: '2026-10-02', score: 100, net: 400 }],
  streak: { current: 3, best: 9, shields: 1 },
  level: { level: 7, title: 'Steady hand', into: 120, need: 900 },
  xpByDay: { '2026-09-27': 500, '2026-09-28': 110, '2026-09-29': 60, '2026-10-02': 150 },
  badges: [
    { t: 'Clean slate · Gold', r: 2, c: 'discipline', k: '2026-09-01' },
    { t: 'Cool head · Silver', r: 1, c: 'discipline', k: '2026-09-29' },
    { t: 'In the black · Diamond', r: 4, c: 'results', k: '2026-09-30', desc: 'net profit over $10,000' },
    { t: 'Unbroken · Platinum', r: 3, c: 'discipline', k: '2026-08-01' },
    { t: 'Plan first · Bronze', r: 0, c: 'routine', k: '2026-10-01' },
    { t: 'Not earned', r: 5, c: 'discipline', k: null }],
  duel: { w: 3, l: 1, d: 0, staked: 250 },
});

t('the week’s Discipline average, clean days out of trading days, and the streak', () => {
  const m = pzWeekCardModel(src());
  eq(m.discipline, 80, '(90 + 60 + 70 + 100) / 4: days outside the week are left out');
  eq([m.cleanDays, m.tradingDays], [3, 4], '70+ is a clean day');
  eq(m.streak, { current: 3, best: 9 });
  eq([m.from, m.to], ['2026-09-28', '2026-10-04']);
});
t('level and the XP gained this week; the duel record', () => {
  const m = pzWeekCardModel(src());
  eq(m.level, { level: 7, title: 'Steady hand', xp: 320 });
  eq(m.duel, { w: 3, l: 1, d: 0 });
});
t('top badges: this week’s first, by tier, then the best of the rest; results badges never', () => {
  const m = pzWeekCardModel(src());
  eq(m.badges, [{ name: 'Cool head', tier: 1, isNew: true }, { name: 'Plan first', tier: 0, isNew: true }, { name: 'Unbroken', tier: 3, isNew: false }]);
});
t('each part can be left off: level, duel record, badges', () => {
  const m = pzWeekCardModel(src(), { level: false, duel: false, badges: false });
  eq([m.level, m.duel, m.badges], [null, null, []]);
  eq(m.discipline, 80, 'the core stays');
});
t('no duels played, or none at all: no duel record', () => {
  eq(pzWeekCardModel({ ...src(), duel: { w: 0, l: 0, d: 0 } }).duel, null);
  eq(pzWeekCardModel({ ...src(), duel: null }).duel, null);
});
t('a week with no trading reads as empty, not as zero', () => {
  const m = pzWeekCardModel({ from: '2026-10-05', to: '2026-10-11', days: src().days, streak: {}, level: null, xpByDay: {}, badges: [], duel: null });
  eq([m.discipline, m.cleanDays, m.tradingDays, m.level, m.badges], [null, 0, 0, null, []]);
});
t('no money anywhere in the model: no money fields, no dollar signs, no P&L', () => {
  const m = pzWeekCardModel(src());
  const keys = [], strs = [];
  (function walk(v) { if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { keys.push(k); walk(x); } else if (typeof v === 'string') strs.push(v); })(m);
  const money = keys.filter(k => /net|pnl|usd|profit|money|amount|dollar|balance|equity|value|stake|fee|return|ret$|dd$/i.test(k));
  eq(money, [], 'money fields');
  ok(!strs.some(s => /\$|profit|p&l|pnl|in the black/i.test(s)), strs.join(' | '));
  eq(Object.keys(m).sort(), ['badges', 'cleanDays', 'discipline', 'duel', 'from', 'level', 'streak', 'to', 'tradingDays']);
});
report('week card');
