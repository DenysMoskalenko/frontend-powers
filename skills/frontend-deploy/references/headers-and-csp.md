# Headers and the CSP

## Contents

`deploy/headers.ts` · adding an origin the browser calls · how the build uses it · the CSP directive by directive · the other
headers · legitimate changes, step by step · an exception the user approved · changes that are
never made · violation reports with `report-to` · rolling out a change.

## `deploy/headers.ts`

The one source of every response header. `pnpm build` renders `dist/_headers` (Cloudflare) and
`dist/headers.caddy` (the container) from it, and `vite preview` serves `headersFor(path)`, so the
end-to-end suite runs against the production policy.

```ts,verify
// file: deploy/headers.ts
// The one source of the response headers: `_headers` (Cloudflare), `headers.caddy` (the container)
// and `vite preview` are all rendered from `headerRules`, so they cannot drift.

type Scope = "all" | "assets";

/** `connectOrigins`: every origin the browser calls (API, identity provider, realtime, telemetry). */
function csp(connectOrigins: readonly string[]) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    ["connect-src 'self'", ...connectOrigins].join(" "),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ].join("; ");
}

function headerRules(connectOrigins: readonly string[]): Record<Scope, Record<string, string>> {
  return {
    all: {
      // Everything unhashed revalidates: index.html, the SPA fallback, files from public/.
      "Cache-Control": "no-cache",
      "Content-Security-Policy": csp(connectOrigins),
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
    // Vite writes every content-hashed file, and only those, under /assets/.
    assets: { "Cache-Control": "public, max-age=31536000, immutable" },
  };
}

/** The headers one request path gets. */
export function headersFor(path: string, connectOrigins: readonly string[]) {
  const { all, assets } = headerRules(connectOrigins);
  return path.startsWith("/assets/") ? { ...all, ...assets } : all;
}

// Cloudflare joins a header that two matching rules set with a comma, so the `/assets/*` rule first
// detaches (`! Name`) what the `/*` rule set.
export function cloudflareHeaders(connectOrigins: readonly string[]) {
  const { all, assets } = headerRules(connectOrigins);
  const lines = (headers: Record<string, string>) =>
    Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`);
  return [
    "/*",
    ...lines(all),
    "/assets/*",
    ...Object.keys(assets).map((name) => `  ! ${name}`),
    ...lines(assets),
    "",
  ].join("\n");
}

// Named snippets that deploy/Caddyfile imports; it applies `assets_headers` to found files only.
export function caddyHeaders(connectOrigins: readonly string[]) {
  return Object.entries(headerRules(connectOrigins))
    .flatMap(([scope, headers]) => [
      `(${scope}_headers) {`,
      ...Object.entries(headers).map(([name, value]) => `\t${name} ${JSON.stringify(value)}`),
      "}",
    ])
    .join("\n")
    .concat("\n");
}

// DNS labels or an IPv6 literal only: WHATWG hosts also allow `* ; , { } ' $`, which would widen the
// CSP or become a Caddy placeholder.
const ORIGIN = /^(https?|wss?):\/\/([a-z0-9-]+(\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(:\d+)?$/;

/** A value that may go into `connect-src` as is: scheme, host and port, nothing else. */
export const isBareOrigin = (value: string) =>
  ORIGIN.test(value) && URL.parse(value)?.origin === value;
```

`deploy/headers.test.ts` pins the parts that break silently: the whole CSP string, `no-cache`
against `immutable` by path, the `! Cache-Control` detach line, the Caddy quoting, and which values
`isBareOrigin` accepts (`https://api.example.com`, `wss://rt.example.com`, `http://[::1]:8080`,
punycode) and refuses (`https://*`, `https://*.example.com`, `https://a;b`, `https://a,b`, a `{…}`
Caddy placeholder, `$`, `'`, a trailing slash, an appended source, `data:`). Any change
to `csp()` changes the first test's expected string in the same commit.

## Adding an origin the browser calls

Six places (`PUBLIC_AUTH_ORIGIN` as the example):

1. `vite.config.ts`: add the name to `PUBLIC_ENV`, before any optional `*_URL` name. The list
   validates it, exposes it and adds it to `connect-src`.
2. `src/vite-env.d.ts`: `readonly PUBLIC_AUTH_ORIGIN: string;` in `ImportMetaEnv`.
3. `src/app/env.ts`: `authOrigin: import.meta.env.PUBLIC_AUTH_ORIGIN,`.
4. `.env.development`: the local value, `PUBLIC_AUTH_ORIGIN=http://localhost:8080`.
5. `playwright.config.ts`: the same value in the preview server's `env`, next to
   `PUBLIC_API_ORIGIN`: the production build ignores `.env.development`. An origin the end-to-end
   build dials needs a server the end-to-end run starts, or a mock; the add-on's own test reference
   shows it.
6. A placeholder next to `PUBLIC_API_ORIGIN` in `.github/workflows/ci.yml` (`env:`) and
   `.gitlab-ci.yml` (`variables:`), the real value in each deploy job, and
   `ARG PUBLIC_AUTH_ORIGIN` before `RUN pnpm build` in the `Dockerfile`.

Then `pnpm check`, `pnpm build` (check that `dist/_headers` lists the origin in `connect-src`) and
`pnpm test:e2e`.

A realtime origin is listed as the browser dials it, `wss://rt.example.com` (`ws://` locally):
Chromium does not let `connect-src https://rt.example.com` open the socket. The value is a bare
origin (no path, no trailing slash) because it is pasted into the CSP; keep a path in code:
`` `${env.authOrigin}/realms/app` ``.

## How the build feeds it

The `securityHeaders` plugin in `vite.config.ts` reads every name in `PUBLIC_ENV` in its
`configResolved` hook (skipped in `mode === "test"`), refuses a missing value
(`Error: PUBLIC_API_ORIGIN is not set`) or anything `isBareOrigin` refuses, a wildcard included
(`Error: PUBLIC_API_ORIGIN is not a bare origin: https://api.example.com/v1`), and passes the list
as `connectOrigins`. In `generateBundle` it emits `_headers`, `headers.caddy` and `.assetsignore`;
in `configurePreviewServer` it sets `headersFor(request.url)` on every `vite preview` response. The
check runs for `vite`, `vite build` and `vite preview`, so a missing origin stops all three.

## The CSP, directive by directive

Messages are Chromium's console text; the end-to-end guard also prints
`CSP violation: <directive> <blocked URI>` and fails the test.

| Directive | Forbids in application code | Violation text |
|---|---|---|
| `default-src 'self'` | any image, font, media, frame or worker from another origin, and `data:` or `blob:` URLs for them (no `img-src`, `font-src`, `frame-src` is set, so this is the fallback) | `Loading the image 'https://…' violates the following Content Security Policy directive: "default-src 'self'". Note that 'img-src' was not explicitly set…`; guard: `CSP violation: img-src data` |
| `script-src 'self'` | inline `<script>`, event-handler attributes, `javascript:` URLs, `eval`, `new Function`, string `setTimeout`, any script from another host | `Running the JavaScript URL violates the following Content Security Policy directive 'script-src 'self''`. For `eval` and `new Function` Trusted Types reports first: the console prints `This document requires 'TrustedScript' assignment.` and the guard `CSP violation: require-trusted-types-for trusted-types-sink`; only the thrown `EvalError` says `Evaluating a string as JavaScript violates … because 'unsafe-eval' is not an allowed source of script` |
| `style-src 'self'` | `<style>` elements created at runtime and `style` attributes from markup or `setAttribute("style", …)`; CSSOM writes (`style={{ … }}`, `el.style.x = …`) pass | `Applying inline style violates the following Content Security Policy directive 'style-src 'self''`; guard: `CSP violation: style-src-elem inline` or `style-src-attr inline` |
| `connect-src 'self' <origins>` | `fetch`, XHR, `EventSource` and WebSocket to any origin not built in from `PUBLIC_ENV` | `Connecting to 'https://…' violates the following Content Security Policy directive: "connect-src 'self' https://api.example.com"` |
| `object-src 'none'` | `<object>` and `<embed>` | setting `data` hits Trusted Types first: `This document requires 'TrustedScriptURL' assignment.` |
| `base-uri 'none'` | a `<base>` element | `Setting the document's base URI to '…' violates the following Content Security Policy directive: "base-uri 'none'"` |
| `form-action 'self'` | a native form posting to another origin; forms here submit through a mutation, not a navigation. The sign-in add-on adds the identity provider's origin for its sign-out form (`keycloak-spa-auth`) | guard: `CSP violation: form-action <URL>` |
| `frame-ancestors 'none'` | other sites framing the app (clickjacking) | enforced by the framing page's browser |
| `require-trusted-types-for 'script'` | string assignments to HTML, script and script-URL sinks: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `dangerouslySetInnerHTML`, `script.src`, `setAttribute("on…")` | `This document requires 'TrustedHTML' assignment. The action has been blocked.` (also `'TrustedScript'`, `'TrustedScriptURL'`); guard: `CSP violation: require-trusted-types-for trusted-types-sink` |
| `trusted-types 'none'` | creating any Trusted Types policy, `default` included | `Creating a TrustedTypePolicy named 'app-html' violates the following Content Security policy directive: "trusted-types 'none'"` |

On the browser floor, Trusted Types is enforced only in Chromium (Firefox from 148, Safari from
26); Firefox 128 and Safari 17.5 ignore both `trusted-types` directives, while `script-src` and
`style-src 'self'` apply everywhere. Code never depends on `trustedTypes` existing.

Vite 8 emits no inline script (the module-preload polyfill lives in the entry chunk), so
`script-src 'self'` needs no hash or nonce. React 19, TanStack Router, Base UI and Tailwind need no exception;
zod needs `z.config({ jitless: true })` (`src/app/zod-config.ts`, which `vite.config.ts` bundles
into zod's own chunk so it runs before any schema is built).

## The other headers

| Header | Value | Why |
|---|---|---|
| `Cache-Control` | `no-cache` everywhere, `public, max-age=31536000, immutable` under `/assets/` | unhashed files revalidate; hashed files never do |
| `Strict-Transport-Security` | `max-age=63072000; includeSubDomains` | two years, no `preload`: preloading is a decision for the whole domain, not one app |
| `X-Content-Type-Options` | `nosniff` | a JSON or HTML response is never run as script |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | the API and third parties see the origin, never the path or query |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | in Chromium, the app and anything it embeds cannot ask for these; Firefox and Safari ignore the header and ask the user |
| `Cross-Origin-Opener-Policy` | `same-origin` | a cross-origin window the app opens, or that opens it, is severed: no `window.opener`, a handle that reads `closed`, no messages |
| `Cross-Origin-Resource-Policy` | `same-origin` | other sites cannot embed the app's files |

Not sent, on purpose: `X-Frame-Options` (superseded by `frame-ancestors`), `X-XSS-Protection`,
`Expect-CT`, `Cross-Origin-Embedder-Policy` (would block cross-origin images and nothing needs
`SharedArrayBuffer`), `upgrade-insecure-requests` (HSTS and https-only origins cover it).

## Legitimate changes

Every change is made in `deploy/headers.ts` (or `PUBLIC_ENV`), updates the pinned CSP string or
adds an assertion in `deploy/headers.test.ts` in the same commit, and is followed by
`pnpm test:e2e`, which runs the production build behind the new headers. A change to
`trusted-types` also updates `e2e/smoke.spec.ts`, which asserts `trusted-types 'none'`.

- **A new origin the browser calls** (identity provider, realtime, telemetry): add the
  `PUBLIC_*` name to `PUBLIC_ENV` (a realtime origin in its `wss://` form); it reaches
  `connect-src` with no change here, by the procedure above.
- **An add-on that needs another directive**: it changes exactly the directives its own reference
  names (an identity provider's origin in `form-action`, for example), each with a test in
  `deploy/headers.test.ts` and the end-to-end assertion on the served CSP header.
- **Images from another host** (avatars, a CDN, user uploads served by storage): add a directive
  to `csp()`, such as `"img-src 'self' https://images.example.com"`. A host that differs per
  environment comes in through the procedure above (validated as a bare origin)
  but in its own list, passed to `csp()` as a second argument, so it does not widen `connect-src`
  by accident. Never `https:` or `*`.
- **Uploads straight to storage with a signed URL**: the storage origin is one more `PUBLIC_*`
  origin and reaches `connect-src` like the API's. The request is a plain `fetch` that never
  carries the API token; the recipe is `tanstack-query-api`'s files reference. A protected download
  saved through a `blob:` URL, and a navigation to a signed download link, need no CSP change.
- **A preview of a file the user picked** (`URL.createObjectURL(file)` in an `<img>`):
  `"img-src 'self' blob:"`. `blob:` never goes into `script-src`.
- **A frame the app embeds** (a payment page, a document viewer): `"frame-src https://…"` with
  the exact origin. COOP does not affect an iframe, so it is the alternative to a popup. An
  iframe-based sign-in check needs the identity provider's origin here; the scaffold's session
  runs without one.
- **The app embedded by a known parent**: replace `frame-ancestors 'none'` with that exact origin.
- **A cross-origin popup the app exchanges messages with** (payment, popup sign-in): set
  `Cross-Origin-Opener-Policy` to `same-origin-allow-popups`, with a test and a comment naming the
  flow. Under `same-origin` the app's handle reads `closed` and no message arrives in either
  direction. Never drop the header.
- **HTML from an API or a user** (a rich-text field): render it as text by default, or ask the
  backend for structured content. The policy leaves no dependency-free way to read markup:
  `DOMParser.parseFromString`, a `<template>`'s `innerHTML` and `createContextualFragment` are
  Trusted Types sinks too, and throw in Chromium, Firefox and WebKit. When the markup must show,
  stop and put the choice to the user; never install either on your own initiative or to silence a
  violation. One option is a parser package that builds React elements from an allow-list of tags
  and attributes (a new dependency; every `href` still goes through `safeHref`). The other is a
  sanitizer policy, whose cost is a dependency that becomes the one place markup enters the DOM and
  a named exception in the policy. `trusted-types` must list the
  name the sanitizer itself creates: DOMPurify 3 creates `dompurify` on first use, so
  `trusted-types app-html` alone blocks it (`Creating a TrustedTypePolicy named 'dompurify'
  violates…`) and its output is empty, while `trusted-types dompurify` with
  `DOMPurify.sanitize(html, { RETURN_TRUSTED_TYPE: true })` in one module works. Prove the name
  of any other sanitizer with `pnpm test:e2e`.

## An exception the user approved

When a dependency or an integration needs a source the policy refuses, stop and put it to the user;
the decision and its reason go in the app's architecture document. The exception is then written in
`csp()` in its narrowest form: the most specific directive (`style-src-attr` rather than
`style-src`, `frame-src` rather than `default-src`), an exact origin or hash rather than a keyword,
with a one-line comment that names the dependency and the reason. The whole-policy assertion in
`deploy/headers.test.ts` changes in the same commit, so the exception is visible in review and the
test fails if it widens; it is removed with the dependency. Whether a dependency that needs one may
be added at all is `tailwind-base-ui`'s rule.

```ts
    // Approved exception (architecture doc): the map widget sets style attributes.
    "style-src-attr 'unsafe-inline'",
```

## Changes that are never made

| Change | Why it is refused |
|---|---|
| `'unsafe-inline'` in `script-src` or `style-src` | reopens every injection the policy blocks; the violation names the library or code that needs it, and that is what gets replaced |
| `'unsafe-eval'` | same; `new Function` in a dependency is fixed by configuration (`jitless`) or by replacing the dependency |
| a wildcard (`*`, `https:`, `*.example.com`) in any source list | one compromised or attacker-registered host gets full access |
| `data:` in any source list, or `blob:` in `script-src` | `build.assetsInlineLimit: 0` keeps assets as files, so nothing needs `data:`; a `blob:` script runs code no file on the origin holds |
| a `default` or pass-through Trusted Types policy | makes every sink accept strings again |
| a nonce or hash | static hosting has no per-request server to mint a nonce, and there is no inline script to hash |
| an edited `dist/_headers`, `public/_headers` or Caddy header line | overwritten by the next build, and the two targets drift |

## Violation reports with `report-to`

The shipped policy sends no reports; the telemetry add-on sees violations from inside the page.
When the organisation has a CSP report collector, `deploy/headers.ts` adds it to every rule:

- a `Reporting-Endpoints: csp="https://reports.example.com/csp"` header, and `report-to csp` as
  the last CSP directive;
- `report-uri https://reports.example.com/csp` beside it: a browser that supports `report-to`
  ignores `report-uri`, and Firefox before 149 (the floor is 128) sends reports only through
  `report-uri`. Safari sends `report-to` reports from 16.4. The collector accepts both bodies
  (`application/reports+json` and `application/csp-report`), treats them as untrusted input, and
  allows the app's origin in CORS.

The URL comes from a build-time variable read in `vite.config.ts` (not `PUBLIC_*`: the bundle never
calls it), with the same discipline as the origins: an `https:` URL whose origin passes
`isBareOrigin` and whose path contains no whitespace, `;`, `,`, `"`, `'`, `{`, `}` or `$`, or the
build fails. The whole-policy assertion and a `Reporting-Endpoints` assertion change in
`deploy/headers.test.ts` in the same commit.

## Rolling out a change

A change that removes or narrows a source can break a page no test visits. Ship it first as
`Content-Security-Policy-Report-Only` next to the enforced policy, with violations collected by
the telemetry add-on's CSP instrumentation or the `report-to` collector, and enforce it after a week without reports. Directive
semantics, Trusted Types policy mechanics and sanitizer APIs belong to `modern-web-guidance`.
