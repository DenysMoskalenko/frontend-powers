---
name: frontend-deploy
description: "Use when deploying the SPA or changing its CSP and security headers: an environment variable or PUBLIC_* origin, import.meta.env, 'is not set' or 'is not a bare origin', deploy/headers.ts, Cache-Control, 'TrustedHTML' assignment or 'violates the following Content Security Policy directive', analytics or third-party scripts, wrangler.jsonc, Caddy Dockerfile, source maps, vite:preloadError, error tracking with Faro, innerHTML, postMessage, user-supplied URLs. Not for vite.config.ts or CI jobs (frontend-tooling), style-injecting libraries (tailwind-base-ui), auth tokens (keycloak-spa-auth), or CSP semantics (modern-web-guidance)."
metadata:
  version: "0.1.1"
---

# Configuring, serving and securing the built app

Assumes Vite 8.3, React 19.3, zod 4.6, wrangler 4.165, Caddy 2.11, @grafana/faro-web-sdk 2.14.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another major of a package than the line above, or an older minor, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

CSP directive semantics, Trusted Types policy mechanics and HTML sanitization belong to `modern-web-guidance`. If that skill is available, load it before changing a directive. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules.

## Important

- Everything in `import.meta.env` ships in the bundle. Only public addresses the browser calls go there, named `PUBLIC_*` and listed in `PUBLIC_ENV`; the app is built once per environment. Each is a bare origin, pasted into `connect-src`; the one exception is an optional `*_URL` (the Faro collector, whose path carries its key), and the build checks its origin the same way (telemetry reference). Any other value (a release id) never goes through `PUBLIC_*`: it is a build-time `define`, and feature flags come from an endpoint (`frontend-project-structure`).
- Response headers come only from `deploy/headers.ts`, and the build refuses a `PUBLIC_*` origin that is not bare, a wildcard included. A CSP violation is fixed in the code that caused it, never with `'unsafe-inline'`, `'unsafe-eval'`, a wildcard or a Trusted Types policy; a source the code cannot avoid is an exception only the user approves, written in its narrowest form (headers reference).
- Never turn a string into HTML, script or style (table below): Trusted Types blocks it in the production build and in Chromium only, so only `pnpm test:e2e`, whose guard fails on the violation, proves the fix.

## References

- `references/headers-and-csp.md` — `deploy/headers.ts`, adding a `PUBLIC_*` origin, `isBareOrigin`, each directive's violation text, allowed changes and approved exceptions, `report-to`. Open before adding an origin or touching a header.
- `references/client-security.md` — `safeHref` and `sameOriginPath` with a test, new windows, `postMessage`, web storage. Open when a URL, window or message comes from outside the app.
- `references/cloudflare.md` — `wrangler.jsonc`, environments, `wrangler deploy --env`, `_headers`, the missing-asset limit, the stale-chunk reload. Open for any Cloudflare change.
- `references/container.md` — `Dockerfile`, `deploy/Caddyfile`, why one image per environment, run flags, the Kubernetes security context, the curl checklist for both targets. Open for the image, the release pipeline, or to prove a release.
- `references/telemetry.md` — the Grafana Faro add-on: `PUBLIC_FARO_URL`, the release id, `startTelemetry`, URL scrubbing, tracing, source maps, CSP violations in production. Open when adding observability.

## Per-environment configuration

One build per environment: the origins are inlined into the bundle and the generated CSP. The
cost (production runs a bundle staging did not run), the mitigation and whose decision the
pipeline shape is are in the container reference. An origin the browser calls is added in six
places, listed in the headers reference. Each value is a bare origin; `vite`, `vite build` and
`vite preview` stop on `Error: PUBLIC_AUTH_ORIGIN is not set` and on
`Error: PUBLIC_AUTH_ORIGIN is not a bare origin: https://id.example.com/realms/app` (keep the path
in code). A realtime origin is listed as `wss://`.

## The headers

`deploy/headers.ts` renders `dist/_headers` (Cloudflare), `dist/headers.caddy` (the container) and the `vite preview` middleware, so `pnpm test:e2e` runs against the production policy:

```text
default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' <PUBLIC_ENV origins>; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types 'none'
```

Also HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, COOP `same-origin` and CORP. Images, fonts and frames are same-origin only; another host, or `blob:` for a picked-file preview, is a deliberate edit to `csp()` that changes the whole-policy assertion in `deploy/headers.test.ts` in the same commit. An add-on changes exactly the directives its own reference names, each with a test in `deploy/headers.test.ts` and the end-to-end assertion on the served header.

## Client-side rules the policy enforces

They break only in the production build (jsdom has no CSP), where the end-to-end guard fails on the
message; writing those tests is `frontend-testing`'s.

| Rule | What breaking it prints |
|---|---|
| Render text, never an HTML string (`dangerouslySetInnerHTML`, `innerHTML`, `DOMParser`); showing markup needs a package the user chooses (headers reference) | `This document requires 'TrustedHTML' assignment. The action has been blocked.` |
| No `<script>` in JSX, `onclick="…"`, `javascript:` URL, `eval`, `new Function`, `setTimeout("code")`; zod runs `jitless` | `This document requires 'TrustedScript' assignment.` |
| Dynamic styles through `style={{ … }}`, never a `style="…"` string or runtime `<style>` | `Applying inline style violates the following Content Security Policy directive 'style-src 'self''` |
| No `data:` images or fonts (`build.assetsInlineLimit: 0`) | `Loading the image 'data:…' violates the following Content Security Policy directive: "default-src 'self'"` |
| No third-party script (tag manager, analytics, widget, CDN) | `This document requires 'TrustedScriptURL' assignment.` |

Outside URLs (`safeHref`, `sameOriginPath`), new windows, `postMessage` and web storage print
nothing when broken: client-security reference. Style-injecting libraries are `tailwind-base-ui`'s.

## Hosting

Cloudflare Workers static assets by default, or the Caddy container on `scratch`; a release on either is proven by the curl checklist in the container reference.

## Cache policy and releases

| Response | `Cache-Control` |
|---|---|
| a file under `/assets/` (Vite's content-hashed output) | `public, max-age=31536000, immutable` |
| `index.html`, deep links, `public/` files | `no-cache` |
| a missing `/assets/*` file | container: 404 `no-cache`; Cloudflare: `index.html`, 200, `immutable` (known limit) |

A tab opened before a deploy asks for chunks the new build removed. `reloadOnStaleChunk(router)` (`src/app/error-reporting.ts`) reloads only while a navigation is pending, never twice within 60 s: a preload on hover fails quietly, a click onto a missing route chunk reloads once onto the new build, and a non-route lazy import that fails rejects to its importer (Cloudflare reference).

## Observability

Grafana Faro is an add-on, loaded only when the build sets `PUBLIC_FARO_URL` (telemetry reference); feature code never imports it.

## Prior-version corrections

| Older examples write | Correct now |
|---|---|
| `VITE_API_URL`, `envPrefix: "VITE_"`, a prefix shared with backend variables | exact `PUBLIC_*` names in `envPrefix: PUBLIC_ENV` |
| a nonce or hash CSP, `html.cspNonce` | `script-src 'self'`: Vite 8 emits no inline script |
| `wrangler pages deploy`, `pages_build_output_dir`, Workers Sites `site.bucket`, `wrangler.toml` | `assets.directory` in `wrangler.jsonc`, `wrangler deploy` |
| a hand-written `public/_headers` | generated from `deploy/headers.ts` |
| an `nginx` or `static-web-server` image | Caddy on `scratch`: `static-web-server` 2.44.3 serves a missing chunk as `index.html` with `immutable` and its 3.0 betas keep `immutable` on the 404; revisit when a release serves a missing `/assets/*` file as an uncached 404 and answers HEAD like GET |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| read `import.meta.env.PUBLIC_*` in a component | read `env` from `@/app/env` in the route and pass the value down (placement: `frontend-project-structure`) |
| substitute values inside built JavaScript, add an inline config script or a runtime `/config.json` | one build per environment; how a pipeline promotes artifacts is the platform team's decision |
| create a Trusted Types policy, edit `trusted-types`, or `pnpm add` an HTML parser | render text; describe the allow-list parser package and the sanitizer policy with their cost and stop: only the user decides |
| add a `<script>` tag for analytics or a widget | refuse: it needs a CSP exception and runs with the user's session |
| set `href={user.website}` or `location.href = returnTo` | `safeHref(user.website)`; `location.assign(sameOriginPath(returnTo))` |
| add `immutable` outside `/assets/*`, or a fallback under it in Caddy | `no-cache`; a missing chunk is a 404, never `index.html` cached for a year |
| set `build.sourcemap: true`, or deploy a `.map` file | `"hidden"`, uploaded from CI under the release id, never deployed (`.assetsignore`, `find dist -name '*.map' -delete`) |
| `event.preventDefault()` in a `vite:preloadError` handler, as Vite's docs show, or reload on every such event | leave it uncancelled and reload only while `router.state.status === "pending"`: cancelled, the router reports a TypeError; reloading on a hover's preload loses the page |
| add `@sentry/react` or another tracker SDK | the Grafana Faro add-on: the organisation's telemetry backend is Faro |
| set `workers_dev` or `preview_urls` to `true`, or enable gradual deployments | keep them off unless Cloudflare Access guards the URLs: they are public |
