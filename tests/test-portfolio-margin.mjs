// Portfolio margin on Hyperliquid: spot and perps share one balance, and the perp clearinghouse reports
// an account value of 0 for an account that holds six figures (the money sits in the spot state as
// "supplied"). The app takes the exchange's own account value for such a wallet, in every view, and a
// combined total counts it once. An ordinary wallet is read as before: perp and spot balances apart.
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t, ok, eq, near, report, makeExtractor } from './harness.mjs';

const require = createRequire(import.meta.url);
const server = require('../server.js');
const { readAppSource } = require('../app-source.js');
const htmlPath = new URL('../ledger.html', import.meta.url).pathname;
const { evalModule } = makeExtractor(readAppSource(htmlPath));
const { unifiedAccountOf } = await evalModule(['unifiedAccountOf'], ['unifiedAccountOf'], '');

t('a portfolio-margin wallet’s balance is the exchange’s account value, else its spot balances; others get none', () => {
  const pm = Object.assign([{ coin: 'USDC', total: 100389, entry: 0 }], { portfolioMargin: true });
  eq(unifiedAccountOf(pm, { accountValue: 100400 }, 100389), 100400);
  eq(unifiedAccountOf(pm, { accountValue: null }, 100389), 100389, 'the history unreadable: the balances at mark');
  eq(unifiedAccountOf(pm, {}, NaN), null);
  eq(unifiedAccountOf([{ coin: 'USDC', total: 100, entry: 0 }], { accountValue: 5100 }, 100), null, 'an ordinary account');
  eq(unifiedAccountOf([], { accountValue: 1 }, 0), null);
});

// two wallets: PM on portfolio margin (perp clearinghouse 0, 100,389 USDC supplied, account value 100,400
// on the exchange), ORD an ordinary one (5,000 in perps, 100 USDC in spot)
const PM = '0x' + 'a'.repeat(40), ORD = '0x' + 'b'.repeat(40), T0 = Date.parse('2026-09-01T00:00:00Z');
const fetchImpl = async (url, o) => { const b = JSON.parse(o.body), u = String(b.user || '').toLowerCase(), pm = u === PM;
  const reply = x => ({ ok: true, status: 200, json: async () => x });
  switch (b.type) {
    case 'clearinghouseState': return reply(b.dex ? { assetPositions: [] } : { assetPositions: [], marginSummary: { accountValue: pm ? '0.0' : '5000' }, withdrawable: pm ? '0.0' : '5000' });
    case 'spotClearinghouseState': return reply(pm ? { portfolioMarginEnabled: true, balances: [{ coin: 'USDC', total: '100389.33907214', hold: '0.0', entryNtl: '0.0', supplied: '100389.33907214' }] }
      : { balances: [{ coin: 'USDC', total: '100', entryNtl: '0' }] });
    case 'spotMetaAndAssetCtxs': return reply([{ universe: [], tokens: [] }, []]);
    case 'portfolio': return reply([['allTime', { accountValueHistory: [[T0, '0.0'], [T0 + 864e5, pm ? '100400.5' : '5100']], pnlHistory: [[T0, '0'], [T0 + 864e5, '10']] }],
      ['perpAllTime', { accountValueHistory: [[T0, '0.0'], [T0 + 864e5, pm ? '0.0' : '5000']], pnlHistory: [[T0, '0'], [T0 + 864e5, '10']] }]]);
    default: return reply([]);
  }
};
const dataDir = mkdtempSync(join(tmpdir(), 'ledger-pm-'));
const app = server.createApp({ dataDir, auth: 'owner-token', htmlPath, fetchImpl, push: false, pushTick: false, offsiteTimer: false });
const B = await new Promise(r => app.listen(0, () => r('http://127.0.0.1:' + app.address().port)));
const H = { Authorization: 'Bearer owner-token', 'Content-Type': 'application/json' };
const call = async (p, body) => { const r = await fetch(B + p, { method: body ? 'POST' : 'GET', headers: H, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, d: await r.json().catch(() => ({})) }; };

try {
  await t('the server’s snapshot: the portfolio-margin wallet counts its one balance, the ordinary one both of its own', async () => {
    const r = await call('/api/v1/refresh', { wallets: [PM, ORD], force: true });
    eq(r.status, 200, JSON.stringify(r.d).slice(0, 200));
    const p = (await call('/api/v1/positions')).d;
    near(p.accountValue, 100400.5 + 5000, 0.01, 'perp view: the unified balance stands in for the 0 the perp clearinghouse reports');
    near(p.spotAccountValue, 100400.5 + 100, 0.01, 'spot view: the same one balance, plus the ordinary wallet’s spot');
    near(p.unifiedAccountValue, 100400.5, 0.01, 'what a combined total takes off, so the pool is counted once');
    near(p.accountValue + p.spotAccountValue - p.unifiedAccountValue, 100400.5 + 5100, 0.01, 'combined: 105,500.5, not 205,901');
  });
  await t('an ordinary wallet alone reads as before, with no unified balance', async () => {
    await call('/api/v1/refresh', { wallets: [ORD], force: true });
    const p = (await call('/api/v1/positions')).d;
    near(p.accountValue, 5000); near(p.spotAccountValue, 100); ok(p.unifiedAccountValue == null || p.unifiedAccountValue === 0, 'none: ' + p.unifiedAccountValue);
  });
} finally { await new Promise(r => app.close(r)); }

report('portfolio margin');
