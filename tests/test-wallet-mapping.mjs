// Mapping wallets to members by hand from the admin panel: map, unmap and make one the main wallet;
// a wallet belongs to one member (mapped, claimed or someone's main one); mapping approves it when
// wallets need approval; the coach allowance follows every wallet a member has; and a signature
// still wins over a mapping. Networking is stubbed.
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t, ok, eq, report } from './harness.mjs';

const require = createRequire(import.meta.url);
const server = require('../server.js');
const sig = require('../vendor/eth-sig.js');
const htmlPath = new URL('../ledger.html', import.meta.url).pathname;
const stub = { beta: { messages: { create: async req => ({ model: req.model, stop_reason: 'end_turn', content: [{ type: 'text', text: 'Ok.' }] }) } } };
const dataDir = mkdtempSync(join(tmpdir(), 'ledger-wmap-'));
const clock = Date.parse('2026-10-01T15:00:00Z');
const mk = () => server.createApp({ dataDir, auth: 'owner-token', htmlPath, now: () => clock, push: false, pushTick: false,
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }), coach: { enabled: true, client: stub } });
let app = mk();
const listen = () => new Promise(res => app.listen(0, () => res('http://127.0.0.1:' + app.address().port)));
let B = await listen();
const call = async (p, o = {}) => { const r = await fetch(B + p, { method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.key ? { 'X-Pulse-Key': o.key } : {}), ...(o.owner ? { Authorization: 'Bearer owner-token' } : {}) },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  return { status: r.status, d: await r.json().catch(() => ({})) }; };
const join_ = async (handle, address) => { const r = await call('/api/social/join', { method: 'POST', body: { handle, address } });
  const k = r.d.key; return { k, id: (await call('/api/social/me', { key: k })).d.me.id }; };
const act = (id, body, o = { owner: true }) => call('/api/social/admin/members/' + id, { method: 'POST', ...o, body });
const listed = async id => (await call('/api/social/admin/members', { owner: true })).d.members.find(m => m.id === id);
const ask = key => call('/api/coach/chat', { method: 'POST', key, body: { messages: [{ role: 'user', content: 'How did I do?' }], facts: { level: 3 } } });
const w = c => '0x' + c.repeat(20);
const W1 = w('a1'), W2 = w('b2'), W3 = w('c3'), W4 = w('d4');

let A, Bm, Ad;
try {
  await t('map a wallet to a member, then make it the main one (the old main stays mapped)', async () => {
    A = await join_('ann', W1);
    const r = await act(A.id, { action: 'link', address: W2.toUpperCase().replace('0X', '0x') });
    eq(r.status, 200, JSON.stringify(r.d)); eq(r.d.wallets, [W1, W2]); eq(r.d.address, W1);
    const m = await listed(A.id); eq(m.address, W1); eq(m.wallets, [W2]);
    const p = await act(A.id, { action: 'primary', address: W2 });
    eq(p.status, 200); eq(p.d.address, W2); eq(p.d.wallets, [W2, W1]);
    eq((await call('/api/social/me', { key: A.k })).d.me.address, W2, 'the member sees the new main wallet');
  });
  await t('unmap; the main wallet can’t be unmapped; bad input is refused', async () => {
    eq((await act(A.id, { action: 'unlink', address: W2 })).status, 400, 'main');
    eq((await act(A.id, { action: 'unlink', address: W1 })).status, 200);
    eq((await listed(A.id)).wallets, []);
    eq((await act(A.id, { action: 'unlink', address: W1 })).status, 404, 'not mapped any more');
    eq((await act(A.id, { action: 'link', address: '0x123' })).status, 400);
    eq((await act(A.id, { action: 'link', address: W2 })).status, 400, 'already theirs');
  });
  await t('a member without a wallet gets the mapped one as their main', async () => {
    Bm = await join_('bob');
    const r = await act(Bm.id, { action: 'link', address: W3 });
    eq(r.status, 200); eq(r.d.address, W3); eq(r.d.wallets, [W3]);
  });
  await t('one member per wallet: mapped, main or claimed elsewhere is refused', async () => {
    eq((await act(A.id, { action: 'link', address: W3 })).status, 409, 'bob’s main wallet');
    eq((await act(A.id, { action: 'link', address: W4 })).status, 200);
    const r = await act(Bm.id, { action: 'link', address: W4 }); eq(r.status, 409); ok(/@ann/.test(r.d.error), r.d.error);
    eq((await act(Bm.id, { action: 'primary', address: W4 })).status, 409);
    // members can't take a mapped wallet as their own, nor can a newcomer join with it
    const me = await call('/api/social/me', { method: 'PUT', key: Bm.k, body: { address: W4 } });
    eq(me.status, 409); eq(me.d.walletTaken, true);
    const C = await join_('cat', W4); eq((await call('/api/social/me', { key: C.k })).d.me.address ?? null, null, 'joined without it');
    // nor can an admin type it in as someone else's address, or make a new member with it
    eq((await act(Bm.id, { action: 'edit', address: W4 })).status, 409);
    const nm = await call('/api/social/admin/members', { method: 'POST', owner: true, body: { handle: 'dan', address: W4 } });
    eq(nm.status, 200); eq((await listed(nm.d.id)).address, null);
  });
  await t('the admin edit making a mapped wallet main takes it off the mapped list', async () => {
    eq((await act(A.id, { action: 'edit', address: W4 })).status, 200);
    const m = await listed(A.id); eq(m.address, W4); eq(m.wallets, []);
  });
  await t('mapping approves the wallet when wallets need approval; the wallets list shows mapped rows', async () => {
    eq((await call('/api/social/admin/config', { method: 'PUT', owner: true, body: { approveWallets: true } })).status, 200);
    const W5 = w('e5');
    eq((await act(A.id, { action: 'link', address: W5 })).status, 200);
    const ws = (await call('/api/social/admin/wallets', { owner: true })).d.wallets;
    const row = ws.find(x => x.address === W5);
    ok(row, 'listed'); eq(row.status, 'approved'); eq(row.members.map(m => [m.handle, m.linked]), [['ann', true]]);
  });
  await t('admins map too; members can’t', async () => {
    const r = await call('/api/social/admin/members', { method: 'POST', owner: true, body: { handle: 'adele', admin: true } });
    Ad = { k: (await call('/api/social/link/finish', { method: 'POST', body: { code: r.d.code } })).d.key, id: r.d.id };
    eq((await act(Bm.id, { action: 'link', address: w('f6') }, { key: Ad.k })).status, 200);
    eq((await act(Bm.id, { action: 'link', address: w('f7') }, { key: Bm.k })).status, 401);
  });
  await t('the coach allowance covers every wallet a member has', async () => {
    // ann (main W4, mapped W5) uses her three: both wallets count them
    for (let i = 0; i < 3; i++) eq((await ask(A.k)).status, 200);
    eq((await ask(A.k)).status, 429);
    // unmapping W5 and letting a newcomer join with it doesn't hand out a fresh three on that wallet
    eq((await act(A.id, { action: 'unlink', address: w('e5') })).status, 200);
    const E = await join_('eve', w('e5'));
    eq((await call('/api/coach/chat', { key: E.k })).d.remaining, 0, 'W5 already used its three today');
  });
  await t('mapped wallets survive a restart', async () => {
    await new Promise(r => app.close(r)); app = mk(); B = await listen();
    eq((await listed(Bm.id)).wallets.sort(), [w('f6')]);
    eq((await listed(Bm.id)).address, W3);
  });
  await t('a signature wins: claiming a wallet takes it off whoever it was mapped to', async () => {
    const K = '0x' + '77'.repeat(32), WS = sig.addressOfPrivateKey(K);
    eq((await act(Bm.id, { action: 'link', address: WS })).status, 200);
    const st = await call('/api/social/claim/start', { method: 'POST', key: A.k, body: { address: WS } });
    eq(st.status, 200, JSON.stringify(st.d));
    const fin = await call('/api/social/claim/finish', { method: 'POST', key: A.k, body: { nonce: st.d.nonce, signature: sig.signPersonal(st.d.message, K) } });
    eq(fin.status, 200, JSON.stringify(fin.d));
    ok(!(await listed(Bm.id)).wallets.includes(WS), 'gone from bob');
    eq((await listed(A.id)).address, WS);
    const r = await act(Bm.id, { action: 'link', address: WS }); eq(r.status, 409); ok(/claimed/.test(r.d.error));
  });
} finally { await new Promise(r => app.close(r)); }

report('wallet mapping');
