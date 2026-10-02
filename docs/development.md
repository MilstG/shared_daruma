# Development guide

How to run the project locally, test it, and change it without breaking the things
that make it easy to deploy.

- [Prerequisites](#prerequisites)
- [Run it](#run-it)
- [Tests](#tests)
- [Making changes](#making-changes)
- [Adding a feature](#adding-a-feature)
- [Adding an API endpoint](#adding-an-api-endpoint)
- [Adding a server setting](#adding-a-server-setting)
- [Checklist before you push](#checklist-before-you-push)

## Prerequisites

- **Node.js 22.13 or newer** (`node --version`). The social layer uses the built-in
  `node:sqlite`.
- A modern browser. Chrome or Edge for the File System Access features.
- Optional: Playwright, only for the browser smoke tests.

There is nothing to install for the app or the server. `npm install` only fetches the
optional `@anthropic-ai/sdk`, needed only to try the AI coach with Anthropic.

## Run it

**Without a server.** Open `ledger.html` in a browser (keep `app/` next to it).
Add `?daruma` to the URL for the Daruma view. Everything stays in the browser.

**With the server.**

```bash
npm start                      # = node server.js, on http://localhost:8080
```

Data goes to `./data/` (git-ignored). The server warns that `AUTH_TOKEN` isn't set;
that's fine locally. To exercise the token flow and the admin panel:

```bash
AUTH_TOKEN=dev-token npm start
```

Then open:

| URL | What |
|---|---|
| http://localhost:8080/ | the journal (click **Load sample data** to skip adding a wallet) |
| http://localhost:8080/daruma | Daruma |
| http://localhost:8080/admin | admin panel (needs `AUTH_TOKEN`) |
| http://localhost:8080/api/v1 | API index |
| http://localhost:8080/help, /docs | built-in guides |

Use a scratch directory to start clean: `DATA_DIR=$(mktemp -d) AUTH_TOKEN=dev npm start`.

Passkeys and web push need a secure context; `localhost` counts as one.

## Tests

```bash
npm test               # every tests/test-*.mjs suite, offline, no dependencies
node tests/test-api.mjs   # one suite
```

- The suites need no network: the exchange is mocked.
- They **extract functions from the shipped app source** (through `app-source.js`)
  rather than importing a separate copy, so they test exactly what ships.
  `tests/harness.mjs` provides `t`, `ok`, `eq`, `near`, `report` and
  `makeExtractor(html)` (`grabFn`, `evalFn`, `evalClass`).
- Server suites start real servers with `createApp({ dataDir, auth, fetchImpl, now, … })`
  on a temp directory and talk HTTP to them.
- `tests/test-budget.mjs` enforces size budgets per screen (journal and Daruma),
  gzipped as served, plus fonts, plus each feature file (40 KB raw / 12 KB gzipped by
  default). Raise a budget in the same change that needs it, and say why.
- `tests/test-syntax.mjs` parses every script block.

**Browser smoke tests** run the real app in Chromium against the real server, fully
offline:

```bash
npm i --no-save playwright && npx playwright install chromium
npm run test:e2e                 # E2E_SLOW=2 doubles the time budgets on a slow machine
```

They boot the journal with a token, load sample data, visit every tab, save a note
and check it survives a reload, check caching and offline start, open the page from
disk, open Daruma at phone width, open every admin tab and run admin two-factor flows.

**CI** (`.github/workflows/test.yml`) runs `npm test` on Node 22 and 24, and the e2e
job on Node 22 with `E2E_SLOW=2`, on every push and pull request.

## Making changes

**No build step.** Edit a file, reload the page. The server notices a changed
`ledger.html` or `app/` file and serves it under a new content hash. The `/api/v1`
analytics engine is extracted once at boot, so restart the server to see app-function
changes there.

**The load-order rule.** `app/*.js` are classic scripts sharing one global scope,
loaded in the order listed in `ledger.html` and in [architecture.md](architecture.md#load-order).
Top-level code in a part may only use names declared in that part or an earlier one.
Code inside functions called later can use anything.

**Function extraction.** The server engine and tests find functions by name in the
app source. Consequences:

- Keep functions the server uses (`ENGINE_FNS` in `server.js`) as plain
  `function name(…) {…}` declarations, pure, and free of DOM access.
- If such a function starts depending on a new one-line `const`, add it to
  `ENGINE_SHIMS` too (consts aren't extractable).
- Renaming one of them means updating `ENGINE_FNS`; otherwise `/api/v1` returns 503
  and the boot log says which name is missing.

**Server style.** Node built-ins only. Every new route checks auth first, caps body
size, and answers JSON errors with plain-language messages. Everything persistent
goes under `DATA_DIR`, written atomically (`.tmp` + rename). Background work uses
`unref`'d timers. Every outside dependency is injectable through `createApp(opts)` so
tests can mock it.

**Social schema changes** go in a new entry at the end of `MIGRATIONS` in `db.js`.
Never edit an existing entry; deployed databases have already run it.

**Historical names.** Daruma was Pulse, then Keel. Code keeps `pz…`, `pulse*.js`,
`X-Pulse-Key`, `pulse.db` and `keel` deliberately so stored data, keys and installs
didn't have to move. Don't rename them.

## Adding a feature

New features live in their own file, `app/features/<name>.js`, rather than growing
the big screen files:

1. Create `app/features/<name>.js`.
2. Add its `<script src="app/features/<name>.js"></script>` in `ledger.html`, before
   `app/boot.js`. Add `data-only="keel"` or `data-only="journal"` if only one screen
   needs it.
3. Plug it into Daruma with `pzFeature` (defined in `app/pulse.js`):

   ```js
   pzFeature({
     id: 'age',
     today: { label, hint, col, after, html },   // a card on Today (hideable and reorderable)
     tab:   { name, nav, html },                  // a screen of its own (#age)
   });
   ```

4. Add `tests/test-<name>.mjs`; it is picked up by `npm test` automatically.
5. If the server must compute it too (verified numbers), add its functions to
   `ENGINE_FNS`.

`app/features/trader-age.js` is the reference example.

## Adding an API endpoint

For `/api/v1`, add the route in `handleV1` in `server.js` and an entry in `V1_DOCS`
(that list is what `GET /api/v1` returns). Then add coverage in `tests/test-api.mjs`
and a row in [api.md](api.md).

## Adding a server setting

1. Read it once in `createApp` from `opts.<name>` falling back to `process.env.<NAME>`
   (so tests can set it without touching the environment).
2. Log a boot warning if it's half-configured.
3. Document it in [configuration.md](configuration.md) and in the table in
   [`README-deploy.md`](../README-deploy.md).

## Checklist before you push

- [ ] `npm test` passes.
- [ ] `npm run test:e2e` passes if you touched the UI, boot, sync or the server.
- [ ] No new npm dependency.
- [ ] No top-level use of a name from a later `app/` part.
- [ ] Size budgets still hold (or the raise is explained).
- [ ] Docs updated: README (user-facing), `docs/` (operator/developer), `help.html` /
      `tech.html` if the built-in guides describe it.
