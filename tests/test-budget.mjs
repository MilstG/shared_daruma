// Size budget for what every visitor downloads: ledger.html plus the app/ scripts it loads,
// each served gzipped. This fails the build when the app grows past the budget, so growth is
// a decision, not a drift. Raising a budget is fine — do it in the same change that needs it,
// and say why.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { t, ok, report } from './harness.mjs';
import { appScripts } from '../app-source.js';

const KB = 1024;
const read = f => readFileSync(new URL('../' + f, import.meta.url));
const size = files => files.reduce((a, f) => { const b = read(f); return { raw: a.raw + b.length / KB, gz: a.gz + gzipSync(b).length / KB }; }, { raw: 0, gz: 0 });
const appFiles = ['ledger.html', ...appScripts(read('ledger.html').toString())];
const BUDGETS = [ // name, files, raw KB, gzipped KB (as served, file by file)
  // raw went to 1850 with peer benchmarks and duels; then 1950 / 740 gzipped with plans and replay, tilt alerts, the
  // weekly card, mentor trade reviews, tax-tool exports, improvers and duel pods (Oct 2026). Gzipped is what's downloaded
  // (cached after the first visit); the e2e timings guard the actual load
  ['the app (ledger.html + ' + (appFiles.length - 1) + ' app/ scripts)', appFiles, 1950, 740],
  // the owner's panel only (never sent to members): 100 → 200 KB raw with Insights, bulk actions and the seed table (Oct 2026)
  ['admin.html', ['admin.html'], 200, 60],
];
t('ledger.html loads its code from app/ (at least ten scripts)', () => ok(appFiles.length > 10, appFiles.join(', ')));
for (const [name, files, rawMax, gzMax] of BUDGETS) {
  const { raw, gz } = size(files);
  t(`${name}: ${raw.toFixed(0)} KB raw (budget ${rawMax}), ${gz.toFixed(0)} KB gzipped (budget ${gzMax})`, () => {
    ok(raw <= rawMax, `${name} is ${raw.toFixed(0)} KB raw — over its ${rawMax} KB budget`);
    ok(gz <= gzMax, `${name} is ${gz.toFixed(0)} KB gzipped — over its ${gzMax} KB budget`);
  });
}
report('budget');
