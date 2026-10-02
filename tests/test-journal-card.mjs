// The journal card's chart and its inputs: one price format, round-number gridlines, the hold as
// text; sample candles that follow the sample trades' own prices (and never reach the exchange or a
// real coin's cache); every fill marked on the chart; the fill replay with a dot per fill.
import vm from 'node:vm';
import { t, ok, eq, near, report, makeExtractor } from './harness.mjs';
import { readAppSource } from '../app-source.js';

const html = readAppSource(new URL('../ledger.html', import.meta.url).pathname);
const { grabFn } = makeExtractor(html);
const grabConst = name => { const i = html.indexOf('const ' + name + '='); if (i < 0) throw new Error(name); return html.slice(i, html.indexOf(';\n', i) + 1); };
const ctx = { Math, Object, Array, String, Number, JSON, isFinite, Date, Set, Map, Proxy, console };
vm.createContext(ctx);
const load = (consts, fns) => vm.runInContext(consts.join('\n') + '\n' + fns.map(grabFn).join('\n'), ctx);
load([grabConst('PZ_COL_DARK'), grabConst('PZ_COL_LIGHT'), grabConst('PZ_COL'), grabConst('PZ_ITV_NAME'), grabConst('_demoAnchors'), grabConst('_demoHash'), 'let _demoData=false;'],
  ['pzPx', 'pzHeld', 'pzTicks', 'pzSnapSvg', '_hashSeed', 'isDemoData', 'demoAnchorsFor', 'demoNoise', 'demoPrice', 'demoCandles']);
ctx.esc = x => String(x); ctx.dispMarket = x => x; ctx.dcoin = t => t.coin;

t('one price format: thousands separated, decimals by size, no trailing noise', () => {
  eq([2775.33, 170.974, 0.12268, 0.126732, 64000, 1, 0.1, 100.5].map(ctx.pzPx), ['2,775.33', '170.974', '0.12268', '0.12673', '64,000.00', '1.00', '0.10', '100.50']);
  eq([ctx.pzPx(null), ctx.pzPx(NaN), ctx.pzPx(-2.5)], ['—', '—', '−2.50']);
});
t('the hold as text, and round-number gridlines', () => {
  eq([5 * 60e3, 329 * 60e3, 26 * 3600e3 + 30 * 60e3].map(ctx.pzHeld), ['5m', '5h 29m', '1d 2h']);
  eq(ctx.pzTicks(2770, 2905, 4), [2780, 2800, 2820, 2840, 2860, 2880, 2900]);
  eq(ctx.pzTicks(0.1221, 0.1266, 4), [0.123, 0.124, 0.125, 0.126]); eq(ctx.pzTicks(5, 5, 4), [], 'a flat range has no gridlines');
});

const DAY = 864e5, T0 = Date.UTC(2026, 9, 1, 8);
// the sample trades, as the app holds them: events [time, price, size, +1 buy / -1 sell]
ctx.allTrades = [
  { coin: 'ETH', events: [[T0, 2775.33, 3.2, 1], [T0 + 5.5 * 3600e3, 2887.77, 3.2, -1]] },
  { coin: 'ETH', events: [[T0 + 3 * DAY, 2650, 1, 1], [T0 + 3 * DAY + 2 * 3600e3, 2612, 1, -1]] },
  { coin: 'DOGE', events: [[T0 + DAY, 0.12268, 112697, 1], [T0 + DAY + 6 * 3600e3, 0.12588, 112697, -1]] }];
vm.runInContext('_demoData=true', ctx);
t('sample mode is on while sample data is loaded and no real wallet replaced it', () => {
  ok(ctx.isDemoData()); ctx.allTrades.push({ coin: 'BTC', events: [], wallet: { address: '0x' + '1'.repeat(40) } }); ok(!ctx.isDemoData(), 'a real wallet’s trades are on screen'); ctx.allTrades.pop();
});
t('sample candles pass through every fill, at any interval, and the same request gives the same candles', () => {
  for (const itv of ['1m', '5m', '1h']) {
    const { rows, coveredTo } = ctx.demoCandles('ETH', itv, T0 - 3600e3, T0 + 7 * 3600e3), ms = { '1m': 60e3, '5m': 300e3, '1h': 3600e3 }[itv];
    eq(coveredTo, T0 + 7 * 3600e3); ok(rows.length >= Math.floor(8 * 3600e3 / ms) - 1, itv + ': ' + rows.length + ' candles');
    for (const [time, px] of ctx.allTrades[0].events) { const c = rows.find(r => time >= r[0] && time < r[0] + ms); ok(c && c[2] <= px && px <= c[1], itv + ': the fill at ' + px + ' sits inside its candle'); }
    for (const r of rows) ok(r[1] >= Math.max(r[3], r[4]) && r[2] <= Math.min(r[3], r[4]), 'high and low hold the open and close');
  }
  eq(ctx.demoCandles('ETH', '5m', T0, T0 + 3600e3).rows, ctx.demoCandles('ETH', '5m', T0, T0 + 3600e3).rows, 'deterministic');
  eq(ctx.demoCandles('BTC', '5m', T0, T0 + 3600e3).rows, [], 'no sample trades on a coin: no candles');
});
t('between fills the path is a bridge with real wobble, not a straight line; far from any fill it stays near the last price', () => {
  const E = ctx.allTrades[0].events, mid = ctx.demoPrice('ETH', T0 + 2.75 * 3600e3), line = 2775.33 * Math.pow(2887.77 / 2775.33, 0.5);
  ok(Math.abs(mid / line - 1) < 0.05, 'near the bridge: ' + mid);
  let wob = 0; for (let i = 1; i < 60; i++) wob = Math.max(wob, Math.abs(ctx.demoPrice('ETH', T0 + i * 5 * 60e3) / ctx.demoPrice('ETH', T0 + (i - 1) * 5 * 60e3) - 1));
  ok(wob > 0.0005, 'it moves between candles: ' + wob);
  near(ctx.demoPrice('ETH', E[0][0]), 2775.33, 1e-9, 'exactly the fill at the fill'); ok(Math.abs(ctx.demoPrice('ETH', T0 + 30 * DAY) / 2612 - 1) < 0.04, 'after the last fill');
});
t('the sample tape never reaches the exchange, and its cache keys never touch a real coin’s', () => {
  const vf = grabFn('venueFetchCandles'), ek = grabConst('excKey');
  ok(vf.includes("isDemoData())return demoCandles(coin,itvName,a,b)"), 'venueFetchCandles hands sample mode to demoCandles first');
  ok(ek.includes("isDemoData()?'demo:':''"), "excKey prefixes 'demo:'");
});
t('the chart marks every fill on its candle, says how long it was held, and labels the worst and best points', () => {
  const c = Array.from({ length: 40 }, (_, i) => [T0 + i * 3e5, 2790 + i, 2770 + i, 2780 + i, 2779 + i]);
  const tr = { coin: 'ETH', dir: 'Long', avgEntry: 2780, avgExit: 2815, openTime: T0 + 3e5, closeTime: T0 + 36 * 3e5, net: 100, events: [[T0 + 3e5, 2780, 2, 1], [T0 + 20 * 3e5, 2800, 1, 1], [T0 + 36 * 3e5, 2815, 3, -1]] };
  const svg = ctx.pzSnapSvg(tr, c, 3e5, null, { t: T0 + 20 * 3e5, px: 2800, k: 1 });
  eq((svg.match(/<path d="M/g) || []).length, 3, 'a triangle per fill'); eq((svg.match(/<circle[^>]*r="8"/g) || []).length, 1, 'the stepped fill is ringed');
  ok(svg.includes('Bought 2 at 2,780.00') && svg.includes('Sold 3 at 2,815.00'), 'each marker says what happened');
  ok(svg.includes('held 2h 55m · 5m candles') && svg.includes('>in 2,780.00<') && svg.includes('>out 2,815.00<'));
  ok(svg.includes('aria-label="ETH long: in at 2,780.00, out at 2,815.00, 3 fills"'));
  ctx.replayExtremes = () => ({ worst: { x: T0 + 5 * 3e5, y: 2772, pct: -0.29 }, best: { x: T0 + 30 * 3e5, y: 2822, pct: 1.51 } });
  const s2 = ctx.pzSnapSvg(tr, c, 3e5, null, null); ok(s2.includes('>worst −0.29%<'.replace('−', '-')) && s2.includes('>best +1.51%<'), s2.match(/>(worst|best)[^<]*</g));
  ctx.replayExtremes = () => ({ best: { x: T0 + 36 * 3e5, y: 2815, pct: 1.26 } });
  ok(!ctx.pzSnapSvg(tr, c, 3e5, null, null).includes('best +'), 'a best point that is the exit itself adds nothing');
});
t('the fill replay: a dot per fill jumps to it, the arrows step, and prices use the same format as the chart', () => {
  const rp = grabFn('planPzRpHtml');
  ok(rp.includes('data-pz-rpi="${n}"') && rp.includes('pz-rp-dot') && rp.includes("typeof pzPx==='function'?pzPx:planPzPx"));
  ok(grabFn('planPzStep').includes('abs?d:') && grabFn('planPzAction').includes('ds.pzRpi!==undefined'));
  ok(grabFn('pzJournalHtml').includes('class="pz-side"') && grabFn('pzJournalHtml').includes('pz-trade-meta'), 'the card header: side pill and the meta line');
});
report('journal card');
