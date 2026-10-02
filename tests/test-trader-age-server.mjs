// Verified Trader Age (spec step 4): the server scores a member's last 6 months from their wallet's
// fills with the app's own traderAge, adds the prep, journal and loss-limit days their app reports,
// and hands it back on /me; the fills cache grows to 6 months and refills an older, shorter cache.
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t, ok, eq, near, report } from './harness.mjs';

const require = createRequire(import.meta.url);
const server = require('../server.js');
const S = require('../social.js');
const htmlPath = new URL('../ledger.html', import.meta.url).pathname;
const DAY = 864e5, ADDR = '0x' + 'b'.repeat(40);
let clock = Date.parse('2026-10-20T20:00:00Z');
const key = ms => new Date(ms).toISOString().slice(0, 10);
// 20 clean trading days: a buy and a winning sell each day (Discipline 100)
const FILLS = [];
for (let i = 19; i >= 0; i--) { const d = clock - i * DAY - 6 * 3600e3;
  FILLS.push({ coin: 'ETH', side: 'B', sz: '1', px: '100', startPosition: '0', closedPnl: '0', fee: '0', crossed: true, time: d, tid: 2 * i + 1, oid: 2 * i + 1 },
    { coin: 'ETH', side: 'A', sz: '1', px: '110', startPosition: '1', closedPnl: '10', fee: '0', crossed: true, time: d + 3600e3, tid: 2 * i + 2, oid: 2 * i + 2 }); }
const starts = [];
const fetchImpl = async (url, o) => { const b = JSON.parse(o.body);
  if (b.type === 'userFillsByTime' && String(b.user).toLowerCase() === ADDR) { starts.push(b.startTime); return { ok: true, status: 200, json: async () => FILLS.filter(f => f.time >= (b.startTime || 0)) }; }
  return { ok: true, status: 200, json: async () => (b.type === 'portfolio' ? [] : []) }; };
const dataDir = mkdtempSync(join(tmpdir(), 'ledger-ta-srv-'));
// a cache from before the window grew: v1, holding only the last few days
mkdirSync(join(dataDir, 'social-fills'), { recursive: true });
writeFileSync(join(dataDir, 'social-fills', ADDR + '.json.gz'), gzipSync(JSON.stringify({ v: 1, fills: FILLS.slice(-4) })));
const app = server.createApp({ dataDir, auth: 'owner-token', htmlPath, fetchImpl, now: () => clock, push: false, pushTick: false, offsiteTimer: false });
const B = await new Promise(r => app.listen(0, () => r('http://127.0.0.1:' + app.address().port)));
const call = async (p, o = {}) => { const r = await fetch(B + '/api/social' + p, { method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.key ? { 'X-Pulse-Key': o.key } : {}), ...(o.owner ? { Authorization: 'Bearer owner-token' } : {}) },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  return { status: r.status, d: await r.json().catch(() => ({})) }; };
const until = async (f, ms = 3000) => { const end = Date.now() + ms; for (;;) { const v = await f(); if (v || Date.now() > end) return v; await new Promise(r => setTimeout(r, 40)); } };
// what the app sends: the days, with prep done every day, half the trades journaled, no loss limit set
const stats = () => ({ xp: 100, level: 1, tz: 'UTC', firstAt: clock - 400 * DAY,
  days: Array.from({ length: 20 }, (_, i) => ({ k: key(clock - (19 - i) * DAY), s: 100, b: false, j: false, p: 1, jn: 0.5 })) });
let K;
try {
  await t('the stats the app sends carry prep, journal share, loss limit and the first fill, cleaned', () => {
    const s = S.sanitizeStats({ firstAt: 5, days: [{ k: '2026-10-01', s: 80, p: 'yes', jn: 3, lm: 0 }, { k: '2026-10-02', s: 80, lm: 7, jn: 0.333 }] });
    eq(s.firstAt, 1420070400000, 'clamped to 2015 or later');
    eq([s.days[0].p, s.days[0].jn, s.days[0].lm], [1, 1, 0]); eq([s.days[1].p, s.days[1].jn, s.days[1].lm], [undefined, 0.33, undefined]);
  });
  await t('a member whose wallet the server reads gets a verified Trader Age on /me', async () => {
    await call('/admin/config', { method: 'PUT', owner: true, body: { requireClaim: false, unlocksOn: false } });
    K = (await call('/join', { method: 'POST', body: { handle: 'steady_one', address: ADDR, share: { verify: true } } })).d.key;
    eq((await call('/stats', { method: 'POST', key: K, body: stats() })).status, 200);
    const ta = await until(async () => { const m = (await call('/me', { key: K })).d.me; return m.ta && m.ta.n >= 20 ? m.ta : null; });
    ok(ta, 'verified'); eq([ta.n, ta.building], [20, false]);
    // Discipline 100 from the fills, steady, no limit set (70), prep 50 + half journaled 25
    eq([ta.parts.discipline, ta.parts.steadiness, ta.parts.limit, ta.parts.log], [100, 100, 70, 75]);
    near(ta.rating, 94.5, 0.05); eq(ta.age, 20, 'capped');
    near(ta.tradingYears, 400 / 365.25, 0.05); eq(ta.week.n, 7); ok(ta.pace > 0);
  });
  await t('the fills cache grew to 6 months: an older 50-day (v1) cache is read again from the start of the window', () => {
    const first = Math.min(...starts);
    ok(Math.abs(first - (clock - 183 * DAY)) < DAY, 'fetched from 6 months back, not from the cached last fill: ' + new Date(first).toISOString());
  });
  await t('the multiplier: finished weeks move it, the week under way gets it, and the owner’s tiers apply', async () => {
    // 20 days to Tuesday Oct 20: of the finished weeks only Oct 12–18 has 15+ days behind it, and it was good
    let me = (await call('/me', { key: K })).d.me;
    eq([me.mult.held, me.mult.now, me.mult.next.toGo, me.mult.next.mult], [1, 1, 1, 1.05]);
    eq(me.mult.hist, { '2026-W43': 1 }, 'this week, at ×1');
    // the owner makes 1 good week worth ×1.1: the next sync gives this week ×1.1, the weeks already counted aren't recounted
    eq((await call('/admin/config', { method: 'PUT', owner: true, body: { mult: { on: true, bar: 70, tiers: [[1, 1.1], [3, 1.2]] } } })).status, 200);
    await call('/stats', { method: 'POST', key: K, body: stats() });
    me = (await call('/me', { key: K })).d.me;
    eq([me.mult.held, me.mult.now, me.mult.hist['2026-W43']], [1, 1.1, 1.1]);
    // tiers whose multiplier goes down are refused (weeks are sorted); the last good ones stay
    await call('/admin/config', { method: 'PUT', owner: true, body: { mult: { tiers: [[2, 1.5], [4, 1.2]] } } });
    eq((await call('/config')).d.mult.tiers, [[1, 1.1], [3, 1.2]]);
    // off: this week goes back to ×1
    await call('/admin/config', { method: 'PUT', owner: true, body: { mult: { on: false } } });
    await call('/stats', { method: 'POST', key: K, body: stats() });
    eq((await call('/me', { key: K })).d.me.mult.now, 1);
    await call('/admin/config', { method: 'PUT', owner: true, body: { mult: { on: true } } });
  });
  await t('others see the Trader Age only while the member shares verified Discipline', async () => {
    const k2 = (await call('/join', { method: 'POST', body: { handle: 'watcher' } })).d.key;
    const prof = async () => (await call('/profile/steady_one', { key: k2 })).d;
    const p = await prof(); ok(JSON.stringify(p).includes('"traderAge":20'), 'shown');
    await call('/me', { method: 'PUT', key: K, body: { share: { verify: false } } });
    ok(!JSON.stringify(await prof()).includes('"traderAge":20'), 'hidden once verify is off');
    eq((await call('/me', { key: K })).d.me.ta, null, 'and the member’s own goes back to the estimate');
  });
} finally { await new Promise(r => app.close(r)); }
report('trader age (server)');
