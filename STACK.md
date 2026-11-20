# Frontend web stack

One pick per concern. Decided 19 November 2026.

Toolchain: Node 26.13, pnpm 12.21, TypeScript 7.0. python-powers (FastAPI) and rust-powers (axum)
are the sibling projects for the backends this frontend calls.
Validated 19 November 2026 on the scaffold in `skills/frontend-scaffolding/assets/app/`:
`pnpm install --frozen-lockfile`, `pnpm check`, `pnpm build`, `pnpm test:e2e` (Playwright against the
production build behind the generated headers), the Caddy container with curl checks, and
`wrangler dev` header checks.

Version policy: exact pins, the newest release older than the three-day cooldown on the day of an
audit. A new major is adopted only after the scaffold gate and the snippet run pass on it.

## One Pick Per Concern

| Concern | Pick | Note |
|---|---|---|
| app type | client-rendered single-page app | no server rendering of any kind |
| runtime and package manager | Node 26 + pnpm 12, pinned in `devEngines` with `onFail: "download"` | no `packageManager` field, no `.nvmrc` |
| dependency cooldown | `minimumReleaseAge: 4320` (three days) in `pnpm-workspace.yaml` | plus `saveExact`, `trustPolicy: no-downgrade`, `allowBuilds` |
| language | TypeScript 7, one `tsconfig.json` | `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly` |
| build | Vite 8 + `@vitejs/plugin-react` 6 | Rolldown; no manual chunks |
| UI library | React 19 with the React Compiler | on in dev and build, off under Vitest |
| routing | TanStack Router, file routes, `autoCodeSplitting` | directory routes |
| server state | TanStack Query 5 | loaders call `queryClient.query`, components `useSuspenseQuery` |
| API client | orval 8: react-query client over `fetch`, zod schemas, MSW handlers | generated from a committed `openapi.json` |
| error model | one `ApiError` thrown by `apiFetch` | covers axum `ErrorBody`, FastAPI `detail`, RFC 9457 |
| validation | zod 4 at trust boundaries | `z.config({ jitless: true })` because of the CSP |
| forms | TanStack Form + zod + Base UI `Field` | plain `<form>` + `FormData` for one field |
| client state | none by default | URL search params, Query cache, `useState`, a Context mounted in `src/app`; zustand 5 when needed |
| styling | Tailwind CSS 4 + Base UI wrappers in `src/shared/ui` | static CSS only |
| lint and format | Biome 2 | type-aware nursery rules and the Tailwind rules switched on explicitly |
| module boundaries | Biome GritQL plugin `biome-plugins/boundaries.grit` | with a regression test |
| dead code | knip 6 | |
| unit and integration tests | Vitest 5 + Testing Library + user-event + MSW 3, jsdom | route tests through `renderRoute` |
| end-to-end tests | Playwright against the production build | axe scan, guard fixture for console, page and CSP errors |
| git hooks | prek | installed by `pnpm hooks` |
| task entrypoint | `package.json` scripts, gate `pnpm check` | no Makefile in an app |
| CI | self-contained `.gitlab-ci.yml` and `.github/workflows/ci.yml` | same jobs in both |
| configuration | one build per environment, public `PUBLIC_*` origins | validated in a Vite plugin hook |
| security headers | generated from `deploy/headers.ts` | strict CSP with Trusted Types |
| deploy, default | Cloudflare Workers static assets | assets only, no Worker script |
| deploy, container | Caddy 2.11 on `scratch` | non-root, read-only root filesystem |
| error reporting | the platform `reportError` | one funnel, trackers listen on `window` |
| observability | Grafana Faro Web SDK | add when needed |
| authentication | keycloak-js, Authorization Code + PKCE | add when needed |
| translations | i18next 27 + react-i18next 18 + i18next-cli | add when needed |
| realtime | SSE over `fetch` + `eventsource-parser`; Centrifugo + `centrifuge` | add when needed |
| shared packages | pnpm workspace of source-only packages | add when needed |

## Decisions

### Tooling

- **Node 26 + pnpm 12**, both pinned exactly in `package.json` `devEngines` with
  `onFail: "download"`: pnpm fetches the pinned Node and switches to the pinned pnpm. Node 25 and
  later ship no corepack, so CI images and the Dockerfile bootstrap with
  `npm install --global pnpm@<version>` and nothing else ever calls npm.
- **Supply chain** in `pnpm-workspace.yaml`: `minimumReleaseAge: 4320` (npm's 72-hour unpublish
  window; set explicitly, which makes the cooldown strict), `saveExact: true`,
  `trustPolicy: no-downgrade` with `trustPolicyIgnoreAfter: 43200`, and `allowBuilds` listing every
  package with a lifecycle script and a reason. pnpm 12 ignores the older `onlyBuiltDependencies`
  and fails on unknown workspace keys. pnpm 12.21 also asks to approve agent skills that packages
  ship; the scaffold declines them under `permissions`.
- `pnpm add pkg@<range>` writes a caret range even with `saveExact`; only a bare `pnpm add pkg`
  writes an exact pin. Check `package.json` after adding with a range.
- **Scripts** are the task entrypoint. `pnpm check` is `biome check && tsc && knip && vitest run`.
  Coverage thresholds run in `pnpm test:coverage` and CI.
- **prek** runs the hooks (`repo: builtin` plus local `pnpm exec` hooks), installed by `pnpm hooks`.
  There is no `prepare` script, so an install never changes `.git`.
- **knip 6** finds unused files, exports and dependencies. It does not use the TypeScript compiler
  API, which TypeScript 7 does not ship.
- **CI**: jobs `check` (`pnpm dedupe --check`, `biome ci`, `tsc`, knip, generated-client drift,
  Vitest with coverage, build with the bundle budget), `audit` (`pnpm audit --audit-level=high`) and
  `e2e` (Playwright image whose tag equals the `@playwright/test` version). GitHub actions are
  pinned by commit SHA.

### Language

- **TypeScript 7** is the native compiler. It removes `baseUrl` and `moduleResolution: node`,
  defaults `types` to `[]` and `noUncheckedSideEffectImports` to `true`, and ships no compiler API,
  so typescript-eslint cannot run and is not missed.
- One `tsconfig.json` with `module: "preserve"`, `target` and `lib` `es2024`, `paths` for `@/*`,
  and no project references. `erasableSyntaxOnly` forbids enums, namespaces and parameter
  properties; Node 26 then runs every `.ts` config and script file directly.
- `noPropertyAccessFromIndexSignature` is off: it fights `import.meta.env` and record lookups for
  no caught bug.
- **Dates and money**: ISO strings on the wire, `Date` for instants, cached module-level
  `Intl.*Format` instances for display. Money is integer minor units or a decimal string, passed to
  `Intl.NumberFormat#format` as a numeric string (narrowed to `` `${number}` ``; a plain `string`
  is TS2769). `Temporal` is not used: no Safari support.

### Build

- **Vite 8** on Rolldown: `resolve.tsconfigPaths: true` replaces the tsconfig-paths plugin,
  `build.rolldownOptions` replaces `rollupOptions`. `@vitejs/plugin-react` 6 has no Babel; the
  React Compiler runs through `@rolldown/plugin-babel` with `reactCompilerPreset()`.
- **React Compiler**: on for `vite` and `vite build`, off under Vitest. Measured on the scaffold:
  build 997 ms with it against 677 ms without, tests unchanged, entry +0.4 KB gzip. It is off in
  tests because compiled components carry memo-cache branches that only an unchanged re-render
  takes: v8 branch coverage fell from 84 % to 78 %, under the 80 % gate. The end-to-end suite runs
  the compiled production build. Code therefore carries no new `useMemo`, `useCallback` or `memo`.
- **Browser floor**: `build.target` is chrome119, edge119, firefox128, safari17.4. Tailwind 4 needs
  Firefox 128; the rest matches `lib: es2024`. Lightning CSS rewrites `light-dark()` for the
  browsers on the floor that lack it.
- **Bundle budget**: a plugin in `vite.config.ts` gzips the entry chunk, its static imports and its
  CSS in `generateBundle` and fails the build over 160 KB. The scaffold measures about 148 KB, of
  which zod is about 24 KB because `validateSearch` stays in the entry chunk. An add-on that must
  load before first render raises the budget by its measured cost in the same change: keycloak-js
  about 10 KB, i18next with react-i18next about 20 KB.
- `build.assetsInlineLimit: 0`: an inlined `data:` URL would need `data:` in the CSP.
  `build.sourcemap: "hidden"`: maps are written for an error tracker and never deployed.

### Structure

- Feature-based: `src/routes` (file routes) → `src/features/<domain>` → `src/shared` and `src/api`.
  `src/app` is the composition root and may import anything; `src/test` is imported only by tests.
- Enforced by a Biome GritQL plugin (no `../` imports, no feature-to-feature imports, no upward
  imports, `@/test/` only from tests) with a Vitest regression test that lints seeded violations.
- `@/*` alias for other folders, `./x` for the same folder. No barrels, no default exports outside
  config files, kebab-case file names outside `src/routes`.
- A route file exports only `Route`: an exported component in a route file, or a barrel between a
  route and its feature, defeats `autoCodeSplitting`.

### Routing and data

- **TanStack Router**: `createFileRoute`, `validateSearch` with a zod schema passed directly,
  `loaderDeps`, a loader that fills the Query cache, `errorComponent` and `notFoundComponent`.
  The router JSON-parses search values, so free text is `z.coerce.string()`.
  `routeFileIgnorePattern` keeps colocated `*.test.tsx` files out of the route tree.
  `defaultPreload: "intent"` with `defaultPreloadStaleTime: 0`, so Query alone owns freshness.
- **TanStack Query 5.107**: `ensureQueryData`, `prefetchQuery` and `fetchQuery` are deprecated in
  favour of `queryClient.query({ ...options, staleTime: "static" })`. Mutation callbacks receive
  `(data, variables, onMutateResult, { client, meta, mutationKey })`.
- Loaders spread orval's `getXQueryOptions`, components call
  `useSuspenseQuery(getXSuspenseQueryOptions())`: under `exactOptionalPropertyTypes`
  `queryClient.query` rejects the suspense options type (TS2379). Both share a key and a fetch.
- **orval 8**: `client: "react-query"`, `httpClient: "fetch"`, `mode: "single"`, mutator
  `apiFetch`, `fetch.includeHttpResponseReturnType: false`, `query.useSuspenseQuery: true`,
  `query.shouldSplitQueryKey: true`; a second output with `client: "zod"`; MSW handlers from
  `mock: { generators: [{ type: "msw" }] }`, always called with explicit data. Generated files are
  committed and CI fails when `pnpm api:generate` changes them.
- **`ApiError`** `{ status, message, code, requestId, fieldErrors, body }` is built in the mutator
  from an axum `ErrorBody`, a FastAPI `detail` or an RFC 9457 problem document. Query's `Register`
  types `defaultError` as `ApiError | Error`.
- `createQueryClient(notify)`: `staleTime` 30 s; retries only for network errors and 408, 429,
  502, 503, 504; mutations never retry; a failed background refetch and an unhandled mutation
  error call `notify` with a reason (`"refresh"` or `"mutation"`), which `createAppRouter` turns
  into a toast; a failed first load is the route's error screen (`defaultErrorComponent`).
- **zod 4** validates search params, forms, storage and socket messages, never an own-backend
  response. zod probes `new Function` when it builds an object schema, which the Trusted Types
  policy reports on every page; `src/app/zod-config.ts` sets `z.config({ jitless: true })`, is
  the first import of `main.tsx`, and `vite.config.ts` groups it into zod's own chunk
  (`codeSplitting.groups`), so it runs before any schema is built whatever the chunking. A schema
  module may therefore be imported statically from entry code, and a top-level `await` in
  `main.tsx` does not break the CSP.

### Forms

- **TanStack Form 1** with the request schema from `api.zod.ts` as the `onSubmit` validator and
  Base UI `Field` parts for labels, descriptions and errors. Submit goes through the generated
  mutation; `ApiError.fieldErrors` maps onto fields with `setErrorMap`; a conflict is a form-level
  error; `useBlocker` guards a dirty form.
- React 19 form actions are not used for server writes: they bypass the mutation cache.

### Styling

- **Tailwind CSS 4**, CSS-first: one `src/styles.css` with `@import "tailwindcss"`, semantic colour
  tokens defined as `light-dark()` pairs and exposed through `@theme inline`, and
  `--color-*: initial` so palette utilities such as `bg-red-500` generate nothing.
- **Base UI** (`@base-ui/react`) parts wrapped one per file in `src/shared/ui`. A wrapper takes a
  `variant` prop backed by a record of complete class strings; its `className` is layout only.
  State is styled through Base UI data attributes (`data-open:`, `data-disabled:`,
  `data-starting-style:`), never a class-name function.
- Class strings are joined by a one-line local `cx()`. No class-merging or variant library: under
  the wrapper contract nothing needs merging. Class sorting is not enforced.
- **Biome Tailwind rules** (nursery, Biome 2.6): `noTailwindLegacyUtilities`,
  `noTailwindRawColors`, `noTailwindRestyledComponents`, `noTailwindArbitraryValue`,
  `useTailwindStaticClassStrings`, `useTailwindShorthandClasses`,
  `useTailwindVariablesShorthand`; the restyle and arbitrary-value rules are off inside
  `src/shared/ui`.
- **No runtime style injection**: the CSP is `style-src 'self'`. `<CSPProvider disableStyleElements>`
  wraps the app. Styles set through the CSSOM (`style={{}}`, positioning, virtualization) pass.
- Dark mode follows the OS through `color-scheme` and `light-dark()` with no script. A user choice
  is an add-on: an external blocking `public/theme.js` sets `data-theme` before first paint.
- Picks proven under the CSP in Chromium, Firefox and WebKit: toasts are **Base UI Toast**;
  virtualization is **virtua** (4.8 KB gzip; the TanStack Virtual hook makes the React Compiler
  skip the component); icons are **lucide-react** named imports; a custom font is a
  `@fontsource-variable/*` package with a preload plugin; data tables are **TanStack Table 9**.

### Testing

- **Vitest 5.1** configured in `vite.config.ts`: jsdom, `globals: false` (so `cleanup()` is called
  explicitly), shuffled order, `TZ=UTC`, v8 coverage with 80 % lines and branches.
- **Route integration tests** are the default: `renderRoute(path)` renders the real route tree
  with a fresh QueryClient and the app's providers; only the network is fake.
- **MSW 3**: `server.listen({ onUnhandledFrame: "error" })` plus an `afterEach` that fails the test
  on any unhandled request, because the error option alone does not fail it. No default handlers.
- jsdom has no `reportError`: the setup file defines one that fails the test when the app reports
  an error the test did not expect (a test that expects one stubs it).
- `@testing-library/jest-dom` 7 until 8 passes the cooldown. Factories are `build<Entity>` with a
  per-test faker seed. Fake timers with user-event need `advanceTimers` and a `jest` global shim.
- **Playwright** runs the production build through `vite preview`, which serves the generated
  headers, against a real backend or the scaffold's `e2e/stub-api.ts`. A guard fixture fails any
  test on a console error, a page error or a CSP violation; axe scans each route.

### Deploy and security

- **One build per environment.** Only public origins reach the bundle: `PUBLIC_*` names listed
  exactly in `envPrefix`, validated as bare origins in a plugin hook, each added to the CSP's
  `connect-src`. No runtime config file and no placeholder substitution.
- **Headers** come from `deploy/headers.ts`, which renders `_headers` for Cloudflare,
  `headers.caddy` for the container and the `vite preview` middleware. CSP:
  `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' <origins>;
  object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none';
  require-trusted-types-for 'script'; trusted-types 'none'`. Also HSTS, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`, COOP and CORP.
- **Cache policy**: `no-cache` for everything unhashed, `public, max-age=31536000, immutable` under
  `/assets/`.
- **Cloudflare Workers static assets** is the default: `wrangler.jsonc` with an `assets` block,
  `not_found_handling: "single-page-application"`, `workers_dev: false`, `preview_urls: false`.
  Cloudflare joins duplicate headers with a comma, so the `/assets/*` rule detaches
  `Cache-Control` first. Known limit: a missing hashed asset is answered with `index.html`, status
  200 and the `immutable` header; `vite:preloadError` reloads the page once.
- **Container**: Caddy 2.11 copied onto `scratch`, numeric user 65532, read-only root filesystem,
  `/healthz`. A missing hashed asset is a 404. static-web-server 2.44 was rejected after
  measurement: it answers a missing hashed asset with `index.html`, 200 and `immutable` (cache
  poisoning during a rolling update), hides `/.well-known/` and answers HEAD on SPA routes with
  404. Revisit when static-web-server 3.0 is released.
- A browser-only OAuth client is an accepted risk; RFC 10017 prefers a backend-for-frontend, and
  an app holding personal data should decide that explicitly.

### Error reporting

- One funnel: the platform `reportError`. React's `onCaughtError`, `onUncaughtError` and
  `onRecoverableError` call it, so boundary-caught errors surface as `window` `error` events, the
  one place a tracker listens. `noConsole` forbids `console` in app code.
- `vite:preloadError` reloads onto the new `index.html`, never twice within 60 s (a timestamp in
  `sessionStorage`), so each deploy recovers once and a broken deploy cannot loop.

### Observability (add when needed)

- **Grafana Faro Web SDK**, loaded by dynamic import only when `PUBLIC_FARO_URL` is set, with
  `traceparent` sent only to the app's own API origins. Source maps are uploaded from CI.
- `@grafana/faro-web-tracing` 2.14 pulls `@opentelemetry/api` 1.10 while its other OpenTelemetry
  packages accept only versions below 1.10: pin `"@opentelemetry/api": "1.9.1"` under `overrides`
  in `pnpm-workspace.yaml` until that is released consistently.

### Authentication (add when needed)

- **keycloak-js 26.2**: Authorization Code + PKCE, tokens in memory, `checkLoginIframe: false`, no
  `onLoad`. `updateToken(0)` means five seconds and `updateToken(-1)` forces a refresh.
- The session plugs into `configureApi({ getToken, retryToken })`. A 401 gets one forced
  refresh and one retry; a 403 is a no-access screen, never a login redirect.
- A non-Keycloak identity provider uses **oidc-client-ts** with an in-memory store.

### Translations (add when needed)

- **i18next 27 + react-i18next 18 + i18next-cli**: JSON v4 messages, generated key types that also
  check interpolation variables, lazy namespaces through `import.meta.glob`, and the CLI gates
  `extract --ci`, `types --ci`, `status` and `lint` in `pnpm check`. i18next-cli depends on
  `@swc/core`, which needs an `allowBuilds` decision.
- i18next 27 defaults `fallbackLng` to `false`, so the fallback language is set explicitly.

### Realtime (add when needed)

- **SSE over `fetch` + `eventsource-parser`** for a one-way stream: the platform `EventSource`
  cannot send an `Authorization` header or a body.
- **Centrifugo + `centrifuge`** for channels and recovery. `getData` runs before every connect
  attempt and carries the session's current token; `getToken` runs only when a token is missing or
  expired. A push updates the cache with `cancelQueries` followed by a version-guarded
  `setQueryData`. The realtime origin is listed as dialled (`wss://`): `connect-src` with the
  `https://` form does not allow the socket.
- A raw WebSocket only for an own bidirectional protocol.

### Shared packages (add when needed)

- A pnpm workspace of **source-only packages**: `exports` point at `.ts` files, every package
  extends one base tsconfig, the consuming app compiles them. One version of every dependency
  through `catalog:`. Lockstep versions with pnpm 12 `versioning.fixed` and `pnpm change`.
- A UI-kit package ships its CSS with `@source "./"`, or the app's Tailwind emits none of its
  classes. Node 26 refuses to strip types from `.ts` files inside `node_modules`, so a source-only
  package is consumed through a bundler only.

## Rejected

A skill never recommends these; naming one is allowed only in a prior-version table, a Red Flags
row or the third-party precedence table.

| Name | Instead | Why |
|---|---|---|
| `react-router`, `react-router-dom` | TanStack Router | typed search params and loaders that share the Query cache |
| `axios`, `openapi-fetch`, `@hey-api/openapi-ts` | orval over `fetch` | one generator for client, zod schemas and MSW handlers |
| `redux`, `@reduxjs/toolkit`, `jotai`, `mobx`, `recoil` | URL, Query cache, `useState`; zustand when needed | server state already has an owner |
| `react-hook-form`, `formik` | TanStack Form | same schema library and adapter-free zod validation |
| `valibot`, `arktype`, `yup` | zod 4 | orval and the router emit and accept zod |
| `styled-components`, `@emotion/react` | Tailwind classes | inject `<style>` at runtime, blocked by the CSP |
| `sonner` | Base UI Toast | appends a `<style>` on import in every engine |
| `next-themes` | `light-dark()` tokens and `public/theme.js` | needs an inline script |
| `tailwind-merge`, `clsx`, `class-variance-authority`, `tailwind-variants` | `cx()` and variant records | nothing to merge under the wrapper contract |
| `framer-motion` | CSS transitions; `motion` when a design calls for it | renamed package; `popLayout` injects styles |
| `react-virtuoso`, `@tanstack/react-virtual` | virtua | 22 KB against 5 KB; the hook disables the React Compiler |
| `vite-tsconfig-paths`, `@vitejs/plugin-react-swc` | Vite 8 `resolve.tsconfigPaths`, `@vitejs/plugin-react` 6 | built in |
| `happy-dom` | jsdom | enforces CORS on test requests; one DOM for every app |
| `cypress` | Playwright | one runner with the axe and guard fixtures |
| `husky`, `lefthook`, `lint-staged` | prek | same hook runner as the sibling stacks |
| `dependency-cruiser` | the Biome GritQL plugin | no second tool |
| `size-limit` | the budget plugin in `vite.config.ts` | measures the real entry graph |
| `storybook` | a Vite harness app in the workspace | no second build system |
| `turborepo`, `lerna`, `@changesets/cli` | pnpm workspace, `pnpm change` | built into pnpm 12 |
| `socket.io-client`, `@microsoft/fetch-event-source` | `centrifuge`; `fetch` + `eventsource-parser` | own protocol and server; unmaintained |
| `react-oidc-context`, `@react-keycloak/web` | a session module over keycloak-js | wrappers hide refresh and error states |
| `react-intl`, `@lingui/core`, `i18next-icu` | i18next JSON v4 | typed keys and CLI gates from one toolchain |
| `@sentry/react`, `@sentry/browser` | Grafana Faro | the organization's telemetry backend |
| `moment`, `dayjs` | `Intl` formatters and `Date` | display only needs the platform |
| `nginx`, `static-web-server` | Caddy on `scratch` | owner decision; measured cache-poisoning fallback |

## package.json

The scaffold's `devEngines`, `dependencies` and `devDependencies`. The validator fails when this
block and `skills/frontend-scaffolding/assets/app/package.json` differ.

```json
{
  "devEngines": {
    "packageManager": {
      "name": "pnpm",
      "version": "12.21.0",
      "onFail": "download"
    },
    "runtime": {
      "name": "node",
      "version": "26.13.1",
      "onFail": "download"
    }
  },
  "dependencies": {
    "@base-ui/react": "1.9.0",
    "@tanstack/react-form": "1.33.5",
    "@tanstack/react-query": "5.107.1",
    "@tanstack/react-router": "1.170.46",
    "react": "19.3.1",
    "react-dom": "19.3.1",
    "zod": "4.6.7"
  },
  "devDependencies": {
    "@axe-core/playwright": "4.14.0",
    "@babel/core": "8.1.2",
    "@biomejs/biome": "2.6.8",
    "@faker-js/faker": "10.6.0",
    "@j178/prek": "0.5.11",
    "@playwright/test": "1.65.1",
    "@rolldown/plugin-babel": "0.3.1",
    "@tailwindcss/vite": "4.3.5",
    "@tanstack/router-plugin": "1.169.0",
    "@testing-library/dom": "10.4.2",
    "@testing-library/jest-dom": "7.0.1",
    "@testing-library/react": "16.3.3",
    "@testing-library/user-event": "14.6.12",
    "@types/node": "26.6.6",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.3.0",
    "@vitest/coverage-v8": "5.1.0",
    "babel-plugin-react-compiler": "1.0.0",
    "jsdom": "30.1.3",
    "knip": "6.45.1",
    "msw": "3.0.6",
    "orval": "8.48.0",
    "tailwindcss": "4.3.5",
    "typescript": "7.0.2",
    "vite": "8.3.8",
    "vitest": "5.1.0",
    "wrangler": "4.163.0"
  }
}
```

Container images: `node:26.13.1-trixie-slim` (build stage), `caddy:2.11.9-alpine` (binary source),
both pinned by digest in the scaffold's `Dockerfile`; `mcr.microsoft.com/playwright:v1.65.1-noble`
in CI.

## Add-on packages

Not in the scaffold. The snippet check adds them to its copy of the scaffold so that snippets in the
add-on skills compile; an app adds each one when it first needs it.

```json
{
  "dependencies": {
    "@grafana/faro-web-sdk": "2.14.0",
    "@grafana/faro-web-tracing": "2.14.0",
    "@tanstack/react-table": "9.3.1",
    "centrifuge": "5.8.0",
    "eventsource-parser": "4.1.3",
    "i18next": "27.1.3",
    "keycloak-js": "26.2.5",
    "lucide-react": "1.73.0",
    "oidc-client-ts": "3.5.0",
    "react-i18next": "18.0.2",
    "virtua": "0.54.2",
    "zustand": "5.1.0"
  },
  "devDependencies": {
    "i18next-cli": "1.88.0"
  }
}
```
