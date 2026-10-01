// Wave 6 features: screenshot mark-up, bar-by-bar trade replay, light/dark themes, tax
// presets, passkeys. Pure helpers extracted from the app (app-source.js) and pinned here;
// the browser smoke tests (e2e/) drive the UI.
import { t, ok, eq, near, report, makeExtractor } from './harness.mjs';
import { readAppSource } from '../app-source.js';

const html = readAppSource(new URL('../ledger.html', import.meta.url).pathname);
const { evalFn, grabFn } = makeExtractor(html);

console.log('\nScreenshot mark-up');
t('an arrow head’s barbs sit behind the tip, symmetric about the shaft', () => {
  const head = evalFn('annArrowHead');
  const [[ax, ay], [bx, by]] = head(0, 0, 100, 0, 10);
  ok(ax < 100 && bx < 100, 'behind the tip');
  near(ay, -by, 1e-9); near(ax, bx, 1e-9);
  near(Math.hypot(100 - ax, ay), 10, 1e-9, 'barb length');
  const [[cx, cy]] = head(0, 0, 0, 100, 10); ok(cy < 100, 'pointing down: barbs above the tip'); void cx;
});
t('thumbnails carry a draw button, wired to the editor; saving re-syncs the images', () => {
  ok(grabFn('loadAttachments').includes('data-att-ann'));
  ok(html.includes("const ann=e.target.closest('[data-att-ann]'); if(ann){"));
  const f = grabFn('openAnnotator');
  ok(f.includes('syncAttUp(id)') && f.includes("toDataURL('image/jpeg'") && f.includes('_attSrcOk(src)'));
  ok(f.includes("now.length>=12"), 'the 12-image cap holds for copies');
});

report('features6');
