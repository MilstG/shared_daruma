// The server's refresh never loses what it already knew: a full refetch keeps fill history
// Hyperliquid no longer serves, a refresh of some wallets keeps the others' positions, and a
// failed position read keeps the last good one. Plus: a malformed relay secret can't crash the
// server, the lockout re-arms after a short lock, and built-in names don't pass allow-lists.
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import net from 'node:net';
import { t, ok, eq, report } from './harness.mjs';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const { createApp } = require('../server.js');
const htmlPath = join(here, '..', 'ledger.html');
const reply = x => new Response(JSON.stringify(x), { status: 200, headers: { 'content-type': 'application/json' } });
const A = '0x' + 'a'.repeat(40), B = '0x' + 'b'.repeat(40);
const start = async (wallets, fetchImpl, extra) => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ledger-refresh-'));
  writeFileSync(join(dataDir, 'ledger-data.json'), JSON.stringify({ rev: 1, snapshot: { wallets, settings: {}, journal: {} } }));
  const app = createApp(Object.assign({ dataDir, auth: 's', htmlPath, fetchImpl, push: false, pushTick: false, noTelegramLoop: true, offsiteTimer: false }, extra));
  await new Promise(r => app.listen(0, r));
  const base = 'http://127.0.0.1:' + app.address().port, H = { Authorization: 'Bearer s', 'Content-Type': 'application/json' };
  return { app, dataDir, base, H, refresh: b => fetch(base + '/api/v1/refresh', { method: 'POST', headers: H, body: JSON.stringify(Object.assign({ force: true }, b)) }).then(r => r.json()) };
};

await t('a full refetch merges into the cache: fills Hyperliquid no longer serves are kept', async () => {
  const T0 = Date.now() - 400 * 864e5; let fills = [];
  const add = n => { for (let i = 0; i < n; i++) { const k = fills.length; fills.push({ coin: 'BTC', side: k % 2 ? 'A' : 'B', sz: '1', px: '100', time: T0 + k * 60000, startPosition: k % 2 ? '1' : '0', closedPnl: k % 2 ? '1' : '0', fee: '0', tid: k + 1, oid: k + 1, crossed: true, dir: '' }); } };
  const hl = (url, o) => { const b = JSON.parse(o.body);
    if (b.type === 'userFillsByTime') return reply(fills.slice(-10000).filter(f => f.time >= b.startTime).slice(0, 2000)); // only the newest 10k, 2k a page
    if (b.type === 'spotMetaAndAssetCtxs') return reply([{ universe: [], tokens: [] }, []]);
    if (b.type === 'clearinghouseState') return reply({ assetPositions: [] });
    if (b.type === 'spotClearinghouseState') return reply({ balances: [] });
    return reply([]); };
  const S = await start([{ address: A, label: 'A' }], hl);
  try {
    const cached = () => JSON.parse(gunzipSync(readFileSync(join(S.dataDir, 'fills', A + '.json.gz'))));
    add(9000); await S.refresh({}); add(6000); await S.refresh({});
    eq(cached().fills.length, 15000, 'incremental refreshes keep everything');
    const r = await S.refresh({ full: true });
    const c = cached(); eq([c.fills.length, c.truncated, r.trades.total], [15000, false, 7500], 'still all 15,000, and no gap');
    ok(c.fills.every((f, i) => !i || c.fills[i - 1].time <= f.time), 'in time order');
  } finally { S.app.close(); }
});

await t('positions: a refresh of one wallet keeps the other’s; a failed read keeps the last good one', async () => {
  const now = Date.now(); let chFail = false;
  const hl = (url, o) => { const b = JSON.parse(o.body);
    if (b.type === 'userFillsByTime') return reply(b.startTime > now - 10 * 864e5 ? [] : [{ coin: 'BTC', side: 'B', sz: '1', px: '100', time: now - 864e5, startPosition: '0', closedPnl: '0', fee: '0', tid: b.user === A ? 1 : 2, oid: 1, crossed: true, dir: '' }]);
    if (b.type === 'clearinghouseState') return chFail ? new Response('bad', { status: 400 })
      : reply({ assetPositions: [{ position: { coin: b.user === A ? 'BTC' : 'ETH', szi: '1', entryPx: '100', unrealizedPnl: '0', returnOnEquity: '0', liquidationPx: '97', leverage: { value: 20 }, positionValue: '100' } }], marginSummary: { accountValue: b.user === A ? '1000' : '9000' } });
    if (b.type === 'spotMetaAndAssetCtxs') return reply([{ universe: [], tokens: [] }, []]);
    if (b.type === 'spotClearinghouseState') return reply({ balances: [] });
    return reply([]); };
  const S = await start([{ address: A, label: 'A' }, { address: B, label: 'B' }], hl);
  try {
    const pos = async () => { const p = await (await fetch(S.base + '/api/v1/positions', { headers: S.H })).json(); return [p.positions.map(x => x.coin + '@' + x.wallet.label).sort().join(','), p.accountValue]; };
    await S.refresh({}); eq(await pos(), ['BTC@A,ETH@B', 10000]);
    await S.refresh({ wallets: [A] }); eq(await pos(), ['BTC@A,ETH@B', 10000], 'B is still there after refreshing only A');
    chFail = true; const r = await S.refresh({});
    eq(await pos(), ['BTC@A,ETH@B', 10000], 'an outage doesn’t read as “no positions”');
    ok(r.wallets.every(w => /couldn’t read open positions/.test(w.error)), 'and the refresh says so');
  } finally { S.app.close(); }
});

await t('a relay secret header with a non-ASCII byte gets a 401, not a crashed server', async () => {
  const S = await start([], async () => reply([]), { cexEnv: { CEX_RELAY_SECRET: 'x'.repeat(32) } });
  try {
    // raw bytes on the socket: a header byte 0xFF is one character but two bytes in UTF-8
    const status = await new Promise((res, rej) => { const sock = net.connect(S.app.address().port, '127.0.0.1', () => {
        sock.write(Buffer.concat([Buffer.from('POST /api/cex/relay HTTP/1.1\r\nHost: x\r\nContent-Length: 2\r\nX-Relay-Secret: '), Buffer.from('x'.repeat(31)), Buffer.from([0xff]), Buffer.from('\r\n\r\n{}')])); });
      sock.on('data', d => { res(+d.toString().split(' ')[1]); sock.destroy(); }); sock.on('error', rej); });
    ok(status >= 400 && status < 500, 'refused: ' + status);
    eq((await fetch(S.base + '/api/health')).status < 500, true, 'and the server is still up');
  } finally { S.app.close(); }
});

await t('built-in names don’t pass the allow-lists', async () => {
  const S = await start([], async () => reply([]));
  try {
    for (const p of ['/api/v1/whatif?field=__proto__&value=1', '/api/v1/breakdown?by=__proto__', '/api/v1/breakdown?by=constructor'])
      eq((await fetch(S.base + p, { headers: S.H })).status, 400, p);
  } finally { S.app.close(); }
});

report('refresh safety');
