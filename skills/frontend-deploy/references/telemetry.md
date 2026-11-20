# Grafana Faro telemetry (add-on)

## Contents

what Faro adds and costs · the five places the collector URL goes · the telemetry module
· tracing and backend CORS · what never leaves the browser · source maps · CSP rollout reports.

## What it adds and what it costs

Faro captures errors, web vitals, sessions and, with the tracing package, a `traceparent` on API
requests. The app keeps its one funnel: code calls the platform `reportError`, which dispatches a
`window` `error` event, and Faro's error instrumentation wraps `window.onerror`, so boundary-caught
errors, uncaught errors and `reportError` calls all arrive without a Faro import in feature code.

Measured on the scaffold: the two lazy chunks are about 67 KB gzip together, the entry chunk grows
by about 0.5 KB, and a build without `PUBLIC_FARO_URL` never fetches the chunks. If that 0.5 KB
takes the entry over `ENTRY_BUDGET_BYTES`, raise it by the measured amount in the same change and
name Faro as the cause.

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
Cloud adds an app key after it). It is optional, and it is not a bare origin, so the scaffold's
origin check needs one change.

1. `vite.config.ts`: the change below. `PUBLIC_FARO_URL` joins `PUBLIC_ENV` and `OPTIONAL_ENV`;
   `securityHeaders` skips an unset optional name and takes only the origin of a `*_URL`. Built
   with `PUBLIC_FARO_URL=https://faro.example.com/collect/<key>`, `connect-src` reads
   `'self' https://api.example.com https://faro.example.com`; without it, `'self'
   https://api.example.com`.
2. `src/vite-env.d.ts`: `readonly PUBLIC_FARO_URL?: string;` in `ImportMetaEnv`.
3. `src/app/env.ts`: `faroUrl: import.meta.env.PUBLIC_FARO_URL || undefined,`
4. `.env.development`: leave it out, so local runs send nothing; set it in a shell to test
   against a local Alloy.
5. The deploy pipeline and the image: set it per environment, and add `ARG PUBLIC_FARO_URL` next to
   `ARG PUBLIC_API_ORIGIN` in the `Dockerfile`. Being optional, it needs no placeholder in CI or in
   `playwright.config.ts`.

The `vite.config.ts` change, against the scaffold's file:

```diff
--- a/vite.config.ts
+++ b/vite.config.ts
@@ -8,7 +8,8 @@
 import { caddyHeaders, cloudflareHeaders, headersFor } from "./deploy/headers.ts";

 // The only variables that reach the bundle. Each is public, and each is an origin the CSP allows.
-const PUBLIC_ENV = ["PUBLIC_API_ORIGIN"];
+const PUBLIC_ENV = ["PUBLIC_API_ORIGIN", "PUBLIC_FARO_URL"];
+const OPTIONAL_ENV = ["PUBLIC_FARO_URL"];
 const ENTRY_BUDGET_BYTES = 160_000;

 /** Validates the public origins, then emits the deploy headers and serves them in `vite preview`. */
@@ -19,14 +20,16 @@
     // A hook, not top-level code: tools that only load this file (Vitest, knip) need no environment.
     configResolved({ env, mode }) {
       if (mode === "test") return;
-      origins = names.map((name) => {
+      origins = names.flatMap((name) => {
         const value: unknown = env[name];
+        if (OPTIONAL_ENV.includes(name) && !value) return [];
         if (typeof value !== "string" || !value) throw new Error(`${name} is not set`);
-        // The value goes into the CSP as is: anything past a bare origin could add a directive.
-        if (URL.parse(value)?.origin !== value) {
+        // A *_URL contributes its origin; any other value goes into the CSP as is, so it must be one.
+        const origin = URL.parse(value)?.origin;
+        if (!origin || origin === "null" || (!name.endsWith("_URL") && origin !== value)) {
           throw new Error(`${name} is not a bare origin: ${value}`);
         }
-        return value;
+        return [origin];
       });
     },
     generateBundle() {
```

## The telemetry module

```ts,verify
// file: src/app/telemetry.ts
import { env } from "@/app/env";

/** Grafana Faro, fetched only by builds that set PUBLIC_FARO_URL. */
export async function startTelemetry(collectorUrl: string) {
  const [{ getWebInstrumentations, initializeFaro }, { TracingInstrumentation }] =
    await Promise.all([import("@grafana/faro-web-sdk"), import("@grafana/faro-web-tracing")]);
  initializeFaro({
    url: collectorUrl,
    app: { name: "frontend-app" },
    // Page URLs can carry ids and tokens in the query or fragment: send the path only.
    beforeSend: (item) => {
      const page = URL.parse(item.meta.page?.url ?? "");
      if (page && item.meta.page) item.meta.page.url = page.origin + page.pathname;
      return item;
    },
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

In `src/main.tsx`, import `startTelemetry` from `@/app/telemetry` and call it after
`reloadOnStaleChunk()`:

```ts
if (env.faroUrl) startTelemetry(env.faroUrl).catch(reportError);
```

Requests sent before the chunk has loaded, usually the first route's loader, carry no
`traceparent`. When backend traces of the first load matter, defer the first render in the
start-up shape the add-ons share: `startTelemetry(env.faroUrl).catch(reportError)` is one more
entry in the `Promise.all([...]).then(render, startFailed)` that `frontend-project-structure` shows,
with one more `unknown` in `render`'s tuple type. That puts the chunk on the critical path; a telemetry failure is reported and never
stops the app.

## Tracing and the backend's CORS

`propagateTraceHeaderCorsUrls` lists one pattern per API origin the app calls through `apiFetch`;
never the identity provider, the realtime server, the collector or a third party, though their
origins are in `connect-src` too. `traceparent` is not a CORS-safelisted header, so an origin whose
CORS does not allow it fails the preflight; on the identity provider that is the token exchange and
every refresh. The API's CORS configuration must allow the `traceparent` and `tracestate` request
headers next to `authorization` and `content-type`: a FastAPI `CORSMiddleware` lists them in
`allow_headers`; an axum `CorsLayer` with `allow_headers(Any)` already passes them.

## What never leaves the browser

- No `setUser` with an email or a name: an opaque user id at most.
- `captureConsole: false`: the console is not a log pipeline here, and `noConsole` keeps app code
  out of it.
- No request or response body, header or token in an error's context.
- Never `trackGeolocation`.
- The `apiKey` and the collector URL are public: anyone can read them from the bundle. The
  collector's rate limit and `cors_allowed_origins` protect it, not the key.

## Source maps

The build writes hidden maps (`build.sourcemap: "hidden"`), which the deploy then excludes. Upload
them for the exact release from the CI build job, before the image or the Cloudflare deploy drops
them. For a self-hosted Alloy `faro.receiver`: set `cors_allowed_origins` to the app's origins (the
default empty list rejects every browser), keep `rate_limiting` on, and set
`sourcemaps.download = false`, serving the maps from a filesystem `location` keyed by release
instead; the default downloads maps from any origin, which is an SSRF path and finds nothing,
because no map is public.

## CSP rollout reports

`enableContentSecurityPolicyInstrumentation: true` sends every `securitypolicyviolation` event to
the collector. Before tightening the policy (a removed origin, a new directive), ship the new
policy as `Content-Security-Policy-Report-Only` beside the enforced one for a week, read the
reports, then enforce it.
