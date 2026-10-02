# Operations: data, backups, monitoring, upgrades

Running the server after it's deployed. Railway specifics are in
[deploy-railway.md](deploy-railway.md); this page applies to any host.

- [What lives in DATA_DIR](#what-lives-in-data_dir)
- [Backup layers](#backup-layers)
- [Restoring the journal](#restoring-the-journal)
- [Restoring from off-site backups](#restoring-from-off-site-backups)
- [Moving to a new server or volume](#moving-to-a-new-server-or-volume)
- [Monitoring](#monitoring)
- [Upgrading](#upgrading)
- [Running outside Railway](#running-outside-railway)

## What lives in DATA_DIR

Everything the server persists is under one directory (`DATA_DIR`, `/data` on
Railway). Nothing else on disk matters; the code can be redeployed freely.

| Path | Contents | Sensitive? |
|---|---|---|
| `ledger-data.json` | The owner's journal, wallets and settings, with a revision number. | **Yes** |
| `ledger-data.json.bak` | The previous revision. | **Yes** |
| `snapshots/YYYY-MM-DD.json` | One copy of the journal per UTC day, newest 14. | **Yes** |
| `backups/backup-*.json.gz` | "Backup to server" copies of the app's full backup, newest 10. | **Yes** |
| `att/` | Journal screenshot attachments (512 MB cap). | **Yes** |
| `fills/`, `funding/`, `ledger/`, `market.json` | Server-side caches of exchange data for `/api/v1`. Re-fetchable, but `fills/` keeps history older than the exchange's 10,000-fill window. | Wallet data |
| `reports/` | Weekly digests (26 kept) and AI coach letters. | Yes |
| `alert-state.json` | Alert de-duplication and cooldowns. | No |
| `pulse.db` (+ `pulse.db-wal`, `pulse.db-shm` while running) | Daruma's social database: members, leagues, feed, posts, duels, reviews. | **Yes** |
| `social.json.migrated` | The pre-SQLite social store, kept after the one-time import. | Yes |
| `media/` | Members' uploaded pictures (2 GB cap). | Personal |
| `vault/` | Members' end-to-end encrypted journals (ciphertext only; 1 GB cap). | Encrypted |
| `social-fills/` | Recent public fills of members who share verified Discipline. | Wallet data |
| `wearables.json` | WHOOP/Oura tokens and readiness days. | **Yes** |
| `admin-2fa.json` (mode 0600) | Admin passkeys, authenticator secrets, hashed recovery codes and sessions. | **Yes** |
| `vapid.json` | The server's web push keys. Lose it and members must re-subscribe to reminders. | **Yes** |
| `offsite-state.json` | When the last off-site bundle shipped. | No |

Treat the whole directory as secret.

## Backup layers

| Layer | Automatic? | Survives losing the volume? | Covers |
|---|---|---|---|
| `ledger-data.json.bak` | yes, every write | no | the journal, one revision back |
| `snapshots/` | yes, daily | no | the journal, 14 days |
| `backups/` | when someone clicks **Backup to server** | no | the app's full backup, 10 copies |
| **Off-site** (`OFFSITE_*`) | yes: every server backup + a daily `DATA_DIR` bundle | **yes** | everything (attachments and fill caches dropped first if the bundle passes `OFFSITE_MAX_MB`) |
| **Backup all** file in the app | manual | yes | journal, wallets, settings, excursion measurements and the browser's fill caches |

Recommended: configure off-site backups, and download a **Backup all** file monthly.

## Restoring the journal

**From the app.** **Open existing** in the app accepts a **Backup all** file. With
server sync on, the restored state syncs to the server as a normal save.

**From a server snapshot or backup.** List and fetch with the owner token:

```bash
curl -H "Authorization: Bearer $AUTH_TOKEN" https://your.app/api/snapshots
curl -H "Authorization: Bearer $AUTH_TOKEN" https://your.app/api/snapshots/2026-09-30 -o snap.json
curl -H "Authorization: Bearer $AUTH_TOKEN" https://your.app/api/backups
```

**By hand, when the journal file is damaged.** If the logs say
`ledger-data.json is damaged … and there is no readable .bak`, the journal API
refuses reads and writes on purpose. On the server (`railway ssh` on Railway):

```bash
cd /data
ls snapshots/                          # pick the newest good day
cp ledger-data.json ledger-data.json.damaged
cp snapshots/2026-09-30.json ledger-data.json
```

The next request reads the restored file; no restart is needed. Each device then
pulls it and re-applies its unsynced edits.

## Restoring from off-site backups

On any machine with Node and the same `OFFSITE_*` variables (including `OFFSITE_KEY`):

```bash
node offsite.js list                                                  # what's in the bucket
node offsite.js restore ledger/data/<stamp>.bundle.gz.enc ./data      # unpack a whole DATA_DIR
node offsite.js get ledger/backup/<stamp>.json.gz.enc backup.json     # one app backup → "Open existing"
```

Then start a server with `DATA_DIR` pointing at the restored folder, or copy it onto
a fresh volume.

## Moving to a new server or volume

1. Stop writes: close the app on every device, or stop the old server.
2. Copy the entire `DATA_DIR` (including `pulse.db-wal` if the server was running;
   safest is to stop it first so SQLite checkpoints).
   An off-site bundle restore is the easiest way to do this.
3. Start the new server on that directory with the **same** `AUTH_TOKEN`, and the
   same `PUBLIC_ORIGIN` or domain: passkeys and wallet sign-ins are tied to the site
   address, so changing the domain means members re-add passkeys.
4. Point DNS at the new server.

## Monitoring

- **Uptime:** `GET /api/health` (no auth) returns 200 with `{"ok":true,…}`.
- **Metrics:** `GET /api/v1/metrics?format=prom` (read token) for Prometheus, or the
  JSON form for Home Assistant / Grafana JSON sources.
- **Server self-checks:** with `REFRESH_INTERVAL_MIN` and a delivery channel, the
  server reports repeated refresh failures (`HEALTH_FAIL_RUNS`), a full volume
  (`HEALTH_DISK_PCT`, `HEALTH_DISK_MIN_MB`) and failed off-site uploads.
- **Status:** `GET /api/v1/meta` shows cache freshness, the refresh failure streak,
  disk free/total and off-site status.
- **Logs:** every server line starts with `[ledger]`. Boot warnings name each
  misconfiguration (no token, no volume, old page, engine disabled, half-configured
  off-site backups, relay without a secret, nudge without a schedule).

## Upgrading

1. Pull or merge the new code and deploy all files from the same commit
   (`server.js`, `ledger.html` and `app/` must match: the engine extracts functions
   from the page).
2. Restart. Migrations run at boot: `pulse.db` applies its numbered schema
   migrations, and an old `social.json` is imported once.
3. Browsers pick up the new app on the next open (scripts are versioned by content
   hash; the service worker fetches the shell network-first).

To roll back, deploy the previous commit. Data stays where it is; the SQLite schema
only moves forward, so roll back only across releases that didn't add a migration
(check `MIGRATIONS` in `db.js`), or restore a backup taken before the upgrade.

## Running outside Railway

The server is a single Node process with no required dependencies, so any host
works:

```bash
git clone <repo> ledger && cd ledger
npm install --omit=dev        # optional: only installs the Anthropic SDK for COACH_AI
export AUTH_TOKEN=$(openssl rand -hex 24)
export DATA_DIR=/var/lib/ledger
export PUBLIC_ORIGIN=https://journal.example.com
export TRUST_PROXY=1          # only behind a reverse proxy that sets X-Forwarded-For
node server.js
```

Requirements and notes:

- **Node 22.13 or newer** (`node:sqlite`).
- Put it behind HTTPS (Caddy, nginx, a tunnel). Passkeys, web push and PWA install
  need a secure origin.
- Set `PUBLIC_ORIGIN` to the public address. Off Railway the server doesn't trust
  the `Host` header for wallet sign-in messages, passkeys and OAuth redirects without it.
- Run one process per `DATA_DIR`.
- Use a process manager that sends `SIGTERM` and restarts on failure (systemd,
  Docker `--restart unless-stopped`, pm2). The server exits 0 on `SIGTERM`.

A minimal systemd unit:

```ini
[Unit]
Description=Ledger companion server
After=network-online.target

[Service]
WorkingDirectory=/opt/ledger
ExecStart=/usr/bin/node server.js
Environment=PORT=8080 DATA_DIR=/var/lib/ledger PUBLIC_ORIGIN=https://journal.example.com TRUST_PROXY=1
EnvironmentFile=/etc/ledger.env
Restart=on-failure
User=ledger

[Install]
WantedBy=multi-user.target
```

(`/etc/ledger.env` holds `AUTH_TOKEN=…` and any other secrets, readable only by root.)
