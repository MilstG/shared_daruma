'use strict';
// "Traders like you": peer-group benchmarks built from anonymous summaries.
//
// Each contributor is one summary (see peerSummary in the app): four coarse dimensions — style,
// trade size, experience, activity — and a dozen numbers. Members send theirs from the app (on by
// default, off with one switch); seed wallets the owner adds are summarised on the server from
// their public fills. Once a day the summaries are grouped: a group exists for every combination
// of dimensions that holds at least `min` traders, and only its deciles leave the server, never a
// contributor's own numbers. Below `splitAt` contributors only "everyone" and "same style" groups
// are built, so a young server doesn't slice itself into empty groups. Each contributor's summary
// is also kept weekly for about 26 weeks (server side only), so each build can say what changed for
// traders who improved, as group medians. Pure functions; no I/O.

const DIMS = {
  style: { scalper: 'Scalper', day: 'Day trader', swing: 'Swing trader', position: 'Position trader' },
  size: { s1: 'Trades under $1k', s2: 'Trades $1k–10k', s3: 'Trades $10k–100k', s4: 'Trades $100k+' },
  exp: { e1: 'Under 3 months', e2: '3–12 months', e3: '1–3 years', e4: '3+ years' },
  act: { a1: 'Under 5 trades a week', a2: '5–15 a week', a3: '15–40 a week', a4: '40+ a week' },
};
const DIM_KEYS = Object.keys(DIMS);
// value bounds; a metric is optional (null) when the contributor can't measure it (seed wallets
// have no journal; returns are only known for wallets read on chain)
const METRICS = { disc: [0, 100], rev: [0, 100], jour: [0, 100], wr: [0, 100], pf: [0, 50], pay: [0, 50], fees: [0, 500], tw: [0, 5000], hold: [0, 1e7], ret: [-100, 1000], dd: [0, 100] };
const MKEYS = Object.keys(METRICS);
const DECILES = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9];
const DEFAULTS = { on: true, min: 25, splitAt: 200, seeds: true };

const fin = v => typeof v === 'number' && isFinite(v);
// A summary from the app or the engine -> the stored shape, or null when it isn't one.
function sanitizeBench(b) {
  if (!b || typeof b !== 'object' || b.ok === false) return null;
  const out = {};
  for (const k of DIM_KEYS) { if (!Object.prototype.hasOwnProperty.call(DIMS[k], b[k])) return null; out[k] = b[k]; }
  const n = Math.round(+b.n); if (!(n >= 30 && n <= 1e6)) return null; out.n = n;
  for (const k of MKEYS) { const v = +b[k]; out[k] = b[k] != null && b[k] !== '' && isFinite(v) ? Math.min(METRICS[k][1], Math.max(METRICS[k][0], Math.round(v * 100) / 100)) : null; }
  return out;
}
function sanitizeBenchCfg(b, prev) {
  const out = Object.assign({}, DEFAULTS, prev || {});
  if (!b || typeof b !== 'object') return out;
  for (const k of ['on', 'seeds']) if (typeof b[k] === 'boolean') out[k] = b[k];
  const int = (v, lo, hi, d) => { const n = Math.round(+v); return v !== '' && v != null && isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
  if (b.min !== undefined) out.min = int(b.min, 10, 1000, out.min); // never under 10: below that a group's deciles are nearly individual numbers
  if (b.splitAt !== undefined) out.splitAt = int(b.splitAt, 0, 100000, out.splitAt);
  return out;
}
// linear-interpolated quantile of a sorted array
const quant = (s, p) => { const i = (s.length - 1) * p, lo = Math.floor(i), hi = Math.ceil(i); return s[lo] + (s[hi] - s[lo]) * (i - lo); };
const r2 = v => Math.round(v * 100) / 100;
const keyOf = dims => { const ks = DIM_KEYS.filter(k => dims[k]); return ks.length ? ks.map(k => k + '=' + dims[k]).join('|') : 'all'; };
// every subset of the four dimensions, as arrays of keys ('all' first)
const SUBSETS = (() => { const out = []; for (let m = 0; m < 16; m++) out.push(DIM_KEYS.filter((_, i) => m & (1 << i))); return out.sort((a, b) => a.length - b.length); })();

// rows: sanitized summaries. -> { at, contributors, split, min, groups: { key: {dims, n, q: {metric: [deciles]}, top: {metric: median}} } }
function buildBenchmarks(rows, cfg, at) {
  cfg = Object.assign({}, DEFAULTS, cfg || {});
  rows = (rows || []).filter(Boolean);
  const split = rows.length >= cfg.splitAt;
  const subsets = split ? SUBSETS : SUBSETS.filter(s => !s.length || (s.length === 1 && s[0] === 'style'));
  const groups = {};
  for (const sub of subsets) {
    const by = new Map();
    for (const r of rows) { const dims = {}; for (const k of sub) dims[k] = r[k]; const key = keyOf(dims);
      if (!by.has(key)) by.set(key, { dims, rows: [] }); by.get(key).rows.push(r); }
    for (const [key, g] of by) {
      if (g.rows.length < cfg.min) continue;
      const q = {}, top = {};
      // the best quarter by profit factor: what the strongest traders in the group do differently
      const pfs = g.rows.filter(r => fin(r.pf)).map(r => r.pf).sort((a, b) => a - b);
      const cut = pfs.length >= 8 ? quant(pfs, 0.75) : null, best = cut == null ? [] : g.rows.filter(r => fin(r.pf) && r.pf >= cut);
      for (const k of MKEYS) {
        const vals = g.rows.map(r => r[k]).filter(fin).sort((a, b) => a - b);
        if (vals.length < cfg.min) continue; // a metric only some measure is shown only when enough do
        q[k] = DECILES.map(p => r2(quant(vals, p)));
        const tv = best.map(r => r[k]).filter(fin).sort((a, b) => a - b);
        if (tv.length >= 10) top[k] = r2(quant(tv, 0.5));
      }
      groups[key] = { dims: g.dims, n: g.rows.length, q, top };
    }
  }
  return { at: at || 0, contributors: rows.length, split, min: cfg.min, groups };
}
// The groups that contain a trader with these dimensions, broadest first.
function groupsFor(B, dims) {
  if (!B || !B.groups) return [];
  const out = [];
  for (const sub of SUBSETS) { if (sub.some(k => !dims || !dims[k])) continue;
    const d = {}; for (const k of sub) d[k] = dims[k]; const g = B.groups[keyOf(d)]; if (g) out.push(Object.assign({ key: keyOf(d) }, g)); }
  return out;
}

// ---- "Traders like you who improved": weekly history, and what changed for those who got better ----
// Each contributor's summary is snapshotted at most once a week (by the week of the summary itself,
// so a seed wallet re-read weekly gives one a week and an unchanged one gives none) and kept about
// 26 weeks, compactly: [week, disc, rev, jour, wr, pf, pay, fees, tw, hold, [slip day rates]] with
// trailing nulls dropped. Snapshots never leave the server; only group medians of their changes do.
const WEEK = 7 * 86400000, HIST_WEEKS = 26;
const HIST_KEYS = ['disc', 'rev', 'jour', 'wr', 'pf', 'pay', 'fees', 'tw', 'hold'];
// slip types read from a member's synced days (share of trading days with one); seeds have none.
// Revenge entries are already `rev`, so they aren't counted twice.
const HIST_SLIPS = ['afterTwo', 'sizeUp', 'addLoser', 'overtrade', 'heldLoser'];
const weekOf = ms => Math.floor(ms / WEEK);
const r1 = v => Math.round(v * 10) / 10;
// % of trading days with each slip over the 4 weeks up to `at`, from synced days [{k, f:[slips]}]; null under 5 days
function slipRates(days, at) {
  const to = new Date(at).toISOString().slice(0, 10), from = new Date(at - 27 * 86400000).toISOString().slice(0, 10);
  const ds = (Array.isArray(days) ? days : []).filter(d => d && typeof d.k === 'string' && d.k >= from && d.k <= to);
  if (ds.length < 5) return null;
  const out = {}; for (const k of HIST_SLIPS) out[k] = r1(100 * ds.filter(d => Array.isArray(d.f) && d.f.includes(k)).length / ds.length);
  return out;
}
function histSnap(sum, at, slips) {
  const a = [weekOf(at)]; for (const k of HIST_KEYS) a.push(sum && fin(sum[k]) ? sum[k] : null);
  if (slips) a.push(HIST_SLIPS.map(k => fin(slips[k]) ? slips[k] : null));
  while (a.length > 1 && a[a.length - 1] === null) a.pop();
  return a;
}
// a snapshot's value for a metric or a slip (null when it wasn't measured)
function histVal(s, k) {
  const i = HIST_KEYS.indexOf(k); if (i >= 0) return fin(s[i + 1]) ? s[i + 1] : null;
  const j = HIST_SLIPS.indexOf(k), sl = s[HIST_KEYS.length + 1]; return j >= 0 && Array.isArray(sl) && fin(sl[j]) ? sl[j] : null;
}
// keep only snapshots from the last HIST_WEEKS weeks
const histTrim = (list, curW) => (Array.isArray(list) ? list : []).filter(s => Array.isArray(s) && fin(s[0]) && s[0] > curW - HIST_WEEKS && s[0] <= curW);
// add a snapshot unless this week (or a later one) already has one -> {list, added}
function histPush(list, snap) {
  const L = Array.isArray(list) ? list : [], top = L.reduce((a, s) => Array.isArray(s) && fin(s[0]) ? Math.max(a, s[0]) : a, snap[0]);
  list = histTrim(L, top);
  const last = list[list.length - 1]; if (last && last[0] >= snap[0]) return { list, added: false };
  list.push(snap); return { list: histTrim(list, snap[0]), added: true };
}
// What's compared: how a change is measured (pct: % change; pts: percentage points; x: plain
// difference), the smallest change that counts, and how it reads.
const pc = d => { const a = Math.abs(d); return a >= 20 ? Math.round(a / 5) * 5 : Math.round(a); };
const pt = d => Math.max(1, Math.round(Math.abs(d)));
const IMP = {
  tw: { u: 'pct', floor: 10, label: 'Trades per week', up: d => `traded about ${pc(d)}% more often`, down: d => `cut trades per week by about ${pc(d)}%` },
  rev: { u: 'pts', floor: 2, label: 'Quick re-entries after a loss', stop: 'stopped re-entering within 15 minutes of a loss',
    up: d => `re-entered within 15 minutes of a loss more often (about ${pt(d)} more in every 100 trades)`, down: d => `re-entered within 15 minutes of a loss less often (about ${pt(d)} fewer in every 100 trades)` },
  hold: { u: 'pct', floor: 10, label: 'Holding time', up: d => `held their trades about ${pc(d)}% longer`, down: d => `closed their trades about ${pc(d)}% sooner` },
  jour: { u: 'pts', floor: 5, label: 'Journaling', up: d => `journaled about ${pt(d)} more of every 100 trades`, down: d => `journaled about ${pt(d)} fewer of every 100 trades` },
  fees: { u: 'pts', floor: 2, label: 'Fees', up: d => `gave about ${pt(d)} points more of their profit to fees`, down: d => `gave about ${pt(d)} points less of their profit to fees` },
  wr: { u: 'pts', floor: 2, label: 'Win rate', up: d => `raised their win rate by about ${pt(d)} points`, down: d => `lowered their win rate by about ${pt(d)} points` },
  pay: { u: 'x', floor: 0.1, label: 'Average win against average loss', up: () => 'made their winners bigger compared with their losers', down: () => 'let their winners shrink compared with their losers' },
};
const SLIP_SAY = { afterTwo: ['Trading on after two losses', 'trading on after two losses in a row', 'traded on after two losses in a row'],
  sizeUp: ['Sizing up after a loss', 'sizing up right after a loss', 'sized up right after a loss'],
  addLoser: ['Adding to losers', 'adding to losing positions', 'added to losing positions'],
  overtrade: ['Overtrading', 'trading more than their usual day', 'traded more than their usual day'],
  heldLoser: ['Holding losers too long', 'holding losers far longer than their winners', 'held losers far longer than their winners'] };
for (const k of HIST_SLIPS) { const [label, ing, past] = SLIP_SAY[k];
  IMP[k] = { u: 'pts', floor: 5, label, stop: 'stopped ' + ing, up: d => `${past} on about ${pt(d)} more of every 100 trading days`, down: d => `${past} on about ${pt(d)} fewer of every 100 trading days` }; }
const IMP_DEFAULTS = { from: 8, to: 12, fresh: 3, minSet: 5, effect: 0.3, max: 6 };
const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? quant(s, 0.5) : null; };
// The plain sentence for a change: what the improvers did, or, when they held steady while the
// others moved, that.
function impText(k, mi, mo, from, to) {
  const M = IMP[k], say = d => d > 0 ? M.up(d) : M.down(d);
  if (Math.abs(mi) < M.floor) return `${M.label} stayed about the same for them, while the others ${say(mo)}`;
  if (k === 'jour' && mi > 0 && from > 0 && to / from >= 1.8) { const x = to / from; return `They journaled ${x < 3 ? r1(x) : Math.round(x)}× more`; }
  if (M.stop && mi < 0 && to != null && to <= 1) return 'They ' + M.stop;
  return 'They ' + say(mi);
}
// a contributor's (baseline, latest) pair: the latest snapshot from the last `fresh` weeks, and the
// latest one `from`–`to` weeks before it
function histPair(list, curW, o) {
  o = Object.assign({}, IMP_DEFAULTS, o || {});
  const L = Array.isArray(list) ? list : [], b = L[L.length - 1];
  if (!b || b[0] < curW - o.fresh) return null;
  let a = null; for (const s of L) if (s[0] <= b[0] - o.from && s[0] >= b[0] - o.to) a = s;
  return a ? [a, b] : null;
}
const delta = (u, a, b) => a == null || b == null ? null : u === 'pct' ? (a > 0 ? Math.max(-100, Math.min(500, 100 * (b - a) / a)) : null) : b - a;
// entries: [{dims, hist}] (current dims; history as kept above). For every peer group: who was
// followed for 8–12 weeks (the panel), who moved from the panel's bottom half to its top half on
// Discipline or on profit factor (the improvers), and the medians of what changed for them against
// everyone else, ranked by effect size (difference of medians over the spread of all changes).
// Nothing is reported for a panel under `min`, and a change only when both sides have 5 or more.
function buildImprovers(entries, B, cfg, at, opts) {
  cfg = Object.assign({}, DEFAULTS, cfg || {}); const o = Object.assign({}, IMP_DEFAULTS, opts || {}), curW = weekOf(at || 0);
  const P = []; for (const e of entries || []) { const p = e && histPair(e.hist, curW, o); if (p) P.push({ dims: e.dims || {}, a: p[0], b: p[1] }); }
  const out = {};
  for (const [key, g] of Object.entries((B && B.groups) || {})) {
    const panel = P.filter(p => DIM_KEYS.every(k => !g.dims[k] || p.dims[k] === g.dims[k]));
    const r = out[key] = { panel: panel.length, n: 0, nOthers: 0, changes: [] };
    if (panel.length < cfg.min) { r.why = 'history'; continue; }
    const up = new Set();
    for (const k of ['disc', 'pf']) {
      const has = panel.filter(p => histVal(p.a, k) != null && histVal(p.b, k) != null); if (has.length < cfg.min) continue;
      const ma = median(has.map(p => histVal(p.a, k))), mb = median(has.map(p => histVal(p.b, k)));
      for (const p of has) if (histVal(p.a, k) < ma && histVal(p.b, k) > mb) up.add(p);
    }
    const imp = panel.filter(p => up.has(p)), oth = panel.filter(p => !up.has(p));
    r.n = imp.length; r.nOthers = oth.length;
    if (imp.length < o.minSet || oth.length < o.minSet) { r.why = 'few'; continue; }
    for (const [k, M] of Object.entries(IMP)) {
      const dl = set => set.map(p => delta(M.u, histVal(p.a, k), histVal(p.b, k))).filter(fin);
      const dI = dl(imp), dO = dl(oth); if (dI.length < o.minSet || dO.length < o.minSet) continue;
      const mi = median(dI), mo = median(dO), all = [...dI, ...dO].sort((a, b) => a - b);
      const eff = (mi - mo) / Math.max(quant(all, 0.75) - quant(all, 0.25), M.floor);
      if (Math.abs(eff) < o.effect || Math.abs(mi - mo) < M.floor) continue;
      const vals = w => imp.map(p => histVal(p[w], k)).filter(fin), from = median(vals('a')), to = median(vals('b'));
      const rd = v => v == null ? null : M.u === 'x' ? r2(v) : r1(v);
      r.changes.push({ metric: k, label: M.label, unit: M.u, improversDelta: rd(mi), othersDelta: rd(mo), from: rd(from), to: rd(to),
        n: dI.length, nOthers: dO.length, effect: r2(eff), text: impText(k, mi, mo, from, to) });
    }
    r.changes.sort((a, b) => Math.abs(b.effect) - Math.abs(a.effect)); r.changes = r.changes.slice(0, o.max);
  }
  return out;
}

module.exports = { DIMS, DIM_KEYS, METRICS, DECILES, DEFAULTS, sanitizeBench, sanitizeBenchCfg, buildBenchmarks, groupsFor, keyOf,
  WEEK, HIST_WEEKS, HIST_KEYS, HIST_SLIPS, IMP, IMP_DEFAULTS, weekOf, slipRates, histSnap, histVal, histTrim, histPush, histPair, impText, buildImprovers };
