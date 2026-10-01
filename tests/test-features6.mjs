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

console.log('\nBar-by-bar replay');
const pnlAt = evalFn('replayPnlAt');
// long: buy 2 @100, add 2 @110 (avg 105), sell 1 @120, sell 3 @100
const EV = [[1, 100, 2, 1], [2, 110, 2, 1], [3, 120, 1, -1], [4, 100, 3, -1]];
t('before the entry: flat, nothing made', () => eq(pnlAt('Long', EV, 0, 99), { pos: 0, avg: null, realized: 0, open: 0, total: 0 }));
t('while scaling in: running average entry, open P&L at the bar’s close', () => {
  const p = pnlAt('Long', EV, 2, 108); eq(p.pos, 4); near(p.avg, 105); near(p.open, 12); near(p.total, 12);
});
t('partial close realizes against the average; the rest stays open', () => {
  const p = pnlAt('Long', EV, 3, 115); eq(p.pos, 3); near(p.realized, 15); near(p.open, 30); near(p.total, 45);
});
t('flat at the end: the total is the trade’s gross P&L', () => {
  const p = pnlAt('Long', EV, 4, 50); eq(p.pos, 0); near(p.realized, 15 - 15); near(p.total, 0);
});
t('shorts make money as price falls', () => {
  const p = pnlAt('Short', [[1, 100, 1, 1], [5, 90, 1, -1]], 3, 95); near(p.open, 5);
  near(pnlAt('Short', [[1, 100, 1, 1], [5, 90, 1, -1]], 9, 0).total, 10);
});
t('the replay is wired to the price chart and stops its timer when the chart closes', () => {
  ok(grabFn('openReplay').includes('replayWire(box,t,'));
  ok(grabFn('openReplay').includes('clearInterval(_replayTimer)'));
  const w = grabFn('replayWire');
  ok(w.includes('D[S.XDS].hidden=!done') && w.includes('D[S.EDS].hidden=!done'), 'exit line and extremes wait for the end');
  ok(w.includes("idbSet('att:'+t.id,arr)") && w.includes('syncAttUp(t.id)'), 'Attach chart saves a screenshot');
});

console.log('\nLight / dark appearance');
t('Auto follows the device; Dark and Light are fixed; anything else counts as Auto', () => {
  const isLight = (0, eval)('(()=>{ const APPEARANCES=["auto","dark","light"]; return ' + grabFn('appearanceIsLight') + '; })()');
  eq([isLight('auto', true), isLight('auto', false), isLight('dark', true), isLight('light', false), isLight(undefined, true), isLight('sepia', false)],
    [true, false, false, true, true, false]);
});
t('Pulse accents are deepened 40% toward black for light mode', () => {
  const deepen = evalFn('pzDeepen');
  eq(deepen('#3FE0A0'), '#268660'); eq(deepen('#FFFFFF'), '#999999'); eq(deepen('nope'), 'nope');
});
t('appearance syncs, rides backups, applies before first paint, and follows the device live', () => {
  ok(html.includes("'playbooks','appearance'];"), 'synced settings field');
  ok(html.includes('appearance:settings.appearance}'), 'in snapshots/backups');
  ok(html.includes("localStorage.getItem('ledger_light')") && html.includes("document.body.classList.add('light')"), 'first-paint script');
  ok(html.includes("matchMedia('(prefers-color-scheme: light)').addEventListener('change'"), 'Auto follows a device switch');
  ok(grabFn('pzSheetHtml').includes('data-pz-appear'), 'Pulse settings has the switch');
  ok(html.includes('body.light #pz{--pz-acc:var(--pz-acc-l'), 'Pulse picks the deepened accent in light');
});

report('features6');
