// Social layer (social.js + Pulse's social client): stats validation, feed events, returns
// from the chain, league promotion, leaderboards, competitions, and the member and admin API
// over real HTTP with a stubbed Hyperliquid. Also the client's unlock and habit helpers.
import { readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import vm from 'node:vm';
import { t, ok, eq, near, report, makeExtractor } from './harness.mjs';

const require = createRequire(import.meta.url);
const S = require('../social.js');
const server = require('../server.js');
const htmlPath = new URL('../ledger.html', import.meta.url).pathname;
const html = readFileSync(htmlPath, 'utf8');
const { grabFn } = makeExtractor(html);

console.log('\nValidation');
t('stats are clamped and filtered: bad days, badges and oversized text never get stored', () => {
  const s = S.sanitizeStats({ xp: -5, level: 9999, streak: 'x', week: 'nope', weekXp: 1e9,
    days: [{ k: '2026-09-01', s: 180, b: 1, j: 0 }, { k: 'bad', s: 50 }], badges: [{ id: 'ok-1', t: 'Fine' }, { id: 'BAD ID', t: 'x' }],
    habits: ['a'.repeat(500), '', 'b', 'c', 'd', 'e', 'f'] });
  eq(s.xp, 0); eq(s.level, 500); eq(s.streak, 0); eq(s.week, null); eq(s.weekXp, 1e6);
  eq(s.days, [{ k: '2026-09-01', s: 100, b: true, j: false }]);
  eq(s.badges, [{ id: 'ok-1', t: 'Fine' }]);
  eq(s.habits.length, 5); eq(s.habits[0].length, 140);
});
t('sharing defaults keep money and the address private', () => {
  const sh = S.sanitizeShare({ usd: true, profile: 'yes' });
  eq(sh, { profile: true, boards: true, feed: true, habits: true, ret: false, usd: true, addr: false });
});
t('competitions need a known type, a title and a window of at most 92 days', () => {
  ok(!S.sanitizeComp({ type: 'lottery', title: 'x', start: '2026-10-01', end: '2026-10-07' }));
  ok(!S.sanitizeComp({ type: 'discipline', title: 'x', start: '2026-10-07', end: '2026-10-01' }));
  ok(!S.sanitizeComp({ type: 'discipline', title: 'x', start: '2026-01-01', end: '2026-06-01' }));
  const c = S.sanitizeComp({ type: 'return', title: 'Sprint', start: '2026-10-01', end: '2026-10-14' });
  eq(c.ddCap, 0.08); eq(c.minDays, 3);
  eq(S.sanitizeComp({ type: 'journal', title: 'J', start: '2026-10-01', end: '2026-10-30' }).minDays, 10);
});

console.log('\nFeed events');
const base = S.sanitizeStats({ xp: 900, level: 2, streak: 6, badges: [{ id: 'a', t: 'A' }], habits: ['When x, y.'], challengesDone: 1 });
t('milestones become feed posts: level, streak marks, new badges, challenges and habits', () => {
  const next = S.sanitizeStats({ xp: 1300, level: 3, streak: 7, badges: [{ id: 'a', t: 'A' }, { id: 'b', t: 'Walked away' }],
    habits: ['When x, y.', 'When I lose twice, I stop.'], challengesDone: 2, lastChallenge: 'When done, stop.' });
  const E = S.eventsFromStats(base, next, S.sanitizeShare({}));
  eq(E.map(e => e.type), ['level', 'streak', 'badge', 'challenge', 'habit']);
  eq(E[1].text, 'hit a 7-day discipline streak'); eq(E[2].text, 'unlocked Walked away'); eq(E[4].quote, 'When I lose twice, I stop.');
});
t('no posts on a first sync, with the feed off, or for habits kept private', () => {
  const next = S.sanitizeStats({ level: 5, habits: ['When a, b.'] });
  eq(S.eventsFromStats(null, next, S.sanitizeShare({})), []);
  eq(S.eventsFromStats(base, next, S.sanitizeShare({ feed: false })), []);
  eq(S.eventsFromStats(base, next, S.sanitizeShare({ habits: false })).map(e => e.type), ['level']);
});

console.log('\nReturns from the chain');
const port = (av, pnl) => [['month', { accountValueHistory: av, pnlHistory: pnl }]];
t('return and drawdown come from the P&L series, so deposits count as neither', () => {
  // 1000 start, +200 deposit on day 2 (account value jumps, P&L doesn't), dip of 50 then +100 overall
  const r = S.portfolioStats(port([[1, '1000'], [2, '1200'], [3, '1150'], [4, '1300']], [[1, '0'], [2, '0'], [3, '-50'], [4, '100']]), 'month');
  near(r.ret, 0.1, 1e-9); near(r.dd, 0.05, 1e-9); eq(r.usd, 100);
  eq(S.portfolioStats(port([[1, '0']], [[1, '0'], [2, '5']]), 'month'), null, 'no starting equity, no ratio');
  eq(S.portfolioStats([], 'month'), null);
});
t('a competition window clips the series', () => {
  const r = S.portfolioStats(port([[1, '1000'], [5, '1000']], [[1, '0'], [2, '-100'], [3, '0'], [4, '50']]), 'month', 3, 4);
  near(r.ret, 0.05, 1e-9); eq(r.dd, 0);
});

console.log('\nLeague');
t('each week the top quarter (max 5) with XP moves up and the bottom quarter moves down', () => {
  const mk = (id, tier, xp) => ({ id, tier, weekXp: { '2026-W40': xp } });
  const M = [mk('a', 1, 500), mk('b', 1, 400), mk('c', 1, 300), mk('d', 1, 200), mk('e', 1, 100), mk('f', 1, 50), mk('g', 1, 0), mk('h', 1, 0),
    mk('x', 0, 10), mk('y', 0, 0), mk('z', 0, 0), mk('w', 0, 0)];
  const mv = S.leagueRollover(M, '2026-W40');
  eq(mv.filter(m => m.from === 1 && m.to === 2).map(m => m.id), ['a', 'b']);
  eq(mv.filter(m => m.from === 1 && m.to === 0).map(m => m.id).sort(), ['g', 'h']);
  eq(mv.filter(m => m.from === 0).map(m => m.id), ['x'], 'bronze: nobody drops, zero XP never promotes');
  eq(S.leagueRollover([mk('a', 0, 9), mk('b', 0, 1)], '2026-W40'), [], 'under four traders: no moves');
});

console.log('\nBoards and competitions');
const day = (k, s, b, j) => ({ k, s, b: !!b, j: !!j });
const members = [
  { id: '1', handle: 'alpha', tier: 0, share: S.sanitizeShare({ ret: true }), stats: S.sanitizeStats({ xp: 5000, level: 5, streak: 3, days: [day('2026-09-28', 90), day('2026-09-29', 80), day('2026-09-30', 70)] }), money: { ret: 0.2, dd: 0.3, usd: 900 }, weekXp: { '2026-W40': 300 } },
  { id: '2', handle: 'bravo', tier: 0, share: S.sanitizeShare({ ret: true }), stats: S.sanitizeStats({ xp: 900, level: 2, streak: 9, days: [day('2026-09-29', 60), day('2026-09-30', 100)] }), money: { ret: 0.05, dd: 0.02, usd: 50 }, weekXp: { '2026-W40': 500 } },
  { id: '3', handle: 'charlie', tier: 1, share: S.sanitizeShare({ boards: false }), stats: S.sanitizeStats({ xp: 99999, streak: 99 }), weekXp: { '2026-W40': 999 } },
];
const opts = { todayKey: '2026-09-30', week: '2026-W40', tier: 0 };
t('process boards skip people who opted out; discipline needs 3 trading days', () => {
  eq(S.boardRows(members, 'xp', opts).map(r => r.handle), ['bravo', 'alpha']);
  eq(S.boardRows(members, 'streak', opts).map(r => [r.handle, r.value]), [['bravo', 9], ['alpha', 3]]);
  eq(S.boardRows(members, 'discipline', opts).map(r => [r.handle, r.value]), [['alpha', 80]]);
});
t('money boards: over 25% drawdown leaves % return; return/drawdown ranks the careful trader first', () => {
  eq(S.boardRows(members, 'ret', opts).map(r => r.handle), ['bravo']);
  eq(S.boardRows(members, 'riskadj', opts).map(r => r.handle), ['bravo', 'alpha']);
  eq(S.boardRows(members, 'usd', opts), [], 'nobody opted in to dollars');
});
t('competition standings for each type', () => {
  const ent = { entrants: { 1: {}, 2: {} }, start: '2026-09-28', end: '2026-10-04' };
  const disc = S.compStandings({ ...ent, type: 'discipline', minDays: 3 }, members, '2026-09-30');
  eq(disc.map(r => [r.handle, r.score]), [['alpha', 80], ['bravo', null]]);
  ok(/2 of 3 trading days/.test(disc[1].note));
  const m2 = members.map(m => m.id === '1' ? { ...m, stats: { ...m.stats, days: [day('2026-09-28', 90), day('2026-09-29', 80, true)] } } : m);
  const surv = S.compStandings({ ...ent, type: 'survivor' }, m2, '2026-09-30');
  eq(surv.map(r => [r.handle, r.out]), [['bravo', false], ['alpha', true]]);
  const m3 = members.map(m => m.id === '2' ? { ...m, stats: { ...m.stats, days: [day('2026-09-28', 1, 0, 1), day('2026-09-29', 1, 0, 1), day('2026-09-30', 1, 0, 0)] } } : m);
  eq(S.compStandings({ ...ent, type: 'journal', minDays: 2 }, m3, '2026-09-30').map(r => [r.handle, r.score]), [['bravo', 2], ['alpha', 0]]);
  const ret = S.compStandings({ ...ent, type: 'return', ddCap: 0.08, money: { 1: { ret: 0.3, dd: 0.1 }, 2: { ret: 0.01, dd: 0.01 } } }, members, '2026-09-30');
  eq(ret.map(r => [r.handle, r.out]), [['bravo', false], ['alpha', true]], 'over the drawdown cap finishes last');
});

console.log('\nHTTP');
const listen = app => new Promise(res => app.listen(0, () => res('http://127.0.0.1:' + app.address().port)));
const PORT = port([[Date.parse('2026-09-01'), '1000'], [Date.parse('2026-09-30'), '1100']], [[Date.parse('2026-09-01'), '0'], [Date.parse('2026-09-15'), '-20'], [Date.parse('2026-09-30'), '100']]);
let hlCalls = 0;
const fetchImpl = async (url, o) => { hlCalls++; const b = JSON.parse(o.body);
  return { ok: true, status: 200, json: async () => b.type === 'portfolio' ? PORT : [] }; };
let clock = Date.parse('2026-09-30T12:00:00Z');
const dataDir = mkdtempSync(join(tmpdir(), 'ledger-social-'));
const app = server.createApp({ dataDir, auth: 'owner-token', htmlPath, fetchImpl, now: () => clock });
const B = await listen(app);
const call = async (p, o = {}) => { const r = await fetch(B + '/api/social' + p, { ...o, headers: { 'Content-Type': 'application/json', ...(o.key ? { 'X-Pulse-Key': o.key } : {}), ...(o.admin ? { Authorization: 'Bearer owner-token' } : {}) }, body: o.body ? JSON.stringify(o.body) : undefined });
  return { status: r.status, d: await r.json() }; };
const tick = () => new Promise(r => setTimeout(r, 30));
let A, Bk;
try {
  await t('joining: names are validated and unique; the key is returned once and only its hash is stored', async () => {
    eq((await call('/join', { method: 'POST', body: { handle: 'no spaces' } })).status, 400);
    const a = await call('/join', { method: 'POST', body: { handle: 'alpha_1', address: '0x' + 'a'.repeat(40), share: { ret: true } } });
    eq(a.status, 200); ok(a.d.key && a.d.key.length === 48); A = a.d.key;
    eq((await call('/join', { method: 'POST', body: { handle: 'ALPHA_1' } })).status, 409);
    const b = await call('/join', { method: 'POST', body: { handle: 'bravo' } }); Bk = b.d.key;
    const raw = readFileSync(join(dataDir, 'social.json'), 'utf8');
    ok(!raw.includes(A) && !raw.includes(Bk), 'keys are never written');
    eq((await call('/me')).status, 401);
    eq((await call('/me', { key: A })).d.me.handle, 'alpha_1');
  });
  await t('returns are read on chain for opted-in members only', async () => {
    await tick();
    ok(hlCalls >= 1, 'portfolio fetched for alpha');
    const lb = await call('/leaderboard?board=ret', { key: Bk });
    eq(lb.d.rows.map(r => r.handle), ['alpha_1']); near(lb.d.rows[0].value, 0.1, 1e-9);
    eq(lb.d.optedIn, false, 'bravo is told they are not on the board');
  });
  await t('stats posts feed the league, the boards and the feed', async () => {
    const st = (xp, level, streak) => ({ xp, level, week: '2026-W40', weekXp: xp / 10, streak, best: streak,
      days: [{ k: '2026-09-28', s: 90 }, { k: '2026-09-29', s: 80 }, { k: '2026-09-30', s: 70 }] });
    eq((await call('/stats', { method: 'POST', key: A, body: st(1000, 2, 6) })).status, 200);
    await call('/stats', { method: 'POST', key: A, body: st(1300, 3, 7) });
    await call('/stats', { method: 'POST', key: Bk, body: st(500, 2, 1) });
    const lg = await call('/league', { key: A });
    eq(lg.d.rows.map(r => [r.handle, r.value, r.me]), [['alpha_1', 130, true], ['bravo', 50, false]]);
    const disc = await call('/leaderboard?board=discipline', { key: A });
    eq(disc.d.rows[0].value, 80);
    const feed = await call('/feed?scope=discover', { key: Bk });
    ok(feed.d.events.some(e => e.handle === 'alpha_1' && e.text === 'reached level 3 · Journeyman'));
    ok(feed.d.events.some(e => e.text === 'hit a 7-day discipline streak'));
  });
  await t('following, the following feed, kudos (never on your own post) and profiles', async () => {
    eq((await call('/feed', { key: Bk })).d.events.filter(e => e.handle === 'alpha_1').length, 0);
    eq((await call('/follow/alpha_1', { method: 'POST', key: Bk })).d.following, true);
    const f = await call('/feed', { key: Bk });
    const ev = f.d.events.find(e => e.handle === 'alpha_1'); ok(ev);
    eq((await call('/kudos/' + ev.id, { method: 'POST', key: Bk })).d, { kudos: 1, liked: true });
    eq((await call('/kudos/' + ev.id, { method: 'POST', key: A })).status, 400);
    const p = await call('/profile/alpha_1', { key: Bk });
    eq(p.d.profile.isFollowing, true); eq(p.d.profile.followers, 1); eq(p.d.profile.address, undefined, 'address stays hidden');
    near(p.d.profile.ret, 0.1, 1e-9);
    eq((await call('/profile/alpha_1', { key: A })).d.profile.address, '0x' + 'a'.repeat(40), 'you see your own');
    await call('/me', { method: 'PUT', key: A, body: { share: { profile: false } } });
    eq((await call('/profile/alpha_1', { key: Bk })).d.profile.private, true);
  });
  await t('admin needs the owner token; competitions, join rules and standings', async () => {
    eq((await call('/admin/overview')).status, 401);
    eq((await call('/admin/overview', { key: A })).status, 401, 'a member key is not admin');
    const mk = await call('/admin/competitions', { method: 'POST', admin: true, body: { title: 'Cup', type: 'discipline', start: '2026-09-28', end: '2026-10-04', minDays: 2 } });
    eq(mk.status, 200);
    const rc = await call('/admin/competitions', { method: 'POST', admin: true, body: { title: 'Sprint', type: 'return', start: '2026-09-01', end: '2026-10-10' } });
    eq((await call('/competitions/' + rc.d.id + '/join', { method: 'POST', key: Bk })).status, 400, 'return comps need an address and opted-in returns');
    eq((await call('/competitions/' + mk.d.id + '/join', { method: 'POST', key: A })).d.joined, true);
    await call('/competitions/' + mk.d.id + '/join', { method: 'POST', key: Bk });
    const c = await call('/competitions/' + mk.d.id, { key: Bk });
    eq(c.d.competition.standings.map(r => [r.handle, r.score]), [['alpha_1', 80], ['bravo', 80]]);
    eq(c.d.competition.me.rank, 2);
    const list = await call('/competitions', { key: A });
    eq(list.d.competitions.length, 2); ok(list.d.competitions.find(x => x.id === mk.d.id).joined);
  });
  await t('owner moderation: suspend hides a member everywhere; config changes reach /config', async () => {
    const ms = await call('/admin/members', { admin: true });
    const b = ms.d.members.find(m => m.handle === 'bravo');
    await call('/admin/members/' + b.id, { method: 'POST', admin: true, body: { action: 'ban' } });
    eq((await call('/me', { key: Bk })).status, 403);
    eq((await call('/league', { key: A })).d.rows.map(r => r.handle), ['alpha_1']);
    await call('/admin/config', { method: 'PUT', admin: true, body: { open: false, unlocks: { trends: 5 }, themes: { gold: 999 } } });
    const cfg = (await call('/config')).d;
    eq(cfg.open, false); eq(cfg.unlocks.trends, 5); eq(cfg.themes.gold, 100, 'levels are clamped');
    eq((await call('/join', { method: 'POST', body: { handle: 'late' } })).status, 403);
    await call('/admin/announce', { method: 'POST', admin: true, body: { text: 'Survivor starts Monday' } });
    const ev = await call('/admin/events', { admin: true });
    const ann = ev.d.events.find(e => e.text === 'Survivor starts Monday'); ok(ann && ann.admin);
    eq((await call('/admin/events/' + ann.id, { method: 'DELETE', admin: true })).status, 200);
  });
  await t('a new week runs promotion once, on the first request', async () => {
    await call('/admin/config', { method: 'PUT', admin: true, body: { open: true } });
    const keys = [];
    for (const h of ['carl1', 'carl2', 'carl3']) keys.push((await call('/join', { method: 'POST', body: { handle: h } })).d.key);
    for (let i = 0; i < 3; i++) await call('/stats', { method: 'POST', key: keys[i], body: { xp: 10, level: 1, week: '2026-W40', weekXp: i * 10 } });
    clock = Date.parse('2026-10-06T12:00:00Z'); // Tuesday of W41
    await call('/config');
    const me = await call('/me', { key: A });
    eq(me.d.tier, 1, 'alpha had the most XP in Bronze and moved up to Silver');
    const again = await call('/me', { key: A }); eq(again.d.tier, 1, 'no second promotion in the same week');
  });
  await t('leaving deletes the profile, posts and entries', async () => {
    eq((await call('/me', { method: 'DELETE', key: A })).status, 200);
    eq((await call('/me', { key: A })).status, 401);
    ok(!readFileSync(join(dataDir, 'social.json'), 'utf8').includes('alpha_1'));
  });
} finally { await new Promise(res => app.close(res)); }
await t('with no AUTH_TOKEN the admin API refuses instead of opening to everyone', async () => {
  const open = server.createApp({ dataDir: mkdtempSync(join(tmpdir(), 'ledger-social-')), auth: '', htmlPath, fetchImpl });
  const b = await listen(open);
  try { eq((await fetch(b + '/api/social/admin/overview')).status, 403);
    const pg = await fetch(b + '/admin'); eq(pg.status, 200); ok((await pg.text()).includes('Pulse admin')); }
  finally { await new Promise(res => open.close(res)); }
});

console.log('\nClient helpers');
const ctx = { Math, Object, Array, String, JSON };
vm.createContext(ctx);
vm.runInContext('const PZ_UNLOCK_DEFAULTS=' + html.slice(html.indexOf('const PZ_UNLOCK_DEFAULTS=') + 25, html.indexOf(';\n', html.indexOf('const PZ_UNLOCK_DEFAULTS='))) + ';\n'
  + ['pzNeeds', 'socHabitSpec', 'pzSocialStats'].map(grabFn).join('\n') + '\nfunction habitSentence(s){ return "When "+s.when+", "+s.then+"."; }', ctx);
t('unlock levels: owner settings, off switch, sample data and themes', () => {
  eq(ctx.pzNeeds('trends', 1), 2); eq(ctx.pzNeeds('trends', 2), 0);
  eq(ctx.pzNeeds('compete', 3, { unlocksOn: true, unlocks: { compete: 6 } }), 6);
  eq(ctx.pzNeeds('compete', 1, { unlocksOn: false, unlocks: { compete: 6 } }), 0);
  eq(ctx.pzNeeds('trends', 1, undefined, true), 0, 'sample data shows everything');
  eq(ctx.pzNeeds('theme:gold', 7), 8); eq(ctx.pzNeeds('theme:unknown', 1), 0);
});
t('a shared habit sentence becomes a self-graded habit', () => {
  eq(ctx.socHabitSpec('When I close two losing trades in a row, I stop for the day.'), { kind: 'self', when: 'I close two losing trades in a row', then: 'I stop for the day' });
  eq(ctx.socHabitSpec('Always use a stop.').then, 'Always use a stop');
});
t('only process numbers go out: no trades, notes, P&L or addresses in the stats payload', () => {
  const g = { xp: { total: 1234 }, level: { level: 3 }, nowWeek: '2026-W40', weekXp: 210, streak: { current: 4, best: 9, shields: 1 },
    challenges: [{ status: 'done', ch: { spec: { when: 'a', then: 'b' } } }, { status: 'missed' }],
    achievements: [{ id: 'x', title: 'X', at: '2026-09-01' }, { id: 'y', title: 'Y', at: null }],
    ctx: { days: [{ key: '2026-09-30', score: 88, breached: false, parts: { journal: 1 }, net: -500, n: 3 }] } };
  const p = ctx.pzSocialStats(g, ['When a, b.']);
  eq(Object.keys(p).sort(), ['badgeN', 'badges', 'best', 'challengesDone', 'days', 'habits', 'lastChallenge', 'level', 'shields', 'streak', 'week', 'weekXp', 'xp']);
  eq(p.days, [{ k: '2026-09-30', s: 88, b: false, j: true }], 'a day carries its score and flags — never its P&L');
  eq(p.badges, [{ id: 'x', t: 'X' }]); eq(p.lastChallenge, 'When a, b.');
});
t('Pulse never posts sample data, and routes profiles and competitions by hash', () => {
  ok(grabFn('socSync').includes('pzS.demo') && grabFn('socSync').includes('!settings.wallets.length'));
  ok(grabFn('pzTab').includes("return 'profile'") && grabFn('pzTab').includes("return 'comp'"));
  ok(existsSync(new URL('../admin.html', import.meta.url).pathname));
});

report('social');
