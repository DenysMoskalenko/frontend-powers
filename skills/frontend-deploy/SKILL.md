---
name: frontend-deploy
description: "Use when deploying the SPA or changing its CSP and security headers: an environment variable or PUBLIC_* origin, import.meta.env, 'is not set' or 'is not a bare origin', deploy/headers.ts, Cache-Control, 'TrustedHTML' assignment or 'violates the following Content Security Policy directive', analytics or third-party scripts, wrangler.jsonc, Caddy Dockerfile, source maps, vite:preloadError, error tracking with Faro, innerHTML, postMessage, user-supplied URLs. Not for vite.config.ts or CI jobs (frontend-tooling), style-injecting libraries (tailwind-base-ui), auth tokens (keycloak-spa-auth), or CSP semantics (modern-web-guidance)."
metadata:
  version: "0.1.0"
---

# Configuring, serving and securing the built app

Assumes Vite 8.3, React 19.3, zod 4.6, wrangler 4.163, Caddy 2.11, @grafana/faro-web-sdk 2.14.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, use its own modules, helpers and scripts, and say so when it has no equivalent instead of adding one unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If `pnpm-lock.yaml` pins another major version than the line above, follow the project and say which rules may not apply.

CSP directive semantics, Trusted Types policy mechanics and HTML sanitization belong to `modern-web-guidance`. If that skill is available, load it before changing a directive. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules.

## Important

- Everything in `import.meta.env` ships in the bundle. Only public origins go there, named `PUBLIC_*` and listed in `PUBLIC_ENV`; the app is built once per environment. A project that already injects configuration at start keeps that design: add the value there and the origin to its CSP, and report the difference.
- Response headers come only from `deploy/headers.ts`. A CSP violation is fixed in the code that caused it, never with `'unsafe-inline'`, `'unsafe-eval'`, a wildcard or a Trusted Types policy.
- Never turn a string into HTML, script or style (table below): Trusted Types blocks it in production only, where the E2E guard fails the test.
- Only `/assets/*` is `immutable`; everything else is `no-cache`. A missing hashed file is never cached as `index.html`.
- Source maps are `build.sourcemap: "hidden"`, uploaded from CI for the exact release when a tracker needs them, and never deployed (`.assetsignore`, `find dist -name '*.map' -delete`).

## References

- `references/headers-and-csp.md` — `deploy/headers.ts`, each directive's violation text, allowed and refused changes. Open before touching a header.
- `references/client-security.md` — `safeHref` and `sameOriginPath` with a test, new windows, `postMessage`, web storage. Open when a URL, window or message comes from outside the app.
- `references/cloudflare.md` — `wrangler.jsonc` key by key, environments, `wrangler deploy`, `_headers`, `.assetsignore`, the missing-asset limit. Open for any Cloudflare change.
- `references/container.md` — `Dockerfile`, `deploy/Caddyfile`, run flags, the Kubernetes security context, the curl checklist for both targets. Open for the image or to prove a deployment.
- `references/telemetry.md` — the Grafana Faro add-on: packages, optional `PUBLIC_FARO_URL`, `startTelemetry`, tracing, privacy. Open when adding observability.

## Per-environment configuration

One build and image per environment: the origins land in the bundle and in the CSP.

Adding an origin the browser calls, in six places (`PUBLIC_AUTH_ORIGIN` as the example):

1. `vite.config.ts`: add the name to `PUBLIC_ENV`, which validates it, exposes it and adds it to `connect-src`.
2. `src/vite-env.d.ts`: `readonly PUBLIC_AUTH_ORIGIN: string;` in `ImportMetaEnv`.
3. `src/app/env.ts`: `authOrigin: import.meta.env.PUBLIC_AUTH_ORIGIN,`.
4. `.env.development`: the local value, `PUBLIC_AUTH_ORIGIN=http://localhost:8080`.
5. `playwright.config.ts`: the same value in the preview server's `env`, next to `PUBLIC_API_ORIGIN`: the production build ignores `.env.development`.
6. A placeholder next to `PUBLIC_API_ORIGIN` in `.github/workflows/ci.yml` (`env:`) and `.gitlab-ci.yml` (`variables:`), the real value in each deploy job, and `ARG PUBLIC_AUTH_ORIGIN` before `RUN pnpm build` in the `Dockerfile`.

Then `pnpm check`, `pnpm build` (check that `dist/_headers` lists the origin in `connect-src`) and `pnpm test:e2e`.

A realtime origin is listed as the browser dials it, `wss://rt.example.com` (`ws://` locally): Chromium does not let `connect-src https://rt.example.com` open the socket.

The value is a bare origin (no path, no trailing slash) because it is pasted into the CSP; `vite`, `vite build` and `vite preview` refuse anything else:

| Error | Fix |
|---|---|
| `Error: PUBLIC_AUTH_ORIGIN is not set` | set it in the shell, `.env.development`, CI or the image's `ARG` |
| `Error: PUBLIC_AUTH_ORIGIN is not a bare origin: https://id.example.com/realms/app` | keep the path in code: `` `${env.authOrigin}/realms/app` `` |

`vite.config.ts` as a file and CI jobs are `frontend-tooling`'s; which realtime origins exist is `frontend-realtime`'s, the identity provider's `keycloak-spa-auth`'s.

## The headers

`deploy/headers.ts` renders `dist/_headers` (Cloudflare), `dist/headers.caddy` (the container) and the `vite preview` middleware, so `pnpm test:e2e` runs against the production policy:

```text
default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' <PUBLIC_ENV origins>; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'
```

Also HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP `same-origin` and CORP. Images, fonts and frames are same-origin only; another host, or `blob:` for a picked-file preview, is a deliberate edit to `csp()` that changes the whole-policy assertion in `deploy/headers.test.ts` in the same commit.

## Client-side rules the policy enforces

These break only in the production build (jsdom has no CSP), where the E2E guard fixture fails on the messages; writing those tests is `frontend-testing`'s.

| Rule | What breaking it prints |
|---|---|
| Render text, never an HTML string: no `dangerouslySetInnerHTML`, `innerHTML`, `insertAdjacentHTML`, `document.write`. HTML from an API or a user is shown as text or parsed into React elements | `This document requires 'TrustedHTML' assignment. The action has been blocked.` |
| No `<script>` in JSX, no `onclick="…"`, no `javascript:` URL, no `setTimeout("code")` | `This document requires 'TrustedScript' assignment.` |
| No `eval` or `new Function`, dependencies included; zod runs `jitless` (wired by `tanstack-query-api`) | `This document requires 'TrustedScript' assignment.`; the thrown `EvalError` says `… 'unsafe-eval' is not an allowed source of script` |
| Dynamic styles through `style={{ … }}`; no `style="…"` string, no runtime `<style>` | `Applying inline style violates the following Content Security Policy directive 'style-src 'self''` |
| No `data:` images or fonts (`build.assetsInlineLimit: 0`); a `blob:` preview needs `img-src 'self' blob:` | `Loading the image 'data:…' violates the following Content Security Policy directive: "default-src 'self'"` |
| No third-party script: tag manager, analytics, chat widget, CDN | `This document requires 'TrustedScriptURL' assignment.` |
| An outside URL passes `safeHref` before `href` or `window.open`; a redirect target passes `sameOriginPath` | nothing: React blocks only `javascript:` |
| A `message` listener checks `event.origin` and `event.source`; `postMessage` names a `targetOrigin`, never `"*"`; a cross-origin popup it talks to needs COOP `same-origin-allow-popups`, never no COOP | nothing: under `same-origin` no message arrives |
| Web storage holds UI preferences and flags, the sign-in return path and the OAuth library's one-time entries, never a token; parsed on read | nothing |

Libraries that inject `<style>` and the CSP-safe UI picks are `tailwind-base-ui`'s.

## Hosting

**Cloudflare Workers static assets** is the default: assets only, `not_found_handling: "single-page-application"`, no gradual deployments, `pnpm exec wrangler deploy --env <env>` after that environment's build (production is the top-level config: `--env=""`).

**The container** is Caddy 2.11 on `scratch`: user `65532:65532`, read-only root filesystem, port 8080, `/healthz`, `docker run --read-only --cap-drop ALL --security-opt no-new-privileges`.

A release is proven by the curl checklist in the container reference, on either target.

## Cache policy and releases

| Response | `Cache-Control` |
|---|---|
| a file under `/assets/` (Vite's content-hashed output) | `public, max-age=31536000, immutable` |
| `index.html`, deep links, `public/` files | `no-cache` |
| a missing `/assets/*` file | container: 404 `no-cache`; Cloudflare: `index.html`, 200, `immutable` (known limit) |

During a rolling update a new `index.html` can ask an old pod for a chunk it lacks; the uncached 404 keeps that harmless. A tab opened before a deploy asks for chunks the new build removed: `reloadOnStaleChunk()` (`src/app/error-reporting.ts`) catches `vite:preloadError` and reloads once per deploy on either target, never twice within 60 s, so a truly broken chunk shows the route error, not a reload loop.

## Observability

Grafana Faro is an add-on, loaded by dynamic import only when the build sets `PUBLIC_FARO_URL`, an optional `PUBLIC_ENV` entry whose origin reaches `connect-src`. It hears the `window` error event `reportError` raises, so feature code never imports it. `traceparent` goes only to the API origins `apiFetch` calls, never the identity provider, realtime server or collector; the API's CORS allows `traceparent` and `tracestate`. Measured cost: about 67 KB gzip of lazy chunks and 0.5 KB in the entry.

## Accepted risk

OAuth tokens live in page memory, usable by any script running there; the strict CSP and Trusted Types are the mitigation.

## Prior-version corrections

| Older examples write | Correct now |
|---|---|
| `VITE_API_URL`, `envPrefix: "VITE_"`, a prefix shared with backend variables | exact `PUBLIC_*` names in `envPrefix: PUBLIC_ENV` |
| a nonce or hash CSP, `html.cspNonce` | `script-src 'self'`: Vite 8 emits no inline script |
| `wrangler pages deploy`, `pages_build_output_dir`, Workers Sites `site.bucket`, `wrangler.toml` | `assets.directory` in `wrangler.jsonc`, `wrangler deploy` |
| a hand-written `public/_headers` | generated from `deploy/headers.ts` |
| an `nginx` or `static-web-server` image | Caddy on `scratch`; `static-web-server` 2.44 serves a missing chunk as `index.html` with `immutable` |
| `corepack enable` in the Dockerfile | `npm install --global pnpm@12.21.0`: Node 25+ has no corepack |
| `@sentry/react` | the Grafana Faro add-on |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| read `import.meta.env.PUBLIC_*` in a component | read `env` from `@/app/env` in the route and pass the value down as a prop (placement: `frontend-project-structure`) |
| put a secret or token into a `PUBLIC_*` variable | keep it on the backend |
| add a runtime `config.json` or an entrypoint that rewrites placeholders in a per-environment build | one build per environment |
| type an origin into the CSP string | add its name to `PUBLIC_ENV` |
| create a Trusted Types policy or edit `trusted-types` | render text or React elements; describe the sanitizer policy and its cost and stop: only the user decides on it |
| add a `<script>` tag for analytics or a widget | refuse: it needs a CSP exception and runs with the user's session |
| set `href={user.website}` or `location.href = returnTo` | `safeHref(user.website)`; `location.assign(sameOriginPath(returnTo))` |
| add `immutable` outside `/assets/*`, or a fallback under it in Caddy | `no-cache`; a missing chunk is a 404 |
| set `workers_dev` or `preview_urls` to `true`, or enable gradual deployments | keep them off unless Cloudflare Access guards the URLs |
