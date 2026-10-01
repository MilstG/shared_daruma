// Tax presets by country: tax years, FX tables, and the matching methods (FIFO, UK same-day /
// 30-day / Section 104, Canadian ACB), each pinned against hand-computed cases.
import { t, ok, eq, near, report, makeExtractor } from './harness.mjs';
import { readAppSource } from '../app-source.js';

const html = readAppSource(new URL('../ledger.html', import.meta.url).pathname);
const { grabBlock, evalModule } = makeExtractor(html);
const presets = grabBlock('const TAX_PRESETS={').replace(/^const /, 'const ');
const T = await evalModule(['taxYearLabel', 'heldOverYear', 'fxFromTable', 'taxDisposals', 'taxReport'], null, presets + ';');
const D = s => Date.parse(s + 'T12:00:00Z');
// spot fills: buys and sells of token @1 (named FOO), USDC fees
const B = (day, sz, px, fee = 0) => ({ coin: '@1', side: 'B', sz: String(sz), px: String(px), fee: String(fee), feeToken: 'USDC', time: D(day) });
const S = (day, sz, px, fee = 0) => ({ coin: '@1', side: 'A', sz: String(sz), px: String(px), fee: String(fee), feeToken: 'USDC', time: D(day) });
const NAMES = { '@1': 'FOO' };

console.log('\nTax years');
t('calendar, UK (6 April) and Australian (1 July) years', () => {
  eq(T.taxYearLabel(D('2025-12-31'), 'cal'), '2025');
  eq([T.taxYearLabel(D('2025-04-05'), 'uk'), T.taxYearLabel(D('2025-04-06'), 'uk'), T.taxYearLabel(D('2026-01-10'), 'uk')], ['2024/25', '2025/26', '2025/26']);
  eq([T.taxYearLabel(D('2025-06-30'), 'au'), T.taxYearLabel(D('2025-07-01'), 'au')], ['FY2024-25', 'FY2025-26']);
});
t('held over a year means sold after the first anniversary; a 29 Feb buy’s anniversary is 28 Feb', () => {
  eq([T.heldOverYear(D('2024-03-01'), D('2025-03-01')), T.heldOverYear(D('2024-03-01'), D('2025-03-02'))], [false, true]);
  eq(T.heldOverYear(D('2024-02-29'), D('2025-03-01')), true); eq(T.heldOverYear(null, D('2030-01-01')), false);
});

console.log('\nCurrency');
t('a pasted rate table: latest rate on or before the day, up to a week back; blank means USD', () => {
  const { fx, n } = T.fxFromTable('date,rate\n2025-01-03,0.80\n2025-01-06; 0,82\n\nnot a row');
  eq(n, 2);
  eq([fx(D('2025-01-03')), fx(D('2025-01-05')), fx(D('2025-01-06')), fx(D('2025-01-13'))], [0.8, 0.8, 0.82, 0.82]);
  ok(Number.isNaN(fx(D('2025-01-02'))), 'before the table'); ok(Number.isNaN(fx(D('2025-01-20'))), 'more than a week stale');
  eq(T.fxFromTable('').fx(D('2025-01-01')), 1);
});
t('amounts convert at each fill’s own date; fills without a rate are counted, not guessed', () => {
  const { fx } = T.fxFromTable('2025-01-01,0.5\n2025-06-01,2');
  const r = T.taxDisposals([B('2025-01-02', 1, 100), S('2025-06-02', 1, 100), S('2024-01-01', 1, 1)], NAMES, 'fifo', fx);
  eq(r.missingFx, 1); eq(r.rows.length, 1);
  near(r.rows[0].cost, 50); near(r.rows[0].proceeds, 200); near(r.rows[0].gain, 150);
});

console.log('\nFIFO (US, Germany, Australia, other)');
t('oldest lots first; fees: buy fee into cost, sell fee off the gain; overselling is unknown basis', () => {
  const r = T.taxDisposals([B('2024-01-10', 2, 10, 1), B('2024-06-01', 2, 20), S('2025-03-01', 3, 30, 3), S('2025-03-02', 2, 30)], NAMES, 'fifo');
  eq(r.rows.map(x => [x.qty, x.rule, x.unknownBasis]), [[2, 'fifo', false], [1, 'fifo', false], [1, 'fifo', false], [1, 'unknown', true]]);
  near(r.rows[0].cost, 21 + 2); near(r.rows[0].proceeds, 60); near(r.rows[0].gain, 37);   // 2 of 3 sold: 2/3 of the $3 sell fee
  near(r.rows[1].cost, 20 + 1); near(r.rows[3].cost, 0);
});
t('presets flag what changes the tax: US term, German tax-free, Australian discount', () => {
  const F = [B('2024-01-10', 1, 10), B('2025-01-05', 1, 10), S('2025-03-01', 2, 20)];
  eq(T.taxReport(F, NAMES, 'us').rows.map(r => r.flag), ['long-term', 'short-term']);
  eq(T.taxReport(F, NAMES, 'de').rows.map(r => r.flag), ['tax-free (held over 1 year)', '']);
  eq(T.taxReport(F, NAMES, 'au').rows.map(r => r.flag), ['CGT discount may apply (held 12+ months)', '']);
  const de = T.taxReport(F, NAMES, 'de').years[0]; near(de.exempt, 10); near(de.net, 20);
});

console.log('\nUnited Kingdom: same day, 30 days, Section 104');
t('same-day buys match first, then buys in the next 30 days, then the pool at average cost', () => {
  const F = [B('2025-01-01', 10, 10), B('2025-02-01', 10, 20),   // pool: 20 @ avg 15
    S('2025-03-01', 4, 30), B('2025-03-01', 1, 25),               // same day: 1 @ 25
    B('2025-03-15', 2, 28),                                       // within 30 days: 2 @ 28
    B('2025-04-20', 5, 40)];                                      // outside 30 days: joins the pool
  const r = T.taxDisposals(F, NAMES, 'uk');
  eq(r.rows.map(x => [x.rule, x.qty]), [['same-day', 1], ['30-day', 2], ['s104', 1]]);
  near(r.rows[0].cost, 25); near(r.rows[1].cost, 56); near(r.rows[2].cost, 15);
  near(r.rows.reduce((s, x) => s + x.gain, 0), 120 - 96);
});
t('a later disposal draws on the pool that excludes buys already matched under the 30-day rule', () => {
  const F = [B('2025-01-01', 10, 10), S('2025-01-10', 5, 12), B('2025-01-20', 5, 20), S('2025-06-01', 10, 15)];
  const r = T.taxDisposals(F, NAMES, 'uk');
  eq(r.rows.map(x => [x.rule, x.qty]), [['30-day', 5], ['s104', 10]]);
  near(r.rows[0].cost, 100); near(r.rows[1].cost, 100, 1e-9, 'pool is the original 10 @ 10');
});
t('UK report uses the 6 April year', () => {
  const r = T.taxReport([B('2025-01-01', 1, 10), S('2025-04-05', 1, 20), B('2025-04-05', 0.5, 10), S('2025-04-07', 0.5, 30)], NAMES, 'uk');
  eq(r.years.map(y => [y.year, y.n]), [['2024/25', 2], ['2025/26', 1]], 'the 5 April sale splits: half same-day, half from the pool');
});

console.log('\nCanada: adjusted cost base');
t('average cost per coin, and losses with a buy within 30 days flagged as possible superficial losses', () => {
  const F = [B('2025-01-01', 1, 100), B('2025-02-01', 1, 200), S('2025-03-01', 1, 120), B('2025-03-20', 1, 90), S('2025-08-01', 1, 160)];
  const r = T.taxReport(F, NAMES, 'ca');
  near(r.rows[0].cost, 150); near(r.rows[0].gain, -30); eq(r.rows[0].flag, 'possible superficial loss');
  near(r.rows[1].cost, 120, 1e-9, 'ACB after the add: (150 + 90) / 2'); near(r.rows[1].gain, 40); eq(r.rows[1].flag, '');
});

report('tax');
