'use strict';
// "Traders like you": peer-group benchmarks built from anonymous summaries.
//
// Each contributor is one summary (see peerSummary in the app): four coarse dimensions — style,
// trade size, experience, activity — and a dozen numbers. Members send theirs from the app (on by
// default, off with one switch); seed wallets the owner adds are summarised on the server from
// their public fills. Once a day the summaries are grouped: a group exists for every combination
// of dimensions that holds at least `min` traders, and only its deciles leave the server, never a
// contributor's own numbers. Below `splitAt` contributors only "everyone" and "same style" groups
// are built, so a young server doesn't slice itself into empty groups. Pure functions; no I/O.

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
        if (tv.length >= 5) top[k] = r2(quant(tv, 0.5));
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

module.exports = { DIMS, DIM_KEYS, METRICS, DECILES, DEFAULTS, sanitizeBench, sanitizeBenchCfg, buildBenchmarks, groupsFor, keyOf };
