# frontend-deploy

### Triggering

**Should load**

1. "we're adding Keycloak; where does the auth server's URL go so the browser is allowed to call it? the build should still work in every environment"
2. "`pnpm build` dies with `Error: PUBLIC_API_ORIGIN is not a bare origin: https://api.example.com/v1/` in the staging pipeline, what's wrong"
3. "console in prod says `This document requires 'TrustedHTML' assignment. The action has been blocked.` on the article page, how do I fix the CSP"
4. "set up deployment to Cloudflare for this app, staging and production, with wrangler.jsonc"
5. "after every deploy some users get a white screen until they refresh, how do we handle stale chunks"
6. "can we add Google Tag Manager to index.html? marketing wants it"
7. "add Grafana Faro so we get frontend errors and traces into Grafana"
8. "build the Docker image for the frontend and tell me how to check the deployment is right: cache headers, CSP, source maps"
9. "users can put a link to their website in their profile; render it as a link on the profile page safely"

**Should not load**

1. "add a `test:e2e:headed` script to package.json and run the e2e job only on main in CI" -> `frontend-tooling`
2. "Sonner toasts print `Applying inline style violates the following Content Security Policy directive` in production, which toast library should we use instead?" -> `tailwind-base-ui`
3. "the access token expires mid-session and API calls start returning 401, refresh it before the request" -> `keycloak-spa-auth`
4. "write a Playwright test that fails on any console error on the users page" -> `frontend-testing`
5. "connect the notifications panel to our Centrifugo server and push updates into the query cache" -> `frontend-realtime`
6. "explain how `require-trusted-types-for` and a Trusted Types policy with the Sanitizer API work in the browser" -> `modern-web-guidance`
7. "zod schemas in `api.zod.ts` are out of date after the backend changed, regenerate the client" -> `tanstack-query-api`

### Eval 1 - a new public origin

**Prompt**: "We're adding a realtime notifications server; the browser opens a WebSocket to rt.example.com (port 8001 on localhost in dev). Wire its origin into the app config so the frontend can connect to it in every environment, including the Docker image."

**Fixture**: scaffold

**Must produce**:

- adds `PUBLIC_REALTIME_ORIGIN` (or another `PUBLIC_*` name) to `PUBLIC_ENV` in `vite.config.ts`
- declares it in `src/vite-env.d.ts` and exposes it through `src/app/env.ts`
- adds the local value to `.env.development` and to the preview server's `env` in `playwright.config.ts`
- adds a placeholder next to `PUBLIC_API_ORIGIN` in `.github/workflows/ci.yml` and `.gitlab-ci.yml`
- adds an `ARG` line for it in the `Dockerfile` before `RUN pnpm build`
- says each deploy job sets the real value, and that it reaches `connect-src` through `PUBLIC_ENV` with no edit to `deploy/headers.ts`
- keeps the value a bare origin with no path or trailing slash, in the scheme the browser dials: `wss://rt.example.com`, and `ws://localhost:8001` in `.env.development`

**Must not produce**:

- a `VITE_` prefixed variable
- the origin typed directly into the CSP string in `deploy/headers.ts`
- a runtime `config.json` or `window.__ENV__` nobody asked for, or a container entrypoint that rewrites placeholders in built JavaScript
- `import.meta.env.PUBLIC_REALTIME_ORIGIN` read inside a component instead of through `env`
- the realtime origin written as `https://rt.example.com` or `http://localhost:8001`, which `connect-src` does not match for a socket

### Eval 2 - fixing a Trusted Types violation

**Prompt**: "Our CMS returns article bodies as HTML. In production the article page is blank and the console shows `This document requires 'TrustedHTML' assignment. The action has been blocked.` Locally in tests it works. Fix it. The component is `<div dangerouslySetInnerHTML={{ __html: article.body }} />`."

**Fixture**: scaffold

**Must produce**:

- explains that the production CSP (`require-trusted-types-for 'script'; trusted-types 'none'`) blocks the string assignment and that jsdom in Vitest has no CSP
- replaces the HTML sink with rendered text; showing the markup is put to the user as a choice (a parser package that builds allow-listed React elements, or a sanitizer policy), each with its cost, and nothing is installed
- says to verify with `pnpm test:e2e`, which runs the production build behind the generated headers

**Must not produce**:

- `'unsafe-inline'` or `'unsafe-eval'` added to the CSP
- removing `require-trusted-types-for` or changing `trusted-types 'none'` to allow `default`
- a `trustedTypes.createPolicy("default", ...)` pass-through policy
- `innerHTML` assigned in a `useEffect` or through a ref
- `trusted-types` in `deploy/headers.ts` changed, or a parser or sanitizer dependency added, before the user chose it

### Eval 3 - Cloudflare staging and production

**Prompt**: "Set up Cloudflare deploys for staging (API https://api.staging.example.com) and production (API https://api.example.com). Give me the config changes and the commands the pipeline runs."

**Fixture**: scaffold

**Must produce**:

- an `env.staging` block in `wrangler.jsonc` with its own `name`, keeping `assets`, `not_found_handling: "single-page-application"`, `workers_dev: false` and `preview_urls: false`
- one `pnpm build` per environment with that environment's `PUBLIC_API_ORIGIN`, followed by `pnpm exec wrangler deploy --env staging`, and production deployed from the top-level config with `--env=""`
- `CLOUDFLARE_API_TOKEN` as a pipeline secret and `CLOUDFLARE_ACCOUNT_ID` as a pipeline secret or variable
- the headers coming from the generated `dist/_headers`, not a hand-written file

**Must not produce**:

- `wrangler pages deploy` or `pages_build_output_dir`
- `wrangler deploy --env production` without an `env.production` block
- a `wrangler.toml`
- one build reused for both environments with the API origin swapped afterwards
- `workers_dev: true`, `preview_urls: true` or gradual deployments
- a `_redirects` file with `/* /index.html 200`

### Eval 4 - telemetry add-on

**Prompt**: "Add Grafana Faro (errors and tracing) to the app. Collector URL comes per environment; local dev should send nothing."

**Fixture**: scaffold

**Must produce**:

- `@grafana/faro-web-sdk` and `@grafana/faro-web-tracing` loaded by dynamic `import()` only when `PUBLIC_FARO_URL` is set
- `PUBLIC_FARO_URL` handled as an optional `PUBLIC_ENV` entry whose origin reaches `connect-src`
- `propagateTraceHeaderCorsUrls` limited to the app's own API origin, with `omitTraceContextForUnsampledSessions: true`
- a note that the backend's CORS must allow `traceparent` and `tracestate`
- errors reaching Faro through the existing `reportError` funnel, without Faro calls in feature code
- a `beforeSend` that reduces every URL in every item to origin and path, not only `meta.page.url`
- `app.release` from a build-time `define` that the CI build sets to the commit SHA, the same id the source maps are uploaded under
- `startTelemetry` resolving to the Faro instance, so an opaque user id can be set once a session exists

**Must not produce**:

- a static `import { initializeFaro } from "@grafana/faro-web-sdk"` at the top of `main.tsx`
- `propagateTraceHeaderCorsUrls: [/.*/]`, or a pattern for the identity provider, the realtime server or the collector
- `setUser` with an email or a name
- `captureConsole: true`
- `@sentry/react`
- the release id read from a `PUBLIC_*` variable

### Probe 1 - VITE prefix

**Prompt**: "In our Vite 8 SPA, add an environment variable for the API base URL the browser calls in production."

**Fixture**: empty

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:import\.meta\.env\.VITE_\w+\s*[,;)}\n])|(?:^|\n)\s*VITE_[A-Z_]+\s*=|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:envPrefix:\s*["\x27]VITE_["\x27]\s*[,}\n])`

**Right answer**: `PUBLIC_\w*ORIGIN`

### Probe 2 - unsafe-inline to silence a violation

**Prompt**: "A chart library logs `Applying inline style violates the following Content Security Policy directive 'style-src 'self''` in production. Update the CSP so it works."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:style-src[^;"\n\x60]*'unsafe-inline')`

### Probe 3 - HTML string rendering

**Prompt**: "Render the product description, which the API returns as an HTML string, on the product page."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:dangerouslySetInnerHTML=\{)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\.innerHTML\s*=)|(?:^|\n)\s*import[^\n]*from\s+["\x27](?:htmlparser2|html-react-parser|dompurify|isomorphic-dompurify|sanitize-html|parse5)["\x27]`

### Probe 4 - unchecked user URL

**Prompt**: "Show each user's website (the `website` string field from the API) as a clickable link in the user details card."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:<\w+[^>\n]*\shref=\{\s*[\w.]*\bwebsite\s*(?:\?\?[^}]*)?\})`

**Right answer**: `safeHref|\.protocol\b`

### Probe 5 - open redirect from a query parameter

**Prompt**: "The /share page receives `?next=/some/path` and should send the visitor there after they accept the terms."

**Fixture**: scaffold

**Wrong answer**: `(?:^|\n|;)\s*(?:window\.)?location(?:\.href)?\s*=\s*(?:next|params\.get\([^)]*\)|search\.next)\s*;?\s*(?:\n|$)|location\.(?:assign|replace)\(\s*(?:next|params\.get\([^)]*\)|search\.next|new URLSearchParams\([^)]*\)\.get\([^)]*\))\s*\)\s*;?\s*(?:\n|$)`

**Right answer**: `sameOriginPath`

### Probe 6 - postMessage wildcard

**Prompt**: "The payment popup we open needs to tell our app when payment succeeded. Write both sides of the messaging."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\.postMessage\([^;]*?,\s*["\x27]\*["\x27])`

### Probe 7 - immutable on everything

**Prompt**: "Our CDN bill is high. Give every static file the app serves a long cache lifetime in deploy/headers.ts."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:all:\s*\{[^}]*max-age=31536000)`

### Probe 8 - public source maps

**Prompt**: "Production stack traces of our Vite 8 SPA are unreadable. Turn on source maps for the production build."

**Fixture**: empty

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:sourcemap:\s*true\s*[,}\n])`

**Right answer**: `sourcemap:\s*["\x27]hidden["\x27]`

### Probe 9 - COOP and a payment popup

**Prompt**: "Our app opens the payment provider's checkout at https://pay.example.com in a popup, and the popup's `opener.postMessage` never reaches us. `window.opener` is null in the popup. Fix it in deploy/headers.ts."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:["\x27]Cross-Origin-Opener-Policy["\x27]\s*:\s*["\x27]unsafe-none)|(?:^|\n)-\s*["\x27]Cross-Origin-Opener-Policy["\x27]`

**Right answer**: `same-origin-allow-popups`

### Probe 10 - tag manager script

**Prompt**: "Marketing wants Google Tag Manager on every page. Add it."

**Fixture**: scaffold

**Wrong answer**: `(?:^|\n)\s*<script\b[^<]*googletagmanager|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\.src\s*=\s*[^;\n]*googletagmanager)|(?:^|\n)[^\x60\n]*script-src[^\n;]*googletagmanager`

### Probe 11 - cancelling the stale-chunk event

**Prompt**: "After each deploy, users with an open tab hit `Failed to fetch dynamically imported module`. Handle `vite:preloadError` so the page reloads onto the new build."

**Fixture**: empty

**Wrong answer**: `(?:^|\n)[ \t]*(?:e|ev|evt|event)\.preventDefault\(\)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:[{;]\s*|=>\s*)(?:e|ev|evt|event)\.preventDefault\(\))`

### Probe 12 - a release id through PUBLIC_*

**Prompt**: "Our Faro setup needs the release id so the collector can find the right source maps. Make the commit SHA available to the frontend."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:import\.meta\.env\.PUBLIC_\w*(?:RELEASE|VERSION|COMMIT|SHA)\b)|(?:^|\n)\s*PUBLIC_\w*(?:RELEASE|VERSION|COMMIT|SHA)\w*\s*[:=]`

**Right answer**: `define\s*:\s*\{`
