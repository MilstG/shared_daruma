// Owner wallet approval (social.js): with "Wallets need my approval" on, a member's wallet
// counts for returns, verified Discipline and money competitions only once the owner has
// approved its address. Decisions are per address, so a rejected wallet stays rejected under
// a new profile. Exercised over real HTTP with a stubbed Hyperliquid.
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t, ok, eq, report } from './harness.mjs';

const require = createRequire(import.meta.url);
const server = require('../server.js');
const htmlPath = new URL('../ledger.html', import.meta.url).pathname;

const W = c => '0x' + c.repeat(40);
const portfolioFor = []; // which wallets the server read on chain
const PORT = [['month', { accountValueHistory: [[Date.parse('2026-09-01T00:00:00Z'), '1000'], [Date.parse('2026-09-29T00:00:00Z'), '1100']],
  pnlHistory: [[Date.parse('2026-09-01T00:00:00Z'), '0'], [Date.parse('2026-09-29T00:00:00Z'), '100']] }]];
const fetchImpl = async (url, o) => { const b = JSON.parse(o.body);
  if (b.type === 'portfolio') portfolioFor.push(String(b.user).toLowerCase());
  return { ok: true, status: 200, json: async () => b.type === 'portfolio' ? PORT : [] }; };
let clock = Date.parse('2026-09-30T12:00:00Z'); // moved on when a test needs more than the 5-joins-an-hour limit
const dataDir = mkdtempSync(join(tmpdir(), 'ledger-wallets-'));
const app = server.createApp({ dataDir, auth: 'owner-token', htmlPath, fetchImpl, push: false, now: () => clock });
const B = await new Promise(r => app.listen(0, () => r('http://127.0.0.1:' + app.address().port)));
const call = async (p, o = {}) => { const r = await fetch(B + '/api/social' + p, { method: o.method || 'GET', headers: { 'Content-Type': 'application/json',
  ...(o.key ? { 'X-Pulse-Key': o.key } : {}), ...(o.admin ? { Authorization: 'Bearer owner-token' } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, d: await r.json() }; };
const tick = () => new Promise(r => setTimeout(r, 40));
const join_ = async (handle, addr, extra) => (await call('/join', { method: 'POST', body: { handle, address: addr, share: { ret: true }, ...(extra || {}) } })).d.key;
const wallets = async () => (await call('/admin/wallets', { admin: true })).d;
const onRetBoard = async (key) => (await call('/leaderboard?board=ret', { key })).d.rows.map(r => r.handle);

try {
  await call('/admin/config', { method: 'PUT', admin: true, body: { unlocksOn: false } });
  let A, Bk, C;
  await t('approval off (the default): every wallet counts, as before', async () => {
    A = await join_('alice', W('a')); Bk = await join_('bob', W('b')); await tick();
    eq((await onRetBoard(A)).sort(), ['alice', 'bob']);
    eq((await call('/me', { key: A })).d.me.walletStatus, null, 'no status shown while approval is off');
  });
  await t('switching approval on keeps current members counting (marked "existing")', async () => {
    eq((await call('/admin/config', { method: 'PUT', admin: true, body: { approveWallets: true } })).status, 200);
    const w = await wallets();
    eq(w.approveWallets, true);
    eq(w.wallets.map(x => [x.address, x.status, x.by]).sort(), [[W('a'), 'approved', 'existing'], [W('b'), 'approved', 'existing']]);
    await tick();
    eq((await onRetBoard(A)).sort(), ['alice', 'bob']);
  });
  await t('a new wallet waits: not read on chain, off the boards, told why, listed first for the owner', async () => {
    const before = portfolioFor.filter(a => a === W('c')).length;
    C = await join_('carol', W('c')); await tick();
    eq(portfolioFor.filter(a => a === W('c')).length, before, 'nothing fetched for an unapproved wallet');
    eq((await call('/me', { key: C })).d.me.walletStatus, 'pending');
    ok(!(await onRetBoard(C)).includes('carol'));
    eq((await call('/leaderboard?board=discipline', { key: C })).d.verifyState, 'approval');
    const rc = await call('/admin/competitions', { method: 'POST', admin: true, body: { title: 'Ret', type: 'return', start: '2026-09-10', end: '2026-10-08' } });
    const j = await call('/competitions/' + rc.d.id + '/join', { method: 'POST', key: C });
    eq(j.status, 400); ok(/approval/.test(j.d.error), j.d.error);
    const w = await wallets();
    eq(w.wallets[0].address, W('c')); eq(w.wallets[0].status, 'pending'); eq(w.wallets[0].members[0].handle, 'carol');
    eq(w.wallets[0].members[0].joinedWith, 'open'); eq(w.counts.pending, 1);
    eq((await call('/admin/overview', { admin: true })).d.walletsPending, 1);
    eq((await call('/admin/members', { admin: true })).d.members.find(m => m.handle === 'carol').walletStatus, 'pending');
  });
  await t('approving reads the wallet and puts it on the boards', async () => {
    eq((await call('/admin/wallets/' + W('c'), { method: 'POST', admin: true, body: { action: 'approve', note: 'paid' } })).status, 200);
    await tick();
    ok(portfolioFor.includes(W('c')), 'read on chain once approved');
    eq((await call('/me', { key: C })).d.me.walletStatus, 'approved');
    ok((await onRetBoard(C)).includes('carol'));
    const row = (await wallets()).wallets.find(x => x.address === W('c'));
    eq([row.status, row.by, row.note], ['approved', 'owner', 'paid']);
  });
  await t('rejecting drops the numbers at once, and the same address under a new profile stays rejected', async () => {
    await call('/admin/wallets/' + W('b'), { method: 'POST', admin: true, body: { action: 'reject' } });
    ok(!(await onRetBoard(A)).includes('bob'));
    eq((await call('/me', { key: Bk })).d.me.walletStatus, 'rejected');
    eq((await call('/leaderboard?board=discipline', { key: Bk })).d.verifyState, 'rejected');
    const k2 = await join_('bob2', W('b')); await tick();
    eq((await call('/me', { key: k2 })).d.me.walletStatus, 'rejected', 'a decision follows the address, not the profile');
  });
  await t('bulk decisions, clearing back to pending, and input checks', async () => {
    const k = await join_('dave', W('d')); const k2 = await join_('erin', W('e'), { invite: 'x' }); void k; void k2;
    eq((await call('/admin/wallets', { method: 'POST', admin: true, body: { action: 'approve', addresses: [W('d'), W('E')] } })).d.n, 2);
    eq((await wallets()).wallets.filter(x => [W('d'), W('e')].includes(x.address)).map(x => x.status), ['approved', 'approved']);
    await call('/admin/wallets/' + W('d'), { method: 'POST', admin: true, body: { action: 'clear' } });
    eq((await wallets()).wallets.find(x => x.address === W('d')).status, 'pending');
    eq((await call('/admin/wallets', { method: 'POST', admin: true, body: { action: 'approve', addresses: ['0x123'] } })).status, 400);
    eq((await call('/admin/wallets', { method: 'POST', admin: true, body: { action: 'ban', addresses: [W('d')] } })).status, 400);
    eq((await call('/admin/wallets', { key: A })).status, 401, 'a member key is not the owner');
    eq((await call('/admin/wallets', { method: 'POST', key: A, body: { action: 'approve', addresses: [W('d')] } })).status, 401);
  });
  await t('a wallet the owner attaches is approved by that act; invite joins are recorded', async () => {
    clock += 2 * 3600e3;
    await call('/admin/config', { method: 'PUT', admin: true, body: { inviteCode: 'REF42' } });
    const k = await join_('frank', W('1'), { invite: 'REF42' });
    const row = (await wallets()).wallets.find(x => x.address === W('1'));
    eq([row.status, row.members[0].joinedWith], ['pending', 'invite']);
    const mk = await call('/admin/members', { method: 'POST', admin: true, body: { handle: 'gina', address: W('2') } });
    eq(mk.status, 200);
    eq((await wallets()).wallets.find(x => x.address === W('2')).status, 'approved');
    await call('/admin/config', { method: 'PUT', admin: true, body: { inviteCode: '' } }); void k;
  });
  await t('switching approval off: wallets you haven’t reviewed count again; an unverified (rejected) one still doesn’t', async () => {
    await call('/admin/config', { method: 'PUT', admin: true, body: { approveWallets: false } });
    await tick();
    const board = await onRetBoard(A);
    ok(board.includes('alice') && !board.includes('bob'), JSON.stringify(board));
    eq((await call('/me', { key: Bk })).d.me.walletStatus, 'rejected', 'told why');
    eq((await call('/me', { key: A })).d.me.walletStatus, null);
    eq((await wallets()).wallets.find(x => x.address === W('b')).status, 'rejected', 'kept');
  });
  await t('from the members list: verify or unverify many at once, suspend, restore and delete; nobody acts on another admin unless the owner', async () => {
    const ms = (await call('/admin/members', { admin: true })).d.members, id = h => ms.find(m => m.handle === h).id;
    let r = await call('/admin/members/bulk', { method: 'POST', admin: true, body: { action: 'verify', ids: [id('bob'), id('alice')] } });
    eq([r.status, r.d.n], [200, 2]); await tick();
    ok((await onRetBoard(A)).includes('bob'), 'bob counts again once verified');
    r = await call('/admin/members/bulk', { method: 'POST', admin: true, body: { action: 'unverify', ids: [id('bob')] } }); await tick();
    ok(!(await onRetBoard(A)).includes('bob'));
    const noWallet = (await call('/admin/members', { method: 'POST', admin: true, body: { handle: 'nowallet' } })).d.id;
    r = await call('/admin/members/bulk', { method: 'POST', admin: true, body: { action: 'verify', ids: [noWallet] } });
    eq([r.d.n, r.d.skipped[0].why], [0, 'no wallet']);
    r = await call('/admin/members/bulk', { method: 'POST', admin: true, body: { action: 'ban', ids: [id('carol'), 'nope'] } });
    eq([r.d.n, r.d.skipped.map(x => x.why)], [1, ['not found']]);
    eq((await call('/admin/members', { admin: true })).d.members.find(m => m.handle === 'carol').banned, true);
    await call('/admin/members/bulk', { method: 'POST', admin: true, body: { action: 'unban', ids: [id('carol')] } });
    // an admin (not the owner) can't delete another admin, or themselves
    await call('/admin/members/' + id('alice'), { method: 'POST', admin: true, body: { action: 'admin' } });
    await call('/admin/members/' + id('bob'), { method: 'POST', admin: true, body: { action: 'admin' } });
    r = await call('/admin/members/bulk', { method: 'POST', key: A, body: { action: 'remove', ids: [id('alice'), id('bob'), noWallet] } });
    eq([r.status, r.d.n, r.d.skipped.map(x => x.why).sort()], [200, 1, ['only the owner can change another admin', 'that’s you']]);
    r = await call('/admin/members/bulk', { method: 'POST', admin: true, body: { action: 'remove', ids: [id('carol'), id('bob')] } });
    eq(r.d.n, 2); const left = (await call('/admin/members', { admin: true })).d.members.map(m => m.handle);
    ok(!left.includes('carol') && !left.includes('bob') && left.includes('alice'), JSON.stringify(left));
    eq((await call('/admin/members/bulk', { method: 'POST', admin: true, body: { action: 'explode', ids: [id('alice')] } })).status, 400);
    eq((await call('/admin/members/bulk', { method: 'POST', key: Bk, body: { action: 'remove', ids: [id('alice')] } })).status, 401, 'a deleted member’s key is gone');
  });
} finally { await new Promise(r => app.close(r)); }

report('wallet approval');
