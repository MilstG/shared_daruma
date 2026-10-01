// The AI coach allowance: 3 messages a day for everyone, counted per profile and per wallet (profiles
// that share a wallet share its allowance), admins and the owner without a limit, and any admin
// can give a member a fresh count for the day. The model is a stub: no network, no key.
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t, ok, eq, report } from './harness.mjs';

const require = createRequire(import.meta.url);
const server = require('../server.js');
const htmlPath = new URL('../ledger.html', import.meta.url).pathname;
const stub = { beta: { messages: { create: async req => ({ model: req.model, stop_reason: 'end_turn', content: [{ type: 'text', text: 'Stick to the plan.' }] }) } } };
const dataDir = mkdtempSync(join(tmpdir(), 'ledger-coachlim-'));
let clock = Date.parse('2026-10-01T15:00:00Z');
const mk = () => server.createApp({ dataDir, auth: 'owner-token', htmlPath, now: () => clock, push: false, pushTick: false,
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }), coach: { enabled: true, client: stub } });
let app = mk();
let B = await new Promise(res => app.listen(0, () => res('http://127.0.0.1:' + app.address().port)));
const call = async (p, o = {}) => { const r = await fetch(B + p, { method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', ...(o.key ? { 'X-Pulse-Key': o.key } : {}), ...(o.owner ? { Authorization: 'Bearer owner-token' } : {}) },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  return { status: r.status, d: await r.json().catch(() => ({})) }; };
const ask = (o) => call('/api/coach/chat', { method: 'POST', ...o, body: { messages: [{ role: 'user', content: 'How did I do?' }], facts: { level: 3 } } });
const join_ = async (handle, address) => { const k = (await call('/api/social/join', { method: 'POST', body: { handle, address } })).d.key;
  return { k, id: (await call('/api/social/me', { key: k })).d.me.id }; };
const W = '0x' + '3c'.repeat(20);

let A, A2, U, Ad;
try {
  await t('three a day for a member, then a clear message', async () => {
    A = await join_('ann', W);
    eq((await call('/api/coach/chat', { key: A.k })).d.limit, 3, 'the new default');
    for (let i = 0; i < 3; i++) eq((await ask({ key: A.k })).status, 200, 'message ' + (i + 1));
    const r = await ask({ key: A.k }); eq(r.status, 429); ok(/today’s 3 coach messages/.test(r.d.error), r.d.error);
  });
  await t('a second profile on the same wallet shares the count; a profile without one has its own', async () => {
    A2 = await join_('ann_two', W);
    eq((await ask({ key: A2.k })).status, 429, 'same wallet, same three');
    eq((await call('/api/coach/chat', { key: A2.k })).d.remaining, 0);
    U = await join_('uma');
    eq((await ask({ key: U.k })).status, 200);
  });
  await t('taking the wallet off a profile doesn’t give it a fresh three', async () => {
    await call('/api/social/me', { method: 'PUT', key: A.k, body: { address: null } });
    eq((await ask({ key: A.k })).status, 429);
  });
  await t('fully unlocked members have three too', async () => {
    await call('/api/social/admin/members/' + U.id, { method: 'POST', owner: true, body: { action: 'unlock' } });
    eq((await call('/api/coach/chat', { key: U.k })).d.limit, 3);
  });
  await t('admins and the owner ask without a limit', async () => {
    const r = await call('/api/social/admin/members', { method: 'POST', owner: true, body: { handle: 'adele', admin: true } });
    Ad = { k: (await call('/api/social/link/finish', { method: 'POST', body: { code: r.d.code } })).d.key, id: r.d.id };
    for (let i = 0; i < 6; i++) eq((await ask({ key: Ad.k })).status, 200, 'admin message ' + (i + 1));
    const st = (await call('/api/coach/chat', { key: Ad.k })).d; eq([st.allowed, st.limit, st.remaining], [true, null, null]);
    for (let i = 0; i < 5; i++) eq((await ask({ owner: true })).status, 200, 'owner message ' + (i + 1));
  });
  await t('an admin resets a member’s count: the profile and its wallet start over today', async () => {
    eq((await call('/api/social/admin/members/' + A.id, { method: 'POST', key: Ad.k, body: { action: 'coachreset' } })).status, 200);
    eq((await call('/api/coach/chat', { key: A.k })).d.remaining, 3);
    // ann had taken her wallet off: put it back; ann_two (same wallet) is reset through her own page
    await call('/api/social/admin/members/' + A2.id, { method: 'POST', key: Ad.k, body: { action: 'coachreset' } });
    eq((await call('/api/coach/chat', { key: A2.k })).d.remaining, 3);
    const list = (await call('/api/social/admin/members', { owner: true })).d.members;
    eq(list.find(m => m.id === A.id).coachUsed, 0); eq(list.find(m => m.id === Ad.id).coachLimit, null);
    eq((await call('/api/social/admin/members/' + A.id, { method: 'POST', key: U.k, body: { action: 'coachreset' } })).status, 401, 'members can’t');
  });
  await t('the count survives a restart and starts over the next day', async () => {
    await ask({ key: U.k }); await ask({ key: U.k });
    await new Promise(r => app.close(r)); app = mk(); B = await new Promise(res => app.listen(0, () => res('http://127.0.0.1:' + app.address().port)));
    eq((await call('/api/coach/chat', { key: U.k })).d.remaining, 0, 'uma used 1 + 2');
    clock += 86400000;
    eq((await call('/api/coach/chat', { key: U.k })).d.remaining, 3);
  });
  await t('three is applied once to an existing server; a number the owner sets later stays', async () => {
    eq((await call('/api/social/admin/overview', { owner: true })).d.config.coach.daily, 3);
    await call('/api/social/admin/config', { method: 'PUT', owner: true, body: { coach: { daily: 5 } } });
    await new Promise(r => app.close(r)); app = mk(); B = await new Promise(res => app.listen(0, () => res('http://127.0.0.1:' + app.address().port)));
    eq((await call('/api/social/admin/overview', { owner: true })).d.config.coach.daily, 5);
  });
} finally { await new Promise(r => app.close(r)); }

report('coach limits');
