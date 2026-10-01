'use strict';
// Duels: one member challenges another to a week or a month on one measure. Pure functions —
// the terms, the dates, and the score — so the rules can be tested without a server.
//
// Scoring reads only what the server already has: the Discipline days it verifies from each
// member's public fills (m.vdays), the days each member's app syncs (m.stats.days: score, fully
// journaled, reviewed), XP by day (m.stats.xpDays), and for % return the duel's own on-chain
// snapshot (d.money). Nobody marks their own homework. Money is never staked; XP can be: each side
// puts up the same amount and the winner takes the loser's.

const TYPES = {
  disc: { label: 'Discipline', rule: 'Higher average daily Discipline wins.', verifiedDefault: true },
  clean: { label: 'Clean days', rule: 'More trading days at 70+ Discipline wins; a tie goes to the higher average.', verifiedDefault: true },
  survive: { label: 'Last one standing', rule: 'The first to have a trading day under 70 Discipline loses.', verifiedDefault: true },
  journal: { label: 'Journal streak', rule: 'More days with every trade journaled and the day reviewed wins.' },
  xp: { label: 'Process XP', rule: 'More XP earned from process wins. Profit earns none.' },
  ret: { label: '% return, capped', rule: 'Higher % return wins; going past the drawdown cap loses outright.' },
};
const DEFAULTS = { on: true, types: { disc: true, clean: true, survive: true, journal: true, xp: true, ret: false }, xp: 100, maxOpen: 3, perDay: 5,
  stakes: true, maxStake: 500, stakePct: 25 }; // stakePct: the most of your XP that can be riding on open duels at once
const DAY = 86400000;
const keyOf = ms => new Date(ms).toISOString().slice(0, 10);
const clamp = (v, lo, hi) => { const n = +v; return isFinite(n) ? Math.min(hi, Math.max(lo, n)) : null; };

function sanitizeDuelCfg(b, prev) {
  const out = Object.assign({}, DEFAULTS, prev || {}, { types: Object.assign({}, DEFAULTS.types, (prev && prev.types) || {}) });
  if (!b || typeof b !== 'object') return out;
  if (typeof b.on === 'boolean') out.on = b.on;
  if (typeof b.stakes === 'boolean') out.stakes = b.stakes;
  if (b.maxStake !== undefined) { const x = clamp(b.maxStake, 0, 100000); if (x != null) out.maxStake = Math.round(x); }
  if (b.stakePct !== undefined) { const x = clamp(b.stakePct, 1, 100); if (x != null) out.stakePct = Math.round(x); }
  if (b.types && typeof b.types === 'object') for (const k of Object.keys(TYPES)) if (typeof b.types[k] === 'boolean') out.types[k] = b.types[k];
  if (b.xp !== undefined) { const x = clamp(b.xp, 0, 10000); if (x != null) out.xp = Math.round(x); }
  if (b.maxOpen !== undefined) { const x = clamp(b.maxOpen, 1, 20); if (x != null) out.maxOpen = Math.round(x); }
  if (b.perDay !== undefined) { const x = clamp(b.perDay, 1, 50); if (x != null) out.perDay = Math.round(x); }
  return out;
}
// The terms someone proposes -> the stored shape, or {error}.
function sanitizeTerms(b, cfg) {
  b = b || {}; cfg = cfg || DEFAULTS;
  const type = Object.prototype.hasOwnProperty.call(TYPES, b.type) ? b.type : null;
  if (!type) return { error: 'Pick what to compete on.' };
  if (!cfg.types[type]) return { error: 'This league doesn’t run ' + TYPES[type].label + ' duels.' };
  const period = b.period === 'month' ? 'month' : 'week';
  const verified = ['disc', 'clean', 'survive'].includes(type) ? b.verified !== false : false;
  const minDays = type === 'disc' ? Math.round(clamp(b.minDays, 1, period === 'month' ? 20 : 5) || 3) : null;
  const ddCap = type === 'ret' ? clamp(b.ddCap, 0.02, 0.5) || 0.08 : null;
  const msg = String(b.msg == null ? '' : b.msg).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 140);
  const stake = cfg.stakes === false ? 0 : Math.round(clamp(b.stake, 0, cfg.maxStake == null ? DEFAULTS.maxStake : cfg.maxStake) || 0);
  return { type, period, verified, minDays, ddCap, msg, stake };
}
// The most XP a member can still put up: a share of their XP, less what's already riding on their
// other open duels. xp: their total; riding: the stakes already committed.
function stakeRoom(xp, riding, cfg) {
  cfg = cfg || DEFAULTS;
  return Math.max(0, Math.min(cfg.maxStake, Math.floor((+xp || 0) * (cfg.stakePct || DEFAULTS.stakePct) / 100) - (riding || 0)));
}
// the member's own calendar day for a moment, as their app files XP under it
const localKey = (ms, tz) => { try { return new Date(ms).toLocaleDateString('en-CA', { timeZone: tz || 'UTC' }); } catch (e) { return keyOf(ms); } };
// The duel's dates once accepted: the next whole week (Monday to Sunday) or the next calendar month,
// in UTC days like the league's weeks — today when today is that Monday or the 1st, so nobody gets
// a head start and nobody waits more than they must.
function windowFor(period, nowMs) {
  const d = new Date(keyOf(nowMs) + 'T00:00:00Z');
  if (period === 'month') {
    const s = d.getUTCDate() === 1 ? d : new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    const e = new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth() + 1, 0));
    return { start: keyOf(s.getTime()), end: keyOf(e.getTime()) };
  }
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  const s = dow === 0 ? d.getTime() : d.getTime() + (7 - dow) * DAY;
  return { start: keyOf(s), end: keyOf(s + 6 * DAY) };
}
// One side's score so far (or final). m: the member; d: the duel; upto: the last day to count.
function sideScore(d, m, upto) {
  const last = d.end < upto ? d.end : upto, inWin = k => k >= d.start && k <= last;
  const verifiedDays = m && m.share && m.share.verify && Array.isArray(m.vdays) ? m.vdays : null;
  const appDays = (m && m.stats && Array.isArray(m.stats.days)) ? m.stats.days : [];
  const proc = (d.verified ? verifiedDays || [] : appDays).filter(x => inWin(x.k)).sort((a, b) => a.k < b.k ? -1 : 1);
  const avg = a => a.length ? a.reduce((s, x) => s + x.s, 0) / a.length : null;
  const marks = proc.map(x => ({ k: x.k, s: Math.round(x.s) })); // what the duel card draws, day by day
  const out = { n: proc.length, marks, score: null, note: '', verifiedMissing: d.verified && !verifiedDays };
  if (d.type === 'disc') { const a = avg(proc); out.avg = a; out.score = a == null ? null : Math.round(a);
    out.note = proc.length < (d.minDays || 3) ? proc.length + ' of ' + (d.minDays || 3) + ' trading days' : proc.length + ' trading days'; }
  else if (d.type === 'clean') { out.score = proc.filter(x => x.s >= 70).length; out.avg = avg(proc); out.note = out.score + ' of ' + proc.length + ' days at 70+'; }
  else if (d.type === 'survive') { const fell = proc.find(x => x.s < 70); out.fell = fell ? fell.k : null; out.score = proc.length;
    // switching verification off mid-duel would hide every slip: that counts as falling on day one
    if (d.verified && !(m && m.share && m.share.verify) && d.start <= upto) { out.fell = d.start; out.note = 'Out: turned verification off'; }
    else out.note = fell ? 'Out on ' + fell.k : proc.length + ' clean trading day' + (proc.length === 1 ? '' : 's'); }
  else if (d.type === 'journal') { const days = appDays.filter(x => inWin(x.k)); out.score = days.filter(x => x.j && x.r).length; out.n = days.length;
    out.marks = days.map(x => ({ k: x.k, s: x.j && x.r ? 100 : 0 })); out.note = out.score + ' of ' + days.length + ' days journaled and reviewed'; }
  else if (d.type === 'xp') { const xd = (m && m.stats && m.stats.xpDays) || {}; let s = 0; const mk = [];
    // XP won in duels isn't process XP: it comes off the day it landed on
    const won = {}; for (const g of (m && m.grants) || []) if (g.duel && g.xp > 0) { const k = localKey(g.at, m.stats && m.stats.tz); won[k] = (won[k] || 0) + g.xp; }
    for (const k of Object.keys(xd).sort()) if (inWin(k)) { const v = Math.max(0, Math.round((+xd[k] || 0) - (won[k] || 0))); s += v; mk.push({ k, s: v }); }
    out.score = s; out.marks = mk; out.n = mk.length; out.note = s + ' XP'; }
  else if (d.type === 'ret') { const r = d.money && m && Object.prototype.hasOwnProperty.call(d.money, m.id) ? d.money[m.id] : null;
    if (!r) out.note = 'waiting for on-chain data';
    else { out.ret = r.ret; out.dd = r.dd; out.out = r.dd > d.ddCap; out.score = r.ret;
      out.note = (r.ret >= 0 ? '+' : '') + (r.ret * 100).toFixed(1) + '% · drawdown ' + (r.dd * 100).toFixed(1) + '%' + (out.out ? ' · over the cap' : ''); } }
  return out;
}
// Who's ahead (or who won, when upto is past the end): {a, b, lead: 'a' | 'b' | null, why}
function standing(d, ma, mb, upto) {
  const a = sideScore(d, ma, upto), b = sideScore(d, mb, upto);
  let lead = null, why = '';
  const cmp = (x, y) => x > y ? 'a' : y > x ? 'b' : null;
  if (d.type === 'disc') {
    const qa = a.n >= (d.minDays || 3) && a.avg != null, qb = b.n >= (d.minDays || 3) && b.avg != null;
    if (qa && qb) { lead = cmp(a.avg, b.avg); why = lead ? 'higher average Discipline' : 'same average'; }
    else if (qa !== qb) { lead = qa ? 'a' : 'b'; why = 'the other side traded fewer than ' + (d.minDays || 3) + ' days'; }
    else why = 'neither has ' + (d.minDays || 3) + ' trading days yet';
  } else if (d.type === 'clean') { lead = cmp(a.score, b.score) || (a.avg != null && b.avg != null ? cmp(a.avg, b.avg) : null); why = lead ? 'more clean days' : 'level'; }
  else if (d.type === 'survive') {
    if (a.fell && b.fell) { lead = a.fell > b.fell ? 'a' : b.fell > a.fell ? 'b' : null; why = lead ? 'lasted longer' : 'both fell the same day'; }
    else if (a.fell || b.fell) { lead = a.fell ? 'b' : 'a'; why = 'still standing'; }
    else why = 'both still standing';
  } else if (d.type === 'journal' || d.type === 'xp') { lead = cmp(a.score, b.score); why = lead ? (d.type === 'xp' ? 'more process XP' : 'more journaled days') : 'level'; }
  else if (d.type === 'ret') {
    if (a.out && b.out) why = 'both went past the cap';
    else if (a.out || b.out) { lead = a.out ? 'b' : 'a'; why = 'the other side went past the ' + Math.round(d.ddCap * 100) + '% drawdown cap'; }
    else if (a.score != null && b.score != null) { lead = cmp(a.score, b.score); why = lead ? 'higher % return' : 'same return'; }
    else why = 'waiting for on-chain data';
  }
  return { a, b, lead, why };
}

module.exports = { TYPES, DEFAULTS, sanitizeDuelCfg, sanitizeTerms, stakeRoom, windowFor, sideScore, standing, keyOf };
