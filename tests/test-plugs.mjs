// Plugging a leak (Pulse → Progress): the clean-week run, the "plugged" badge, plugging again,
// and how plugs merge between devices. The real functions run in a sandbox with a fixed clock
// (Thu 2026-10-01, ISO week 40) and hand-built slip days.
import vm from 'node:vm';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, ok, eq, report, makeExtractor } from './harness.mjs';
import { readAppSource } from '../app-source.js';

const here = dirname(fileURLToPath(import.meta.url));
const html = readAppSource(join(here, '..', 'ledger.html'));
const { grabFn } = makeExtractor(html);
const grabConst = name => { const i = html.indexOf('const ' + name + '='); if (i < 0) throw new Error(name); return html.slice(i, html.indexOf(';\n', i) + 1); };

const NOW = Date.UTC(2026, 9, 1, 15);
class FDate extends Date { constructor(...a) { if (!a.length) super(NOW); else super(...a); } static now() { return NOW; } }
const ctx = vm.createContext({ Date: FDate, Math, console, Set, Map, Object, JSON, Array, String, Promise, isFinite, Infinity, setTimeout,
  S_KEY: 's', J_KEY: 'j', rawSet: async () => {}, allTrades: [], viewFilter: () => true, Store: { async set() {} },
  dayKey: ms => new Date(ms).toISOString().slice(0, 10), isoWeekKey: () => 'week:x', markJEdit() {}, pbNorm: a => a || [] });
const FNS = ['isoWeekOfKey', 'isoWeekMondayKey', 'pzPlugState', 'pzPlugs', 'pzPlugStart', 'pzPlugDrop', 'pzLeakMap', 'adoptHabit', 'retireHabit',
  'habitById', '_syncMerge', 'pzLessonsNorm', 'weekFocus', 'setWeekFocus'];
vm.runInContext(['PZ_BEH', 'PZ_PLUG', 'pzAddDays'].map(grabConst).join('\n') + '\nvar settings={}, journal={}, _pzSlipDays=new Map();\n' + FNS.map(grabFn).join('\n'), ctx);
const run = c => vm.runInContext(c, ctx);
// slip days: {day: [[net, ...flags], ...]}
const days = o => { ctx.__d = new Map(Object.entries(o).sort().map(([k, sl]) => [k, { key: k, slips: sl.map(([net, ...f], i) => ({ id: k + i, net, f })) }]));
  run('_pzSlipDays=__d'); };
const state = from => { const s = run(`pzPlugState({slip:'revenge',from:'${from}'})`); return { cleanRun: s.cleanRun, done: s.done, back: s.back }; };

console.log('\nThe clean-week run');
t('three clean weeks (two trading days each) plug it, done on the third Sunday', () => {
  days({ '2026-09-01': [], '2026-09-02': [], '2026-09-08': [], '2026-09-09': [], '2026-09-15': [], '2026-09-16': [] });
  eq(state('2026-09-01'), { cleanRun: 3, done: '2026-09-20', back: false });
});
t('a slip resets the run even in a week with a single trading day', () => {
  days({ '2026-09-01': [], '2026-09-02': [], '2026-09-09': [[-400, 'revenge']], '2026-09-15': [], '2026-09-16': [], '2026-09-22': [], '2026-09-23': [] });
  eq(state('2026-09-01'), { cleanRun: 2, done: null, back: false });
});
t('a clean week with one trading day neither counts nor breaks the run', () => {
  days({ '2026-09-01': [], '2026-09-02': [], '2026-09-09': [], '2026-09-15': [], '2026-09-16': [], '2026-09-22': [], '2026-09-23': [] });
  eq(state('2026-09-01'), { cleanRun: 3, done: '2026-09-27', back: false });
});
t('the week in progress shows but doesn’t count yet; another slip type is not this leak', () => {
  days({ '2026-09-22': [[-10, 'sizeUp']], '2026-09-23': [], '2026-09-29': [[-50, 'revenge']], '2026-09-30': [] });
  const s = run(`pzPlugState({slip:'revenge',from:'2026-09-21'})`);
  eq([s.cleanRun, s.thisWeek.count], [1, 1]);
});
t('a leak that comes back after it was plugged says so', () => {
  days({ '2026-09-01': [], '2026-09-02': [], '2026-09-08': [], '2026-09-09': [], '2026-09-15': [], '2026-09-16': [], '2026-09-22': [[-80, 'revenge']] });
  eq(state('2026-09-01').back, true);
});

console.log('\nPlugging, stopping, plugging again');
await t('a plug makes one habit; plugging again after it was plugged starts that habit over', async () => {
  run('settings={}');
  days({ '2026-09-01': [], '2026-09-02': [], '2026-09-08': [], '2026-09-09': [], '2026-09-15': [], '2026-09-16': [] });
  ctx.__p = run(`pzPlugStart('revenge')`); await ctx.__p;
  run(`settings.pzPlugs[0].from='2026-09-01'; settings.habits[0].createdAt=Date.UTC(2026,8,1)`);
  await run(`pzPlugStart('revenge')`); // the first one is done: a new plug
  const s = run('settings');
  eq(s.pzPlugs.length, 2); eq(s.habits.length, 1, 'the same habit, reused');
  eq(s.habits[0].retired, false); eq(s.habits[0].createdAt, NOW, 'counted from the new plug');
  await run(`pzPlugStart('revenge')`); eq(run('settings.pzPlugs.length'), 2, 'starting twice is a no-op');
});
await t('the badge counts done plugs once each, and never a stopped one', async () => {
  days({ '2026-09-01': [], '2026-09-02': [], '2026-09-08': [], '2026-09-09': [], '2026-09-15': [], '2026-09-16': [] });
  run(`settings={pzPlugs:[{slip:'revenge',from:'2026-09-01',dropped:true},{slip:'revenge',from:'2026-09-01'},{slip:'revenge',from:'2026-09-01'},{slip:'sizeUp',from:'2026-09-01'}]}`);
  const src = grabFn('pzBadgeCatalog');
  ok(/p\.done&&!p\.dropped/.test(src) && src.includes("seen.add(p.slip+'|'+p.done)"), 'filter in pzBadgeCatalog');
  const f = run(`pzPlugs().filter(p=>p.done&&!p.dropped)`); eq(f.length, 3);
  const seen = new Set(); eq(f.filter(p => !seen.has(p.slip + '|' + p.done) && seen.add(p.slip + '|' + p.done)).length, 2);
});

console.log('\nTwo devices');
t('plugs merge by leak and start day; a stop on either device sticks', () => {
  const mine = [{ slip: 'revenge', from: '2026-09-01', habitId: 'hA', at: 1 }];
  const theirs = [{ slip: 'sizeUp', from: '2026-09-02', habitId: 'hB', at: 2 }, { slip: 'revenge', from: '2026-09-01', habitId: 'hA', at: 0, dropped: true }];
  const m = ctx._syncMerge('pzPlugs', mine, theirs);
  eq(m.map(p => [p.slip, !!p.dropped]), [['revenge', true], ['sizeUp', false]]);
});
t('habits merge by id, so a plug’s habit from the other device isn’t orphaned', () => {
  const m = ctx._syncMerge('habits', [{ id: 'hB', when: 'x', then: 'mine' }], [{ id: 'hA', when: 'y', then: 'z' }, { id: 'hB', when: 'x', then: 'theirs' }]);
  eq(m.map(h => h.id + ':' + h.then).sort(), ['hA:z', 'hB:mine']);
});

console.log('\nThe leak map');
t('the 30-day window is 30 calendar days and the 30 before it', () => {
  const g = { days: [{ key: '2026-09-02', behavior: { slips: [{ net: -10, f: ['revenge'] }] } }, { key: '2026-09-01', behavior: { slips: [{ net: -20, f: ['revenge'] }] } },
    { key: '2026-08-03', behavior: { slips: [{ net: -5, f: ['revenge'] }] } }, { key: '2026-08-02', behavior: { slips: [{ net: -7, f: ['revenge'] }] } }] };
  run('settings={}');
  const r = ctx.pzLeakMap(g, 30).find(x => x.slip === 'revenge');
  eq([r.n, r.cost, r.prevN, r.prevCost], [1, -10, 2, -25]);
});

report('plugs');
