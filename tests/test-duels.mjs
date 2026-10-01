// Duels: one member challenges another for a week or a month. The terms, the dates and the score
// (pure, duels.js), then the whole life of a duel over HTTP: challenge, counter, accept, the live
// score, settling (record, XP, feed), decline, expiry, withdraw, forfeit, the limits, and the
// admin's settings and cancel. No network.
import { mkdtempSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { t, ok, eq, report } from './harness.mjs';

const require = createRequire(import.meta.url);
const Duels = require('../duels.js');
const server = require('../server.js');
const htmlPath = new URL('../ledger.html', import.meta.url).pathname;
const DAY = 86400000;

console.log('Terms, dates and scores');
t('terms: a real type the league allows; conditions only where they apply', () => {
  eq(Duels.sanitizeTerms({ type: 'poker' }).error, 'Pick what to compete on.');
  ok(/doesn’t run/.test(Duels.sanitizeTerms({ type: 'ret' }).error), '% return is off by default');
  const d = Duels.sanitizeTerms({ type: 'disc', period: 'month', minDays: 99, msg: '  loser\nbuys   coffee  ' });
  eq([d.period, d.verified, d.minDays, d.ddCap, d.msg], ['month', true, 20, null, 'loser buys coffee']);
  eq(Duels.sanitizeTerms({ type: 'xp', verified: true }).verified, false, 'XP isn’t read from fills');
  const cfg = Duels.sanitizeDuelCfg({ types: { ret: true } });
  eq(Duels.sanitizeTerms({ type: 'ret' }, cfg).ddCap, 0.08, 'a drawdown cap always comes with % return');
});
t('dates: the next whole week or month, starting today only when today is the Monday or the 1st', () => {
  eq(Duels.windowFor('week', Date.parse('2026-10-07T15:00:00Z')), { start: '2026-10-12', end: '2026-10-18' }); // a Wednesday
  eq(Duels.windowFor('week', Date.parse('2026-10-12T08:00:00Z')), { start: '2026-10-12', end: '2026-10-18' }); // that Monday
  eq(Duels.windowFor('month', Date.parse('2026-10-07T15:00:00Z')), { start: '2026-11-01', end: '2026-11-30' });
  eq(Duels.windowFor('month', Date.parse('2026-12-01T00:30:00Z')), { start: '2026-12-01', end: '2026-12-31' });
});
const dd = (type, extra) => Object.assign({ type, start: '2026-10-12', end: '2026-10-18', verified: false, minDays: 3, ddCap: 0.08 }, extra);
const mem = (id, scores, extra) => Object.assign({ id, share: {}, stats: { days: scores.map(([k, s, j, r]) => ({ k: '2026-10-' + k, s, j: !!j, r: !!r })), xpDays: {} } }, extra);
t('Discipline: the higher average wins, but only with the agreed trading days', () => {
  const A = mem('a', [['12', 90], ['13', 80], ['14', 70]]), B = mem('b', [['12', 100], ['13', 95]]);
  const s = Duels.standing(dd('disc'), A, B, '2026-10-20');
  eq([s.lead, s.a.score, s.b.score], ['a', 80, 98]); ok(/fewer than 3/.test(s.why), s.why);
  eq(Duels.standing(dd('disc', { minDays: 2 }), A, B, '2026-10-20').lead, 'b');
  eq(Duels.standing(dd('disc'), A, mem('b', [['11', 100], ['19', 100], ['20', 100]]), '2026-10-20').b.n, 0, 'days outside the dates don’t count');
});
t('verified duels read only the server’s own Discipline days', () => {
  const A = mem('a', [['12', 100], ['13', 100], ['14', 100]], { share: { verify: true }, vdays: [{ k: '2026-10-12', s: 50 }, { k: '2026-10-13', s: 60 }, { k: '2026-10-14', s: 70 }] });
  const B = mem('b', [['12', 80], ['13', 80], ['14', 80]]);
  const s = Duels.standing(dd('disc', { verified: true }), A, B, '2026-10-20');
  eq([s.a.score, s.b.n, s.b.verifiedMissing], [60, 0, true]);
});
t('clean days, last one standing, journaling, XP and capped returns', () => {
  const A = mem('a', [['12', 90, 1, 1], ['13', 60, 1, 1], ['14', 75, 1, 0]]), B = mem('b', [['12', 72], ['13', 71], ['15', 40, 1, 1]]);
  const c = Duels.standing(dd('clean'), A, B, '2026-10-20'); eq([c.a.score, c.b.score, c.lead], [2, 2, 'a'], 'level on count: higher average wins');
  const sv = Duels.standing(dd('survive'), A, B, '2026-10-20'); eq([sv.a.fell, sv.b.fell, sv.lead], ['2026-10-13', '2026-10-15', 'b'], 'lasted longer');
  eq(Duels.standing(dd('survive'), mem('a', [['12', 90]]), mem('b', [['12', 95]]), '2026-10-20').lead, null, 'both standing: level');
  const j = Duels.standing(dd('journal'), A, B, '2026-10-20'); eq([j.a.score, j.b.score, j.lead], [2, 1, 'a']);
  A.stats.xpDays = { '2026-10-12': 40, '2026-10-30': 999 }; B.stats.xpDays = { '2026-10-13': 55 };
  eq(Duels.standing(dd('xp'), A, B, '2026-10-20').lead, 'b');
  const r = dd('ret', { money: { a: { ret: 0.2, dd: 0.12 }, b: { ret: 0.01, dd: 0.02 } } });
  const rs = Duels.standing(r, A, B, '2026-10-20'); eq([rs.lead, rs.a.out], ['b', true], 'past the cap loses, whatever the return');
});

console.log('\nOver HTTP');
let clock = Date.parse('2026-10-07T15:00:00Z'); // a Wednesday
const dataDir = mkdtempSync(join(tmpdir(), 'ledger-duels-'));
const mk = () => server.createApp({ dataDir, auth: 'owner-token', htmlPath, now: () => clock, push: false, pushTick: false, trustProxy: true,
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => [] }) });
let app = mk();
const listen = () => new Promise(res => app.listen(0, () => res('http://127.0.0.1:' + app.address().port)));
let B = await listen();
let ipN = 0;
const call = async (p, o = {}) => { const r = await fetch(B + '/api/social' + p, { method: o.method || 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': o.ip || '10.0.0.1', ...(o.key ? { 'X-Pulse-Key': o.key } : {}), ...(o.owner ? { Authorization: 'Bearer owner-token' } : {}) },
    body: o.body !== undefined ? JSON.stringify(o.body) : undefined });
  return { status: r.status, d: await r.json().catch(() => ({})) }; };
const join_ = async h => (await call('/join', { method: 'POST', ip: '10.0.2.' + (++ipN), body: { handle: h, share: { feed: true } } })).d.key;
const days = (pairs, xp) => ({ xp: 100, days: pairs.map(([k, s]) => ({ k, s, j: s >= 70, r: s >= 70 })), xpDays: xp || {} });
const send = (key, to, terms) => call('/duels', { method: 'POST', key, body: Object.assign({ to, type: 'disc', period: 'week', verified: false }, terms) });
const mine = async (key) => (await call('/duels', { key })).d;
const inbox = async key => (await call('/inbox', { key })).d.items.map(x => x.text);
let ann, bob, cat, dee;
try {
  ann = await join_('ann'); bob = await join_('bob'); cat = await join_('cat'); dee = await join_('dee');
  let id;
  await t('a challenge reaches the other side; verified duels need verification switched on', async () => {
    ok(/Verify my discipline/.test((await send(ann, 'bob', { verified: true })).d.error));
    const r = await send(ann, '@bob', { msg: 'loser buys coffee' }); eq(r.status, 200, JSON.stringify(r.d)); id = r.d.duel.id;
    eq([r.d.duel.status, r.d.duel.mine, r.d.duel.awaiting, r.d.duel.preview], ['pending', 'sent', false, { start: '2026-10-12', end: '2026-10-18' }]);
    const b = await mine(bob); eq([b.duels[0].mine, b.duels[0].awaiting, b.duels[0].msg], ['received', true, 'loser buys coffee']);
    ok((await inbox(bob)).some(x => /@ann challenged you to a Discipline duel/.test(x)));
    eq((await send(ann, 'bob')).status, 409, 'one duel at a time between two people');
    eq((await send(ann, 'ann')).status, 409);
  });
  await t('suggesting other terms sends it back; only the side it’s waiting on can answer', async () => {
    eq((await call('/duels/' + id, { method: 'POST', key: ann, body: { action: 'accept' } })).status, 409, 'not your turn');
    const c = await call('/duels/' + id, { method: 'POST', key: bob, body: { action: 'counter', type: 'clean', period: 'week', verified: false } });
    eq([c.status, c.d.duel.type, c.d.duel.awaiting, c.d.duel.countered], [200, 'clean', false, true]);
    ok((await inbox(ann)).some(x => /suggested different terms/.test(x)));
    const c2 = await call('/duels/' + id, { method: 'POST', key: ann, body: { action: 'counter', type: 'disc', period: 'week', verified: false, minDays: 2 } });
    eq(c2.d.duel.minDays, 2);
  });
  await t('accepting fixes the dates: the next Monday to Sunday', async () => {
    const a = await call('/duels/' + id, { method: 'POST', key: bob, body: { action: 'accept' } });
    eq([a.status, a.d.duel.status, a.d.duel.start, a.d.duel.end], [200, 'active', '2026-10-12', '2026-10-18']);
    ok((await inbox(ann)).some(x => /accepted your Discipline duel/.test(x)));
  });
  await t('the live score follows both sides’ days; outside the dates nothing counts', async () => {
    clock = Date.parse('2026-10-14T18:00:00Z');
    await call('/stats', { method: 'POST', key: ann, body: days([['2026-10-11', 10], ['2026-10-12', 90], ['2026-10-13', 70]]) });
    await call('/stats', { method: 'POST', key: bob, body: days([['2026-10-12', 60], ['2026-10-13', 70], ['2026-10-14', 65]]) });
    const v = (await mine(ann)).duels.find(x => x.id === id);
    eq([v.me.score, v.them.score, v.lead], [80, 65, 'me']); eq(v.me.marks.map(m => m.k), ['2026-10-12', '2026-10-13']);
    const w = (await mine(bob)).duels.find(x => x.id === id); eq(w.lead, 'them');
  });
  await t('settled the day after it ends: a record, the winner’s XP and a feed line', async () => {
    clock = Date.parse('2026-10-19T12:00:00Z');
    eq((await mine(ann)).duels.find(x => x.id === id).status, 'active', 'not yet: the last day’s syncs may still come in');
    clock = Date.parse('2026-10-20T09:00:00Z');
    const a = await mine(ann), v = a.duels.find(x => x.id === id);
    eq([v.status, v.result.outcome, v.result.xp, a.record], ['done', 'won', 100, { w: 1, l: 0, d: 0 }]);
    eq((await mine(bob)).record, { w: 0, l: 1, d: 0 });
    const me = (await call('/me', { key: ann })).d.me; ok((me.grants || []).some(g => g.xp === 100 && /duel/.test(g.why)), 'the XP arrives as a grant');
    const prof = (await call('/profile/ann', { key: cat })).d.profile; eq(prof.duels, { w: 1, l: 0, d: 0 });
    const feed = (await call('/feed?scope=discover', { key: cat })).d; ok(JSON.stringify(feed).includes('won a Discipline duel against @bob'), 'both share milestones: the loser is named');
    ok((await inbox(bob)).some(x => /won your Discipline duel/.test(x)));
  });
  await t('declined: no new challenge from the same person that week; expiry after 48 hours', async () => {
    const r = await send(cat, 'dee'); await call('/duels/' + r.d.duel.id, { method: 'POST', key: dee, body: { action: 'decline' } });
    ok(/declined a challenge from you/.test((await send(cat, 'dee')).d.error));
    const r2 = await send(dee, 'cat'); eq(r2.status, 200, 'the other way round is fine');
    clock += 49 * 3600000;
    eq((await mine(dee)).duels.find(x => x.id === r2.d.duel.id).status, 'expired');
    ok((await inbox(dee)).some(x => /expired/.test(x)));
  });
  await t('withdraw a sent challenge; forfeit a running duel (the other side wins)', async () => {
    const w = await send(ann, 'cat'); eq((await call('/duels/' + w.d.duel.id, { method: 'POST', key: ann, body: { action: 'cancel' } })).d.duel.status, 'cancelled');
    const f = await send(bob, 'cat'); await call('/duels/' + f.d.duel.id, { method: 'POST', key: cat, body: { action: 'accept' } });
    const ff = await call('/duels/' + f.d.duel.id, { method: 'POST', key: cat, body: { action: 'forfeit' } });
    eq([ff.d.duel.result.outcome, ff.d.duel.result.forfeit], ['lost', 'me']); eq((await mine(bob)).record.w, 1);
  });
  await t('limits: open duels per member, people who don’t take challenges, types the league switched off', async () => {
    await call('/admin/config', { method: 'PUT', owner: true, body: { duels: { maxOpen: 1 } } });
    eq((await send(ann, 'dee')).status, 200);
    ok(/1 duels going/.test((await send(ann, 'bob')).d.error));
    await call('/me', { method: 'PUT', key: bob, body: { share: { duels: false } } });
    ok(/isn’t taking challenges/.test((await send(cat, 'bob')).d.error));
    ok(/doesn’t run/.test((await send(cat, 'dee', { type: 'ret' })).d.error));
  });
  await t('admins see every duel and can cancel one without a result; settings survive a restart', async () => {
    const A = (await call('/admin/duels', { owner: true })).d;
    eq([A.counts.active, A.counts.pending, A.config.maxOpen], [0, 1, 1]);
    const open = A.open[0]; eq([open.a, open.b, open.status], ['ann', 'dee', 'pending']);
    eq((await call('/admin/duels/' + open.id, { method: 'POST', owner: true, body: { action: 'cancel' } })).status, 200);
    ok((await inbox(dee)).some(x => /cancelled by the league’s admins/.test(x)));
    eq((await call('/admin/duels/' + open.id, { method: 'POST', key: ann, body: { action: 'cancel' } })).status, 401, 'members can’t');
    await new Promise(r => app.close(r)); app = mk(); B = await listen();
    eq((await call('/admin/duels', { owner: true })).d.config.maxOpen, 1);
    eq((await mine(ann)).record, { w: 1, l: 0, d: 0 });
    const c = (await call('/config')).d; eq([c.modules.duels, c.duels.on], [1, true]);
  });
} finally { await new Promise(r => app.close(r)); }

report('duels');
