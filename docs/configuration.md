# Configuration reference

The server is configured only through **environment variables** (and one command-line
flag). Nothing is required to start it; `AUTH_TOKEN` and a persistent `DATA_DIR` are
required for any real deployment. Variables are read once at boot, so a change takes
effect on the next start (on Railway, saving a variable redeploys the service).

Grouped by what they control:

- [Core](#core)
- [Access and security](#access-and-security)
- [Scheduled refresh, alerts and digests](#scheduled-refresh-alerts-and-digests)
- [Telegram](#telegram)
- [Server health](#server-health)
- [Off-site backups](#off-site-backups)
- [AI coach](#ai-coach)
- [Web push](#web-push)
- [Wearables](#wearables)
- [Exchange relay (Bybit, Binance)](#exchange-relay-bybit-binance)
- [Set by the platform](#set-by-the-platform)
- [Command-line flags](#command-line-flags)
- [Minimal configurations](#minimal-configurations)

## Core

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `8080` | Port to listen on. Railway injects it. |
| `DATA_DIR` | `/data` if that directory exists, else `./data` | Where every persistent file lives. See [operations.md](operations.md#what-lives-in-data_dir). |
| `HOME_VIEW` | *(unset: the journal)* | `daruma` (or `keel`, its earlier name) makes `/` redirect to `/daruma`. The full journal stays at `/ledger.html`. |
| `TZ` | *(system, usually UTC)* | The process clock. Used for members whose app hasn't reported a time zone. |

## Access and security

| Variable | Default | Notes |
|---|---|---|
| `AUTH_TOKEN` | *(empty: everything open)* | The owner's bearer token. Opens everything: the journal (`/api/data`), backups, attachments, `/api/v1`, the admin panel. **Set it.** Without it the admin API refuses all requests and the rest of the API is open. |
| `READ_TOKEN` | *(unset)* | A second token that may only `GET /api/v1/*`. It still reads trades, P&L, journal notes, wallet addresses and positions. |
| `AUTH_FAIL_MAX` | `20` | Wrong tokens from one address within 10 minutes before it is locked out (HTTP 429) of every token-gated route. |
| `AUTH_LOCK_MIN` | `15` | Lockout length in minutes. |
| `CORS_ORIGIN` | *(unset)* | One exact origin allowed to call `/api/*` from a browser. |
| `PUBLIC_ORIGIN` | *(unset)* | The address people use, e.g. `https://pulse.example.com` (comma-separate several). Pins wallet sign-in messages, passkeys and OAuth redirects to that site. Not needed on Railway; set it when self-hosting. |
| `TRUST_PROXY` | on when on Railway, else off | Take the client address from the last `X-Forwarded-For` entry (for rate limits and lockouts). Only enable behind a proxy that sets that header. Values: `1`, `on`, `true`, `yes`. |
| `ADMIN_2FA` | `optional` | Second factor for `/api/social/admin/*`: `optional` (each person chooses), `required` (everyone must), `off`. Unknown values count as `required`. |
| `ADMIN_2FA_RESET` | *(unset)* | Set to any value, restart, then remove: clears the owner's admin second factors and ends every admin session. Each distinct value resets once. |

## Scheduled refresh, alerts and digests

| Variable | Default | Notes |
|---|---|---|
| `REFRESH_INTERVAL_MIN` | *(unset: off)* | Refresh server caches from Hyperliquid every N minutes (first run ~30 s after boot). Drives alerts, weekly digests, the nudge and health checks. |
| `ALERT_WEBHOOK` | *(unset)* | Discord, Slack, ntfy or generic JSON endpoint for alerts and digests. |
| `ALERT_LIQ_PCT` | `10` | Alert when a position is within this % of liquidation. |
| `ALERT_DAILY_LOSS` | *(the app's saved rule)* | Daily-loss alert threshold in $. |
| `ALERT_FUNDING_24H` | *(unset: off)* | Alert when funding paid per 24 h exceeds this many $. |
| `NUDGE_HOUR` | *(unset: off)* | End-of-day journaling nudge after this hour (0–23), in the app's time zone. Needs `REFRESH_INTERVAL_MIN` and a delivery channel. |
| `NUDGE_TZ` | `UTC` | Fallback IANA zone for the nudge until the app reports its own. |

## Telegram

| Variable | Default | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | *(unset)* | Bot token from @BotFather. Delivers alerts and digests, and answers `/today`, `/risk`, `/stats`, `/goals`, `/digest` (read-only). |
| `TELEGRAM_CHAT_ID` | *(unset)* | Comma-separated allowlist of chat ids. Other chats are ignored. |
| `TELEGRAM_SHARE_CHAT_ID` | *(unset)* | Chat(s) for Review → Progress → "Send to partner". |

## Server health

Needs `REFRESH_INTERVAL_MIN` and a delivery channel. Health alerts repeat at most once a day.

| Variable | Default | Notes |
|---|---|---|
| `HEALTH_FAIL_RUNS` | `3` | Report after this many failed scheduled refreshes in a row (and again on recovery). `0` = off. |
| `HEALTH_DISK_PCT` | `90` | Report when the data volume is this % full. `0` = off. |
| `HEALTH_DISK_MIN_MB` | `100` | … or has less than this many MB free. `0` = off. |

## Off-site backups

On only when the first five are all set; a partial set logs a warning and stays off.

| Variable | Default | Notes |
|---|---|---|
| `OFFSITE_ENDPOINT` | *(unset)* | S3-compatible endpoint: R2 `https://<account>.r2.cloudflarestorage.com`, AWS `https://s3.<region>.amazonaws.com`, B2 `https://s3.<region>.backblazeb2.com`, MinIO… |
| `OFFSITE_BUCKET` | *(unset)* | Bucket name (path-style addressing; create it first). |
| `OFFSITE_ACCESS_KEY_ID` | *(unset)* | Key with put/get/list/delete on that bucket only. |
| `OFFSITE_SECRET_ACCESS_KEY` | *(unset)* | Its secret. |
| `OFFSITE_KEY` | *(unset)* | Encryption passphrase (AES-256-GCM). **Lose it and the backups are unreadable.** |
| `OFFSITE_REGION` | `auto` for R2, else `us-east-1` | Signing region. |
| `OFFSITE_PREFIX` | `ledger/` | Key prefix inside the bucket. |
| `OFFSITE_KEEP` | `30` | Newest N kept of each kind (backups, data bundles). |
| `OFFSITE_EVERY_H` | `24` | Hours between full `DATA_DIR` bundles. |
| `OFFSITE_MAX_MB` | `256` | Bundle size cap; attachments are dropped first, then fill caches. The journal always ships. |

## AI coach

| Variable | Default | Notes |
|---|---|---|
| `COACH_AI` | *(unset: off)* | `1` enables the weekly AI letter (Review) and the coach chat (Daruma). |
| `COACH_AI_PROVIDER` | `anthropic` (`openai` for a `gpt-…` model) | `anthropic` or `openai`. |
| `ANTHROPIC_API_KEY` | *(unset)* | Read only when the provider is Anthropic. Uses the optional `@anthropic-ai/sdk` package. |
| `OPENAI_API_KEY` | *(unset)* | Read only when the provider is OpenAI. No package needed. |
| `COACH_AI_MODEL` | `claude-opus-5-5`, or `gpt-5.6-luna` with OpenAI | Model for both the letter and the chat. |
| `COACH_AI_EFFORT` | `low` for chat, `medium` for letters | OpenAI reasoning effort; `none` sends no setting. |
| `OPENAI_BASE_URL` | `https://api.openai.com/v1` | Compatible endpoint (Azure OpenAI, Bedrock's `/openai/v1`). |

## Web push

| Variable | Default | Notes |
|---|---|---|
| `PUSH` | on | `0` switches web push reminders off. Keys are generated once in `DATA_DIR/vapid.json`. |
| `PUSH_SUBJECT` | `mailto:pulse@localhost` | Your real `mailto:` or `https://` contact for browsers' push services. |

## Wearables

| Variable | Default | Notes |
|---|---|---|
| `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` | *(unset)* | WHOOP OAuth app (developer.whoop.com). Redirect URL: `<origin>/api/wear/whoop/callback`. |
| `OURA_CLIENT_ID` / `OURA_CLIENT_SECRET` | *(unset)* | Oura OAuth app (cloud.ouraring.com). Redirect URL: `<origin>/api/wear/oura/callback`. |

## Exchange relay (Bybit, Binance)

| Variable | Default | Notes |
|---|---|---|
| `CEX_RELAY_URL` | *(unset)* | Forward Bybit/Binance requests to a relay copy of this server instead of calling the exchange from here. |
| `CEX_RELAY_URL_BYBIT` / `CEX_RELAY_URL_BINANCE` | *(unset)* | Per-exchange relay (wins over `CEX_RELAY_URL`). |
| `CEX_RELAY_SECRET` | *(unset)* | Shared secret between the main server and the relay copy. |
| `CEX_RELAY_ONLY` | off | `1` on the relay copy: it then serves only `/api/health` and the relay, and only to callers with the secret. |
| `CEX_RELAY_PER_MIN` | `1200` | Relayed requests per caller per minute (minimum 10). |
| `BYBIT_API_HOST` | `api.bybit.com` | Alternative Bybit API host (e.g. a regional entity's). |

## Set by the platform

You don't set these; the server reads them.

| Variable | Used for |
|---|---|
| `RAILWAY_ENVIRONMENT` / `RAILWAY_ENVIRONMENT_NAME` | Detecting Railway: trusts the `Host` header (no `PUBLIC_ORIGIN` needed) and turns `TRUST_PROXY` on. |
| `RAILPACK_NODE_VERSION` | *(build-time, optional)* Forces Railway's builder to a Node version if `engines` isn't honored. |

## Command-line flags

```bash
node server.js                    # start the server
node server.js --reset-admin-2fa  # clear the owner's admin second factors, end admin sessions, exit
node offsite.js list              # list off-site objects (needs the OFFSITE_* variables)
node offsite.js restore <key> <dir>
node offsite.js get <key> <file>
```

## Minimal configurations

**Personal journal on Railway**

```
AUTH_TOKEN=<long random>
# + a volume mounted at /data
```

**Journal with monitoring**

```
AUTH_TOKEN=<long random>
REFRESH_INTERVAL_MIN=30
TELEGRAM_BOT_TOKEN=<from @BotFather>
TELEGRAM_CHAT_ID=<your chat id>
NUDGE_HOUR=18
OFFSITE_ENDPOINT=… OFFSITE_BUCKET=… OFFSITE_ACCESS_KEY_ID=… OFFSITE_SECRET_ACCESS_KEY=… OFFSITE_KEY=…
```

**A Daruma league for a group**

```
AUTH_TOKEN=<long random>
HOME_VIEW=daruma
REFRESH_INTERVAL_MIN=30
PUSH_SUBJECT=mailto:you@example.com
ADMIN_2FA=required
COACH_AI=1
ANTHROPIC_API_KEY=<key>
OFFSITE_…  (as above)
```
