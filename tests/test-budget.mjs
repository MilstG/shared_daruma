// Size budget for what every visitor downloads. The app is one file served gzipped; this
// fails the build when it grows past the budget, so growth is a decision, not a drift.
// Raising a budget is fine — do it in the same change that needs it, and say why.
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { t, ok, report } from './harness.mjs';

const KB = 1024;
const BUDGETS = [ // file, raw KB, gzipped KB (as served)
  ['ledger.html', 1750, 680],
  ['admin.html', 100, 32],
];
for (const [file, rawMax, gzMax] of BUDGETS) {
  const buf = readFileSync(new URL('../' + file, import.meta.url));
  const raw = buf.length / KB, gz = gzipSync(buf).length / KB;
  t(`${file}: ${raw.toFixed(0)} KB raw (budget ${rawMax}), ${gz.toFixed(0)} KB gzipped (budget ${gzMax})`, () => {
    ok(raw <= rawMax, `${file} is ${raw.toFixed(0)} KB raw — over its ${rawMax} KB budget`);
    ok(gz <= gzMax, `${file} is ${gz.toFixed(0)} KB gzipped — over its ${gzMax} KB budget`);
  });
}
report('budget');
