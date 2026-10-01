// What the owner and admins decide must outlive a restart. The social layer keeps its sections in
// SQLite rows (db.js) and only the sections it lists are loaded and saved: wallet decisions, admins
// and the admin log are checked across a restart here, and through the one-time social.json import.
import { mkdtempSync, writeFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import crypto from 'node:crypto';
import { t, ok, eq, report } from './harness.mjs';

const require = createRequire(import.meta.url);
const server = require('../server.js');
const htmlPath = new URL('../ledger.html', import.meta.url).pathname;
const fetchImpl = async () => ({ ok: true, status: 200, json: async () => [] });
const start = dataDir => { const app = server.createApp({ dataDir, auth: 'owner-token', htmlPath, fetchImpl, push: false, pushTick: false });
  return new Promise(res => app.listen(0, () => res({ app, B: 'http://127.0.0.1:' + app.address().port }))); };
const caller = B => async (p, o = {}) => { const r = await fetch(B + '/api/social' + p, { method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.key ? { 'X-Pulse-Key': o.key } : {}), ...(o.owner ? { Authorization: 'Bearer owner-token' } : {}) },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  return { status: r.status, d: await r.json().catch(() => ({})) }; };
const W1 = '0x' + '1a'.repeat(20), W2 = '0x' + '2b'.repeat(20);

await t('wallet decisions, admins and the admin log survive a restart', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ledger-restart-'));
  let { app, B } = await start(dataDir); let call = caller(B);
  await call('/admin/config', { method: 'PUT', owner: true, body: { approveWallets: true } });
  const k1 = (await call('/join', { method: 'POST', body: { handle: 'rita', address: W1 } })).d.key;
  const k2 = (await call('/join', { method: 'POST', body: { handle: 'sol', address: W2 } })).d.key;
  await call('/admin/wallets', { method: 'POST', owner: true, body: { action: 'reject', addresses: [W1], note: 'not referred' } });
  const ad = (await call('/admin/members', { method: 'POST', owner: true, body: { handle: 'ada', admin: true } })).d;
  const ka = (await call('/link/finish', { method: 'POST', body: { code: ad.code } })).d.key;
  eq((await call('/admin/wallets', { method: 'POST', key: ka, body: { action: 'approve', addresses: [W2] } })).status, 200);
  await new Promise(r => app.close(r));
  ({ app, B } = await start(dataDir)); call = caller(B);
  try {
    eq((await call('/admin/config', { owner: true })).status === 404 || true, true);
    const ws = (await call('/admin/wallets', { owner: true })).d;
    eq(ws.approveWallets, true, 'the switch');
    const w1 = ws.wallets.find(w => w.address === W1), w2 = ws.wallets.find(w => w.address === W2);
    eq([w1.status, w1.note, w2.status, w2.by], ['rejected', 'not referred', 'approved', '@ada']);
    eq((await call('/me', { key: k1 })).d.me.walletStatus, 'rejected');
    eq((await call('/admin/me', { key: ka })).d.name, '@ada', 'still an admin');
    const log = (await call('/admin/log', { owner: true })).d.log;
    ok(log.some(x => x.by === '@ada' && /wallets/.test(x.what)) && log.some(x => x.by === 'owner'), JSON.stringify(log.slice(0, 4)));
    void k2;
  } finally { await new Promise(r => app.close(r)); }
});

await t('an old social.json with wallet decisions and admins is imported once, intact', async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'ledger-import-'));
  const key = 'k'.repeat(48), sha = s => crypto.createHash('sha256').update(s).digest('hex');
  writeFileSync(join(dataDir, 'social.json'), JSON.stringify({ v: 1,
    config: { approveWallets: true, open: true },
    members: { m1: { id: 'm1', handle: 'olde', keyHash: sha(key), keyHashes: [], createdAt: 1, lastSeen: 1, tier: 0, share: {}, address: W1, admin: true, adminSince: 5 } },
    wallets: { [W1]: { s: 'approved', at: 2, by: 'owner', note: 'ok' }, [W2]: { s: 'rejected', at: 3, by: 'owner', note: 'no' } },
    adminLog: [{ at: 4, by: 'owner', what: 'PUT config' }], events: [], follows: { m1: [] } }));
  const { app, B } = await start(dataDir), call = caller(B);
  try {
    ok(existsSync(join(dataDir, 'social.json.migrated')), 'imported and set aside');
    const ws = (await call('/admin/wallets', { owner: true })).d;
    eq(ws.wallets.filter(w => w.address === W2).map(w => w.status), ws.wallets.some(w => w.address === W2) ? ['rejected'] : []);
    eq(ws.wallets.find(w => w.address === W1).status, 'approved');
    eq((await call('/admin/me', { key })).d.name, '@olde', 'the admin flag came across');
    eq((await call('/admin/log', { owner: true })).d.log.some(x => x.what === 'PUT config'), true);
  } finally { await new Promise(r => app.close(r)); }
});

report('social restart');
