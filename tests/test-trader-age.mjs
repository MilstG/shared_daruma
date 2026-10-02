// Trader Age (app/features/trader-age.js): the daily rating, the 6-month weighted norm, years from a
// rating, pace against this week, breaks that freeze it, and how the feature plugs into Keel.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t, ok, eq, near, report, makeExtractor } from './harness.mjs';

const require = createRequire(import.meta.url);
const htmlPath = new URL('../ledger.html', import.meta.url).pathname;
const { readAppSource } = require('../app-source.js');
const src = readAppSource(htmlPath);
const { grabFn, evalModule } = makeExtractor(src);
const consts = ['taRatingFor'].map(n => src.match(new RegExp('^const ' + n + '=.*$', 'm'))[0]).join('\n');
const { traderAge, taYears, taRatingFor, taFmtYears, taWeeks, taMultStep, taMultOf, taMultDefaults } = await evalModule(
  ['taConf', 'taYears', 'traderAge', 'isoWeekOfKey', 'taFmtYears', 'taMultDefaults', 'taWeeks', 'taMultTier', 'taMultStep', 'taMultOf'],
  ['traderAge', 'taYears', 'taRatingFor', 'taFmtYears', 'taWeeks', 'taMultStep', 'taMultOf', 'taMultDefaults'], 'const TA=taConf();\n' + consts);

const DAY = 864e5, NOW = Date.parse('2026-10-20T12:00:00Z');
const key = ms => new Date(ms).toISOString().slice(0, 10);
// n trading days ending `endBack` days before NOW, one every `every` days
const run = (n, f, o = {}) => Array.from({ length: n }, (_, i) => { const at = NOW - ((o.endBack || 0) + (n - 1 - i) * (o.every || 1)) * DAY;
  return Object.assign({ key: key(at), score: 80, parts: {}, behavior: { flags: {} } }, f(i, at)); });
const age = (days, J, o) => traderAge(days, J || {}, Object.assign({ now: NOW }, o));

t('years from a rating: every 10 points doubles it, capped at 20', () => {
  eq([taYears(50), taYears(60), taYears(70), taYears(80), taYears(40)], [1, 2, 4, 8, 0.5]);
  eq(taYears(100), 20); near(taRatingFor(2), 60, 1e-9);
  eq([taFmtYears(0.5), taFmtYears(1 / 12), taFmtYears(5.71), taFmtYears(12.4)], ['6 months', '1 month', '5.7 years', '12 years']);
});
t('fewer than 15 trading days: still building, with how many to go', () => {
  const A = age(run(9, () => ({})));
  eq([A.building, A.need, A.n], [true, 6, 9]); ok(A.rating > 0, 'the number exists, it just isn’t shown yet');
});
t('the daily mix: 65% Discipline, 15% steadiness, 10% loss limit, 10% prep and journal', () => {
  // flat 50s, no limit set (70), nothing logged: 0.65·50 + 0.15·100 + 0.10·70 + 0 = 54.5
  const A = age(run(20, () => ({ score: 50 })));
  near(A.rating, 54.5, 1e-9); near(A.age, Math.pow(2, 0.45), 1e-9); eq(A.drag, 'discipline');
  // perfect days: limit kept, prepped, every trade journaled → 100, Trader Age at its cap
  const J = {}; const days = run(20, (i, at) => { J['day:' + key(at)] = { sleep: 4 }; return { score: 100, parts: { limit: 1, journal: 1 } }; });
  const B = age(days, J); near(B.rating, 100, 1e-9); eq(B.age, 20);
  // a day traded past the limit scores 0 on that part
  near(age(run(20, () => ({ score: 50, parts: { limit: 0 } }))).rating, 47.5, 1e-9);
});
t('steadiness: the same average Discipline scores lower when it swings', () => {
  const even = age(run(30, () => ({ score: 70 }))), swing = age(run(30, i => ({ score: i % 2 ? 100 : 40 })));
  ok(swing.parts.steadiness < 50, JSON.stringify(swing.parts)); near(even.parts.steadiness, 100, 1e-9);
  ok(swing.rating < even.rating);
});
t('recent days count more: a 30-trading-day half-life', () => {
  const days = [...run(60, () => ({ score: 40 }), { endBack: 30 }), ...run(30, () => ({ score: 90 }))];
  const A = age(days), plain = (60 * 40 + 30 * 90) / 90;
  ok(A.parts.discipline > plain + 5, `weighted ${A.parts.discipline.toFixed(1)} vs plain ${plain.toFixed(1)}`);
});
t('only the last 6 months count, and a break freezes it', () => {
  const old = run(40, () => ({ score: 20 }), { endBack: 200 }), recent = run(20, () => ({ score: 80 }));
  near(age([...old, ...recent]).rating, age(recent).rating, 1e-9, 'days older than 6 months are out');
  // a month with no trading: nothing new comes in, nothing decays (the days are still inside the window)
  const days = run(30, i => ({ score: 60 + (i % 3) * 10 }), { endBack: 40 });
  near(age(days).rating, age(days, {}, { now: NOW - 30 * DAY }).rating, 1e-9);
});
t('pace: this week against the norm, between 0× and 3×, once there are 3 trading days in it', () => {
  const norm = run(40, () => ({ score: 60 }), { endBack: 8 });
  eq(age([...norm, ...run(2, () => ({ score: 100 }))]).pace, undefined, 'two days aren’t a week');
  const good = age([...norm, ...run(4, () => ({ score: 95 }))]); ok(good.pace > 1.5 && good.pace <= 3, String(good.pace));
  const bad = age([...norm, ...run(4, () => ({ score: 10, behavior: { flags: { revenge: 3, sizeUp: 1 } } }))]);
  ok(bad.pace < 0.5, String(bad.pace)); eq(bad.week.slip, 'revenge', 'and which slip cost the most');
});
t('trading age from the first fill, and a week-by-week history (last 12 weeks with trading)', () => {
  const A = age(run(120, () => ({})), {}, { firstAt: NOW - 2 * 365.25 * DAY });
  near(A.tradingYears, 2, 1e-9); eq(A.weeks.length, 12); ok(A.weeks.every(w => w.age > 0 && w.n > 0));
});
// the multiplier: weeks of the form {week, weekRating, norm}
const W = (i, wr, norm = 80) => ({ week: '2026-W' + String(i).padStart(2, '0'), weekRating: wr, norm });
const walk = (weeks, cfg) => weeks.reduce((st, w) => taMultStep(st, w, cfg), null);
t('the multiplier climbs with good weeks: ×1.05 at 2, ×1.1 at 4, ×1.2 at 8, ×1.3 at 13, ×1.5 at 26', () => {
  const at = n => taMultOf(walk(Array.from({ length: n }, (_, i) => W(i + 1, 80))));
  eq([at(1), at(2), at(3), at(4), at(8), at(12), at(13), at(25), at(26), at(40)], [1, 1.05, 1.05, 1.1, 1.2, 1.2, 1.3, 1.3, 1.5, 1.5]);
});
t('a week under the bar drops one tier, never back to the start; a week with a low norm neither counts nor drops', () => {
  const good = Array.from({ length: 10 }, (_, i) => W(i + 1, 80)); // 10 good weeks: ×1.2
  const st = walk([...good, W(11, 60)]); eq([st.count, taMultOf(st)], [4, 1.1], 'down to the 4-week tier');
  eq(taMultOf(walk([...good, W(11, 60), W(12, 60)])), 1.05, 'a second bad week: one more tier');
  eq(walk([W(1, 60)]).count, 0, 'nothing to lose yet');
  const neutral = walk([...good, W(11, 85, 65)]); eq(neutral.count, 10, 'the week was fine but the 6-month norm under the bar: no climb, no drop');
  eq(walk([...good, W(11, 85, null)]).count, 10, 'not enough days for a norm yet: no climb');
});
t('each week counts once, and the owner’s tiers can change without stranding anyone', () => {
  const st = walk(Array.from({ length: 5 }, (_, i) => W(i + 1, 80)));
  eq(taMultStep(st, W(3, 20)).count, 5, 'a week already counted is skipped');
  eq(taMultOf(st, { on: true, bar: 70, tiers: [[1, 1.2], [5, 2]] }), 2, 'the same 5 weeks read against new tiers');
  eq(taMultOf(st, Object.assign(taMultDefaults(), { on: false })), 1, 'off: no multiplier');
});
t('weeks from days: each trading week’s own rating, and the 6-month norm once there are 15 days', () => {
  const days = run(25, () => ({ score: 90 }));
  const ws = taWeeks(days, {}, {});
  ok(ws.length >= 4); ok(ws.every(w => w.weekRating > 70));
  eq(ws[0].norm, null, 'the first week has too few days for a norm'); ok(ws[ws.length - 1].norm > 70);
  eq(taWeeks(days, {}, { after: ws[1].week }).length, ws.length - 2, 'it can start after the last week already counted');
});
t('a feature plugs into Keel through pzFeature: a Today card people can hide and move, and a screen of its own', () => {
  ok(grabFn('pzFeature').includes('PZ_SECTIONS.today.push') && grabFn('pzFeature').includes('PZ_TABS.push'));
  ok(src.includes("pzFeature({id:'age', today:{label:'Trader Age'") && src.includes("tab:{name:'age',nav:'progress',html:taScreenHtml}"));
  ok(src.includes('for(const f of PZ_FEATS)if(f.today)card[f.id]=()=>sec(f.id,()=>f.today.html(D));'), 'Today renders feature cards');
  ok(src.includes('const feat=pzFeatTab(tab);'), 'and routes to feature screens');
});

// served: the feature file loads on Keel's page only, and app/features/ can't be used to reach other files
const server = require('../server.js');
const app = server.createApp({ dataDir: mkdtempSync(join(tmpdir(), 'ledger-ta-')), auth: '', htmlPath, push: false, pushTick: false, offsiteTimer: false });
const B = await new Promise(r => app.listen(0, () => r('http://127.0.0.1:' + app.address().port)));
try {
  await t('the feature file is on Keel’s page only, versioned like every script', async () => {
    const k = await (await fetch(B + '/keel')).text(), j = await (await fetch(B + '/')).text();
    const m = k.match(/<script src="(app\/features\/trader-age\.js\?v=[0-9a-f]{12})"><\/script>/); ok(m, 'on Keel');
    ok(!j.includes('trader-age.js'), 'not on the journal');
    const r = await fetch(B + '/' + m[1]); eq(r.status, 200); ok((await r.text()).includes('function traderAge('));
    for (const p of ['/app/features/../server.js', '/app/features/%2e%2e%2fserver.js', '/app/features/x/y.js', '/app/features/.hidden.js']) eq((await fetch(B + p)).status, 404, p);
  });
} finally { await new Promise(r => app.close(r)); }
report('trader age');
