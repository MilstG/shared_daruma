// Browser smoke tests: the real app in a real Chromium, served by the real server, offline.
// The unit suites (npm test) exercise functions pulled out of ledger.html; these catch what
// they can't — a view that throws on render, a button wired to nothing, a sync that never
// reaches the server, a page that got slow. Run: npm run test:e2e
//
// Needs Playwright with Chromium, which the repo deliberately doesn't depend on:
//   npm i --no-save playwright && npx playwright install chromium
// (or point NODE_PATH at an existing install). Every request outside the local server is
// blocked, so nothing here touches Hyperliquid or the internet.
//
// Timing budgets are in BUDGET_MS below; E2E_SLOW=2 doubles them on a slow machine.
import { createRequire } from 'node:module';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { t, ok, eq, report } from '../tests/harness.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) {
  console.error('Playwright is not installed. Run: npm i --no-save playwright && npx playwright install chromium');
  process.exit(1);
}
const { createApp } = require(join(here, '..', 'server.js'));

const SLOW = Math.max(1, +process.env.E2E_SLOW || 1);
const BUDGET_MS = { boot: 3000, demo: 4000, tab: 2500, pulse: 4000, admin: 3000 }; // measured ~0.4–0.6 s locally
const within = (what, ms) => ok(ms <= BUDGET_MS[what] * SLOW, `${what} took ${ms} ms — over its ${BUDGET_MS[what] * SLOW} ms budget`);
const timings = {};

const TOKEN = 'e2e-token';
const dataDir = mkdtempSync(join(tmpdir(), 'ledger-e2e-'));
const app = createApp({ dataDir, auth: TOKEN, htmlPath: join(here, '..', 'ledger.html'), push: false, offsiteTimer: false,
  fetchImpl: async () => { throw new Error('offline'); } });
const BASE = await new Promise(r => app.listen(0, '127.0.0.1', () => r('http://127.0.0.1:' + app.address().port)));
const browser = await chromium.launch();

// A page that blocks the outside world, carries the token, and records every uncaught error.
// Console noise the browser itself makes (blocked requests, the CSP meta warning) isn't a bug.
async function openPage(viewport, opts = {}) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|frame-ancestors/.test(m.text())) errors.push(m.text()); });
  await page.route('**/*', r => r.request().url().startsWith(BASE) ? r.continue() : r.abort());
  if (opts.token !== false) await page.addInitScript(tok => { try { localStorage.setItem('srv_token', tok); } catch (e) {} }, TOKEN);
  return { page, errors };
}
const timed = async (key, fn) => { const t0 = Date.now(); await fn(); return (timings[key] = Date.now() - t0); };
const serverJournal = async () => (await (await fetch(BASE + '/api/data', { headers: { Authorization: 'Bearer ' + TOKEN } })).json()).snapshot?.journal || {};

try {
  console.log('\nFull journal (desktop)');
  const { page, errors } = await openPage({ width: 1366, height: 900 });
  await t('boots against the server with the token, inside the budget', async () => {
    within('boot', await timed('boot', async () => {
      await page.goto(BASE + '/');
      await page.waitForSelector('#demoBtn', { state: 'visible' });
      await page.waitForFunction(() => typeof SRV !== 'undefined' && SRV.enabled && !SRV.badAuth);
    }));
    eq(errors, [], 'no uncaught errors on boot');
  });
  await t('sample data reconstructs trades and renders the dashboard, inside the budget', async () => {
    within('demo', await timed('demo', async () => {
      await page.click('#demoBtn');
      await page.waitForFunction(() => typeof allTrades !== 'undefined' && allTrades.length > 0);
      await page.waitForSelector('#tbody tr.trow');
    }));
    ok(await page.evaluate(() => allTrades.length) >= 50, 'a populated history');
    ok(await page.locator('#tbody tr.trow').count() > 0, 'trade rows rendered');
    eq(errors, [], 'no uncaught errors');
  });
  for (const [tab, view] of [['review', 'reviewView'], ['diag', 'diagView'], ['proj', 'projView'], ['dash', 'dashView']]) {
    await t(`the ${tab} tab renders with data, inside the budget`, async () => {
      within('tab', await timed('tab:' + tab, async () => {
        await page.click(`#topnav [data-tab="${tab}"]`);
        await page.waitForFunction(v => { const el = document.getElementById(v); return el && !el.classList.contains('hide') && el.innerText.trim().length > 200; }, view);
      }));
      eq(errors, [], 'no uncaught errors');
    });
  }
  let tradeId;
  await t('a journal note saves, syncs to the server, and survives a reload', async () => {
    const row = page.locator('#tbody tr.trow').first();
    tradeId = await row.getAttribute('data-id');
    await row.click();
    const notes = page.locator(`[data-j="notes"][data-id="${tradeId}"]`);
    await notes.waitFor();
    await notes.fill('e2e: waited for the retest, sized down');
    await page.click(`[data-save="${tradeId}"]`);
    // sync is debounced ~1 s after an edit
    let synced = null;
    for (let i = 0; i < 50 && !synced; i++) { const j = await serverJournal(); if (j[tradeId] && j[tradeId].notes) synced = j[tradeId].notes; else await page.waitForTimeout(200); }
    eq(synced, 'e2e: waited for the retest, sized down', 'the server holds the note');
    await page.reload();
    await page.waitForFunction(id => typeof journal !== 'undefined' && journal[id] && journal[id].notes, tradeId);
    eq(await page.evaluate(id => journal[id].notes, tradeId), 'e2e: waited for the retest, sized down');
    eq(errors, [], 'no uncaught errors');
  });
  await page.close();

  console.log('\nPulse (phone)');
  await t('Pulse opens at phone width with sample data and no errors, inside the budget', async () => {
    const { page: p, errors: errs } = await openPage({ width: 390, height: 844 });
    within('pulse', await timed('pulse', async () => {
      await p.goto(BASE + '/pulse');
      await p.waitForSelector('#pz', { state: 'visible' });
      await p.waitForFunction(() => document.getElementById('pz').innerText.trim().length > 100);
    }));
    const width = await p.evaluate(() => document.documentElement.scrollWidth);
    ok(width <= 390, 'no sideways scrolling on a phone (page is ' + width + ' px wide)');
    eq(errs, [], 'no uncaught errors');
    await p.close();
  });

  console.log('\nAdmin panel');
  await t('every admin tab renders for the owner, inside the budget', async () => {
    const { page: p, errors: errs } = await openPage({ width: 1280, height: 900 });
    within('admin', await timed('admin', async () => {
      await p.goto(BASE + '/admin#overview');
      await p.waitForSelector('#view .tile');
    }));
    const tabs = await p.$$eval('#tabs a', as => as.map(a => a.getAttribute('href').slice(1)));
    ok(tabs.length >= 10 && tabs.includes('wallets'), 'tabs: ' + tabs.join(','));
    for (const tab of tabs) {
      await p.goto(BASE + '/admin#' + tab);
      await p.waitForFunction(tb => document.querySelector('#tabs [aria-current]')?.getAttribute('href') === '#' + tb && document.getElementById('view').innerText.trim().length > 20, tab);
    }
    eq(errs, [], 'no uncaught errors across ' + tabs.length + ' tabs');
    await p.close();
  });
  await t('a wrong token is refused with a message, not a blank page', async () => {
    const { page: p, errors: errs } = await openPage({ width: 1280, height: 900 }, { token: false });
    await p.addInitScript(() => { try { localStorage.setItem('srv_token', 'wrong'); } catch (e) {} });
    await p.goto(BASE + '/admin');
    await p.waitForSelector('#loginErr:not(.hide)');
    ok(/token/i.test(await p.textContent('#loginErr')));
    eq(errs, []);
    await p.close();
  });
} finally {
  await browser.close();
  await new Promise(r => app.close(r));
  console.log('\nTimings (ms): ' + Object.entries(timings).map(([k, v]) => k + ' ' + v).join(' · '));
}
report('e2e');
