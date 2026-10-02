# HTTP API reference

Every route the companion server answers, grouped by purpose. A running server also
describes `/api/v1` itself: `GET /api/v1` (no auth) returns a machine-readable index
with each endpoint, its auth level and its parameters.

- [Authentication](#authentication)
- [Pages and assets](#pages-and-assets)
- [Health](#health)
- [Journal persistence](#journal-persistence)
- [Backups](#backups)
- [Analytics API v1](#analytics-api-v1)
- [Coach and sharing](#coach-and-sharing)
- [Exchange relay](#exchange-relay)
- [Wearables](#wearables)
- [Social (Daruma)](#social-daruma)
- [Errors and limits](#errors-and-limits)

## Authentication

| Credential | Header | Opens |
|---|---|---|
| Owner token | `Authorization: Bearer $AUTH_TOKEN` | Everything below. |
| Read token | `Authorization: Bearer $READ_TOKEN` | `GET /api/v1/*` only. |
| Member device key | `X-Pulse-Key: <key>` | A member's own `/api/social/*` routes, the coach chat, the exchange relay, wearables. |
| Admin session | member key with admin rights, plus the 2FA cookie when `ADMIN_2FA` asks | `/api/social/admin/*`. |

When `AUTH_TOKEN` is **not** set, owner routes are open to anyone and the admin API
refuses everything. Wrong tokens are delayed 300 ms each, and `AUTH_FAIL_MAX` wrong
tokens from one address in 10 minutes lock it out (429 with `Retry-After`) for
`AUTH_LOCK_MIN` minutes.

## Pages and assets

No auth (they hold no user data).

| Route | Serves |
|---|---|
| `GET /`, `/index.html`, `/ledger.html` | The full journal. With `HOME_VIEW=daruma`, `/` redirects to `/daruma`. |
| `GET /daruma` (`/keel`, `/pulse`) | Daruma, the simple view. |
| `GET /admin` | The admin panel (`admin.html`). |
| `GET /b/<name>` | A member's public badge page, if they switched it on. |
| `GET /help`, `/docs` | User guide (`help.html`) and technical reference (`tech.html`). |
| `GET /app/<file>.js?v=<hash>`, `/app/fonts/<file>` | App scripts and fonts; cached for a year when the hash matches. |
| `GET /sw.js`, `/manifest.webmanifest`, `/pulse.webmanifest`, icons | PWA assets. |

## Health

| Route | Auth | Returns |
|---|---|---|
| `GET /api/health` | none | `{ok: true, auth: <AUTH_TOKEN set?>, appSyncCapable: <page has the sync client?>}` |
| `GET /api/version` | none | `{v: <current app version hash>}` |

Use `/api/health` for uptime monitors and as Railway's healthcheck path.

## Journal persistence

Owner token required.

| Route | Purpose |
|---|---|
| `GET /api/data` | `{rev, snapshot}`: the journal, wallets and settings (`snapshot` is `null` before the first save). |
| `PUT /api/data` | Body `{rev, snapshot}`. Returns `{rev: <new>}`. A stale `rev` returns **409** `{rev, snapshot}` with the server's state to merge. |
| `GET /api/snapshots` | Daily snapshots: `[{date, bytes, rev}]`, newest first (14 kept). |
| `GET /api/snapshots/YYYY-MM-DD` | One day's snapshot. |
| `GET/PUT/DELETE /api/att/<key>` | A trade's screenshot attachments (`key` = base64url trade id; 8 MB per trade, 512 MB total). |

```bash
curl -H "Authorization: Bearer $AUTH_TOKEN" https://your.app/api/data
```

## Backups

Owner token required.

| Route | Purpose |
|---|---|
| `POST /api/backup` | Store a full app backup ("Backup to server"); gzipped in `DATA_DIR/backups/`, newest 10 kept, and mirrored off-site when configured. |
| `GET /api/backups` | List stored backups. |
| `GET /api/backups/<name>` | Download one (`backup-….json.gz`). |
| `POST /api/offsite/run` | Ship an encrypted `DATA_DIR` bundle off-site now. 409 if off-site is off or an upload is running. |

## Analytics API v1

Read-only views over the trades the server reconstructs from its own caches, computed
by the app's own functions. `GET` accepts the owner or read token; `POST`/`DELETE` and
`?live=1` need the owner token.

### Feeding it

```
POST /api/v1/refresh     body: {wallets?: [addr], full?: bool, force?: bool}
```

Fetches fills (incrementally), funding, positions (HIP-3 included), spot balances and
portfolio from Hyperliquid for the given wallets (default: the ones saved in the app).
One refresh at a time, at most every 15 s unless `force`. With `REFRESH_INTERVAL_MIN`
set, the server does this on its own.

### Endpoints

| Route | Returns |
|---|---|
| `GET /api/v1` | The endpoint index (no auth). |
| `GET /api/v1/meta` | Data revision, per-wallet cache freshness, engine status, trade counts, refresh failures, disk free/total, off-site status. |
| `GET /api/v1/trades` | Filtered trades with journal fields and R. Also `sort`, `order`, `limit` (≤ 1000), `offset`, `events=1`. |
| `GET /api/v1/trades/:id` | One trade with fill events and its journal entry. |
| `GET /api/v1/stats` | `computeStats` over the filtered set, plus the 1R basis used. |
| `GET /api/v1/equity` | Cumulative equity, daily series, drawdown diagnostics. |
| `GET /api/v1/calendar` | Net P&L per calendar day. |
| `GET /api/v1/breakdown` | Grouped stats: `by=coin\|dir\|market\|wallet\|tag\|dow\|hour`, `basis=usd\|pct`, `top=N` (default 5). |
| `GET /api/v1/projection` | Monte Carlo fan: `horizon` (days, default 90), `paths` (≤ 2000, default 400), `block`, `seed`, `lookback`. |
| `GET /api/v1/kelly` | Kelly sizing (`null` under 10 decisive trades). |
| `GET /api/v1/walkforward` | Rolling walk-forward expectancy vs in-sample: `train`, `step`, `seed`. |
| `GET /api/v1/capital` | Deposits/withdrawals/transfers, time-weighted return on capital, XIRR. Account-wide; ignores filters; optional `wallet`. |
| `GET /api/v1/risk` | Open-position risk: liquidation distances, concentration, danger list. |
| `GET /api/v1/positions` | Cached positions, spot and account snapshot. `?live=1` refetches (owner token). |
| `GET /api/v1/spot/lots` | FIFO 8949-style spot lots; optional `wallet`. |
| `GET /api/v1/whatif` | Counterfactual replay without trades matching `field`/`op`/`value` (`op`: `eq ne lt lte gt gte in`). |
| `GET /api/v1/digests`, `/api/v1/digests/YYYY-MM-DD` | Stored weekly digests. |
| `GET /api/v1/journal`, `/api/v1/journal/:id`, `/api/v1/tags` | Read-only journal views and tag counts. |
| `GET /api/v1/export/trades.csv` | CSV of the filtered trades. |
| `GET /api/v1/metrics` | Flat monitoring numbers; `?format=prom` for Prometheus text. |
| `GET /api/v1/cache/:addr` | One wallet's server caches (fills, funding, capital flows) as JSON, gzipped when accepted (owner token). New devices seed their browser caches from it. |
| `DELETE /api/v1/cache/:addr` | Evict one wallet's server caches (owner token). |

### Filters

Shared by trades, stats, equity, calendar, breakdown, projection, kelly, walkforward,
whatif and the CSV export:

| Param | Values |
|---|---|
| `market` | `perp`, `spot`, `combined` |
| `wallet` | `0x…` |
| `coin` | raw coin or resolved spot symbol |
| `dir` | `Long`, `Short`, `Spot` |
| `status` | `open`, `closed`, `all` |
| `outcome` | `win`, `loss`, `be` (uses the saved break-even band) |
| `tag` | a journal tag |
| `q` | substring of notes |
| `from`, `to` | ms or s epoch, ISO time, or `YYYY-MM-DD` (a whole day on the `tz` clock; `to` inclusive) |
| `tz` | `utc` or `local`. `local` is the **server's** zone; prefer `utc`. |

```bash
curl -H "Authorization: Bearer $READ_TOKEN" 'https://your.app/api/v1/stats?market=perp&from=2026-09-01'
curl -H "Authorization: Bearer $READ_TOKEN" 'https://your.app/api/v1/breakdown?by=tag'
curl -H "Authorization: Bearer $READ_TOKEN" 'https://your.app/api/v1/metrics?format=prom'
curl -H "Authorization: Bearer $AUTH_TOKEN" -X POST 'https://your.app/api/v1/refresh'
```

If the served page is missing a function the engine needs, analytics routes return
**503** naming it; persistence is unaffected.

## Coach and sharing

| Route | Auth | Purpose |
|---|---|---|
| `GET /api/coach/status` | owner | Whether the coach is on, its provider and model, and whether partner sharing is set up. |
| `GET/POST /api/coach/chat` | owner or member key | The Daruma coach chat, within the member's daily allowance (`COACH_AI=1`). |
| `GET/POST /api/coach/letter/<YYYY-Www>` | owner | Read or write the weekly AI letter. The posted `{facts}` pass a server-side allowlist first. |
| `POST /api/share` | owner | Post a text to `TELEGRAM_SHARE_CHAT_ID`. |

## Exchange relay

`POST /api/cex/relay` with `{venue, host, path, query, headers}`: forwards one
browser-signed, read-only `GET` to Bybit or Binance. Open to the owner token and to
members (`X-Pulse-Key`); a relay-only copy (`CEX_RELAY_ONLY=1`) accepts only callers
with `CEX_RELAY_SECRET`. Only the exchanges' own hosts and the read-only endpoints the
app uses are forwarded, with only the signing headers. Limited to
`CEX_RELAY_PER_MIN` per caller.

## Wearables

`/api/wear/*`, for the owner or a member:

| Route | Purpose |
|---|---|
| `GET /api/wear` | Connection status and stored days. |
| `POST /api/wear/<whoop\|oura>/start` | Begin OAuth; returns the provider's sign-in URL. |
| `GET /api/wear/<whoop\|oura>/callback` | OAuth redirect target (register this URL with the provider). |
| `POST /api/wear/sync` | Pull recent days now. |
| `POST /api/wear/apple/token` | Create the personal link an iPhone Shortcut posts to. |
| `POST /api/wear/apple?t=<token>` | The Shortcut's daily post (HRV, resting HR, sleep). |
| `DELETE /api/wear/<provider>` | Disconnect. |

## Social (Daruma)

`/api/social/*` is Daruma's social layer (`social.js`). Members authenticate with
`X-Pulse-Key`; the owner token and admins reach `/api/social/admin/*`. The routes are
used by the app and admin panel rather than meant as a public API, so they are
summarised by area; see `social.js` for exact shapes.

| Area | Path prefixes |
|---|---|
| Server config (public) | `config` |
| Joining and devices | `join`, `login`, `link`, `devices`, `passkey`, `claim` (Sign-In with Ethereum) |
| Profile and stats sync | `me`, `profile`, `stats`, `public`, `visit` |
| Encrypted journal sync | `vault` (ciphertext only; 6 MB each) |
| Leagues and boards | `league`, `leagues`, `leaderboard`, `competitions` |
| Feed and posts | `feed`, `posts`, `comments`, `kudos`, `follow`, `report`, `media` (images: WebP, JPEG, PNG) |
| People | `people`, `partners`, `mentor`, `notes`, `inbox` |
| Duels | `duels`, `pods` (group duels) |
| Trade reviews | `reviews` |
| Benchmarks | `bench` ("Traders like you") |
| Push | `push` (subscribe, preferences, test) |
| Admin | `admin/overview`, `admin/members`, `admin/wallets`, `admin/leagues`, `admin/competitions`, `admin/badges`, `admin/duels`, `admin/bench`, `admin/insights`, `admin/reports`, `admin/reviews`, `admin/events`, `admin/announce`, `admin/config`, `admin/log`, plus the 2FA routes |

## Errors and limits

All API errors are JSON: `{"error": "<plain-language message>"}`.

| Status | Meaning |
|---|---|
| 400 | Malformed body or parameter. |
| 401 | Missing or wrong credential (answered after 300 ms). |
| 403 | Authenticated but not allowed (suspended, feature off). |
| 404 | No such route or object. |
| 405 | Wrong method. |
| 409 | Stale revision (`/api/data`, vault) or a conflicting operation. |
| 413 | Body too large (25 MB general; smaller per route). |
| 415 | Unsupported image type. |
| 429 | Address locked out, or a per-member/day limit hit. |
| 503 | Analytics engine unavailable, or the admin 2FA store unreadable. |
| 507 | Server out of room for pictures or encrypted journals. |
