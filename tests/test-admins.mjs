// Admins: members the owner trusts with the admin panel. They sign in with their own member key
// (a link from the owner, or Pulse on their device), never the access token, so they can run the
// league but never reach the owner's journal or server, and only the owner adds or removes admins.
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t, ok, eq, report } from './harness.mjs';

const require = createRequire(import.meta.url);
const server = require('../server.js');
const htmlPath = new URL('../ledger.html', import.meta.url).pathname;
const app = server.createApp({ dataDir: mkdtempSync(join(tmpdir(), 'ledger-admins-')), auth: 'owner-token', htmlPath,
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }) });
const B = await new Promise(res => app.listen(0, () => res('http://127.0.0.1:' + app.address().port)));
const call = async (p, o = {}) => { const r = await fetch(B + p, { method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.key ? { 'X-Pulse-Key': o.key } : {}), ...(o.owner ? { Authorization: 'Bearer owner-token' } : {}) },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  return { status: r.status, d: await r.json().catch(() => ({})) }; };
const redeem = async code => (await call('/api/social/link/finish', { method: 'POST', body: { code } })).d.key;

let A, Aid, Bk, Bid, M, Mid;
try {
  await t('the owner adds an admin by name; the link’s code signs them in', async () => {
    const r = await call('/api/social/admin/members', { method: 'POST', owner: true, body: { handle: 'alex', admin: true } });
    eq(r.status, 200); ok(r.d.code); Aid = r.d.id;
    A = await redeem(r.d.code); ok(A, 'a member key');
    eq((await call('/api/social/admin/me', { key: A })).d, { owner: false, id: Aid, name: '@alex' });
    eq((await call('/api/social/admin/me', { owner: true })).d.owner, true);
    eq((await call('/api/social/me', { key: A })).d.me.admin, true, 'Pulse knows, and shows the admin panel link');
  });
  await t('an existing member is made an admin from their page; ordinary members get nothing', async () => {
    M = (await call('/api/social/join', { method: 'POST', body: { handle: 'morgan' } })).d.key;
    Mid = (await call('/api/social/me', { key: M })).d.me.id;
    eq((await call('/api/social/admin/overview', { key: M })).status, 401);
    const b = (await call('/api/social/join', { method: 'POST', body: { handle: 'blair' } })).d; Bk = b.key;
    Bid = (await call('/api/social/me', { key: Bk })).d.me.id;
    eq((await call('/api/social/admin/members/' + Bid, { method: 'POST', owner: true, body: { action: 'admin' } })).status, 200);
    eq((await call('/api/social/admin/overview', { key: Bk })).status, 200);
    const list = (await call('/api/social/admin/members', { key: A })).d.members;
    eq(list.filter(m => m.admin).map(m => m.handle).sort(), ['alex', 'blair']);
  });
  await t('admins run the league: members, wallets, settings, announcements', async () => {
    eq((await call('/api/social/admin/members/' + Mid, { method: 'POST', key: A, body: { action: 'grant', xp: 100, why: 'welcome' } })).status, 200);
    eq((await call('/api/social/admin/config', { method: 'PUT', key: A, body: { approveWallets: true } })).status, 200);
    eq((await call('/api/social/admin/announce', { method: 'POST', key: A, body: { text: 'Hello league' } })).status, 200);
    const c = await call('/api/social/admin/members', { method: 'POST', key: A, body: { handle: 'newbie' } });
    eq(c.status, 200, 'adds ordinary members');
  });
  await t('only the owner makes or removes admins, or touches another admin', async () => {
    eq((await call('/api/social/admin/members', { method: 'POST', key: A, body: { handle: 'sneaky', admin: true } })).status, 403);
    eq((await call('/api/social/admin/members/' + Mid, { method: 'POST', key: A, body: { action: 'admin' } })).status, 403);
    eq((await call('/api/social/me', { key: M })).d.me.admin, false);
    for (const action of ['ban', 'remove', 'code', 'unadmin', 'edit'])
      eq((await call('/api/social/admin/members/' + Bid, { method: 'POST', key: A, body: { action, handle: 'x_y_z' } })).status, 403, action);
    eq((await call('/api/social/admin/members/' + Aid, { method: 'POST', key: A, body: { action: 'unadmin' } })).status, 403, 'not even themselves');
  });
  await t('an admin key never opens the owner’s journal, backups or server routes', async () => {
    for (const p of ['/api/data', '/api/backups', '/api/snapshots', '/api/v1/meta'])
      eq((await call(p, { key: A })).status, 401, p);
    eq((await call('/api/offsite/run', { method: 'POST', key: A })).status, 401);
  });
  await t('who did what is logged, and wallet decisions name the admin', async () => {
    const log = (await call('/api/social/admin/log', { owner: true })).d.log;
    ok(log.some(x => x.by === '@alex' && /members/.test(x.what) && /grant/.test(x.what)), JSON.stringify(log.slice(0, 3)));
    ok(log.some(x => x.by === 'owner' && /admin$/.test(x.what)));
    await call('/api/social/me', { method: 'PUT', key: M, body: { address: '0x' + '7a'.repeat(20) } });
    await call('/api/social/admin/wallets', { method: 'POST', key: A, body: { action: 'approve', addresses: ['0x' + '7a'.repeat(20)] } });
    const w = (await call('/api/social/admin/wallets', { owner: true })).d.wallets.find(x => x.address === '0x' + '7a'.repeat(20));
    eq(w && w.by, '@alex');
  });
  await t('removing or suspending an admin closes the panel to them at once', async () => {
    eq((await call('/api/social/admin/members/' + Bid, { method: 'POST', owner: true, body: { action: 'unadmin' } })).status, 200);
    eq((await call('/api/social/admin/overview', { key: Bk })).status, 401);
    eq((await call('/api/social/me', { key: Bk })).status, 200, 'still a member');
    eq((await call('/api/social/admin/members/' + Aid, { method: 'POST', owner: true, body: { action: 'ban' } })).status, 200);
    eq((await call('/api/social/admin/overview', { key: A })).status, 401);
  });
} finally { app.close(); }

report('admins');
