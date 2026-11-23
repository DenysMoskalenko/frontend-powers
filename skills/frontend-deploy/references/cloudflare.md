# Cloudflare Workers static assets

## Contents

`wrangler.jsonc` key by key · environments and the deploy command · the generated
`_headers` · `.assetsignore` · the known limit and the stale-chunk reload · checking locally with `wrangler dev`.

## `wrangler.jsonc`

```jsonc
// Assets only: no Worker script, so every request is a static-asset request.
// The custom domain and DNS belong to the platform's infrastructure code, not to this file.
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "frontend-app",
  "compatibility_date": "2026-11-01",
  "assets": {
    "directory": "./dist",
    "not_found_handling": "single-page-application"
  },
  // workers.dev and preview URLs are public: off unless Cloudflare Access guards them.
  "workers_dev": false,
  "preview_urls": false
}
```

| Key | Why it is set this way |
|---|---|
| `$schema` | the installed wrangler's schema, so the editor checks keys against the pinned version |
| `name` | the Worker name; one per environment (below) |
| `compatibility_date` | required: without it the deploy fails with `A compatibility_date is required when uploading a Worker` |
| `assets.directory` | the build output; wrangler uploads every file in it except those `.assetsignore` lists |
| `assets.not_found_handling` | `"single-page-application"`: any path without a file returns `index.html` with 200, which makes deep links work. The other values are `"404-page"` and `"none"` |
| `workers_dev` | defaults to `true`, which publishes the app at a public `*.workers.dev` URL beside the custom domain |
| `preview_urls` | per-version preview URLs are public too; keep `false` unless Cloudflare Access protects them |

No `main`: there is no Worker script, so every request is a static-asset request. No
`assets.html_handling`: the default `"auto-trailing-slash"` redirects `/index.html` to `/`. No
`_redirects` file: wrangler ignores a `/* /index.html 200` rule with `Infinite loop detected in
this rule and has been ignored`, and `not_found_handling` already does the job. No `run_worker_first`: that key routes requests to a
Worker script, which this app does not have. No gradual deployments: a split rollout serves two
versions at once, which is exactly the version skew the cache policy assumes away.

## Environments and the deploy command

One build per environment, one Worker per environment. Add an `env` block per environment beside
the top-level keys; `assets`, `workers_dev` and `preview_urls` are inherited:

```jsonc
  "env": {
    "staging": { "name": "frontend-app-staging" }
  }
```

The top-level config is production. The deploy job builds with that environment's origins and
deploys the same `dist/`:

```bash
PUBLIC_API_ORIGIN=https://api.staging.example.com pnpm build
pnpm exec wrangler deploy --env staging
```

Once an `env` block exists, a deploy without `--env` warns that no target environment was given;
production is `--env=""`. An `--env` without a block fails with
`No environment found in configuration with name "<env>".` CI needs `CLOUDFLARE_API_TOKEN` (a
token from the "Edit Cloudflare Workers" template, limited to one account) and
`CLOUDFLARE_ACCOUNT_ID`. `pnpm exec wrangler deploy --dry-run --env <env>` checks the config and
reads `dist/` without an account. Custom domains and routes belong to the platform's
infrastructure code.

## The generated `_headers`

`pnpm build` writes `dist/_headers` from `deploy/headers.ts`; never edit it or add one to `public/`.
For `PUBLIC_API_ORIGIN=https://api.example.com` it is:

```text
/*
  Cache-Control: no-cache
  Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' https://api.example.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'
  Strict-Transport-Security: max-age=63072000; includeSubDomains
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
  Cross-Origin-Opener-Policy: same-origin
  Cross-Origin-Resource-Policy: same-origin
/assets/*
  ! Cache-Control
  Cache-Control: public, max-age=31536000, immutable
```

Every rule whose path matches applies, and a header set by two matching rules is joined with a
comma: without the `! Cache-Control` line a hashed asset would get
`no-cache, public, max-age=31536000, immutable`. A narrower rule therefore detaches the header
first (`! Name`), then sets it; `cloudflareHeaders()` does this for every header the `/assets/*`
rule sets. The file allows 100 rules and 2,000 characters per line, and the CSP line counts
against that limit as origins are added. `_headers` itself is never served.

## `.assetsignore`

`pnpm build` also writes `dist/.assetsignore` with `*.map` and `headers.caddy`. Without it
wrangler uploads and serves the source maps. `wrangler dev` answers an ignored path with the SPA
fallback, so a map URL returns HTML, never the map.

## The known limit: a missing hashed asset

Cloudflare answers a request for a file that does not exist under `/assets/` with `index.html`,
status 200, and the `/assets/*` headers, `immutable` included, whatever the `Sec-Fetch-Dest`. Two
cases reach it:

- A tab opened before a deploy asks for a lazy chunk of its old version, which the new deploy no
  longer has. The import fails, Vite dispatches `vite:preloadError`, and `reloadOnStaleChunk(router)`
  reloads onto the new `index.html` when a navigation is pending (below). The HTML cached under the
  old chunk's URL is never requested again.
- A new `index.html` reaches a browser while an edge still serves the previous asset set. The
  browser would cache HTML under a current chunk's URL for a year, and a reload cannot clear it.
  Deploys are atomic (no gradual deployments) to keep this window closed; it has not been
  observed.

`src/app/error-reporting.ts` reloads only while the router has a navigation pending, and bounds the
reload by time, not by session, so a tab left open across several deploys recovers from each:

```ts
/** A chunk of the previous deploy is gone: a navigation reloads onto the new `index.html`. */
export function reloadOnStaleChunk(router: { state: Pick<AnyRouter["state"], "status"> }) {
  // Never `preventDefault()`: Vite would resolve the import with `undefined` and the router would report a
  // TypeError; uncancelled, the router recognises the failed import and waits for the reload.
  window.addEventListener("vite:preloadError", () => {
    // A preload on hover fails quietly; the click that follows is a navigation and reloads here.
    if (router.state.status !== "pending") return;
    // A failure within a minute of the last reload is not a stale deploy: no reload loop.
    const last = Number(sessionStorage.getItem("reloaded-for-stale-chunk"));
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem("reloaded-for-stale-chunk", String(Date.now()));
    location.reload();
  });
}
```

- A preload on hover (`defaultPreload: "intent"`) that hits a missing chunk fails quietly: no
  reload, and a dirty form's leave guard is not raised.
- A real navigation to a missing route chunk reloads once onto the new build and lands on the
  target URL; a chunk that is still missing after the reload shows the route error screen.
- A lazy import that is not a route chunk (a language file, a realtime client) and fails while no
  navigation is pending rejects to its importer, which reports it and keeps the current state; the
  next navigation reloads.

`src/main.tsx` creates the router before calling `reloadOnStaleChunk(router)`.
`e2e/stale-chunk.spec.ts` proves the first two on the built app.

If the second case is ever observed, a guard Worker (`run_worker_first: ["/assets/*"]` turning HTML
responses into 404s with `no-store`) closes it, at the price of billing every asset request as a
Worker request. The container does not have the limit: Caddy answers a missing chunk with 404 and
`no-cache`.

## Checking locally

```bash
PUBLIC_API_ORIGIN=https://api.example.com pnpm build
pnpm exec wrangler dev
```

`wrangler dev` serves `dist/` with `_headers`, `.assetsignore` and `not_found_handling` applied,
without an account. The curl checklist in the container reference applies; its missing-asset and
map rows list the Cloudflare answers.
