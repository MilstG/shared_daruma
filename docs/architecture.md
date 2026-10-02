# Architecture

How the repository is put together: what runs in the browser, what runs on the
server, how they talk, and the few rules that keep it working. For the in-app
technical reference (reconstruction math, the sync protocol in detail, the journal
data model) open `/docs` on a running server, which serves [`tech.html`](../tech.html).

- [The big picture](#the-big-picture)
- [Repository layout](#repository-layout)
- [The client](#the-client)
- [The server](#the-server)
- [The social layer (Daruma)](#the-social-layer-daruma)
- [Data flow](#data-flow)
- [Identity and trust](#identity-and-trust)
- [Design rules](#design-rules)

## The big picture

Ledger is a **client-side trading journal** for Hyperliquid (plus Lighter, Bybit and
Binance) with an optional **companion server**. Daruma is a phone-first, gamified view
of the same app with a social layer (leagues, duels, mentors) that runs on that server.

```
┌──────────────────────────── browser ────────────────────────────┐
│ ledger.html + app/*.js  (no build step, no framework)           │
│  • fetches fills/funding/positions straight from the exchanges  │
│  • reconstructs trades, runs all statistics, mining, excursions │
│  • stores caches in IndexedDB, journal in local storage         │
│  • the same page is the full journal (/) and Daruma (/daruma)   │
└───────────────┬─────────────────────────────────────────────────┘
                │ HTTPS: /api/data sync, /api/social, /api/v1 …
┌───────────────▼──────────── server.js (Node ≥ 22.13) ───────────┐
│ serves the app · persists the owner's journal (one JSON blob)   │
│ read-only analytics API built from the app's own functions      │
│ scheduled refresh, alerts, digests, Telegram bot, web push      │
│ social layer (social.js + SQLite) · admin panel · backups       │
└───────────────┬─────────────────────────────────────────────────┘
                │ files
          DATA_DIR (/data volume on Railway)
```

Two principles run through everything:

1. **The browser does the work.** The app is fully usable from `file://` with no
   server at all. The server adds persistence, multi-device sync, automation and the
   social features, never a second copy of the analytics.
2. **One source of truth for the code.** The server's analytics engine and the test
   suites both *extract functions from the shipped app source* instead of
   re-implementing them. Change the app's math and the API and tests follow.

## Repository layout

| Path | What it is |
|---|---|
| `ledger.html` | The page: markup, styles, a few small inline bootstraps (theme before first paint, install metadata, the Daruma switch). Loads its code from `app/`. |
| `app/` | The app's code as ordinary scripts sharing one global scope (load order below). Also `app/fonts/` (self-hosted WOFF2) and `app/chart.umd.js` (vendored Chart.js). |
| `app/features/` | Newer features, one file each (`trader-age.js` first), plugged into Daruma via `pzFeature`. |
| `app-source.js` | Returns `ledger.html` with every `app/` script inlined in order. Used by the server's engine and the tests so they read exactly what ships. |
| `server.js` | The companion server: HTTP routing, persistence, `/api/v1`, scheduled jobs, alerts, Telegram, coach, page and asset serving. Exports `createApp(opts)`. |
| `social.js` | Daruma's social layer: members, leagues, competitions, feed, posts, duels, mentors, reviews, the admin API (`/api/social/*`). |
| `social-config.js` | The admin panel's settings, their defaults and sanitizers (levels, XP, features, coach, routines). |
| `db.js` | SQLite storage for the social layer (`DATA_DIR/pulse.db`) via `node:sqlite`, with numbered schema migrations and the one-time `social.json` import. |
| `duels.js`, `bench.js`, `insights.js` | Duel scoring and ladder, "Traders like you" peer benchmarks, admin insights. |
| `webauthn.js` | Passkey (WebAuthn) verification, no dependencies. |
| `admin2fa.js`, `admin2fa-ui.js` | Admin panel second factor (passkeys, TOTP, recovery codes) and its UI. |
| `push.js` | Web push (VAPID, RFC 8291 encryption) with no dependencies. |
| `wear.js` | Readiness from WHOOP and Oura (OAuth) and Apple Health (Shortcut). |
| `offsite.js` | Encrypted off-site backups to S3-compatible storage (SigV4 signing included) and the restore CLI. |
| `cex-relay.js` | Forwards browser-signed, read-only Bybit/Binance requests. |
| `vendor/eth-sig.js` | Bundled signature recovery (noble libraries) for Sign-In with Ethereum wallet claims. |
| `admin.html` | The owner/admin panel, served at `/admin`. |
| `badges.html` | A member's public badge page, served at `/b/<name>`. |
| `help.html`, `tech.html` | Built-in user guide (`/help`) and technical reference (`/docs`). |
| `icons/` | PWA icons for the journal and Daruma. |
| `tests/` | Offline test suites (`npm test`) plus fixtures (`eth-vectors.json`, `s3-sigv4-vectors.json`, a soft authenticator). |
| `e2e/run.mjs` | Browser smoke tests with Playwright against the real server. |
| `railway.json` | Railway deploy config (start command and restart policy). |
| `AUDIT*.md` | Past audit notes. |

## The client

### Load order

`ledger.html` loads these as classic `<script>` tags, in this order:

```
app/chart.umd.js        (journal page only)
app/core.js             storage, server sync, exchange API client
app/venues.js           Lighter, Bybit, Binance
app/engine.js           trade reconstruction and analytics
app/dashboard.js
app/diagnostic.js
app/excursions.js       MAE/MFE from candles
app/journal.js
app/data-io.js          imports, exports, backups
app/tools.js
app/habits-coach.js
app/progress.js         XP, streaks, badges, tilt alerts
app/pulse.js            Daruma shell, pzFeature
app/pulse-social.js     Daruma social screens
app/pulse-screens.js
app/reviews.js          mentor trade reviews
app/plans.js            plan vs outcome
app/features/trader-age.js
app/boot.js             runs last
```

All parts share one global scope. **The one rule:** code that runs *while a part
loads* (top-level code, as opposed to code inside a function called later) may only
use names declared in that part or an earlier one. `boot.js` runs last and starts the
app. The browser smoke tests catch violations because every part loads on every page.

A script tag may carry `data-only="journal"` or `data-only="keel"`; the server then
leaves it out of the other screen's page (Daruma never draws Chart.js charts, so it
doesn't download it). Opened from disk, every script loads.

### One page, two apps

The same `ledger.html` is the full journal (`/`, `/ledger.html`) and Daruma
(`/daruma`; `/keel` and `/pulse` are older names that still work). An inline script
switches to the Daruma view by path (or `?daruma` from disk). Each has its own web
manifest and icons, so they install as two separate apps. Internally Daruma's code
keeps its earlier names: the `pz` prefix, `app/pulse*.js`, the `X-Pulse-Key` header,
`pulse.db`, and `keel` as the screen name.

### Runtime

- **Boot** (`boot.js`): asks for persistent storage, runs `initServerSync()` first
  (so a server snapshot is applied before local reads), then hydrates the journal,
  settings and saved excursion measurements, then renders.
- **Heavy compute** (reconstruction, the permutation miner) runs in a **Web Worker**
  built at runtime from a Blob of the app's own function sources, with a synchronous
  fallback. There is no separate worker file.
- **Caches**: fills, funding, capital flows and candles live in IndexedDB, gzip-
  compressed where `CompressionStream` exists, refreshed incrementally by watermark.
- **Network**: the page's CSP allows `api.hyperliquid.xyz`, Lighter's API and the
  page's own origin only. Bybit and Binance go through the server's relay.
- **Offline**: the server serves a small service worker (`/sw.js`) that caches the
  app shell network-first, so a deploy shows on the next open and the app still opens
  offline. API calls are never intercepted.

## The server

`server.js` has **no required npm dependencies**: `http`, `fs`, `crypto`, `zlib`, `vm`
and `node:sqlite` only. The single optional package, `@anthropic-ai/sdk`, is loaded
only when `COACH_AI=1` with the Anthropic provider.

### Structure

- `createApp(opts)` builds an `http.Server`. Every external dependency (data dir,
  tokens, `fetch`, clock, push, timers) can be injected through `opts`, which is how
  the tests run it on a temp directory with a mocked exchange.
- Run directly (`node server.js`), it reads the environment, logs warnings for
  missing `AUTH_TOKEN`, missing `/data` volume, an old `ledger.html` or a disabled
  engine, listens on `PORT`, and handles `SIGTERM`/`SIGINT` by closing the server and
  exiting 0 (with a 3-second backstop).
- A throw inside a request handler answers 500 for that request only; unhandled
  promise rejections are logged, not fatal.

### Serving the app

- The page is assembled per screen (journal or Daruma), gzipped once, and served
  with an `ETag` (304 when unchanged), `X-Frame-Options: DENY` and
  `frame-ancestors 'none'`.
- `app/*.js` and `app/fonts/*` are referenced with a content hash (`?v=…`). Requests
  with the current hash get `Cache-Control: immutable` for a year; a deploy changes
  the hash, so browsers pick it up at once.
- `/help`, `/docs`, `/admin`, `/b/<name>`, manifests, icons and `/sw.js` are static
  or generated inline.

### Persistence of the owner's journal

The owner's journal, wallets and settings are **one JSON blob** in
`DATA_DIR/ledger-data.json`, with a revision number:

- `GET /api/data` → `{rev, snapshot}`; `PUT /api/data {rev, snapshot}` → `{rev}`.
- A write with a stale `rev` gets **409** with the current state; the client merges
  its unsynced edits (per journal entry and per settings field) on top and retries.
- Writes are atomic (`.tmp` + rename). The previous file is kept as `.bak`, and one
  copy per UTC day goes to `snapshots/` (14 kept).
- A damaged file falls back to `.bak`; with no readable backup the journal API
  refuses reads and writes rather than letting the next save overwrite it.

### The analytics engine (`/api/v1`)

At boot the server reads the app through `app-source.js`, extracts a fixed list of
pure functions by name (`ENGINE_FNS` in `server.js`: `reconstructTrades`,
`computeStats`, `projectForward`, `traderAge`, the Hyperliquid client…), and
evaluates them in an isolated `node:vm` context with a few one-line shims
(`ENGINE_SHIMS`). If any name is missing, the engine is disabled and `/api/v1`
analytics return 503 naming what's missing, while the app and persistence keep
working.

The engine computes from server-side caches (`fills/`, `funding/`, `market.json`)
filled by `POST /api/v1/refresh` or the scheduled refresh. The same engine verifies
Daruma members' Discipline and Trader Age from their public fills, scores tilt alerts
for push, and builds seed-wallet benchmarks.

### Background jobs

| Job | When | What |
|---|---|---|
| Social tick | every minute | Duel results and expiries, seed-wallet re-reads, push reminders on each member's clock. |
| Scheduled refresh | every `REFRESH_INTERVAL_MIN` (first ~30 s after boot) | Refresh caches, run alerts, the weekly digest (first run of each ISO week), the end-of-day nudge, health checks. |
| Off-site | hourly check, ships every `OFFSITE_EVERY_H` (first check after 2 min) | Encrypted `DATA_DIR` bundle to the bucket. |
| Telegram | long polling, when configured | Answers the read-only bot commands. |

All timers are `unref`'d, so they never keep the process alive on their own.

### Security mechanics

- Bearer tokens compared in constant time. Every 401 is delayed 300 ms.
- Per-address lockout after `AUTH_FAIL_MAX` wrong tokens in 10 minutes.
- `TRUST_PROXY` (automatic on Railway) reads the client address from the last
  `X-Forwarded-For` entry for those limits.
- CORS only for one exact `CORS_ORIGIN`, off by default.
- Uploaded images are sniffed by magic bytes (WebP, JPEG, PNG only, never SVG/HTML).
- Size caps everywhere: 25 MB request bodies, 8 MB attachments per trade and 512 MB
  in all, 2 GB of pictures, 6 MB per encrypted journal and 1 GB in all.

## The social layer (Daruma)

`social.js` owns `/api/social/*`. State lives in SQLite (`DATA_DIR/pulse.db`):
members and settings are cached in memory for fast leaderboards and written back row
by row; the feed, kudos, posts, comments, reports, reviews and media index are read
with indexed queries. `db.js` applies numbered migrations and records progress in
`PRAGMA user_version`, so upgrades migrate themselves at boot. Pictures are files in
`DATA_DIR/media/`; members' end-to-end encrypted journals are ciphertext files in
`DATA_DIR/vault/`.

Process numbers (XP, streaks, scores) are computed by each member's browser and are
self-reported. Anything that must be trusted is recomputed by the server from public
on-chain data: verified Discipline, Trader Age, returns, and the "On chain" mark on
posted trades. **Claimed** wallets (signed with Sign-In with Ethereum) stop anyone from
borrowing a well-known trader's numbers.

## Data flow

**Loading trades (browser):** wallet address → exchange API (paginated fills,
funding, ledger, positions) → IndexedDB cache → `reconstructTrades` → stats, charts,
journal.

**Syncing the owner's journal:** edit → debounced save (~0.8 s) → `PUT /api/data`
with the current `rev` → new `rev`, or 409 → merge → retry. On the next start, edits
that never reached the server are sent first if no other device has saved since.

**A Daruma member:** creates a profile → gets a random device key (only its hash is
stored) → syncs process stats to `/api/social/stats` → the server reads their public
fills (if they share a wallet) to verify → leaderboards, duels, feed.

**Analytics API:** `POST /api/v1/refresh` (or the timer) → Hyperliquid → server
caches → `GET /api/v1/*` computes with the extracted app functions.

## Identity and trust

| Who | How they authenticate | What they can do |
|---|---|---|
| Owner | `Authorization: Bearer <AUTH_TOKEN>` | Everything. Plus an admin second factor for `/api/social/admin/*` when `ADMIN_2FA` asks. |
| Script / dashboard | `Bearer <READ_TOKEN>` | `GET /api/v1/*` only. |
| Admin | Member device key with the admin flag (+ second factor) | The admin panel, except managing other admins. Never the owner's journal or backups. |
| Member | `X-Pulse-Key: <device key>` | Their own profile, social features, encrypted vault, coach within allowance, the exchange relay. Devices added by wallet signature, passkey or one-time code. |
| Visitor | nothing | The app in their own browser; their data never touches the server. |

## Design rules

These keep the project simple to run and hard to break. Respect them in changes:

- **No build step.** Edit a file, reload. No bundler, transpiler or framework.
- **No required dependencies** on the server. Anything new uses Node built-ins.
- **No second copy of app logic.** If the server or tests need a function, add it to
  `ENGINE_FNS` / extract it; don't re-implement.
- **Load order** in `app/` (see above).
- **New features go in `app/features/<name>.js`**, with their own test suite and size
  budget (`tests/test-budget.mjs`).
- **Every persistent file lives under `DATA_DIR`.**
- **Never trust the browser for money numbers**; read them from chain data.
