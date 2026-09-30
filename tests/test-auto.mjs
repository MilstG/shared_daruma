// Automatic metrics (useful with zero effort): the six Discipline checks read from fills, the
// logging bonus that can only add XP, Form against your own baseline, and Load against your
// usual day. pzBehaviorDays also runs on the server to verify the social boards.
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { t, ok, eq, report, makeExtractor } from './harness.mjs';

const html = readFileSync(new URL('../ledger.html', import.meta.url).pathname, 'utf8');
const { grabFn } = makeExtractor(html);
const ctx = { Math, Object, Array, String, JSON, Set, Map };
vm.createContext(ctx);
vm.runInContext(['nfMedian', 'addedToLoser', 'pzBehaviorDays', 'pzBonus', 'pzForm', 'pzLoad'].map(grabFn).join('\n'), ctx);

const MIN = 60000, DAY = 86400000, T0 = Date.UTC(2026, 8, 1);
const dayOf = ms => new Date(ms).toISOString().slice(0, 10);
const loss = n => n < -1;
let seq = 0;
// a trade on day d, opened at hh:mm, held `hold` minutes
const tr = (d, hh, mm, hold, net, extra) => { const o = T0 + d * DAY + (hh * 60 + mm) * MIN;
  return Object.assign({ id: 't' + (seq++), openTime: o, closeTime: o + hold * MIN, net, maxSize: 1, avgEntry: 100, dir: 'Long', isOpen: false }, extra || {}); };
const days = arr => ctx.pzBehaviorDays(arr, { dayOf, isLoss: loss });
const today = arr => days(arr).slice(-1)[0];

console.log('\nDiscipline checks');
t('a clean day scores 100', () => { const d = today([tr(0, 9, 0, 30, 50), tr(0, 11, 0, 30, -20)]); eq(d.score, 100); eq(d.clean, 2); });
t('re-entering within 15 minutes of a loss is a revenge entry', () => {
  const d = today([tr(0, 9, 0, 60, -40), tr(0, 10, 10, 30, 20)]);
  eq(d.flags.revenge, 1); eq(d.score, 50);
  eq(today([tr(0, 9, 0, 60, -40), tr(0, 10, 20, 30, 20)]).flags.revenge, 0, '20 minutes later is fine');
  eq(today([tr(0, 9, 0, 60, 40), tr(0, 10, 5, 30, 20)]).flags.revenge, 0, 'after a win is fine');
});
t('trading on after two losses in a row the same day', () => {
  const d = today([tr(0, 9, 0, 30, -10), tr(0, 10, 0, 30, -10), tr(0, 12, 0, 30, 5)]);
  eq(d.flags.afterTwo, 1);
  eq(today([tr(-1, 22, 0, 30, -10), tr(0, 9, 0, 30, -10), tr(0, 12, 0, 30, 5)]).flags.afterTwo, 0, 'yesterday’s loss doesn’t count');
});
t('a stop-and-reverse right after a loss is a revenge entry (close and entry share a millisecond)', () => {
  const a = tr(0, 9, 0, 60, -40), b = tr(0, 10, 0, 30, 20); b.openTime = a.closeTime;
  eq(today([a, b]).flags.revenge, 1);
});
t('trades cut off at the start of the history are skipped, not judged', () => {
  const d = today([tr(0, 9, 0, 0, -40, { partialHistory: true }), tr(0, 9, 5, 30, 20)]);
  eq(d.n, 1); eq(d.flags.revenge, 0);
});
t('sizing up right after a loss, against your recent median size', () => {
  const prior = [0, 1, 2, 3, 4].map(i => tr(-1, 9 + i, 0, 20, 5));
  const d = today([...prior, tr(0, 9, 0, 30, -30), tr(0, 10, 0, 30, 10, { maxSize: 2 })]);
  eq(d.flags.sizeUp, 1);
  eq(today([...prior, tr(0, 9, 0, 30, -30), tr(0, 10, 0, 30, 10, { maxSize: 1.4 })]).flags.sizeUp, 0, 'under 1.5× is fine');
});
t('overtrading counts trades past 1.5× your usual day (minimum 3), judged against earlier days only', () => {
  const prior = []; for (let d = -6; d < 0; d++) prior.push(tr(d, 9, 0, 20, 5), tr(d, 11, 0, 20, 5));
  const d = today([...prior, ...[0, 1, 2, 3, 4].map(i => tr(0, 8 + i * 2, 30, 20, 5))]);
  eq(d.flags.overtrade, 2); eq(d.score, 60);
  eq(today([tr(0, 9, 0, 20, 5), tr(0, 10, 0, 20, 5), tr(0, 11, 0, 20, 5), tr(0, 12, 0, 20, 5)]).flags.overtrade, 0, 'no history: no cap');
});
t('holding a loser more than 3× your usual winner hold', () => {
  const prior = [0, 1, 2].map(i => tr(-1, 9 + i, 0, 10, 20));
  eq(today([...prior, tr(0, 9, 0, 45, -30)]).flags.heldLoser, 1);
  eq(today([...prior, tr(0, 9, 0, 25, -30)]).flags.heldLoser, 0);
});
t('adding to a losing position, from the fill events', () => {
  const o = T0 + 9 * 60 * MIN;
  const added = tr(0, 9, 0, 60, -50, { events: [[o, 100, 1, 1], [o + MIN, 95, 1, 1], [o + 2 * MIN, 96, 2, -1]] });
  eq(today([added]).flags.addLoser, 1);
});

console.log('\nBonus XP');
t('logging only ever adds: check-in 10, plan 15, journal 15, stops 10, limit 10 — prorated, never negative', () => {
  eq(ctx.pzBonus(null, null), { parts: {}, total: 0 });
  eq(ctx.pzBonus({ parts: { plan: 0, journal: 0, limit: 0 } }, {}).total, 0, 'a missed plan or a blown limit costs nothing');
  const b = ctx.pzBonus({ parts: { plan: 1, journal: 0.5, planned: 1, limit: 1 } }, { sleep: 3 });
  eq(b.parts, { checkin: 10, plan: 15, journal: 8, stops: 10, limit: 10 }); eq(b.total, 53);
  eq(ctx.pzBonus({ parts: { plan: 0.5 } }, null).parts.plan, 8, 'a plan written after the first entry earns half');
});

console.log('\nForm and Load');
const hist = (nets, dFrom) => nets.map((n, i) => tr(dFrom + i, 10, 0, 30, n));
t('Form needs 15 trades and something in the last 30 days; 50 is your usual', () => {
  const now = T0 + 120 * DAY;
  const base = hist(Array.from({ length: 30 }, (_, i) => (i % 3 === 0 ? -40 : 30)), 80);
  eq(ctx.pzForm(base.slice(0, 12), now, { isWin: n => n > 1, isLoss: loss }).score, null, 'under 15 trades');
  eq(ctx.pzForm(hist(Array.from({ length: 30 }, () => 20), 20), now, { isWin: n => n > 1, isLoss: loss }).stale, true, 'nothing in 30 days');
  const slow = ctx.pzForm(base, now, { isWin: n => n > 1, isLoss: loss });
  ok(slow.score != null && slow.window === 'last 5 trades', 'a slow trader still gets a reading');
  const same = [...base, ...[30, -40, 30].map((n, i) => tr(115 + i, 10, 0, 30, n))];
  const f0 = ctx.pzForm(same, now, { isWin: n => n > 1, isLoss: loss });
  ok(f0.score >= 40 && f0.score <= 62, 'usual week near 50: ' + f0.score);
  const hot = [...base, ...[60, 70, 50].map((n, i) => tr(115 + i, 10, 0, 30, n))];
  const cold = [...base, ...[-60, -70, -50].map((n, i) => tr(115 + i, 10, 0, 30, n))];
  const fh = ctx.pzForm(hot, now, { isWin: n => n > 1, isLoss: loss }).score, fc = ctx.pzForm(cold, now, { isWin: n => n > 1, isLoss: loss }).score;
  ok(fh > f0.score && f0.score > fc, `hot ${fh} > usual ${f0.score} > cold ${fc}`);
  ok(fc < 40, 'a losing week reads as a slump');
});
t('Load: 50 is your usual day, 100 is twice it, and it needs 5 earlier trading days', () => {
  const prior = []; for (let d = 0; d < 6; d++) prior.push(tr(d, 9, 0, 20, 5), tr(d, 11, 0, 20, 5));
  const k = dayOf(T0 + 6 * DAY);
  eq(ctx.pzLoad(prior.slice(0, 8), k, dayOf).score, null);
  eq(ctx.pzLoad([...prior, tr(6, 9, 0, 20, 5), tr(6, 10, 0, 20, 5)], k, dayOf).score, 50);
  eq(ctx.pzLoad([...prior, ...[0, 1, 2, 3].map(i => tr(6, 9 + i, 0, 20, 5))], k, dayOf).score, 100);
  const big = ctx.pzLoad([...prior, tr(6, 9, 0, 20, 5, { maxSize: 6 })], k, dayOf);
  eq(big.rN, 0.5); eq(big.rV, 3); eq(big.score, 100, 'size counts as much as the number of trades');
  eq(ctx.pzLoad(prior, k, dayOf).score, 0);
});
t('the app and the server use one fixed loss rule, not the personal break-even setting', () => {
  ok(html.includes('const PZ_LOSS=n=>n<-1;'));
  ok(grabFn('gameContext').includes('isLoss:PZ_LOSS'));
  ok(readFileSync(new URL('../server.js', import.meta.url).pathname, 'utf8').includes("isLoss: n => n < -1"));
});

report('auto');
