'use strict';
// Social layer for Pulse (v0.1): members, weekly leagues, leaderboards, competitions,
// following, a feed with kudos, and the owner's admin endpoints. Everything lives on the
// owner's server in one JSON file (DATA_DIR/social.json); there is no central service.
//
// Trust model, stated plainly:
//   - Process numbers (XP, level, streak, daily process scores) are computed by each
//     member's own browser from their own journal and posted here. They are self-reported.
//   - Money numbers (30-day return, drawdown, P&L) are NEVER taken from the client: the
//     server reads them from Hyperliquid's public portfolio endpoint for the member's
//     address, and only when the member opted in to showing them.
//   - A member proves nothing about owning the address they give (no wallet signature in
//     v0.1), so the address is hidden by default and the owner can remove anyone.
//   - A member is identified by a random key kept in their browser (header X-Pulse-Key);
//     only its SHA-256 is stored. The owner's AUTH_TOKEN gates the admin endpoints.
//
// Pure helpers are exported for tests; createSocial() wires them to HTTP.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond'];
const LEVELS = ['Rookie', 'Apprentice', 'Journeyman', 'Disciplined', 'Consistent', 'Professional', 'Veteran', 'Master', 'Grandmaster', 'Legend'];
const HANDLE_RE = /^[A-Za-z0-9_]{3,20}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const WEEK_RE = /^\d{4}-W\d{2}$/;
const BADGE_RE = /^[a-z0-9-]{1,40}$/;
const MAX_SOCIAL_BODY = 64 * 1024;
const MAX_EVENTS = 2000;
const MAX_MEMBERS = 5000;
const STREAK_MARKS = [7, 14, 21, 30, 50, 75, 100, 150, 200, 365];
const COMP_TYPES = ['discipline', 'survivor', 'journal', 'return'];
const DEFAULT_CONFIG = { open: true, inviteCode: '', unlocksOn: true,
  unlocks: { trends: 2, share: 3, compete: 4 }, themes: { ember: 3, aurora: 5, gold: 8 } };
const SHARE_KEYS = ['profile', 'boards', 'feed', 'habits', 'ret', 'usd', 'addr'];
const DEFAULT_SHARE = { profile: true, boards: true, feed: true, habits: true, ret: false, usd: false, addr: false };

const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const clampNum = (v, lo, hi) => { const n = +v; return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };
const cleanText = (s, max) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
const utcDayKey = ms => new Date(ms).toISOString().slice(0, 10);
const addDaysKey = (k, n) => utcDayKey(Date.parse(k + 'T00:00:00Z') + n * 86400000);
// ISO week ('GGGG-Www') of a 'YYYY-MM-DD' key — same math as the client's isoWeekOfKey.
function isoWeekOfKey(k) {
  const d = new Date(k + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) + 3);
  const ft = new Date(Date.UTC(d.getUTCFullYear(), 0, 4)); ft.setUTCDate(ft.getUTCDate() - ((ft.getUTCDay() + 6) % 7) + 3);
  return d.getUTCFullYear() + '-W' + String(1 + Math.round((d - ft) / (7 * 86400000))).padStart(2, '0');
}
const avg = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;

// ---- validation of what a member's browser posts ----
function sanitizeStats(b) {
  b = b || {};
  const days = (Array.isArray(b.days) ? b.days : []).slice(-60)
    .filter(d => d && DAY_RE.test(d.k)).map(d => ({ k: d.k, s: clampNum(d.s, 0, 100) || 0, b: !!d.b, j: !!d.j }));
  const badges = (Array.isArray(b.badges) ? b.badges : []).slice(0, 60)
    .filter(x => x && BADGE_RE.test(x.id)).map(x => ({ id: x.id, t: cleanText(x.t, 40) }));
  const habits = (Array.isArray(b.habits) ? b.habits : []).slice(0, 20).map(h => cleanText(h, 140)).filter(Boolean).slice(0, 5);
  return {
    xp: clampNum(b.xp, 0, 1e8) || 0, level: clampNum(b.level, 1, 500) || 1,
    week: WEEK_RE.test(b.week) ? b.week : null, weekXp: clampNum(b.weekXp, 0, 1e6) || 0,
    streak: clampNum(b.streak, 0, 10000) || 0, best: clampNum(b.best, 0, 10000) || 0, shields: clampNum(b.shields, 0, 2) || 0,
    challengesDone: clampNum(b.challengesDone, 0, 10000) || 0, lastChallenge: cleanText(b.lastChallenge, 140),
    badges, badgeN: clampNum(b.badgeN, 0, 100) || badges.length, habits, days,
  };
}
function sanitizeShare(s, prev) {
  const out = Object.assign({}, DEFAULT_SHARE, prev || {});
  for (const k of SHARE_KEYS) if (s && typeof s[k] === 'boolean') out[k] = s[k];
  return out;
}
// Average process score over the trading days in [fromKey, toKey], or null below minDays.
function disciplineOver(days, fromKey, toKey, minDays) {
  const ds = (days || []).filter(d => d.k >= fromKey && d.k <= toKey);
  return ds.length >= (minDays || 1) ? { avg: avg(ds.map(d => d.s)), n: ds.length } : { avg: null, n: ds.length };
}

// ---- feed events from the change between two stats posts ----
function eventsFromStats(prev, next, share) {
  if (!prev || !share || !share.feed) return [];
  const E = [];
  if (next.level > prev.level) E.push({ type: 'level', text: 'reached level ' + next.level + ' · ' + LEVELS[Math.min(next.level, LEVELS.length) - 1] });
  const mark = STREAK_MARKS.filter(m => prev.streak < m && next.streak >= m).pop();
  if (mark) E.push({ type: 'streak', text: 'hit a ' + mark + '-day discipline streak' });
  const had = new Set((prev.badges || []).map(b => b.id));
  for (const b of next.badges) if (!had.has(b.id)) E.push({ type: 'badge', text: 'unlocked ' + (b.t || b.id) });
  if (next.challengesDone > prev.challengesDone)
    E.push({ type: 'challenge', text: 'completed the weekly challenge', quote: next.lastChallenge || '' });
  if (share.habits) {
    const old = new Set(prev.habits || []);
    for (const h of next.habits) if (!old.has(h)) E.push({ type: 'habit', text: 'adopted a habit', quote: h });
  }
  return E.slice(0, 6);
}

// ---- 30-day return and drawdown from Hyperliquid's portfolio response ----
// Equity is rebuilt from the P&L series (start value + P&L since start), so deposits and
// withdrawals inside the window neither count as return nor as drawdown.
function portfolioStats(res, label, fromMs, toMs) {
  const e = (Array.isArray(res) ? res : []).find(x => x && x[0] === label);
  if (!e || !e[1]) return null;
  const av = (e[1].accountValueHistory || []).map(p => [+p[0], parseFloat(p[1])]).filter(p => isFinite(p[1]));
  const pn = (e[1].pnlHistory || []).map(p => [+p[0], parseFloat(p[1])]).filter(p => isFinite(p[1]));
  const inWin = p => (fromMs == null || p[0] >= fromMs) && (toMs == null || p[0] <= toMs);
  const P = pn.filter(inWin); if (P.length < 2) return null;
  const startAv = (av.filter(p => p[0] <= P[0][0]).pop() || av.find(inWin) || [0, 0])[1];
  if (!(startAv > 0)) return null;
  const base = P[0][1];
  let peak = startAv, dd = 0;
  for (const [, v] of P) { const eq = startAv + (v - base); if (eq > peak) peak = eq; if (peak > 0) dd = Math.max(dd, (peak - eq) / peak); }
  const usd = P[P.length - 1][1] - base;
  return { ret: usd / startAv, dd, usd, start: startAv };
}

// ---- league: weekly promotion and relegation by XP earned that week ----
function leagueRollover(members, week) {
  const moves = [];
  for (let t = 0; t < TIERS.length; t++) {
    const inTier = members.filter(m => !m.banned && (m.tier || 0) === t && m.weekXp && m.weekXp[week] != null);
    const n = inTier.length; const k = n >= 4 ? Math.min(5, Math.floor(n / 4)) : 0; if (!k) continue;
    const sorted = [...inTier].sort((a, b) => (b.weekXp[week] || 0) - (a.weekXp[week] || 0));
    if (t < TIERS.length - 1) for (const m of sorted.slice(0, k)) if (m.weekXp[week] > 0) moves.push({ id: m.id, from: t, to: t + 1 });
    if (t > 0) for (const m of sorted.slice(-k)) moves.push({ id: m.id, from: t, to: t - 1 });
  }
  return moves;
}

// ---- leaderboards ----
const BOARDS = {
  xp: { label: 'Weekly XP', scope: 'league', needs: 'boards' },
  discipline: { label: 'Discipline', needs: 'boards' },
  streak: { label: 'Streak', needs: 'boards' },
  level: { label: 'All-time XP', needs: 'boards' },
  riskadj: { label: 'Return / drawdown', needs: 'ret' },
  ret: { label: '% Return', needs: 'ret' },
  usd: { label: '$ P&L', needs: 'usd' },
};
function boardRows(members, board, opts) {
  opts = opts || {};
  const B = BOARDS[board]; if (!B) return null;
  const todayK = opts.todayKey || utcDayKey(Date.now());
  const week = opts.week || isoWeekOfKey(todayK);
  // process boards read posted stats; money boards read only what the server fetched from the chain
  let pool = members.filter(m => !m.banned && m.share && m.share[B.needs] && (B.needs !== 'boards' || m.stats));
  if (B.scope === 'league' && opts.tier != null) pool = pool.filter(m => (m.tier || 0) === opts.tier);
  const rows = [];
  for (const m of pool) {
    let v = null, sub = '';
    if (board === 'xp') { v = (m.weekXp && m.weekXp[week]) || 0; sub = 'Level ' + m.stats.level; }
    else if (board === 'level') { v = m.stats.xp; sub = 'Level ' + m.stats.level; }
    else if (board === 'streak') { v = m.stats.streak; sub = 'Best ' + m.stats.best; }
    else if (board === 'discipline') { const d = disciplineOver(m.stats.days, addDaysKey(todayK, -6), todayK, 3); if (d.avg == null) continue; v = Math.round(d.avg); sub = d.n + ' trading days'; }
    else {
      const mo = m.money; if (!mo || mo.ret == null) continue;
      if (board === 'ret') { if (mo.dd > 0.25) continue; v = mo.ret; sub = 'DD ' + (mo.dd * 100).toFixed(1) + '%'; }
      else if (board === 'riskadj') { v = mo.ret / Math.max(mo.dd, 0.005); sub = (mo.ret >= 0 ? '+' : '') + (mo.ret * 100).toFixed(1) + '% · DD ' + (mo.dd * 100).toFixed(1) + '%'; }
      else if (board === 'usd') { v = mo.usd; sub = 'DD ' + (mo.dd * 100).toFixed(1) + '%'; }
    }
    rows.push({ id: m.id, handle: m.handle, tier: m.tier || 0, value: v, sub });
  }
  rows.sort((a, b) => b.value - a.value || a.handle.localeCompare(b.handle));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}

// ---- competitions ----
function compStatus(c, todayKey) { return todayKey < c.start ? 'upcoming' : todayKey > c.end ? 'finished' : 'live'; }
function compStandings(c, members, todayKey) {
  const byId = new Map(members.map(m => [m.id, m]));
  const rows = [];
  for (const id of Object.keys(c.entrants || {})) {
    const m = byId.get(id); if (!m || m.banned) continue;
    const days = ((m.stats && m.stats.days) || []).filter(d => d.k >= c.start && d.k <= c.end && d.k <= todayKey);
    let score = null, note = '', out = false;
    if (c.type === 'discipline') {
      const d = disciplineOver(days, c.start, c.end, c.minDays || 3);
      if (d.avg == null) note = d.n + ' of ' + (c.minDays || 3) + ' trading days so far'; else { score = Math.round(d.avg); note = d.n + ' trading days'; }
    } else if (c.type === 'survivor') {
      const hit = days.find(d => d.b);
      if (hit) { out = true; score = -1; note = 'Out on ' + hit.k; } else { score = days.length; note = days.length + ' trading day' + (days.length === 1 ? '' : 's') + ' standing'; }
    } else if (c.type === 'journal') {
      let run = 0, best = 0; for (const d of days) { run = d.j ? run + 1 : 0; best = Math.max(best, run); }
      score = best; note = best + ' fully journaled day' + (best === 1 ? '' : 's') + ' in a row' + (best >= (c.minDays || 10) ? ' · done' : '');
    } else if (c.type === 'return') {
      const r = c.money && c.money[id];
      if (!r) note = 'waiting for data';
      else if (c.ddCap && r.dd > c.ddCap) { out = true; score = -Infinity; note = 'Over the ' + Math.round(c.ddCap * 100) + '% drawdown cap'; }
      else { score = r.ret; note = (r.ret >= 0 ? '+' : '') + (r.ret * 100).toFixed(1) + '% · DD ' + (r.dd * 100).toFixed(1) + '%'; }
    }
    rows.push({ id, handle: m.handle, score, note, out });
  }
  rows.sort((a, b) => (b.score == null ? -Infinity : b.score) - (a.score == null ? -Infinity : a.score) || a.handle.localeCompare(b.handle));
  rows.forEach((r, i) => { r.rank = i + 1; });
  return rows;
}
function sanitizeComp(b) {
  b = b || {};
  const type = COMP_TYPES.includes(b.type) ? b.type : null;
  const title = cleanText(b.title, 60), rule = cleanText(b.rule, 280);
  if (!type || !title || !DAY_RE.test(b.start) || !DAY_RE.test(b.end) || b.end < b.start) return null;
  if (Date.parse(b.end) - Date.parse(b.start) > 92 * 86400000) return null;
  return { type, title, rule, start: b.start, end: b.end,
    minDays: clampNum(b.minDays, 1, 90) || (type === 'journal' ? 10 : 3),
    ddCap: type === 'return' ? (clampNum(b.ddCap, 0.01, 0.9) || 0.08) : null };
}

// ---- the HTTP side ----
function createSocial(opts) {
  const file = path.join(opts.dataDir, 'social.json');
  const json = opts.json, authOk = opts.authOk, adminConfigured = !!opts.adminConfigured;
  const fetchImpl = opts.fetchImpl || ((...a) => globalThis.fetch(...a));
  const now = opts.now || (() => Date.now());
  let S;
  try { S = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { S = null; }
  if (!S || S.v !== 1) S = { v: 1, config: {}, members: {}, follows: {}, events: [], comps: {}, league: { week: null } };
  S.config = Object.assign({}, DEFAULT_CONFIG, S.config, {
    unlocks: Object.assign({}, DEFAULT_CONFIG.unlocks, S.config && S.config.unlocks),
    themes: Object.assign({}, DEFAULT_CONFIG.themes, S.config && S.config.themes) });
  const save = () => { const tmp = file + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(S)); fs.renameSync(tmp, file); };
  const members = () => Object.values(S.members);
  const byKey = req => { const k = req.headers['x-pulse-key']; if (!k || typeof k !== 'string' || k.length > 128) return null;
    const h = sha(k); return members().find(m => m.keyHash === h) || null; };
  const byHandle = h => members().find(m => m.handle.toLowerCase() === String(h || '').toLowerCase()) || null;
  const pushEvent = (m, e) => {
    S.events.push({ id: crypto.randomBytes(6).toString('hex'), at: now(), member: m ? m.id : null, type: e.type, text: e.text, quote: e.quote || '', kudos: [] });
    if (S.events.length > MAX_EVENTS) S.events.splice(0, S.events.length - MAX_EVENTS);
  };
  const todayKey = () => utcDayKey(now());
  // weekly league rollover runs lazily on the first request of a new ISO week
  const ensureWeek = () => {
    const wk = isoWeekOfKey(todayKey());
    if (S.league.week === wk) return;
    if (S.league.week) for (const mv of leagueRollover(members(), S.league.week)) {
      const m = S.members[mv.id]; if (!m) continue; m.tier = mv.to;
      if (mv.to > mv.from && m.share && m.share.feed) pushEvent(m, { type: 'league', text: 'moved up to ' + TIERS[mv.to] + ' league' });
    }
    S.league.week = wk; save();
  };
  // money stats: read from the chain for opted-in members, at most every 30 minutes each
  const moneyBusy = new Set();
  const refreshMoney = async (m, force) => {
    if (!m.address || !(m.share.ret || m.share.usd) || moneyBusy.has(m.id)) return;
    if (!force && m.money && now() - m.money.at < 30 * 60000) return;
    moneyBusy.add(m.id);
    try {
      const r = await fetchImpl('https://api.hyperliquid.xyz/info', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'portfolio', user: m.address }) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const res = await r.json();
      const st = portfolioStats(res, 'month');
      m.money = st ? { ret: st.ret, dd: st.dd, usd: st.usd, at: now() } : { ret: null, dd: null, usd: null, at: now() };
      for (const c of Object.values(S.comps)) if (c.type === 'return' && c.entrants[m.id]) {
        const s2 = portfolioStats(res, 'month', Date.parse(c.start + 'T00:00:00Z'), Date.parse(c.end + 'T23:59:59Z'));
        if (s2) { c.money = c.money || {}; c.money[m.id] = { ret: s2.ret, dd: s2.dd }; }
      }
      save();
    } catch (e) { /* the next request retries; boards just show what they have */ }
    finally { moneyBusy.delete(m.id); }
  };
  const tierOf = m => ({ tier: m.tier || 0, tierName: TIERS[m.tier || 0] });
  const publicMember = (m, viewer) => {
    const st = m.stats || {};
    const out = { id: m.id, handle: m.handle, ...tierOf(m), level: st.level || 1, title: LEVELS[Math.min(st.level || 1, LEVELS.length) - 1],
      followers: members().filter(x => (S.follows[x.id] || []).includes(m.id)).length,
      following: (S.follows[m.id] || []).length, isFollowing: !!viewer && (S.follows[viewer.id] || []).includes(m.id), isMe: !!viewer && viewer.id === m.id };
    if (!m.share.profile && !out.isMe) return Object.assign(out, { private: true });
    const d30 = disciplineOver(st.days, addDaysKey(todayKey(), -29), todayKey(), 3);
    Object.assign(out, { xp: st.xp || 0, streak: st.streak || 0, best: st.best || 0, discipline30: d30.avg == null ? null : Math.round(d30.avg),
      badges: (st.badges || []).map(b => b.t || b.id), badgeN: st.badgeN || 0 });
    if (m.share.habits || out.isMe) out.habits = st.habits || [];
    if ((m.share.ret || out.isMe) && m.money && m.money.ret != null) { out.ret = m.money.ret; out.dd = m.money.dd; }
    if ((m.share.usd || out.isMe) && m.money && m.money.usd != null) out.usd = m.money.usd;
    if ((m.share.addr || out.isMe) && m.address) out.address = m.address;
    return out;
  };
  const eventOut = (e, viewer) => { const m = e.member ? S.members[e.member] : null;
    return { id: e.id, at: e.at, type: e.type, text: e.text, quote: e.quote, handle: m ? m.handle : null, tier: m ? m.tier || 0 : null,
      admin: !e.member, kudos: e.kudos.length, liked: !!viewer && e.kudos.includes(viewer.id), mine: !!viewer && e.member === viewer.id }; };
  const compOut = (c, viewer, full) => { const st = compStatus(c, todayKey());
    const rows = compStandings(c, members(), todayKey());
    const mine = viewer ? rows.find(r => r.id === viewer.id) || null : null;
    const o = { id: c.id, title: c.title, type: c.type, rule: c.rule, start: c.start, end: c.end, minDays: c.minDays, ddCap: c.ddCap,
      status: st, entrants: rows.length, joined: !!(viewer && c.entrants[viewer.id]), me: mine };
    if (full) o.standings = rows.slice(0, 50).map(r => ({ rank: r.rank, handle: r.handle, note: r.note, out: r.out, score: r.score, me: !!viewer && r.id === viewer.id }));
    return o; };
  const joinTimes = new Map();

  const readJson = async (req) => {
    const raw = await new Promise((resolve, reject) => { let size = 0; const ch = [];
      req.on('data', c => { size += c.length; if (size > MAX_SOCIAL_BODY) { reject(new Error('too large')); req.destroy(); return; } ch.push(c); });
      req.on('end', () => resolve(Buffer.concat(ch).toString('utf8'))); req.on('error', reject); });
    return raw ? JSON.parse(raw) : {};
  };

  async function handle(req, res, url, query) {
    const M = req.method;
    const parts = url.split('/').slice(3); // ['', 'api', 'social', ...]
    const head = parts[0] || '';
    let body = {};
    if (M === 'POST' || M === 'PUT') { try { body = await readJson(req); } catch (e) { return json(res, 400, { error: 'invalid body' }); } }
    ensureWeek();

    if (head === 'config' && M === 'GET')
      return json(res, 200, { enabled: true, open: S.config.open, inviteRequired: !!S.config.inviteCode, unlocksOn: S.config.unlocksOn,
        unlocks: S.config.unlocks, themes: S.config.themes, tiers: TIERS, week: S.league.week, members: members().filter(m => !m.banned).length });

    // ---------- owner: admin ----------
    if (head === 'admin') {
      // an open server (no AUTH_TOKEN) would make everyone an admin: refuse until a token is set
      if (!adminConfigured) return json(res, 403, { error: 'Set AUTH_TOKEN on the server to use the admin panel.' });
      if (!authOk(req)) return json(res, 401, { error: 'unauthorized' });
      const sub = parts[1] || '';
      if (sub === 'overview' && M === 'GET') {
        const wk = S.league.week, act = members().filter(m => now() - (m.lastSeen || 0) < 7 * 86400000);
        return json(res, 200, { adminConfigured, members: members().length, banned: members().filter(m => m.banned).length, active7: act.length,
          events: S.events.length, comps: Object.keys(S.comps).length, week: wk, config: S.config,
          tiers: TIERS.map((t, i) => ({ tier: t, n: members().filter(m => !m.banned && (m.tier || 0) === i).length })) });
      }
      if (sub === 'members' && M === 'GET' && !parts[2])
        return json(res, 200, { members: members().sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0)).map(m => ({ id: m.id, handle: m.handle,
          tier: m.tier || 0, level: (m.stats && m.stats.level) || 1, xp: (m.stats && m.stats.xp) || 0, streak: (m.stats && m.stats.streak) || 0,
          address: m.address || null, share: m.share, banned: !!m.banned, createdAt: m.createdAt, lastSeen: m.lastSeen || null,
          money: m.money && m.money.ret != null ? { ret: m.money.ret, dd: m.money.dd } : null })) });
      if (sub === 'members' && parts[2] && M === 'POST') {
        const m = S.members[parts[2]]; if (!m) return json(res, 404, { error: 'no such member' });
        const a = body.action;
        if (a === 'ban' || a === 'unban') m.banned = a === 'ban';
        else if (a === 'tier') { const t = clampNum(body.tier, 0, TIERS.length - 1); if (t == null) return json(res, 400, { error: 'bad tier' }); m.tier = Math.round(t); }
        else if (a === 'remove') { delete S.members[m.id]; delete S.follows[m.id];
          for (const k in S.follows) S.follows[k] = S.follows[k].filter(x => x !== m.id);
          S.events = S.events.filter(e => e.member !== m.id);
          for (const c of Object.values(S.comps)) { delete c.entrants[m.id]; if (c.money) delete c.money[m.id]; } }
        else return json(res, 400, { error: 'unknown action' });
        save(); return json(res, 200, { ok: true });
      }
      if (sub === 'config' && M === 'PUT') {
        const c = S.config;
        if (typeof body.open === 'boolean') c.open = body.open;
        if (typeof body.inviteCode === 'string') c.inviteCode = cleanText(body.inviteCode, 40);
        if (typeof body.unlocksOn === 'boolean') c.unlocksOn = body.unlocksOn;
        for (const [grp, keys] of [['unlocks', ['trends', 'share', 'compete']], ['themes', ['ember', 'aurora', 'gold']]])
          if (body[grp] && typeof body[grp] === 'object') for (const k of keys) { const v = clampNum(body[grp][k], 1, 100); if (v != null) c[grp][k] = Math.round(v); }
        save(); return json(res, 200, { ok: true, config: c });
      }
      if (sub === 'competitions' && M === 'POST' && !parts[2]) {
        const c = sanitizeComp(body); if (!c) return json(res, 400, { error: 'needs a title, a type (' + COMP_TYPES.join(', ') + '), and start ≤ end dates within 92 days' });
        c.id = crypto.randomBytes(5).toString('hex'); c.createdAt = now(); c.entrants = {};
        S.comps[c.id] = c; pushEvent(null, { type: 'announce', text: 'New competition: ' + c.title, quote: c.rule }); save();
        return json(res, 200, { ok: true, id: c.id });
      }
      if (sub === 'competitions' && parts[2] && M === 'DELETE') {
        if (!S.comps[parts[2]]) return json(res, 404, { error: 'no such competition' });
        delete S.comps[parts[2]]; save(); return json(res, 200, { ok: true });
      }
      if (sub === 'competitions' && M === 'GET')
        return json(res, 200, { competitions: Object.values(S.comps).sort((a, b) => b.createdAt - a.createdAt).map(c => compOut(c, null, true)) });
      if (sub === 'announce' && M === 'POST') {
        const text = cleanText(body.text, 280); if (!text) return json(res, 400, { error: 'empty' });
        pushEvent(null, { type: 'announce', text }); save(); return json(res, 200, { ok: true });
      }
      if (sub === 'events' && M === 'GET') return json(res, 200, { events: S.events.slice(-100).reverse().map(e => eventOut(e, null)) });
      if (sub === 'events' && parts[2] && M === 'DELETE') {
        const n = S.events.length; S.events = S.events.filter(e => e.id !== parts[2]);
        if (S.events.length === n) return json(res, 404, { error: 'no such event' });
        save(); return json(res, 200, { ok: true });
      }
      return json(res, 404, { error: 'not found' });
    }

    // ---------- joining ----------
    if (head === 'join' && M === 'POST') {
      if (!S.config.open) return json(res, 403, { error: 'This league isn’t taking new members right now.' });
      if (S.config.inviteCode && cleanText(body.invite, 40) !== S.config.inviteCode) return json(res, 403, { error: 'That invite code isn’t right.' });
      if (members().length >= MAX_MEMBERS) return json(res, 403, { error: 'The league is full.' });
      const ip = (req.socket && req.socket.remoteAddress) || '';
      const recent = (joinTimes.get(ip) || []).filter(t => now() - t < 3600000);
      if (recent.length >= 5) return json(res, 429, { error: 'Too many new profiles from here. Try again later.' });
      const handle = cleanText(body.handle, 20).replace(/^@/, '');
      if (!HANDLE_RE.test(handle)) return json(res, 400, { error: 'Pick a name of 3–20 letters, numbers or underscores.' });
      if (byHandle(handle)) return json(res, 409, { error: 'That name is taken.' });
      const key = crypto.randomBytes(24).toString('hex'), id = crypto.randomBytes(6).toString('hex');
      const m = { id, handle, keyHash: sha(key), createdAt: now(), lastSeen: now(), tier: 0, share: sanitizeShare(body.share),
        address: /^0x[0-9a-fA-F]{40}$/.test(body.address || '') ? body.address.toLowerCase() : null, stats: null, weekXp: {}, money: null, banned: false };
      S.members[id] = m; S.follows[id] = [];
      recent.push(now()); joinTimes.set(ip, recent);
      if (m.share.feed) pushEvent(m, { type: 'join', text: 'joined the league' });
      save(); refreshMoney(m, true);
      return json(res, 200, { key, me: publicMember(m, m), share: m.share });
    }

    // ---------- everything below needs a member key ----------
    const me = byKey(req);
    if (!me) return json(res, 401, { error: 'not a member' });
    if (me.banned) return json(res, 403, { error: 'This profile was removed from the league.' });
    me.lastSeen = now();

    if (head === 'me' && M === 'GET') return json(res, 200, { me: publicMember(me, me), share: me.share, tier: me.tier || 0 });
    if (head === 'me' && M === 'PUT') {
      if (body.handle != null) { const h = cleanText(body.handle, 20).replace(/^@/, '');
        if (!HANDLE_RE.test(h)) return json(res, 400, { error: 'Pick a name of 3–20 letters, numbers or underscores.' });
        const other = byHandle(h); if (other && other.id !== me.id) return json(res, 409, { error: 'That name is taken.' }); me.handle = h; }
      if (body.share) me.share = sanitizeShare(body.share, me.share);
      if (body.address !== undefined) me.address = /^0x[0-9a-fA-F]{40}$/.test(body.address || '') ? body.address.toLowerCase() : null;
      if (!(me.share.ret || me.share.usd)) me.money = null;
      save(); refreshMoney(me, true);
      return json(res, 200, { me: publicMember(me, me), share: me.share });
    }
    if (head === 'me' && M === 'DELETE') {
      delete S.members[me.id]; delete S.follows[me.id];
      for (const k in S.follows) S.follows[k] = S.follows[k].filter(x => x !== me.id);
      S.events = S.events.filter(e => e.member !== me.id);
      for (const c of Object.values(S.comps)) { delete c.entrants[me.id]; if (c.money) delete c.money[me.id]; }
      save(); return json(res, 200, { ok: true });
    }
    if (head === 'stats' && M === 'POST') {
      const next = sanitizeStats(body);
      for (const e of eventsFromStats(me.stats, next, me.share)) pushEvent(me, e);
      me.stats = next; me.statsAt = now();
      if (next.week) { me.weekXp = me.weekXp || {}; me.weekXp[next.week] = next.weekXp;
        const keep = Object.keys(me.weekXp).sort().slice(-8); for (const k of Object.keys(me.weekXp)) if (!keep.includes(k)) delete me.weekXp[k]; }
      save(); refreshMoney(me);
      return json(res, 200, { ok: true, tier: me.tier || 0 });
    }
    if (head === 'league' && M === 'GET') {
      const rows = boardRows(members(), 'xp', { tier: me.tier || 0, week: S.league.week });
      const n = rows.length, k = n >= 4 ? Math.min(5, Math.floor(n / 4)) : 0;
      return json(res, 200, { tier: me.tier || 0, tierName: TIERS[me.tier || 0], week: S.league.week, size: n, promote: me.tier < TIERS.length - 1 ? k : 0, demote: me.tier > 0 ? k : 0,
        rows: rows.slice(0, 50).map(r => ({ rank: r.rank, handle: r.handle, value: r.value, sub: r.sub, me: r.id === me.id })), me: rows.find(r => r.id === me.id) || null });
    }
    if (head === 'leaderboard' && M === 'GET') {
      const board = BOARDS[query.board] ? query.board : 'discipline';
      for (const m of members()) refreshMoney(m); // background; boards show what's cached
      const rows = boardRows(members(), board, { tier: me.tier || 0, week: S.league.week });
      const mine = rows.find(r => r.id === me.id) || null;
      return json(res, 200, { board, label: BOARDS[board].label, rows: rows.slice(0, 50).map(r => ({ rank: r.rank, handle: r.handle, tier: r.tier, value: r.value, sub: r.sub, me: r.id === me.id })),
        me: mine, total: rows.length, optedIn: !!me.share[BOARDS[board].needs] });
    }
    if (head === 'feed' && M === 'GET') {
      const scope = query.scope === 'discover' ? 'discover' : 'following';
      const fol = new Set([...(S.follows[me.id] || []), me.id]);
      const vis = e => !e.member || (S.members[e.member] && !S.members[e.member].banned && (e.member === me.id || S.members[e.member].share.feed));
      const list = S.events.filter(e => vis(e) && (scope === 'discover' || !e.member || fol.has(e.member))).slice(-60).reverse();
      const suggest = scope === 'discover' ? members().filter(m => m.id !== me.id && !m.banned && m.share.profile && !fol.has(m.id) && m.stats)
        .map(m => ({ m, d: disciplineOver(m.stats.days, addDaysKey(todayKey(), -29), todayKey(), 3).avg }))
        .sort((a, b) => (b.d || 0) - (a.d || 0)).slice(0, 3)
        .map(({ m, d }) => ({ handle: m.handle, tierName: TIERS[m.tier || 0], why: 'Level ' + m.stats.level + (d != null ? ' · discipline ' + Math.round(d) : '') })) : [];
      return json(res, 200, { scope, events: list.map(e => eventOut(e, me)), suggest });
    }
    if (head === 'kudos' && parts[1] && M === 'POST') {
      const e = S.events.find(x => x.id === parts[1]); if (!e) return json(res, 404, { error: 'no such post' });
      if (e.member === me.id) return json(res, 400, { error: 'That’s your own post.' });
      const i = e.kudos.indexOf(me.id); if (i >= 0) e.kudos.splice(i, 1); else e.kudos.push(me.id);
      save(); return json(res, 200, { kudos: e.kudos.length, liked: i < 0 });
    }
    if (head === 'profile' && parts[1] && M === 'GET') {
      const m = byHandle(decodeURIComponent(parts[1])); if (!m || m.banned) return json(res, 404, { error: 'No one by that name.' });
      const ev = S.events.filter(e => e.member === m.id && (m.share.feed || m.id === me.id)).slice(-10).reverse().map(e => eventOut(e, me));
      return json(res, 200, { profile: publicMember(m, me), events: ev });
    }
    if (head === 'follow' && parts[1] && (M === 'POST' || M === 'DELETE')) {
      const m = byHandle(decodeURIComponent(parts[1])); if (!m || m.banned || m.id === me.id) return json(res, 404, { error: 'No one by that name.' });
      const f = S.follows[me.id] = (S.follows[me.id] || []).filter(x => x !== m.id);
      if (M === 'POST') f.push(m.id);
      save(); return json(res, 200, { following: M === 'POST' });
    }
    if (head === 'competitions' && M === 'GET' && !parts[1]) {
      for (const c of Object.values(S.comps)) if (c.type === 'return' && c.entrants[me.id]) refreshMoney(me);
      return json(res, 200, { competitions: Object.values(S.comps).sort((a, b) => a.start < b.start ? 1 : -1).map(c => compOut(c, me, false)) });
    }
    if (head === 'competitions' && parts[1] && M === 'GET') {
      const c = S.comps[parts[1]]; if (!c) return json(res, 404, { error: 'no such competition' });
      return json(res, 200, { competition: compOut(c, me, true) });
    }
    if (head === 'competitions' && parts[1] && parts[2] === 'join' && (M === 'POST' || M === 'DELETE')) {
      const c = S.comps[parts[1]]; if (!c) return json(res, 404, { error: 'no such competition' });
      if (compStatus(c, todayKey()) === 'finished') return json(res, 400, { error: 'This competition has finished.' });
      if (M === 'DELETE') delete c.entrants[me.id];
      else {
        if (c.type === 'return' && !(me.address && me.share.ret)) return json(res, 400, { error: 'Return competitions read your wallet on chain: add your address and switch on “Show % return” in What you share.' });
        c.entrants[me.id] = { joinedAt: now() };
        if (me.share.feed) pushEvent(me, { type: 'compete', text: 'joined ' + c.title });
        if (c.type === 'return') refreshMoney(me, true);
      }
      save(); return json(res, 200, { joined: M === 'POST' });
    }
    return json(res, 404, { error: 'not found' });
  }
  return { handle, state: () => S };
}

module.exports = { createSocial, sanitizeStats, sanitizeShare, sanitizeComp, eventsFromStats, portfolioStats, leagueRollover,
  boardRows, compStandings, compStatus, disciplineOver, isoWeekOfKey, TIERS, DEFAULT_CONFIG, DEFAULT_SHARE };
