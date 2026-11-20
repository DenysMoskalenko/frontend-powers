# Headers and the CSP

## Contents

`deploy/headers.ts` · how the build uses it · the CSP directive by directive · the other
headers · legitimate changes, step by step · changes that are never made · rolling out a change.

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
```

`deploy/headers.test.ts` pins the parts that break silently: the whole CSP string, `no-cache`
against `immutable` by path, the `! Cache-Control` detach line, and the Caddy quoting. Any change
to `csp()` changes the first test's expected string in the same commit.

## How the build feeds it

The `securityHeaders` plugin in `vite.config.ts` reads every name in `PUBLIC_ENV` in its
`configResolved` hook (skipped in `mode === "test"`), refuses a missing value
(`Error: PUBLIC_API_ORIGIN is not set`) or anything but a bare origin
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
| `form-action 'self'` | a native form posting to another origin; forms here submit through a mutation, not a navigation | guard: `CSP violation: form-action <URL>` |
| `frame-ancestors 'none'` | other sites framing the app (clickjacking) | enforced by the framing page's browser |
| `require-trusted-types-for 'script'` | string assignments to HTML, script and script-URL sinks: `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write`, `dangerouslySetInnerHTML`, `script.src`, `setAttribute("on…")` | `This document requires 'TrustedHTML' assignment. The action has been blocked.` (also `'TrustedScript'`, `'TrustedScriptURL'`); guard: `CSP violation: require-trusted-types-for trusted-types-sink` |
| `trusted-types 'none'` | creating any Trusted Types policy, `default` included | `Creating a TrustedTypePolicy named 'app-html' violates the following Content Security policy directive: "trusted-types 'none'"` |

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
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=(), payment=(), usb=()` | the app and anything it embeds cannot ask for these |
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
  `connect-src` with no change here. The procedure is in SKILL.md.
- **Images from another host** (avatars, a CDN): add a directive to `csp()`, such as
  `"img-src 'self' https://images.example.com"`. A host that differs per environment comes in as a
  `PUBLIC_*_ORIGIN` and is passed to `csp()` as a second list, so it does not widen `connect-src`
  by accident. Never `https:` or `*`.
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
- **HTML from an API or a user** (a rich-text field): render it as text, parse it into
  allowlisted React elements, or ask the backend for structured content. A sanitizer policy is
  offered only when the user asks for HTML rendering after hearing its cost (a dependency that
  becomes the one place markup enters the DOM, and a named exception in the policy); the agent
  never adds it on its own initiative or to silence a violation. `trusted-types` must list the
  name the sanitizer itself creates: DOMPurify 3 creates `dompurify` on first use, so
  `trusted-types app-html` alone blocks it (`Creating a TrustedTypePolicy named 'dompurify'
  violates…`) and its output is empty, while `trusted-types dompurify` with
  `DOMPurify.sanitize(html, { RETURN_TRUSTED_TYPE: true })` in one module works. Prove the name
  of any other sanitizer with `pnpm test:e2e`.

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

## Rolling out a change

A change that removes or narrows a source can break a page no test visits. Ship it first as
`Content-Security-Policy-Report-Only` next to the enforced policy, with violations collected by
the telemetry add-on's CSP instrumentation, and enforce it after a week without reports. Directive
semantics, Trusted Types policy mechanics and sanitizer APIs belong to `modern-web-guidance`.
