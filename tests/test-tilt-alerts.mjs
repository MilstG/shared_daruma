// Live tilt alerts: the patterns read from today's fills (pzTiltAlerts), the once-a-day and
// 30-minute rules (pzTiltAlertPick), days on the trader's own clock, and the push the server
// sends members with Pulse closed (pref kind "tilt").
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { t, ok, eq, report, makeExtractor } from './harness.mjs';
import { readAppSource } from '../app-source.js';

const require = createRequire(import.meta.url);
const htmlPath = new URL('../ledger.html', import.meta.url).pathname;
const { evalModule } = makeExtractor(readAppSource(htmlPath));
const { pzTiltAlerts, pzTiltAlertPick } = await evalModule(['nfMedian', 'pzTiltAlerts', 'pzTiltAlertPick'], ['pzTiltAlerts', 'pzTiltAlertPick']);

const M = 60000, H = 3600000, DAY = 86400000;
const zone = tz => { const f = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }); return ms => f.format(ms); };
const UTC = zone('UTC');
const NOW = Date.UTC(2026, 9, 2, 15, 0); // Fri 2 Oct 2026, 15:00 UTC
let id = 0;
// a closed trade: opened `open` ms before now, closed `close` ms before now (null = still open)
const tr = (open, close, net, size) => ({ id: 't' + (++id), openTime: NOW - open, closeTime: close == null ? null : NOW - close, isOpen: close == null,
  net: net || 0, maxSize: 1, avgEntry: size || 1000 });
const run = (trades, o) => pzTiltAlerts(trades, Object.assign({ now: NOW, dayOf: UTC, isLoss: n => n < -1 }, o || {}));
const kinds = a => a.map(x => x.k);

console.log('\nPatterns');
t('a re-entry within 15 minutes of a loss', () => {
  const a = run([tr(50 * M, 20 * M, -40), tr(12 * M, null)]);
  eq(kinds(a), ['revenge']); ok(/8 minutes after a loss/.test(a[0].text), a[0].text); eq(a[0].at, NOW - 12 * M);
  eq(run([tr(50 * M, 35 * M, -40), tr(12 * M, null)]), [], '23 minutes later is not a quick re-entry');
  eq(run([tr(50 * M, 20 * M, 40), tr(12 * M, null)]), [], 'after a win it is just the next trade');
  eq(run([tr(150 * M, 100 * M, -40), tr(95 * M, null)]), [], 'more than an hour ago: not live any more');
});
t('a stop-and-reverse on the same fill counts as the re-entry', () => {
  const a = tr(30 * M, 10 * M, -40), b = { ...tr(10 * M, null), openTime: a.closeTime };
  eq(kinds(run([a, b])), ['revenge']); ok(/1 minute after/.test(run([a, b])[0].text), 'never "0 minutes"');
});
t('3 losses within 45 minutes', () => {
  const a = run([tr(60 * M, 40 * M, -20), tr(38 * M, 25 * M, -20), tr(23 * M, 5 * M, -20)]);
  ok(kinds(a).includes('streak3')); ok(a.find(x => x.k === 'streak3').text.startsWith('3 losses in 35 minutes. This is when revenge trades happen.'));
  ok(!kinds(run([tr(90 * M, 55 * M, -20), tr(38 * M, 25 * M, -20), tr(23 * M, 5 * M, -20)])).includes('streak3'), '50 minutes apart');
  ok(!kinds(run([tr(60 * M, 40 * M, -20), tr(38 * M, 25 * M, 30), tr(23 * M, 5 * M, -20)])).includes('streak3'), 'two losses and a win');
});
t('sizing up right after a loss, against the median of the trades before it', () => {
  const past = [1, 2, 3, 4, 5, 6].map(i => tr(i * DAY + H, i * DAY, 10, 1000));
  const a = run([...past, tr(60 * M, 30 * M, -40, 1000), tr(10 * M, null, 0, 2000)]);
  eq(kinds(a), ['sizeUp']); ok(/2\.0× your usual size, right after a loss/.test(a[0].text), a[0].text);
  eq(kinds(run([...past, tr(60 * M, 30 * M, -40, 1000), tr(10 * M, null, 0, 1400)])), [], '1.4× is not sizing up');
  eq(kinds(run([...past, tr(60 * M, 30 * M, 40, 1000), tr(10 * M, null, 0, 2000)])), [], 'after a win it is not');
  eq(kinds(run([past[0], tr(60 * M, 30 * M, -40, 1000), tr(10 * M, null, 0, 2000)])), [], 'too little history to know your usual size');
});
t('more trades than the plan, or well past a usual day', () => {
  const today = n => Array.from({ length: n }, (_, i) => tr((55 - i * 5) * M, (53 - i * 5) * M, 10));
  const a = run(today(4), { maxTrades: 3 });
  eq(kinds(a), ['overtrade']); ok(/trade 4 today, and your plan was 3/.test(a[0].text));
  eq(run(today(3), { maxTrades: 3 }), [], 'at the plan is fine');
  // usual: two a day over the last six trading days, so past max(3, 2 × 1.5) = 3
  const past = []; for (let d = 1; d <= 6; d++) past.push(tr(d * DAY + 2 * H, d * DAY + H, 10), tr(d * DAY + 4 * H, d * DAY + 3 * H, 10));
  const u = run([...past, ...today(4)]);
  eq(kinds(u), ['overtrade']); ok(/a usual day for you is about 2/.test(u[0].text), u[0].text);
  eq(run([...past, ...today(3)]), []);
  eq(run(today(9)).length, 0, 'no usual yet (fewer than five past days), no plan: nothing to compare with');
  eq(kinds(run([...past, ...today(4)], { maxTrades: 6 })), ['overtrade'], 'inside the plan but well past the usual day');
});
t('the loss limit: 80% used, then reached (the existing limit, one alert path)', () => {
  const t1 = tr(120 * M, 100 * M, -30), t2 = tr(75 * M, 40 * M, -55);
  const a = run([t1, t2], { lossLimit: 100 });
  eq(kinds(a), ['limit80']); ok(/used 85% of today’s loss limit/.test(a[0].text)); eq(a[0].at, t2.closeTime);
  const b = run([t1, t2, tr(15 * M, 5 * M, -20)], { lossLimit: 100 });
  eq(kinds(b), ['limit']); ok(/reached the loss limit/.test(b[0].text));
  eq(run([t1, t2, tr(15 * M, 5 * M, 40)], { lossLimit: 100 }), [], 'back under 80%: nothing');
  eq(run([t1, t2], {}), [], 'no limit set');
  ok(!/\$|\d+\.\d\d/.test(a[0].text + b[0].text), 'percentages, never dollar amounts (the text can land on a lock screen)');
});
t('most urgent first: the limit, then losses close together, then the rest', () => {
  const a = run([tr(60 * M, 40 * M, -40), tr(38 * M, 25 * M, -40), tr(23 * M, 5 * M, -40), tr(3 * M, null)], { lossLimit: 100 });
  eq(kinds(a), ['limit', 'streak3', 'revenge']);
});
t('every alert is plain and kind: no shaming words, a way to step away', () => {
  const all = [run([tr(50 * M, 20 * M, -40), tr(12 * M, null)]), run([tr(60 * M, 40 * M, -20), tr(38 * M, 25 * M, -20), tr(23 * M, 5 * M, -20)], { lossLimit: 50 })].flat();
  for (const x of all) { ok(!/stupid|idiot|fail|bad trader|again\?!|you always|never learn/i.test(x.text), x.text); ok(/step away|stop|close the app|come back/i.test(x.text), x.text); ok(x.title && x.title.length < 40); }
});

console.log('\nDays on your clock');
t('a loss before your midnight is yesterday: it doesn’t make three today', () => {
  const NY = zone('America/New_York');
  const now = Date.UTC(2026, 9, 2, 4, 30); // 00:30 in New York, still 2 Oct in UTC
  const L = (o, c) => ({ id: 'n' + (++id), openTime: now - o, closeTime: now - c, isOpen: false, net: -20, maxSize: 1, avgEntry: 1000 });
  const trades = [L(50 * M, 40 * M), L(28 * M, 25 * M), L(15 * M, 10 * M)]; // 23:50 NY yesterday, 00:05 and 00:20 today
  ok(!kinds(pzTiltAlerts(trades, { now, dayOf: NY })).includes('streak3'), 'New York: two losses today');
  ok(kinds(pzTiltAlerts(trades, { now, dayOf: UTC })).includes('streak3'), 'UTC: all three are today');
});
t('trades opened yesterday don’t count toward today’s total', () => {
  const NY = zone('America/New_York'), now = Date.UTC(2026, 9, 2, 4, 40); // 00:40 New York
  const mk = (o, c) => ({ id: 'y' + (++id), openTime: now - o, closeTime: now - c, isOpen: false, net: 10, maxSize: 1, avgEntry: 1000 });
  const trades = [mk(55 * M, 52 * M), mk(50 * M, 48 * M), mk(45 * M, 42 * M), mk(20 * M, 10 * M)]; // three before NY midnight
  eq(pzTiltAlerts(trades, { now, dayOf: NY, maxTrades: 2 }), [], 'one trade today in New York');
  eq(kinds(pzTiltAlerts(trades, { now, dayOf: UTC, maxTrades: 2 })), ['overtrade']);
});

console.log('\nRate limits');
const c = (k, at) => ({ k, at: at || NOW, title: k, text: k });
t('one alert at a time, each pattern once a day, none within 30 minutes of the last', () => {
  let r = pzTiltAlertPick([c('streak3'), c('revenge')], null, NOW, '2026-10-02');
  eq(r.pick.k, 'streak3'); eq(r.st, { day: '2026-10-02', fired: { streak3: NOW }, last: NOW });
  r = pzTiltAlertPick([c('revenge')], r.st, NOW + 10 * M, '2026-10-02'); eq(r.pick, null, '10 minutes later: quiet');
  r = pzTiltAlertPick([c('streak3'), c('revenge')], r.st, NOW + 31 * M, '2026-10-02'); eq(r.pick.k, 'revenge', 'streak3 already said today');
  r = pzTiltAlertPick([c('streak3'), c('revenge')], r.st, NOW + 70 * M, '2026-10-02'); eq(r.pick, null, 'both said today');
  r = pzTiltAlertPick([c('streak3')], r.st, NOW + 20 * H, '2026-10-03'); eq(r.pick.k, 'streak3', 'a new day on your clock starts fresh');
});
t('the 30-minute gap holds across midnight; reaching the limit covers the 80% one', () => {
  const st = { day: '2026-10-02', fired: { revenge: NOW }, last: NOW };
  eq(pzTiltAlertPick([c('streak3')], st, NOW + 20 * M, '2026-10-03').pick, null);
  const r = pzTiltAlertPick([c('limit')], null, NOW, '2026-10-02');
  ok(r.st.fired.limit && r.st.fired.limit80);
  eq(pzTiltAlertPick([c('limit80')], r.st, NOW + 40 * M, '2026-10-02').pick, null);
  eq(pzTiltAlertPick([], null, NOW, '2026-10-02').pick, null);
});
t('a state from another day keeps only its last time', () => {
  const r = pzTiltAlertPick([c('revenge')], { day: '2026-10-01', fired: { revenge: NOW - DAY }, last: NOW - DAY }, NOW, '2026-10-02');
  eq(r.pick.k, 'revenge'); eq(Object.keys(r.st.fired), ['revenge']);
});

console.log('\nPushes while Pulse is closed');
const server = require('../server.js');
const Push = require('../push.js');
const W = '0x' + 'ab'.repeat(20);
let clock = NOW;
// three losing round trips in the last 40 minutes on the member's wallet
const fl = (side, start, pnl, ms, i) => ({ coin: 'ETH', side, sz: '1', px: '1000', startPosition: String(start), closedPnl: String(pnl), fee: '0.5', crossed: true, time: ms, tid: i, oid: i });
const FILLS = [];
[[40, 30], [28, 18], [15, 5]].forEach(([o, cl], i) => FILLS.push(fl('B', 0, 0, NOW - o * M, 2 * i + 1), fl('A', 1, -25, NOW - cl * M, 2 * i + 2)));
const fetchImpl = async (url, o) => { const b = JSON.parse(o.body || '{}');
  const out = b.type === 'userFillsByTime' ? FILLS.filter(f => f.time >= (b.startTime || 0)) : [];
  return { ok: true, status: 200, json: async () => out }; };
const pushed = [];
const pushFetch = async (url, o) => { pushed.push(url); return { status: 201 }; };
const dataDir = mkdtempSync(join(tmpdir(), 'ledger-tilt-'));
const app = server.createApp({ dataDir, auth: 'owner-token', htmlPath, now: () => clock, pushFetch, pushTick: false, fetchImpl, offsiteTimer: false });
const B = await new Promise(res => app.listen(0, () => res('http://127.0.0.1:' + app.address().port)));
const call = async (p, o = {}) => { const r = await fetch(B + '/api/social' + p, { method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.key ? { 'X-Pulse-Key': o.key } : {}) }, body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  return { status: r.status, d: await r.json().catch(() => ({})) }; };
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const sub = () => ({ endpoint: 'https://fcm.googleapis.com/push/' + crypto.randomBytes(4).toString('hex'), keys: { p256dh: Push.b64u(ua.getPublicKey()), auth: Push.b64u(crypto.randomBytes(16)) } });
try {
  const K = (await call('/join', { method: 'POST', body: { handle: 'tilty', address: W, share: { verify: true } } })).d.key;
  ok(K, 'joined');
  await call('/stats', { method: 'POST', key: K, body: { xp: 10, level: 1, tz: 'UTC', days: [{ k: '2026-10-02', s: 60 }] } });
  const P = await call('/push', { method: 'POST', key: K, body: { subscription: sub(), prefs: { morning: '05:00', eod: '05:30' } } });
  eq(P.d.prefs.tilt, true, 'tilt alerts are on by default');
  await t('Pulse open on a device (seen in the last 10 minutes): no push, the app says it', async () => {
    clock = NOW + 30 * 1000;
    eq(await app.pushTick(), 0); eq(pushed.length, 0);
  });
  await t('once Pulse closes, what the open app already said isn’t pushed again (and the 30 minutes hold)', async () => {
    clock = NOW + 11 * M; // the last request was 11 minutes ago; the losses are still inside the hour
    eq(await app.pushTick(), 0);
  });
  await t('a new pattern while closed is pushed once, with the tilt pref kind', async () => {
    FILLS.push(fl('B', 0, 0, NOW + 12 * M, 99)); // a re-entry 17 minutes after the last loss: not quick enough
    clock = NOW + 50 * M; eq(await app.pushTick(), 0, 'nothing new to say');
    FILLS.push(fl('A', 1, -30, NOW + 52 * M, 100), fl('B', 0, 0, NOW + 58 * M, 101)); // a loss, then back in 6 minutes later
    clock = NOW + 60 * M; eq(await app.pushTick(), 1); for (let i = 0; i < 50 && !pushed.length; i++) await new Promise(r => setTimeout(r, 20)); eq(pushed.length, 1);
    clock = NOW + 63 * M; eq(await app.pushTick(), 0, 'checked at most every 5 minutes, said once');
    clock = NOW + 70 * M; eq(await app.pushTick(), 0);
  });
  await t('the member can turn tilt pushes off in the push settings', async () => {
    const r = await call('/push', { method: 'PUT', key: K, body: { prefs: { tilt: false } } });
    eq(r.d.prefs.tilt, false);
    const items = (await call('/inbox', { key: K })).d.items;
    ok(items.some(x => x.kind === 'tilt' && /minutes? after a loss/.test(x.text)), JSON.stringify(items));
    FILLS.push(fl('A', 1, -30, NOW + 72 * M, 102), fl('B', 0, 0, NOW + 74 * M, 103), fl('A', 1, -30, NOW + 76 * M, 104));
    clock = NOW + 120 * M; eq(await app.pushTick(), 0); eq(pushed.length, 1);
  });
} finally { app.close(); }
report('tilt alerts');
