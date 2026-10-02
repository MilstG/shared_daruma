# Deploying on Railway, step by step

This guide takes you from a fresh Railway account to a running, persistent Ledger +
Daruma server, then covers the optional features, updates, backups and the problems
people actually hit. It is the long version of [`README-deploy.md`](../README-deploy.md).

- [What you are deploying](#what-you-are-deploying)
- [Before you start](#before-you-start)
- [Step 1: Create the service from GitHub](#step-1-create-the-service-from-github)
- [Step 2: Check the build](#step-2-check-the-build)
- [Step 3: Attach a volume at /data](#step-3-attach-a-volume-at-data)
- [Step 4: Set AUTH_TOKEN](#step-4-set-auth_token)
- [Step 5: Give it a public address](#step-5-give-it-a-public-address)
- [Step 6: Verify the deployment](#step-6-verify-the-deployment)
- [Step 7: Turn on what you need](#step-7-turn-on-what-you-need)
- [Deploying from the CLI instead](#deploying-from-the-cli-instead)
- [Day 2: updates, rollbacks, backups](#day-2-updates-rollbacks-backups)
- [Settings to leave alone](#settings-to-leave-alone)
- [Troubleshooting](#troubleshooting)
- [Security checklist](#security-checklist)

---

## What you are deploying

One Railway **service** running `node server.js`, with one **volume** mounted at
`/data`. That's all.

```
Browser (ledger.html + app/*.js)
   │  talks directly to api.hyperliquid.xyz / Lighter for market data and fills
   │
   ▼
Railway edge (HTTPS, your *.up.railway.app or custom domain)
   │
   ▼
Service: node server.js   ← zero required npm dependencies, Node ≥ 22.13
   │   serves the app, /daruma, /admin, /help, /docs
   │   stores the journal, runs /api/v1 analytics, the social layer, alerts…
   ▼
Volume mounted at /data   ← EVERYTHING persistent lives here
   ledger-data.json, pulse.db, backups/, snapshots/, media/, vault/, …
```

There is no build step, no database service to add, and no Redis. The social layer
uses SQLite through Node's built-in `node:sqlite`, stored on the same volume.

## Before you start

| You need | Why |
|---|---|
| A Railway account on a plan with volumes big enough for you | The free/trial volume is 0.5 GB; Hobby gives 5 GB, Pro 50 GB (Railway's current limits). A personal journal fits in 0.5 GB, but a Daruma league with picture uploads, seed wallets and fill caches wants Hobby or above. |
| This repository on GitHub (your fork or your own copy) | Railway deploys from it, and redeploys on every push. |
| A long random string for `AUTH_TOKEN` | `openssl rand -hex 24` or `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`. Store it in a password manager. |
| Optional: a domain you control | For a custom address instead of `*.up.railway.app`. |

Pick the **region** now if you plan to use Bybit or Binance: both refuse calls from
US IP addresses, and the caller is your server. See [Exchange regions](#exchange-apis-bybit-binance-and-region).

## Step 1: Create the service from GitHub

1. In Railway, **New Project → Deploy from GitHub repo**.
2. Authorize Railway on GitHub if asked, then pick this repository and the branch
   you deploy from (usually `main`).
3. Railway creates a project with one service and starts the first deploy straight
   away. That first deploy has no volume and no token yet; that's fine, nothing is
   stored until you use it. Do steps 3 and 4 before you open the app for real.

## Step 2: Check the build

Open the service → **Deployments** → the running deploy → **Build Logs**. You
should see Railway's builder (Railpack) detect a Node project:

- **Node version** comes from `"engines": { "node": ">=22.13" }` in `package.json`.
  22.13 is the first release with `node:sqlite` unflagged, which the social layer
  needs. If a build ever picks an older Node, set the service variable
  `RAILPACK_NODE_VERSION=22` (it takes priority over `engines`).
- **Install** runs npm against `package-lock.json`. The only package is the
  *optional* `@anthropic-ai/sdk`, used only when `COACH_AI=1` with Anthropic. If it
  fails to install, the server still runs.
- **Start command** is `node server.js`, set by [`railway.json`](../railway.json):

  ```json
  {
    "deploy": {
      "startCommand": "node server.js",
      "restartPolicyType": "ON_FAILURE",
      "restartPolicyMaxRetries": 3
    }
  }
  ```

  It is deliberately **not** `npm start`. Railway sends `SIGTERM` on every redeploy;
  with npm in between, npm exits non-zero (`npm error signal SIGTERM`) and Railway
  marks the deploy as crashed even though the server shut down cleanly. Running node
  directly lets `server.js` catch the signal, close its connections and exit 0.
  Settings in `railway.json` override the dashboard, so you don't have to set this
  anywhere else.

Then open **Deploy Logs**. On this first deploy you will see two warnings; the next
two steps clear them:

```
[ledger] WARNING: AUTH_TOKEN is not set — the persistence API is open to anyone with the URL.
[ledger] WARNING: no /data volume detected — data will NOT survive redeploys. Attach a Railway Volume at /data.
[ledger] analytics engine ready (… functions extracted from ledger.html)
[ledger] listening on :8080
```

## Step 3: Attach a volume at /data

**This is the persistence. Skip it and your journal disappears on the next deploy.**
Railway's container filesystem is rebuilt on every deploy; only a volume survives.

1. In the project canvas, right-click the service (or use **⌘K / Ctrl+K**) →
   **Attach volume** / **New Volume**, and attach it to this service.
2. Set the **mount path** to exactly **`/data`**.
3. Railway redeploys the service with the volume mounted.

`server.js` picks its data directory like this:

1. `DATA_DIR`, if you set it;
2. otherwise `/data`, if that directory exists (your volume);
3. otherwise `./data` next to `server.js` (ephemeral on Railway).

So with a volume at `/data` there's nothing more to configure. If you mount the
volume somewhere else, set `DATA_DIR` to that path.

What ends up on the volume is described in [Data and backups](operations.md#what-lives-in-data_dir).
Watch its size under the volume's **Metrics**; with `REFRESH_INTERVAL_MIN` set,
the server also alerts you when it is 90% full (`HEALTH_DISK_PCT`).

## Step 4: Set AUTH_TOKEN

Service → **Variables** → **New Variable**:

| Name | Value |
|---|---|
| `AUTH_TOKEN` | your long random string |

Railway redeploys with the new variable. Why it's not optional:

- Without it, `/api/data` (your whole journal: wallets, notes, settings) is readable
  and writable by anyone who finds the URL.
- Without it, everyone who opens `/daruma` shares one journal.
- Without it, the admin panel (`/admin`) refuses every request.

While you're here, these are worth setting from day one (all optional):

| Name | Suggested value | What it does |
|---|---|---|
| `REFRESH_INTERVAL_MIN` | `30` | Refreshes server-side caches from Hyperliquid on a timer. Needed for alerts, weekly digests, the end-of-day nudge and the disk/health watch. |
| `PUSH_SUBJECT` | `mailto:you@example.com` | Contact address sent to browsers' push services with Daruma reminders. |
| `HOME_VIEW` | `daruma` | Makes `/` open Daruma (the phone-first view) instead of the full journal, which moves to `/ledger.html`. Leave unset for a journal-first site. |
| `TZ` | e.g. `Europe/Berlin` | The server's own clock (log timestamps, members without a reported time zone). Leave unset for UTC. |

Every variable is listed in [configuration.md](configuration.md).

> **Tip — shared variables.** If you later add a second service (the exchange relay
> below), put common values such as `CEX_RELAY_SECRET` in **Project Settings →
> Shared Variables** and reference them from each service with `${{shared.CEX_RELAY_SECRET}}`.

## Step 5: Give it a public address

1. Service → **Settings** → **Networking** → **Generate Domain**. You get
   `https://<name>.up.railway.app`.
2. If Railway asks for a port, use the one the logs show (`listening on :8080`).
   Railway injects `PORT` and the server listens on it; you never set `PORT` yourself.

**Custom domain (optional).** Same panel → **Custom Domain** → enter e.g.
`journal.example.com`, then create the CNAME record Railway shows at your DNS
provider. Railway issues the TLS certificate once DNS resolves.

You do **not** need `PUBLIC_ORIGIN` on Railway. The server detects Railway
(`RAILWAY_ENVIRONMENT`) and trusts the `Host` header, because Railway's edge only
forwards requests for the service's own domains (custom ones included). That is what
wallet sign-in messages, passkeys and the wearables' OAuth redirects are built from.
It also turns on `TRUST_PROXY`, so rate limits and lockouts see the visitor's real
address rather than Railway's proxy.

## Step 6: Verify the deployment

**1. Logs.** The two warnings from step 2 are gone, and you see:

```
[ledger] analytics engine ready (… functions extracted from ledger.html)
[ledger] listening on :8080
```

(and `scheduled refresh every 30 min …` if you set `REFRESH_INTERVAL_MIN`).

**2. Health check.**

```bash
curl https://<your-app>.up.railway.app/api/health
# {"ok":true,"auth":true,"appSyncCapable":true}
```

- `auth: true` means `AUTH_TOKEN` is set.
- `appSyncCapable: true` means the served page has the sync client (it's false only
  if an old `ledger.html` was deployed next to a newer `server.js`).

**3. The app.** Open the URL. The app finds the server, asks for the token once (it
is remembered in that browser), and pulls the server's copy. Add a wallet, write a
journal note; the status bar reads `☁ Server sync · rev N · saved`.

**4. Persistence.** Service → Deployments → **⋮ → Redeploy**. Reload the page: the
note is still there and the revision counter moved on. From a shell:

```bash
curl -H "Authorization: Bearer $AUTH_TOKEN" https://<your-app>.up.railway.app/api/data | head -c 300
```

**5. The other pages.** `/daruma` (simple view), `/admin` (owner panel, sign in with
the token), `/help` (user guide), `/docs` (technical reference), `/api/v1` (API index).

## Step 7: Turn on what you need

Each feature below is off until its variables are set. Adding a variable redeploys
the service; check the deploy logs for a line confirming it (or a warning naming what
is missing).

### Alerts and weekly digests

Needs `REFRESH_INTERVAL_MIN` plus at least one delivery channel.

| Variable | Example |
|---|---|
| `ALERT_WEBHOOK` | A Discord or Slack incoming-webhook URL, an ntfy topic URL, or any endpoint that accepts JSON |
| `TELEGRAM_BOT_TOKEN` | From @BotFather |
| `TELEGRAM_CHAT_ID` | Your chat id (comma-separate several); every other chat is ignored |
| `ALERT_LIQ_PCT` | `10` (alert within 10% of liquidation; the default) |
| `ALERT_DAILY_LOSS` | `500` (otherwise the app's saved daily-loss rule is used) |
| `ALERT_FUNDING_24H` | `50` (funding paid per 24 h) |
| `NUDGE_HOUR` | `18` (end-of-day journaling nudge after 18:00 in the app's time zone) |

With Telegram set, the bot also answers `/today`, `/risk`, `/stats`, `/goals` and
`/digest`. The log line `scheduled refresh every 30 min … with alert delivery`
confirms the setup.

### AI coach (weekly letter + Daruma chat)

| Variable | Value |
|---|---|
| `COACH_AI` | `1` |
| `ANTHROPIC_API_KEY` | your Claude API key |
| `COACH_AI_MODEL` | optional; defaults to `claude-opus-5-5` |

Or, for OpenAI: `COACH_AI=1`, `COACH_AI_PROVIDER=openai`, `OPENAI_API_KEY`, and
optionally `COACH_AI_MODEL` / `COACH_AI_EFFORT` / `OPENAI_BASE_URL`. Daily message
allowances are set in `/admin` → Coach.

### Encrypted off-site backups (recommended)

The server's own backups sit on the same volume they protect. Add an S3-compatible
bucket and every server backup, plus a daily bundle of the whole data directory, is
encrypted (AES-256-GCM) and shipped there. Cloudflare R2 is the cheapest fit (no
egress fees, 10 GB free):

1. In Cloudflare: **R2 → Create bucket** (e.g. `ledger-backups`), then **Manage API
   tokens → Create API token** with *Object Read & Write* on that one bucket.
2. In Railway, set:

   | Variable | Value |
   |---|---|
   | `OFFSITE_ENDPOINT` | `https://<account-id>.r2.cloudflarestorage.com` |
   | `OFFSITE_BUCKET` | `ledger-backups` |
   | `OFFSITE_ACCESS_KEY_ID` | the token's access key id |
   | `OFFSITE_SECRET_ACCESS_KEY` | the token's secret |
   | `OFFSITE_KEY` | a long passphrase, **also stored outside Railway** |

3. Redeploy; the log shows `off-site backups on: …`. To test right away:

   ```bash
   curl -X POST -H "Authorization: Bearer $AUTH_TOKEN" https://<your-app>.up.railway.app/api/offsite/run
   ```

Lose `OFFSITE_KEY` and the off-site copies can't be decrypted. Restoring is covered
in [operations.md](operations.md#restoring-from-off-site-backups).

### Web push reminders

On by default. The server creates its own push keys once, in `DATA_DIR/vapid.json`,
so they survive redeploys because they're on the volume. Set `PUSH_SUBJECT` to a
real `mailto:` or `https://` contact. `PUSH=0` switches push off.

### Wearables (WHOOP, Oura)

Register an OAuth app with each provider using the redirect URL
`https://<your-domain>/api/wear/whoop/callback` (or `/api/wear/oura/callback`), then
set `WHOOP_CLIENT_ID` / `WHOOP_CLIENT_SECRET` and/or `OURA_CLIENT_ID` /
`OURA_CLIENT_SECRET`. Apple Health works through an iPhone Shortcut and needs no
variables. If you later move to a custom domain, update the redirect URLs.

### Admin panel two-factor

`ADMIN_2FA` defaults to `optional` (each admin can add a passkey or authenticator
app in `/admin` → Settings → Security). Set `required` to force it for everyone.
If the owner loses every factor: add `ADMIN_2FA_RESET=1`, let Railway redeploy, then
**delete the variable**. A given value only resets once; use `2`, `3`… next time.

### Exchange APIs (Bybit, Binance) and region

Hyperliquid and Lighter are read from the browser and need nothing here. Bybit and
Binance can't be called from a web page, so the browser signs each read-only
request and your server forwards it (`POST /api/cex/relay`). The exchanges decide by
the **server's** IP address:

- Both refuse the **US**, which rules out Railway's US regions.
- Railway's EU West region is in the Netherlands, which Binance doesn't serve.
- Railway's Southeast Asia region is in Singapore, which Bybit doesn't serve.

The lists change; check each exchange's restricted-countries page. Choose the
service's region in its **Settings** (the deploy region). Decide before you store
much data: a service with a volume is easier to start in the right region than to
move later.

If no single region suits you, keep the main service where it is and **add a relay
service** in a region the exchange serves:

1. In the same project, **New → GitHub Repo** → this repository again, and set its
   region to one the exchange serves. It needs no volume.
2. On the relay service, set `CEX_RELAY_ONLY=1` and `CEX_RELAY_SECRET=<long random>`,
   and generate a domain for it.
3. On the main service, set `CEX_RELAY_URL=https://<relay>.up.railway.app` and the
   same `CEX_RELAY_SECRET`. Use `CEX_RELAY_URL_BYBIT` / `CEX_RELAY_URL_BINANCE` to
   send each exchange to a different relay.

The relay copy then answers only `/api/health` and the relay route, and only to
callers that present the secret.

## Deploying from the CLI instead

Same result, without the dashboard (Railway CLI: `npm i -g @railway/cli`):

```bash
railway login
railway init                          # new project (or: railway link, for an existing one)
railway up                            # upload and deploy this folder
railway volume add --mount-path /data # the persistent volume
railway variable set AUTH_TOKEN="$(openssl rand -hex 24)"
railway variable set REFRESH_INTERVAL_MIN=30
railway domain                        # generate a *.up.railway.app address
railway logs                          # follow the deploy logs
```

(Older CLI versions spell variables as `railway variables --set "KEY=value"`.)
A CLI-uploaded service doesn't redeploy on git pushes; run `railway up` again, or
connect the GitHub repo under Service → Settings → Source.

## Day 2: updates, rollbacks, backups

**Updating.** Push to the deployed branch; Railway builds and redeploys. A service
with a volume has a few seconds of downtime on each deploy (the old container must
release the volume before the new one mounts it). Open apps keep working from their
cached copy and sync again when the server is back; unsent edits are kept and sent
at the next start. Nothing in the data directory needs migrating by hand: `pulse.db`
migrates its own schema at boot, and an old `social.json` is imported once.

**Rolling back.** Service → Deployments → pick an earlier deploy → **⋮ → Rollback**.
The volume is not rolled back, only the code.

**Backups.** Four layers, from quickest to safest:

1. `ledger-data.json.bak`: the revision before the last write (automatic).
2. `DATA_DIR/snapshots/`: one copy per day of the journal, last 14 days (automatic).
3. **Backup to server** in the app: full backups in `DATA_DIR/backups/`, newest 10.
4. **Off-site**: the encrypted bucket above. The only layer that survives losing the
   volume. Set it up.

Also export **Backup all** from the app now and then and keep the file somewhere
else; it includes the browser-only fill caches.

**Looking inside the volume.** `railway ssh` opens a shell in the running
container; the data is under `/data`. Restores are in [operations.md](operations.md).

## Settings to leave alone

| Setting | Why |
|---|---|
| **Replicas** | Keep at **1**. Volumes can't be shared between replicas, and the server keeps live state (sessions, rate limits, the social layer's in-memory index) in one process. |
| **Start command** | Keep `node server.js` (see step 2). |
| **Serverless / app sleeping** | Leave off if you use alerts, digests, nudges, push reminders or duels: they run on timers inside the process. A sleeping service wakes on a request but misses whatever was scheduled while it slept. |
| **`PORT`** | Railway sets it. |
| **Healthcheck path** | Optional. `/api/health` is a good path if you add one (Settings → Deploy), but with a volume attached a deploy still has brief downtime. |

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| Journal is empty after a redeploy | No volume, or mounted at the wrong path. Logs show `no /data volume detected`. Attach the volume at `/data` (or set `DATA_DIR` to its mount path). Data written before the volume existed is gone; restore from a **Backup all** file with **Open existing**. |
| Every deploy is marked **Crashed** although the app works | The start command was changed to `npm start` in the dashboard. Remove the override; `railway.json` sets `node server.js`. |
| Build fails or boot fails with `No such built-in module: node:sqlite` | Node is older than 22.13. Set `RAILPACK_NODE_VERSION=22` and redeploy. |
| The app never asks for a token and doesn't sync | `/api/health` shows `"auth": false` (set `AUTH_TOKEN`) or `"appSyncCapable": false` (an old `ledger.html` is deployed; deploy the whole repo together). |
| `429 too many wrong tokens from this address` | `AUTH_FAIL_MAX` (20) wrong tokens within 10 minutes locked that address out for `AUTH_LOCK_MIN` (15) minutes. Wait, then re-enter the token carefully. |
| `/api/v1/*` returns 503 | The analytics engine couldn't extract a function from the served page (logs name it). Usually mismatched files; deploy `server.js`, `ledger.html` and `app/` from the same commit. The app and sync keep working. |
| The journal API refuses reads and writes; logs say `ledger-data.json is damaged … no readable .bak` | Restore a good copy from `DATA_DIR/snapshots/` (see [operations.md](operations.md#restoring-the-journal)). |
| Bybit or Binance says the region is refused | The server's region is blocked by that exchange. See [Exchange APIs](#exchange-apis-bybit-binance-and-region). |
| Locked out of the admin panel's second factor | `ADMIN_2FA_RESET=1`, redeploy, delete the variable. |
| `off-site backups are half-configured and OFF — missing …` | Set the variables the line names (all five `OFFSITE_*` basics are required). |
| `NUDGE_HOUR is set but REFRESH_INTERVAL_MIN is not` | The nudge runs on the refresh schedule; set `REFRESH_INTERVAL_MIN`. |
| Volume filling up | `GET /api/v1/meta` shows disk free and total, and the volume's Metrics tab shows use. Pictures are capped at 2 GB, encrypted journals at 1 GB, attachments at 512 MB. Grow the volume in its settings, or remove seed wallets and evict caches of wallets you no longer track (`DELETE /api/v1/cache/<address>`). |

## Security checklist

- [ ] `AUTH_TOKEN` set, long and random, and kept in a password manager.
- [ ] Volume attached at `/data`.
- [ ] Off-site backups configured, with `OFFSITE_KEY` stored outside Railway.
- [ ] `READ_TOKEN` (if used) given only to scripts and people you'd show the journal
      to. It reads trades, notes, wallet addresses and positions.
- [ ] `CORS_ORIGIN` left unset unless a browser app on another origin needs the API.
- [ ] `ADMIN_2FA=required` if anyone besides you has admin access.
- [ ] `ADMIN_2FA_RESET` removed after use.
- [ ] Replicas = 1.
