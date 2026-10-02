# Ledger + Daruma documentation

Ledger is a Hyperliquid trading journal and analytics app that runs entirely in the
browser. Daruma is its phone-first, gamified view, with leagues, duels and mentoring
run from your own server. The optional companion server (`server.js`, no required
dependencies) adds persistence, multi-device sync, a read-only analytics API,
alerts, and the social layer.

## Start here

| I want to… | Read |
|---|---|
| **Put it online on Railway** | [deploy-railway.md](deploy-railway.md): step by step, with troubleshooting |
| Know what a setting does | [configuration.md](configuration.md): every environment variable |
| Back up, restore, monitor or upgrade | [operations.md](operations.md) |
| Self-host elsewhere (VPS, Docker, systemd) | [operations.md → Running outside Railway](operations.md#running-outside-railway) |
| Call the API from a script or dashboard | [api.md](api.md) |
| Understand how the code fits together | [architecture.md](architecture.md) |
| Run it locally, test it, change it | [development.md](development.md) |
| Learn what the app does, screen by screen | the main [README](../README.md) (user guide), or `/help` on a running server |
| Read the deep technical reference (reconstruction, sync protocol, data model) | [`tech.html`](../tech.html), served at `/docs` |

## Quick start

**Just use it.** Open `ledger.html` in a browser (keep the `app/` folder next to
it), paste a wallet address, click **Load all**. Nothing to install.

**Run the server locally.**

```bash
node --version          # 22.13 or newer
AUTH_TOKEN=dev-token npm start
# → http://localhost:8080  (journal)   /daruma   /admin   /api/v1
```

**Deploy on Railway in five steps** (details in [deploy-railway.md](deploy-railway.md)):

1. New Project → Deploy from GitHub repo → this repository.
2. Attach a **volume** mounted at **`/data`**.
3. Set **`AUTH_TOKEN`** to a long random string.
4. Settings → Networking → **Generate Domain**.
5. Check `https://<app>.up.railway.app/api/health` returns `"auth":true`, then open
   the app and enter the token.

## What's where

```
ledger.html, app/        the app (browser)
server.js                the companion server
social.js, db.js, …      Daruma's social layer (SQLite in DATA_DIR/pulse.db)
admin.html               the admin panel (/admin)
tests/, e2e/             offline test suites and browser smoke tests
railway.json             Railway start command and restart policy
docs/                    this documentation
```

Full layout: [architecture.md → Repository layout](architecture.md#repository-layout).
