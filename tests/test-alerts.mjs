// Webhook alert derivation (scheduled refresh + alerts feature). alertsFrom is pure —
// thresholds and dedupe keys are pinned here without a server, caches, or network.
import { t, ok, eq, report } from './harness.mjs';
import { alertsFrom, healthAlertsFrom, postWebhook, telegramReply, createApp } from '../server.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

const CFG = { liqPct: 10, dailyLoss: 500, funding24h: 100, cooldownMs: 0 };

console.log('\nalertsFrom thresholds');
t('near-liquidation position alerts; safe one does not', () => {
  const a = alertsFrom({ risk: [
    { coin: 'BTC', side: 'long', liqDist: 0.08, notional: 12000, wallet: { address: '0xabc' } },
    { coin: 'ETH', side: 'short', liqDist: 0.45, notional: 8000 },
  ], todayKey: 'd', todayNet: 0, funding24h: 0 }, CFG);
  eq(a.length, 1);
  ok(a[0].key === 'liq:BTC:0xabc');
  ok(a[0].text.includes('8.0% from liquidation'));
});
t('daily loss fires at the limit, keyed to the day so it re-arms tomorrow', () => {
  const a = alertsFrom({ risk: [], todayKey: '2026-9-5', todayNet: -600, funding24h: 0 }, CFG);
  eq(a.length, 1); eq(a[0].key, 'dailyloss:2026-9-5');
  const b = alertsFrom({ risk: [], todayKey: '2026-9-5', todayNet: -400, funding24h: 0 }, CFG);
  eq(b.length, 0); // under the limit
});
t('funding bleed uses paid (negative) funding', () => {
  const a = alertsFrom({ risk: [], todayKey: 'd', todayNet: 0, funding24h: -150 }, CFG);
  eq(a.length, 1); ok(a[0].text.includes('Funding bleed'));
  eq(alertsFrom({ risk: [], todayKey: 'd', todayNet: 0, funding24h: 150 }, CFG).length, 0); // RECEIVING funding is not an alert
});
t('drawdown alert only beyond the Monte-Carlo p95', () => {
  const base = { risk: [], todayKey: 'd', todayNet: 0, funding24h: 0 };
  eq(alertsFrom({ ...base, currentDD: -900, ddP95: 1000 }, CFG).length, 0);
  const a = alertsFrom({ ...base, currentDD: -1200, ddP95: 1000 }, CFG);
  eq(a.length, 1); eq(a[0].key, 'dd');
});
t('thresholds set to 0 disable their alerts', () => {
  const off = { liqPct: 0, dailyLoss: 0, funding24h: 0 };
  const a = alertsFrom({ risk: [{ coin: 'BTC', side: 'long', liqDist: 0.01, notional: 1 }],
    todayKey: 'd', todayNet: -1e9, funding24h: -1e9 }, off);
  eq(a.length, 0);
});

console.log('\npostWebhook body shaping');
async function capture(url) {
  let got = null;
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, o) => { got = { url: u, ...o }; return { ok: true }; };
  try { await postWebhook(url, 'hello'); } finally { globalThis.fetch = orig; }
  return got;
}
await t('discord gets {content}', async () => {
  const g = await capture('https://discord.com/api/webhooks/x/y');
  eq(JSON.parse(g.body), { content: 'hello' });
});
await t('slack gets {text}', async () => {
  const g = await capture('https://hooks.slack.com/services/x');
  eq(JSON.parse(g.body), { text: 'hello' });
});
await t('ntfy gets a plain-text body', async () => {
  const g = await capture('https://ntfy.sh/mytopic');
  eq(g.body, 'hello'); eq(g.headers['Content-Type'], 'text/plain');
});
await t('anything else gets generic {text} JSON', async () => {
  const g = await capture('https://example.com/hook');
  eq(JSON.parse(g.body), { text: 'hello' });
});
await t('non-2xx throws so the caller can log it', async () => {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: false, status: 500 });
  let threw = false;
  try { await postWebhook('https://example.com/h', 'x'); } catch (e) { threw = true; }
  finally { globalThis.fetch = orig; }
  ok(threw);
});

console.log('\ntelegramReply command router');
t('engine-down state answers every command with the same explanation', () => {
  ok(telegramReply('/today', { engineOk: false }).includes('engine unavailable'));
  ok(telegramReply('/risk', null).includes('engine unavailable'));
});
t('/today reports net, count, and the daily limit both sides of the line', () => {
  const under = telegramReply('/today', { engineOk: true, todayNet: -200, todayN: 3, tripLimit: 500 });
  ok(under.includes('-$200') && under.includes('3 trades') && under.includes('Daily limit: $500'));
  const over = telegramReply('/today', { engineOk: true, todayNet: -650, todayN: 5, tripLimit: 500 });
  ok(over.includes('⛔') && over.includes('step away'));
  const noLimit = telegramReply('/today', { engineOk: true, todayNet: 100, todayN: 1, tripLimit: 0 });
  ok(!noLimit.includes('limit'));
});
t('/risk summarizes the book and lists liquidation dangers', () => {
  const st = { engineOk: true, accountValue: 25000, risk: { positions: 2, gross: 40000, skew: -10000,
    dangers: [{ coin: 'DOGE', side: 'long', liqDistPct: 6.5 }] } };
  const r = telegramReply('/risk', st);
  ok(r.includes('2 position(s)') && r.includes('gross $40,000') && r.includes('short $10,000'));
  ok(r.includes('account $25,000'));
  ok(r.includes('DOGE long (6.5% away)'));
  const safe = telegramReply('/risk', { engineOk: true, risk: { positions: 1, gross: 100, skew: 100, dangers: [] } });
  ok(safe.includes('No positions within 10%'));
  ok(telegramReply('/risk', { engineOk: true }).includes('refresh first'));
});
t('/stats formats the 30d summary; empty window says so', () => {
  const s = telegramReply('/stats', { engineOk: true, stats30: { n: 12, net: 340, winRate: 0.583,
    expectancy: 28.3, profitFactor: 1.62, fees: 41 } });
  ok(s.includes('12 trades') && s.includes('win rate 58%') && s.includes('PF 1.62'));
  ok(telegramReply('/stats', { engineOk: true }).includes('No closed trades'));
});
t('/goals reports month vs plan; unset goals point at the Review tab', () => {
  const g = telegramReply('/goals', { engineOk: true, goals: { net: 800, target: 2000, n: 9,
    projected: 2400, intraDD: -300, maxDD: 1000, tradesPerWeek: 4.5, maxTradesWeek: 10 } });
  ok(g.includes('$800 / $2,000 target') && g.includes('Projected month-end: $2,400'));
  ok(g.includes('DD -$300 vs cap -$1,000') && g.includes('4.5 trades/wk vs cap 10'));
  ok(telegramReply('/goals', { engineOk: true }).includes('No monthly goals set'));
});
t('/digest returns the stored digest text or explains there is none', () => {
  eq(telegramReply('/digest', { engineOk: true, digest: 'weekly text' }), 'weekly text');
  ok(telegramReply('/digest', { engineOk: true }).includes('No weekly digest'));
});
t('unknown commands get the help text listing every command', () => {
  const h = telegramReply('/help', { engineOk: true });
  for (const c of ['/today', '/risk', '/stats', '/goals', '/digest']) ok(h.includes(c));
  ok(h.includes('read-only'));
});

console.log('\nOps health alerts');
const HC = { failRuns: 3, diskMinBytes: 100 * 1024 * 1024, diskPct: 90 };
t('refresh failure streak alerts at failRuns, with the last error and data age', () => {
  const now = Date.UTC(2026, 9, 1, 12);
  eq(healthAlertsFrom({ failStreak: 2, now }, HC).length, 0);
  const a = healthAlertsFrom({ failStreak: 3, lastError: 'HTTP 502', lastOkAt: now - 3 * 3600e3, now }, HC);
  eq(a.length, 1); eq(a[0].key, 'health:refresh');
  ok(a[0].text.includes('3 runs in a row') && a[0].text.includes('HTTP 502') && a[0].text.includes('3 h ago'), a[0].text);
  ok(healthAlertsFrom({ failStreak: 5, now }, HC)[0].text.includes('not since this server started'));
  eq(healthAlertsFrom({ failStreak: 9, now }, { ...HC, failRuns: 0 }).length, 0, 'failRuns 0 = off');
});
t('disk alerts under the free floor or past the used percentage, not otherwise', () => {
  const GB = 1024 ** 3;
  eq(healthAlertsFrom({ failStreak: 0, disk: { free: 2 * GB, total: 5 * GB } }, HC).length, 0);
  const pct = healthAlertsFrom({ failStreak: 0, disk: { free: 0.4 * GB, total: 5 * GB } }, HC);
  eq(pct.length, 1); eq(pct[0].key, 'health:disk'); ok(pct[0].text.includes('92% used'), pct[0].text);
  eq(healthAlertsFrom({ failStreak: 0, disk: { free: 50 * 1024 * 1024, total: 0.2 * GB } }, HC).length, 1, 'under the MB floor');
  eq(healthAlertsFrom({ failStreak: 0, disk: null }, HC).length, 0, 'no statfs = no disk alert');
});

await t('scheduled refresh: 3 failed runs post one health alert, a recovery posts once, and meta reports it', async () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const posts = [];
  const hook = http.createServer((req, res) => { let b = ''; req.on('data', c => b += c); req.on('end', () => { posts.push(JSON.parse(b).text); res.end('ok'); }); });
  await new Promise(r => hook.listen(0, r));
  let failing = true;
  const reply = x => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
  const fetchImpl = async (url, o) => {
    if (failing) throw new Error('exchange unreachable');
    const ty = JSON.parse(o.body).type;
    if (ty === 'clearinghouseState') return reply({ assetPositions: [], marginSummary: { accountValue: '0' } });
    if (ty === 'spotClearinghouseState') return reply({ balances: [] });
    if (ty === 'spotMetaAndAssetCtxs') return reply([{ universe: [], tokens: [] }, []]);
    return reply([]);
  };
  const dataDir = mkdtempSync(join(tmpdir(), 'ledger-health-'));
  const app = createApp({ dataDir, auth: 'secret', htmlPath: join(here, '..', 'ledger.html'), fetchImpl, push: false,
    alerts: { webhook: 'http://127.0.0.1:' + hook.address().port + '/hook' },
    diskStat: () => ({ free: 10 * 1024 ** 3, total: 20 * 1024 ** 3 }) });
  const base = await new Promise(r => app.listen(0, () => r('http://127.0.0.1:' + app.address().port)));
  const H = { Authorization: 'Bearer secret', 'Content-Type': 'application/json' };
  const w = await fetch(base + '/api/data', { method: 'PUT', headers: H, body: JSON.stringify({ rev: 0,
    snapshot: { app: 'ledger', journal: {}, wallets: [{ address: '0x' + '1'.repeat(40), label: 'main' }] } }) });
  eq(w.status, 200);
  for (let i = 0; i < 4; i++) await app._runScheduledRefresh();
  const health = posts.filter(p => p.includes('Scheduled refresh'));
  eq(health.length, 1, 'one alert for the streak, not one per run: ' + JSON.stringify(posts));
  ok(health[0].includes('last error: Network error'), health[0]);
  const meta = await (await fetch(base + '/api/v1/meta', { headers: H })).json();
  eq(meta.refresh.failStreak, 4); ok(meta.disk && meta.disk.total > 0);
  failing = false;
  await app._runScheduledRefresh();
  await app._runScheduledRefresh();
  eq(posts.filter(p => p.includes('working again')).length, 1, 'recovery said once: ' + JSON.stringify(posts));
  eq((await (await fetch(base + '/api/v1/meta', { headers: H })).json()).refresh.failStreak, 0);
  await new Promise(r => app.close(r)); hook.close();
});

report('alerts');
