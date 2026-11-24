# Grafana Faro telemetry (add-on)

## Contents

what Faro adds and costs · the collector URL in five places · the `vite.config.ts` edits · the
release id · the telemetry module and its test · `main.tsx` and the user id · tracing and backend
CORS · what never leaves the browser · source maps · CSP violations and rollout reports.

## What it adds and what it costs

Faro captures errors, web vitals, sessions and, with the tracing package, a `traceparent` on API
requests. The app keeps its one funnel: code calls the platform `reportError`, which dispatches a
`window` `error` event, and Faro's error instrumentation wraps `window.onerror`, so boundary-caught
errors, uncaught errors and `reportError` calls all arrive without a Faro import in feature code.
An unhandled promise rejection raises `unhandledrejection`, not `error`; Faro's error
instrumentation listens for it too, so a tracker that replaces Faro must listen for both events.

Measured on the scaffold: the two lazy chunks are about 67 KB gzip together, the entry chunk grows
by about 0.6 KB, and a build without `PUBLIC_FARO_URL` never fetches the chunks. Raise
`ENTRY_BUDGET_BYTES` by the measured growth in the same change, over budget or not, and name Faro as
the cause: every add-on does, so the budget comes out the same in whatever order they arrive.

Packages: `pnpm add @grafana/faro-web-sdk @grafana/faro-web-tracing` (a bare add writes exact pins).

`@grafana/faro-web-tracing` 2.14.0 depends on `@opentelemetry/api@^1.9.0`, which resolves to 1.10.0,
while the `@opentelemetry/core`, `resources` and `sdk-trace-web` 2.12.1 it also pulls in declare the
peer `@opentelemetry/api >=1.0.0 <1.10.0`. pnpm installs anyway and reports the unmet peer. Pin the
API to the newest version inside every range, in `pnpm-workspace.yaml`:

```yaml
overrides:
  "@opentelemetry/api": 1.9.1
```

Drop the override when a Faro release depends on an OpenTelemetry line whose peers accept the
resolved API.

## The collector URL, in five places

`PUBLIC_FARO_URL` is the full collector URL (an Alloy `faro.receiver` ends in `/collect`, Grafana
Cloud adds an app key after it). It is optional, and it is not a bare origin, so the origin check
in `vite.config.ts` needs the edits below.

1. `vite.config.ts`: the edits below. Built with
   `PUBLIC_FARO_URL=https://faro.example.com/collect/<key>`, `connect-src` gains
   `https://faro.example.com`; without it, nothing.
2. `src/vite-env.d.ts`: `readonly PUBLIC_FARO_URL?: string;` in `ImportMetaEnv`.
3. `src/app/env.ts`: `faroUrl: import.meta.env.PUBLIC_FARO_URL || undefined,`
4. `.env.development`: leave it out, so local runs send nothing; set it in a shell to test
   against a local Alloy.
5. The deploy pipeline and the image: set it per environment, and add `ARG PUBLIC_FARO_URL` next to
   `ARG PUBLIC_API_ORIGIN` in the `Dockerfile`. Being optional, it needs no placeholder in CI or in
   `playwright.config.ts`.

## The `vite.config.ts` edits

Four edits. Each is placed by a line that the scaffold and `keycloak-spa-auth`'s `form-action`
edits both leave in place, so the two add-ons apply in either order and give the same file:

1. `"PUBLIC_FARO_URL"` becomes the last entry of `PUBLIC_ENV` (an origin added later goes before
   it), and directly below the `PUBLIC_ENV` statement:

```ts
// May be unset; a *_URL name holds a full URL, and the CSP gets its origin.
const OPTIONAL_ENV = ["PUBLIC_FARO_URL"];
```

2. In `defineConfig`, directly below `resolve: { tsconfigPaths: true },`, the release id (next
   section): `define: { __RELEASE__: JSON.stringify(process.env.RELEASE || "dev") },`
3. In `securityHeaders`' `configResolved`, the per-name check becomes a named function that
   returns a list. On the bare scaffold it is the `origins = names.map((name) => { ... });`
   callback: it becomes `const toOrigins = (name: string) => { ... };`, its `return value;`
   becomes `return [value];`, and `origins = names.flatMap(toOrigins);` follows it.
   `keycloak-spa-auth` makes the same change; once `toOrigins` exists, skip this step.
4. Inside `toOrigins`: below `const value: unknown = env[name];` add
   `if (OPTIONAL_ENV.includes(name) && !value) return [];`; replace the comment above the
   `isBareOrigin(value)` check and that check's first line with the three lines below; and
   `return [value];` becomes `return [origin];`. An unset optional name contributes nothing, a
   `*_URL` contributes its origin, and every origin still passes `isBareOrigin`, so
   `https://*/collect` fails the build like `https://*` does.

```ts
// A *_URL contributes its origin; any other value goes into the CSP as is, so it must be one.
const origin = name.endsWith("_URL") ? URL.parse(value)?.origin : value;
if (!origin || !isBareOrigin(origin)) {
```

With `keycloak-spa-auth`'s edits as well, in either order, the top of the file and the plugin read
as follows; without them, `PUBLIC_AUTH_ORIGIN`, `FORM_ACTION_ENV`, `formNames` and `formOrigins` are absent and the
`emitFile` and `headersFor` calls keep the scaffold's one-line form. The plugin list calls
`securityHeaders(PUBLIC_ENV, FORM_ACTION_ENV)`. Biome formats the file as written.

```ts
// The only variables that reach the bundle. Each is public, and each is an origin the CSP allows.
const PUBLIC_ENV = ["PUBLIC_API_ORIGIN", "PUBLIC_AUTH_ORIGIN", "PUBLIC_FARO_URL"];
// May be unset; a *_URL name holds a full URL, and the CSP gets its origin.
const OPTIONAL_ENV = ["PUBLIC_FARO_URL"];
// keycloak-js posts its sign-out form there, so the ID token stays out of every URL.
const FORM_ACTION_ENV = ["PUBLIC_AUTH_ORIGIN"];
const ENTRY_BUDGET_BYTES = 160_000;

/** Validates the public origins, then emits the deploy headers and serves them in `vite preview`. */
function securityHeaders(names: readonly string[], formNames: readonly string[]): Plugin {
  let origins: string[] = [];
  let formOrigins: string[] = [];
  return {
    name: "security-headers",
    // A hook, not top-level code: tools that only load this file (Vitest, knip) need no environment.
    configResolved({ env, mode }) {
      if (mode === "test") return;
      const toOrigins = (name: string) => {
        const value: unknown = env[name];
        if (OPTIONAL_ENV.includes(name) && !value) return [];
        if (typeof value !== "string" || !value) throw new Error(`${name} is not set`);
        // A *_URL contributes its origin; any other value goes into the CSP as is, so it must be one.
        const origin = name.endsWith("_URL") ? URL.parse(value)?.origin : value;
        if (!origin || !isBareOrigin(origin)) {
          throw new Error(`${name} is not a bare origin: ${value}`);
        }
        return [origin];
      };
      origins = names.flatMap(toOrigins);
      formOrigins = formNames.flatMap(toOrigins);
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "_headers",
        source: cloudflareHeaders(origins, formOrigins),
      });
      this.emitFile({
        type: "asset",
        fileName: "headers.caddy",
        source: caddyHeaders(origins, formOrigins),
      });
      // Cloudflare uploads everything else in dist; source maps go to the error tracker only.
      this.emitFile({ type: "asset", fileName: ".assetsignore", source: "*.map\nheaders.caddy\n" });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        for (const [name, value] of Object.entries(
          headersFor(request.url ?? "/", origins, formOrigins),
        )) {
          response.setHeader(name, value);
        }
        next();
      });
    },
  };
}
```

## The release id

Faro sends `app.release` with every item, and the collector looks up source maps by it. It is
not an origin, so it never goes through `PUBLIC_*`: the `define` above writes it into the bundle
as a string literal at build time, and the module declares `__RELEASE__` so `tsc` knows it. The CI
build sets `RELEASE` to the commit SHA, and the source maps are uploaded under that same value;
a local build reports `"dev"`.

```yaml
# .github/workflows/ci.yml: beside PUBLIC_API_ORIGIN in the top-level env
env:
  RELEASE: ${{ github.sha }}
```

```yaml
# .gitlab-ci.yml: beside PUBLIC_API_ORIGIN in variables
variables:
  RELEASE: $CI_COMMIT_SHA
```

The image build needs `ARG RELEASE` next to `ARG PUBLIC_FARO_URL` and `--build-arg
RELEASE=<sha>`.

## The telemetry module

```ts,verify
// file: src/app/telemetry.ts
import type { Faro, TransportItem } from "@grafana/faro-web-sdk";
import { env } from "@/app/env";

/** `define` in vite.config.ts replaces it: the commit SHA a CI build sets in `RELEASE`, "dev" locally. */
declare const __RELEASE__: string;

// A whole URL in a text: it carries search terms, ids, a sign-in callback's code and state after
// its first `?` or `#`. Matched once per URL, so the time stays linear in the text's length.
const URL_IN_TEXT = /\b(?:https?|wss?):\/\/[^\s"'<>\\]*/gi;

/** Every URL anywhere in a telemetry item, reduced to its origin and path; nothing else changes. */
export function withoutQueries(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(URL_IN_TEXT, (url) => url.replace(/[?#].*/, ""));
  }
  if (Array.isArray(value)) return value.map(withoutQueries);
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, withoutQueries(item)]),
    );
  }
  return value;
}

/** Grafana Faro, fetched only by builds that set PUBLIC_FARO_URL; the caller sets the user on it. */
export async function startTelemetry(collectorUrl: string): Promise<Faro> {
  const [{ getWebInstrumentations, initializeFaro }, { TracingInstrumentation }] =
    await Promise.all([import("@grafana/faro-web-sdk"), import("@grafana/faro-web-tracing")]);
  return initializeFaro({
    url: collectorUrl,
    // The id the source maps are uploaded under, so the collector finds them.
    app: { name: "frontend-app", release: __RELEASE__ },
    // Navigation and resource timings, spans, CSP reports and the page meta all carry full URLs.
    beforeSend: (item) => withoutQueries(item) as TransportItem,
    instrumentations: [
      ...getWebInstrumentations({
        captureConsole: false,
        enableContentSecurityPolicyInstrumentation: true,
      }),
      new TracingInstrumentation({
        // An unsampled session sends no traceparent, so the backend takes its own sampling decision.
        omitTraceContextForUnsampledSessions: true,
        instrumentationOptions: {
          // A bare origin, checked at build time: escaping its dots is enough.
          propagateTraceHeaderCorsUrls: [new RegExp(`^${env.apiOrigin.replaceAll(".", "\\.")}/`)],
        },
      }),
    ],
  });
}
```

`withoutQueries` keeps the item's shape and cuts the query and fragment off every URL in every
string: the page URL in `meta`, a navigation timing's `name` (a sign-in callback's `code` and
`state` included), resource timings and spans (the API's search parameters), and a CSP report's
`documentURI`, whatever the scheme's case. It matches each URL once, so a long error text full of
URLs costs linear time inside every send. A relative URL (`/users?q=…`) is left as is; browsers
report absolute ones. The test runs it on items recorded from Chromium:

```ts,verify,test
// file: src/app/telemetry.test.ts
import { expect, test } from "vitest";
import { withoutQueries } from "./telemetry";

// Recorded from Chromium: a page load that carries a search and a sign-in callback.
const pageUrl = "http://localhost:4173/users?page=1&email=alice%40example.com";
const policy =
  "default-src 'self'; connect-src 'self' https://api.example.com https://faro.example.com";

test("a navigation item keeps origin and path only, wherever the URL sits", () => {
  const navigation = {
    type: "event",
    payload: {
      name: "faro.performance.navigation",
      domain: "browser",
      attributes: {
        name: `${pageUrl}#state=STATE123&session_state=SESS456&code=AUTHCODE789&iss=x`,
        httpHost: "localhost:4173",
        duration: "309",
      },
      timestamp: "2026-11-22T12:50:53.747Z",
    },
    meta: { app: { name: "frontend-app", release: "dev" }, page: { url: pageUrl } },
  };

  expect(withoutQueries(navigation)).toEqual({
    ...navigation,
    payload: {
      ...navigation.payload,
      attributes: { ...navigation.payload.attributes, name: "http://localhost:4173/users" },
    },
    meta: { ...navigation.meta, page: { url: "http://localhost:4173/users" } },
  });
});

test("a CSP violation item loses the page's query and keeps the policy as sent", () => {
  const violation = {
    type: "event",
    payload: {
      name: "securitypolicyviolation",
      domain: "browser",
      attributes: {
        blockedURI: "inline",
        documentURI: pageUrl,
        effectiveDirective: "style-src-attr",
        originalPolicy: policy,
        sourceFile: "http://localhost:4173/assets/index-abc.js?v=1",
      },
      timestamp: "2026-11-22T12:50:55.566Z",
    },
    meta: { page: { url: pageUrl } },
  };

  expect(withoutQueries(violation)).toEqual({
    ...violation,
    payload: {
      ...violation.payload,
      attributes: {
        ...violation.payload.attributes,
        documentURI: "http://localhost:4173/users",
        sourceFile: "http://localhost:4173/assets/index-abc.js",
      },
    },
    meta: { page: { url: "http://localhost:4173/users" } },
  });
});

test("a URL inside a longer text loses its query too", () => {
  expect(withoutQueries(["GET https://api.example.com/users?q=ada failed", 3, null])).toEqual([
    "GET https://api.example.com/users failed",
    3,
    null,
  ]);
});

test("a text full of URLs without a query is scanned once, not once per URL", () => {
  const text = "http://a/".repeat(16_000);
  const started = performance.now();

  expect(withoutQueries(text)).toBe(text);
  expect(performance.now() - started).toBeLessThan(200);
});

test("an upper-case scheme loses its query too", () => {
  expect(withoutQueries("HTTPS://API.example.com/users?email=a@b.c")).toBe(
    "HTTPS://API.example.com/users",
  );
});
```

## `main.tsx` and the user id

`startTelemetry(collectorUrl: string): Promise<Faro>` resolves to the Faro instance once the
chunks have loaded. In `src/main.tsx`, before anything that waits: on the bare scaffold after
`reloadOnStaleChunk(router)`, with a sign-in or i18n add-on above their start-up, as
`frontend-project-structure`'s app-composition reference shows:

```ts
const telemetry = env.faroUrl ? startTelemetry(env.faroUrl) : undefined;
telemetry?.catch(reportError);
```

Once a session exists (the sign-in add-on, `keycloak-spa-auth`), the composition root gives Faro
the session's opaque user id; the rejection was already reported above:

```ts
if (userId)
  void telemetry?.then(
    (faro) => faro.api.setUser({ id: userId }),
    () => {},
  );
```

Requests sent before the chunks have loaded, usually the first route's loader, carry no
`traceparent`. When backend traces of the first load matter, the first render also waits for
`telemetry`, in the start-up shape `frontend-project-structure` shows. That puts the chunks on the
critical path; a telemetry failure is reported and never stops the app.

## Tracing and the backend's CORS

`propagateTraceHeaderCorsUrls` lists one pattern per API origin the app calls through `apiFetch`;
never the identity provider, the realtime server, the collector or a third party, though their
origins are in `connect-src` too. `traceparent` is not a CORS-safelisted header, so an origin whose
CORS does not allow it fails the preflight; on the identity provider that is the token exchange and
every refresh. The API's CORS configuration must allow the `traceparent` and `tracestate` request
headers next to `authorization` and `content-type`: a FastAPI `CORSMiddleware` lists them in
`allow_headers`; an axum `CorsLayer` with `allow_headers(Any)` already passes them.

## What never leaves the browser

- No query or fragment of any URL: `beforeSend` runs `withoutQueries` on every item, because
  navigation and resource timings, spans and CSP reports carry full URLs, not only `meta.page`.
- No `setUser` with an email or a name: an opaque user id at most.
- `captureConsole: false`: the console is not a log pipeline here, and `noConsole` keeps app code
  out of it.
- No request or response body, header or token in an error's context.
- Never `trackGeolocation`.
- The `apiKey` and the collector URL are public: anyone can read them from the bundle. The
  collector's rate limit and `cors_allowed_origins` protect it, not the key.

## Source maps

The build writes hidden maps (`build.sourcemap: "hidden"`), which the deploy then excludes. Upload
them from the CI build job under the build's `RELEASE`, before the image or the Cloudflare deploy
drops them. For a self-hosted Alloy `faro.receiver`: set `cors_allowed_origins` to the app's
origins (the default empty list rejects every browser), keep `rate_limiting` on, and set
`sourcemaps.download = false`, serving the maps from a filesystem `location` whose `path` contains
`{{ .Release }}`, which the receiver fills from `app.release`; the default downloads maps from any
origin, which is an SSRF path and finds nothing, because no map is public.

## CSP violations and rollout reports

The shipped CSP has no reporting directive, so without Faro a violation in production is seen only
in the user's console. `getWebInstrumentations` includes Faro's CSP instrumentation (on unless
`enableContentSecurityPolicyInstrumentation: false`; the module sets it explicitly): it listens for
`securitypolicyviolation` on `document` and sends each one as an event of that name, with
`effectiveDirective`, `blockedURI`, `sourceFile`, `sample` and `disposition`, scrubbed like every
other item. It sees only violations after its chunks have loaded; the `report-to` header in the
headers reference also covers the first load and needs no add-on.

Browser extensions inject styles and scripts into the page and raise violations the app did not
cause. Tell them apart in the query, never in `beforeSend`:

- a `sourceFile` or `blockedURI` with an extension scheme (`chrome-extension:`, `moz-extension:`,
  `safari-web-extension:`) is an extension;
- the app's own violation names a `sourceFile` under `/assets/` of the current release, repeats
  across sessions and browsers, and `pnpm test:e2e` reproduces it, since its browsers run without
  extensions;
- an `inline` violation with an empty `sourceFile` in a few sessions only is almost always an
  extension; one that follows a release is the app's.

Before tightening the policy (a removed origin, a new directive), ship the new policy as
`Content-Security-Policy-Report-Only` beside the enforced one for a week, read the reports
(`disposition: "report"`), then enforce it.
