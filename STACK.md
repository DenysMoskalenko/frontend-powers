# Frontend web stack

One pick per concern. Decided 19 November 2026, revised 23 November 2026 after an outside
specialist's review.

Toolchain: Node 26.13, pnpm 12.22, TypeScript 7.0. python-powers (FastAPI) and rust-powers (axum)
are the sibling projects for the backends this frontend calls.
Validated 23 November 2026 on the scaffold in `skills/frontend-scaffolding/assets/app/`:
`pnpm install --frozen-lockfile`, `pnpm dedupe --check`, `pnpm check` (102 tests),
`pnpm test:coverage` (lines 95.2 %, branches 91.5 %), `pnpm api:generate` with no drift,
`pnpm build` (entry 149,474 B gzip), `pnpm test:e2e` (12 passed: Playwright against the production
build behind the generated headers, in the `chromium` and `phone` projects), and the Caddy
container. The audit gate (`pnpm audit --prod --audit-level=high`, `pnpm audit signatures`) last
ran on 22 November.

Version policy: exact pins, the newest release older than the three-day cooldown on the day of an
audit. A new major is adopted only after the scaffold gate and the snippet run pass on it.
`pnpm outdated` reports neither the `devEngines` pins nor the container images, so every audit
checks them by hand: `npm view pnpm time`, the Node release index, Caddy's releases, the Playwright
image tag equal to `@playwright/test`, and each image's digest resolved again from its tag. A
security release of pnpm itself is taken at the next audit once it is past the cooldown: nothing
else reports it. The browser floor moves at the same audit (see Build).

## One Pick Per Concern

| Concern | Pick | Note |
|---|---|---|
| app type | client-rendered single-page app | no server rendering of any kind |
| runtime and package manager | Node 26 + pnpm 12, pinned in `devEngines` with `onFail: "download"` | no `packageManager` field, no `.nvmrc` |
| dependency cooldown | `minimumReleaseAge: 4320` (three days) in `pnpm-workspace.yaml` | plus `saveExact`, `trustPolicy: no-downgrade`, `allowBuilds` |
| language | TypeScript 7, one `tsconfig.json` | `strict`, `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `erasableSyntaxOnly` |
| build | Vite 8 + `@vitejs/plugin-react` 6 | Rolldown; no manual chunks |
| browser floor | Baseline Widely Available on the audit date, Firefox at least 128 | `build.target`; moves at every version audit |
| UI library | React 19 with the React Compiler | on in dev, build and `pnpm test`; off only in coverage runs |
| routing | TanStack Router, file routes, `autoCodeSplitting` | directory routes |
| server state | TanStack Query 5 | loaders call `loadQuery`, components `useSuspenseQuery` |
| API client | orval 8: react-query client over `fetch`, zod schemas, MSW handlers | generated from a committed `openapi.json` |
| error model | one `ApiError` thrown by `apiFetch` | covers axum `ErrorBody`, FastAPI `detail`, RFC 9457; field errors keep the backend's `code` |
| validation | zod 4 at trust boundaries | `z.config({ jitless: true })` because of the CSP |
| forms | TanStack Form through `useAppForm` (`createFormHook`) + zod + Base UI `Field` | plain `<form>` + `FormData` for one field |
| client state | none by default | URL search params, Query cache, `useState`, a Context mounted in `src/app`; zustand 5 when needed |
| styling | Tailwind CSS 4 + Base UI wrappers in `src/shared/ui` | static CSS only; mobile-first on the default breakpoints |
| lint and format | Biome 2 | type-aware nursery rules and the Tailwind rules switched on explicitly |
| module boundaries | Biome GritQL plugin `biome-plugins/boundaries.grit` | with a regression test |
| dead code | knip 6 | |
| unit and integration tests | Vitest 5 + Testing Library + user-event + MSW 3 | route tests through `renderRoute`; two projects, Node and jsdom, chosen by file name |
| end-to-end tests | Playwright against the production build | Desktop Chrome and a WebKit phone; axe scan, guard fixture for console, page and CSP errors |
| git hooks | prek | installed by `pnpm hooks` |
| task entrypoint | `package.json` scripts, gate `pnpm check` | no Makefile in an app |
| CI | self-contained `.gitlab-ci.yml` and `.github/workflows/ci.yml` | same jobs in both |
| configuration | build-time: one build per environment, public `PUBLIC_*` origins | validated in a Vite plugin hook; no runtime configuration |
| security headers | generated from `deploy/headers.ts` | strict CSP with Trusted Types |
| deploy, default | Cloudflare Workers static assets | assets only, no Worker script |
| deploy, container | Caddy 2.11 on `scratch` | non-root, read-only root filesystem |
| error reporting | the platform `reportError` | one funnel, trackers listen on `window` |
| observability | Grafana Faro Web SDK | add when needed |
| authentication | keycloak-js, Authorization Code + PKCE; oidc-client-ts for another provider | add when needed |
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
  and fails on unknown workspace keys. Since 12.21 pnpm also asks to approve agent skills that
  packages ship; the scaffold declines them under `permissions`.
- `pnpm add pkg@<range>` writes a caret range even with `saveExact`; only a bare `pnpm add pkg`
  writes an exact pin. Check `package.json` after adding with a range.
- **Scripts** are the task entrypoint. `pnpm check` is `biome check && tsc && knip && vitest run`.
  Coverage thresholds run in `pnpm test:coverage` and CI.
- **prek** runs the hooks (`repo: builtin` plus local `pnpm exec` hooks), installed by `pnpm hooks`.
  There is no `prepare` script, so an install never changes `.git`.
- **knip 6** finds unused files, exports and dependencies. It does not use the TypeScript compiler
  API, which TypeScript 7 does not ship.
- **CI**: jobs `check` (`pnpm audit signatures`, `pnpm dedupe --check`, `biome ci`, `tsc`, knip,
  generated-client drift, Vitest with coverage, build with the bundle budget), `audit`, `e2e`
  (Playwright image whose tag equals the `@playwright/test` version; it carries Chromium and
  WebKit) and `audit-full`. GitHub actions are pinned by commit SHA, the CI images by digest
  with the tag in a comment.
- **Audit policy**: the gate on every push, pull request and deploy, and the prek hook, is
  `pnpm audit --prod --audit-level=high` plus `pnpm audit signatures`: a fresh advisory against a
  development-only package must not block a deploy for the three days the cooldown holds its fix
  back. `audit-full` runs `pnpm audit --audit-level=moderate` over every dependency on a weekly
  schedule or by hand (GitHub `schedule` and `workflow_dispatch`; a GitLab pipeline schedule,
  with a `.not-scheduled` template keeping the other jobs out of it); its failure is work to
  schedule, not a broken build. GitHub disables a schedule after 60 days without activity in a
  public repository.

### Language

- **TypeScript 7** is the native compiler. It removes `baseUrl` and `moduleResolution: node`,
  defaults `types` to `[]` and `noUncheckedSideEffectImports` to `true`, and ships no compiler API
  (7.1 will ship a new one). typescript-eslint would need TypeScript 6 installed beside it; Biome's
  `types` domain covers the rules the scaffold enables (see `## Watch`).
- One `tsconfig.json` with `module: "preserve"`, `target` and `lib` `es2024`, `paths` for `@/*`,
  and no project references. `erasableSyntaxOnly` forbids enums, namespaces and parameter
  properties; Node 26 then runs every `.ts` config and script file directly.
- `noPropertyAccessFromIndexSignature` is off: it fights `import.meta.env` and record lookups for
  no caught bug.
- `lib: es2024` stops only newer JavaScript built-ins; the `dom` lib tracks current Chromium, so
  nothing stops a DOM API or CSS feature above the browser floor. That is a rule for people
  (`frontend-code-style`): look up the exact member in MDN's compatibility data (`URL.parse`, not
  `URL`) and write the older equivalent or feature-detect. Build-time Node code may use anything
  Node 26 has.
- Biome gates on browser code (`src/**` minus tests): `noNodejsModules` and `noRestrictedGlobals`
  for `process`, `Buffer`, `global` and `require`. `useExhaustiveSwitchCases` is on; a switch
  over a server union keeps a `default` with `value satisfies never;` and a fallback.
- **Dates and money**: ISO strings on the wire, `Date` for instants, cached module-level
  `Intl.*Format` instances for display. A calendar date (`YYYY-MM-DD`, no time) is formatted by
  `formatDate` with `timeZone: "UTC"` and never goes through local-time `Date` arithmetic, or it
  shows the day before west of UTC. Money is integer minor units or a decimal string, passed to
  `Intl.NumberFormat#format` as a numeric string (narrowed to `` `${number}` ``; a plain `string`
  is TS2769); minor units divide by the currency's own fraction digits. `Temporal` is not used:
  the browser floor lacks it (see `## Watch`), and a polyfill is not worth its size for
  display-only dates.

### Build

- **Vite 8** on Rolldown: `resolve.tsconfigPaths: true` replaces the tsconfig-paths plugin,
  `build.rolldownOptions` replaces `rollupOptions`. `@vitejs/plugin-react` 6 has no Babel; the
  React Compiler runs through `@rolldown/plugin-babel` with `reactCompilerPreset()`.
- **React Compiler**: on for `vite`, `vite build` and `pnpm test`; off only in a coverage run.
  The switch is `@rolldown/plugin-babel`'s per-preset `configResolvedHook`
  (`!config.test?.coverage?.enabled`), which sees `--coverage` and `coverage.enabled` alike, and
  `src/app/react-compiler.dom.test.ts` checks it through a value the config provides. Coverage
  runs uncompiled because compiled components add memo-cache branches that only an unchanged
  re-render takes: forced on, the scaffold's branches go from 183 to 333, so the gate would
  measure the compiler instead of the app. Under `pnpm test` the cost is within noise (median
  3.18 s against 3.27 s). Measured earlier: build 997 ms with it against 677 ms without, entry
  +0.4 KB gzip. Code therefore carries no new `useMemo`, `useCallback` or `memo`.
- **Browser floor**: Baseline Widely Available on the audit date: the newest Chrome, Edge,
  Firefox and Safari released on or before the audit date minus 30 months, Firefox never below
  128 (Tailwind 4 needs it). On 23 November 2026 `build.target` is
  `["chrome125", "edge125", "firefox128", "safari17.5"]` (Chrome 125 and Safari 17.5 of May 2024;
  `ios17.5` builds byte-identical output, so it is left out). It moves at every version audit
  (`maintenance/release-audit.md`), and every copy under `skills/` moves with it; the validator
  fails a stale one. At this floor `light-dark()` ships natively: the Lightning CSS rewrite and
  its "stays light after build" caveats are gone. Browser code never uses an API the floor
  lacks: `URL.parse` is `new URL` in `try`/`catch`, a stream is read with `getReader()`, not
  `for await`. Vite's own default (`baseline-widely-available`, fixed at 2026-01-01) is lower and
  lowers syntax only.
- **Bundle budget**: a plugin in `vite.config.ts` gzips the entry chunk, its static imports and its
  CSS in `generateBundle` and fails the build over 160 KB. The scaffold measures 149,474 B
  (23 November 2026), of which zod is about 24 KB because `validateSearch` stays in the entry
  chunk. Headroom is not a
  reserve: a change that grows the entry first checks what can leave it (a dynamic import, a route
  chunk), then raises the budget by the measured growth in the same change, naming the cause.
  Entry growth of each add-on, measured alone on the scaffold (gzip): keycloak-js about 10 KB,
  i18next with react-i18next about 20 KB, Centrifugo about 1.3 KB (0.7 KB the wiring, 0.6 KB the
  live user page), the theme toggle (Base UI `ToggleGroup`) about 4.6 KB, the Faro loader about
  0.6 KB. An SSE feed in the root layout measured about 5 KB in an app with every add-on.
  Every add-on raises the budget by its measured growth whether or not the entry is over, so the
  result does not depend on the order: with Keycloak, Faro, i18n and Centrifugo the entry measured
  180,559 B and the budget came to 191,085 B in both orders (23 November 2026).
- `build.assetsInlineLimit: 0`: an inlined `data:` URL would need `data:` in the CSP.
  `build.sourcemap: "hidden"`: maps are written for an error tracker and never deployed.

### Structure

- Feature-based: `src/routes` (file routes) → `src/features/<domain>` → `src/shared` and `src/api`.
  `src/app` is the composition root and may import anything; `src/test` is imported only by tests.
- Enforced by a Biome GritQL plugin over static imports and `import()` (no `../` or `./../`
  imports, no feature-to-feature imports, no upward imports, `@/test/` only from tests) with a
  Vitest regression test that lints seeded violations.
- `@/*` alias for other folders, `./x` for the same folder. No barrels, no default exports outside
  config files, kebab-case file names outside `src/routes`.
- A route file exports only `Route`: an exported component in a route file, or a barrel between a
  route and its feature, defeats `autoCodeSplitting`.
- An existing app adopts the standard one concern per change, in the order
  `frontend-project-structure` gives: independent fixes, lint, the test harness, zod, generated
  outputs and forms, layout, the React Compiler last. Its architecture document records each
  deliberate deviation, and a rule for a package the app does not use waits until it is adopted.

### Routing and data

- **TanStack Router**: `createFileRoute`, `validateSearch` with a zod schema passed directly,
  `loaderDeps`, a loader that fills the Query cache, `errorComponent` and `notFoundComponent`.
  The router JSON-parses search values, so free text is `z.coerce.string()`; `createAppRouter`
  passes a parser that makes a value a number only when it prints back as typed, so `?q=1.50`,
  `?q=1e3` and ids past 2^53 stay text. A link or redirect that changes one key writes a search
  updater that keeps the others. After a navigation that changes the path, `createAppRouter` moves
  focus to the first `h1` inside `main` (the router does not manage focus).
  `routeFileIgnorePattern` keeps colocated `*.test.tsx` files out of the route tree.
  `defaultPreload: "intent"` with `defaultPreloadStaleTime: 0` and
  `defaultStaleReloadMode: "blocking"`, so Query alone owns freshness and the router always runs
  loaders and waits for them. With the default `"background"` a revisited route paints its old
  match while the loader reruns behind it; the cost of `"blocking"` is that a slow loader keeps
  the previous page under the progress bar on every return.
- **First-load shell**: the root layout is the root route's `shellComponent`, with an empty
  `beforeLoad`, `pendingComponent: () => null` and `pendingMs`/`pendingMinMs` at 0. The router
  publishes no match until one is pending with a pending component or ready, so without this a
  slow first load is a blank page; a root `pendingComponent` remounts the header and a router
  `defaultPendingComponent` replaces the old page on later navigations. The shell renders while
  the root match is pending: it reads router context through `useRouter().options.context` and
  never suspends. `shellComponent` is documented for server-rendered document shells; its
  client-side behaviour is verified on router 1.170.46 (router-core 1.171.39), so every router
  upgrade reruns the first-load test in `src/routes/__root.test.tsx` and the slow-first-load
  spec in `e2e/smoke.spec.ts`.
- A pending navigation shows one `role="progressbar"` named "Loading page" (visible after
  200 ms, no growth under `prefers-reduced-motion`).
- **TanStack Query 5.108**: `ensureQueryData`, `prefetchQuery` and `fetchQuery` are deprecated in
  favour of `queryClient.query(options)`. Mutation callbacks receive
  `(data, variables, onMutateResult, { client, meta, mutationKey })`.
- Loaders call `loadQuery(queryClient, getXQueryOptions())` from `src/shared/lib/load-query.ts`,
  components `useSuspenseQuery(getXSuspenseQueryOptions())`: under `exactOptionalPropertyTypes`
  `queryClient.query` rejects the suspense options type (TS2379). Both share a key and a fetch.
  `loadQuery` returns cached data at once however old, but refetches and awaits an invalidated
  query: `staleTime: "static"` alone also returns invalidated data, because query-core checks it
  before `isInvalidated`.
- **orval 8**: `client: "react-query"`, `httpClient: "fetch"`, `mode: "single"`,
  `urlEncodeParameters: true` (a path parameter cannot reach another endpoint; a hand-written path
  encodes every dynamic segment with `encodeURIComponent` for the same reason), mutator
  `apiFetch`, `fetch.includeHttpResponseReturnType: false`, `query.useSuspenseQuery: true`,
  `query.shouldSplitQueryKey: true`; a second output with `client: "zod"` and
  `override.zod.exactOptional: true` (optional keys infer `x?: T`); MSW handlers from
  `mock: { generators: [{ type: "msw" }] }`, always called with explicit data. Generated files are
  committed and CI fails when `pnpm api:generate` changes them.
- **`ApiError`** `{ status, message, code, requestId, fieldErrors, body }` is built in the mutator
  from an axum `ErrorBody`, a FastAPI `detail` or an RFC 9457 problem document. Query's `Register`
  types `defaultError` as `ApiError | Error`. `fieldErrors` is `Record<string, FieldError[]>` with
  `FieldError { message: string; code?: string }`: every error per field in the server's order,
  `code` from axum's `code` or pydantic's `type`. A form shows `message` unless the app translates
  by `code`; a 409 with field errors goes on those fields, on the form when none is rendered.
- **Reads time out, writes do not.** `apiFetch` rejects a GET or HEAD that gets no response
  headers within `timeoutMs` (default 30 000, set through `configureApi`) with the platform
  `TimeoutError` `DOMException`; the timer stops at the headers, so a slow body is not cut. A
  write has no client timeout: an aborted write may still have been applied. `configureApi` is
  one call at startup; a second call replaces the first. An empty body resolves `undefined`, a
  JSON content type is parsed, `text/*` is a string and anything else a `Blob`.
- `createQueryClient(notify)`: `staleTime` 30 s; a query retries at most twice, only a network
  `TypeError` and 408, 429, 502, 503, 504, never a `TimeoutError` (the server already had the whole
  timeout, and a network failure fails fast, so only that is cheap to retry), a `SyntaxError` or a
  schema error (a `TypeError` from a bug inside a `queryFn` is retried too: browsers report a
  network failure as a bare `TypeError`); mutations never retry and run with
  `networkMode: "always"`, so a write started offline fails at once like any network failure
  instead of pausing and being sent on reconnect, behind the user's back; a failed background
  refetch and an unhandled mutation error call `notify` with a reason (`"refresh"` or `"mutation"`), which
  `createAppRouter` turns into one toast per reason (`id: reason`), assertive and persistent
  (`priority: "high"`, `timeout: 0`), unless the query or mutation sets `meta: { silent: true }`
  because its screen shows the failure itself (a form, a polled screen); a failed first load is the
  route's error screen (`defaultErrorComponent`).
- Polling is `refetchInterval` with `retry: false`, `meta: { silent: true }` and the queries'
  default `networkMode: "online"`; a file
  download is a `Blob` from `apiFetch`; upload progress needs an `XMLHttpRequest` helper beside
  `apiFetch`, because `fetch` reports none. Both recipes are `tanstack-query-api`'s.
- **zod 4** validates search params, forms, storage and socket messages, never an own-backend
  response: the backend owns its contract and publishes it as `openapi.json`, the drift check keeps
  the client equal to that committed copy, and a response that breaks it is a backend bug fixed
  there; response schemas would ship and parse for every endpoint. zod probes `new Function` once, as
  the first object schema is built, which the Trusted Types policy reports on every page; `src/app/zod-config.ts` sets `z.config({ jitless: true })`, is
  the first import of `main.tsx`, and `vite.config.ts` groups it into zod's own chunk
  (`codeSplitting.groups`), so it runs before any schema is built whatever the chunking. A schema
  module may therefore be imported statically from entry code, and a top-level `await` in
  `main.tsx` does not break the CSP.

### Forms

- **TanStack Form 1** through one shared module, `src/shared/hooks/use-app-form.tsx`
  (`createFormHook`), with `submitErrors` in `src/shared/lib/submit-errors.ts`. A form writes
  `useAppForm` with `validationLogic: revalidateLogic()` and the request schema from `api.zod.ts`
  as `validators.onDynamic`, and renders `form.Form`, `form.FormError`, bound fields
  (`field.TextField`) and `form.SubmitButton`; the shared parts own `noValidate`, focus on the
  first invalid field, the server errors and the request-id fallback. A schema error appears on
  the first submit and then follows each change. `onSubmit` goes through the generated mutation
  and does not catch: a rejection is the failed submit. Server field errors are set per field
  and stay while another field changes; a 409 with field errors lands on the fields the form
  renders, on the form otherwise. `useBlocker` guards a dirty form. Never build UI on `isSubmitSuccessful`.
- Measured on the scaffold's create form against the rejected plain-helper design (one
  `form-submit.ts` plus `submitErrors`, every field wired by hand): 61 lines against 120 per
  form, one to three lines per text field against about thirteen, the same entry chunk, and a
  route chunk 1.4 KB gzip larger (lazy). The helper design was rejected because each form
  re-wires every field, including the server-error clear, and a field that forgets it shows a
  stale server error; every form also keeps about 60 lines of submit glue. The cost of
  `createFormHook`: `useFieldContext<string>()` is a cast, so binding `field.TextField` to a
  non-string field compiles; field names stay checked.
- React 19 form actions are not used for server writes: TanStack Form owns the values, the submit
  state and the errors, and an action would add a second owner that runs in a Transition and resets
  uncontrolled fields on success.

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
  `src/shared/ui`. `noTailwindRawColors` sets `allowBlackAndWhite: false`. Biome lints classes
  only in `className` and `cx()`, so every class string kept elsewhere (a variant record) is
  wrapped in `cx()`. Still unlinted: a token that does not exist (`bg-primary` generates nothing)
  and a class string in a plain variable.
- **Responsive by default**: Tailwind's default breakpoints, mobile-first (unprefixed classes are
  the narrowest layout). A `src/shared/ui` component responds to its container (`@container`,
  `@sm:` to `@xl:`), route layout to the viewport; a wide table scrolls inside its own container
  and the page never scrolls sideways; full heights are `dvh`, never `vh`. An app that is
  desktop-only says so in its architecture document with a minimum width. Touch targets, hover
  and safe areas belong to the third-party skills.
- **No runtime style injection**: the CSP is `style-src 'self'`. `<CSPProvider disableStyleElements>`
  wraps the app. Styles set through the CSSOM (`style={{}}`, positioning, virtualization) pass.
- Dark mode follows the OS through `color-scheme` and native `light-dark()` with no script; a
  container with `scheme-dark` flips its own subtree. A user choice is an add-on: an external
  blocking `public/theme.js` sets `data-theme` before first paint.
- A failure toast is `priority: "high"` (announced at once) and `timeout: 0` (stays until
  dismissed), one per reason through its `id`; a success toast keeps the defaults.
- A dependency that needs a CSP exception is dropped by default. When the user decides it stays,
  the decision goes in the app's architecture document and the header takes the narrowest form: a
  hash in `style-src` for a fixed `<style>` text, or `style-src-attr 'unsafe-inline'` for style
  attributes; never `'unsafe-inline'` or a nonce on `style-src`, nothing on `script-src`, and no
  `style-src-elem` (see `## Watch`).
- Picks proven under the CSP in Chromium, Firefox and WebKit: toasts are **Base UI Toast**;
  virtualization is **virtua** (4.2 KB gzip for `VList` at 0.55; the TanStack Virtual hook makes the React Compiler
  skip the component); icons are **lucide-react** named imports; a custom font is a
  `@fontsource-variable/*` package with a preload plugin; data tables are **TanStack Table 9**.

### Testing

- **Vitest 5.1** configured in `vite.config.ts`: `globals: false` (so `cleanup()` is called
  explicitly), shuffled order, `TZ=UTC`, v8 coverage with 80 % lines and branches.
- **Two projects, chosen by file name with no judgement**: `*.test.tsx` and `*.dom.test.ts` run
  in jsdom with `src/test/setup.ts` then `src/test/setup-dom.ts` (jest-dom, `cleanup`, storage
  clearing); every other `*.test.ts` runs in Node with `setup.ts` alone (the MSW server, the
  unhandled-request check, the recording `reportError`, the faker seed). A misplaced file fails
  with `document is not defined` and is renamed, never given `// @vitest-environment`. jsdom
  took 40 to 47 % of a run while most `*.test.ts` files need no DOM; the split cut the median
  run from about 4.0 s to 3.3 s (102 tests, noisy shared machine, 23 November 2026).
  `isolate: false` gave no steady gain and `pool: "vmThreads"` breaks MSW
  (`WritableStream is not defined`), so neither is used.
- **Route integration tests** are the default: `renderRoute(path)` renders the real route tree
  with a fresh QueryClient and the app's providers; only the network is fake.
- **MSW 3**: `server.listen({ onUnhandledFrame: "error" })` plus an `afterEach` that fails the test
  on any unhandled request, because the error option alone does not fail it. No default handlers,
  with one exception: a request the root layout makes on every page gets one `server.use(...)` in
  the setup's `beforeEach` answering the neutral case, and a test of that request declares its own.
- The platform `reportError` only logs: `setup.ts` replaces it with one that
  fails the test when the app reports an error the test did not expect (a test that expects one
  stubs it). `setup-dom.ts` also clears `localStorage` and `sessionStorage` after each test.
- Factories are `build<Entity>` with a per-test faker seed. Fake timers with user-event need
  `advanceTimers` and a `jest` global shim.
- **Playwright** runs the production build through `vite preview`, which serves the generated
  headers, against a real backend or the scaffold's `e2e/stub-api.ts`, in two projects:
  `chromium` (Desktop Chrome) and `phone` (WebKit, `devices["iPhone 17e"]`, 390 px wide), so the
  narrow layout and WebKit-only bugs are caught; Firefox is added locally when needed. Install:
  `pnpm exec playwright install chromium webkit`. The engines are current builds, so the suite
  cannot catch a feature missing on the browser floor. A guard fixture fails any test on a
  console error, a page error or a CSP violation, except an error a spec lists in
  `expectedErrors`; `expectNoSidewaysScroll(page)` runs on every page the smoke specs visit; axe
  scans each route. The template ships smoke, error-screen and stale-chunk specs.
- **`data-testid`** is a house convention for automation outside the repository (a QA suite, a
  monitoring script), which cannot rely on visible text: on form controls, action buttons, table
  rows or cards, dialogs and page containers, named `<feature>-<element>` in kebab-case, a row
  adding the entity id, never derived from visible text, no personal data. `src/shared/ui`
  wrappers forward it to the interactive element. Tests in the repository still query by role
  first.

### Deploy and security

- **One build per environment.** Only public origins reach the bundle: `PUBLIC_*` names listed
  exactly in `envPrefix`, validated as bare origins in a plugin hook (DNS labels or an IPv6
  literal: no wildcard, no CSP or Caddy metacharacter), each added to the CSP's `connect-src`.
  A build value that is not an origin (the release id) comes through a Vite `define`, never
  `PUBLIC_*`. Configuration is build-time: the origins are inlined into the bundle and into the
  generated CSP, validated before anything is written, and the app starts with no extra request.
  The cost: production runs a bundle staging did not run. The mitigation is to build every
  environment from the same commit in one pipeline; how many builds a pipeline makes and how an
  artifact is promoted is the platform team's decision, not this plugin's.
- **Runtime configuration is rejected** (a `/config.json` fetched before first render, placeholder
  substitution in built files, an inline config script): the origins would also have to reach
  the CSP, so the headers would be rendered at deploy time as well; the app would wait for one
  more request and validate in the browser what the build now refuses; substitution inside built
  JavaScript gives one hashed file name different content per environment under a year-long
  `immutable` cache, and an inline script breaks `script-src 'self'`.
- **Headers** come from `deploy/headers.ts`, which renders `_headers` for Cloudflare,
  `headers.caddy` for the container and the `vite preview` middleware. CSP:
  `default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' <origins>;
  object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none';
  require-trusted-types-for 'script'; trusted-types 'none'`. Also HSTS, `nosniff`,
  `Referrer-Policy`, `Permissions-Policy`, COOP and CORP. On the browser floor only Chromium
  enforces Trusted Types (Firefox 148, Safari 26) and `Permissions-Policy`; the others ignore
  them, `script-src` and `style-src 'self'` hold everywhere, and no code depends on
  `trustedTypes` existing. Violation reports use `Reporting-Endpoints` with `report-to` and a
  `report-uri` fallback (`frontend-deploy`).
- **Cache policy**: `no-cache` for everything unhashed, `public, max-age=31536000, immutable` under
  `/assets/`.
- **Cloudflare Workers static assets** is the default: `wrangler.jsonc` with an `assets` block,
  `not_found_handling: "single-page-application"`, `workers_dev: false`, `preview_urls: false`.
  Cloudflare joins duplicate headers with a comma, so the `/assets/*` rule detaches
  `Cache-Control` first. Known limit: a missing hashed asset is answered with `index.html`, status
  200 and the `immutable` header; the next navigation reloads the page once.
- **Container**: Caddy 2.11 copied onto `scratch`, numeric user 65532, read-only root filesystem,
  `/healthz`. A missing hashed asset is a 404 with `no-cache`. static-web-server was rejected
  after measurement: 2.44.3 answers a missing hashed asset with `index.html`, 200 and `immutable`
  (cache poisoning during a rolling update) and answers HEAD on SPA routes with 404; the 3.0 betas
  return a 404 for the missing asset but keep `immutable` on it, and HEAD stays 404. The revisit
  trigger is in `## Watch`.
- **A browser-only OAuth client is a stated deviation.** RFC 10017 (BCP 212, August 2026) rates it
  "not recommended for business applications, sensitive applications, and applications that
  handle personal data" (§6.3.4.3) and calls a backend-for-frontend "strongly recommended" for the
  same classes (§6.1.4.3). The plugin keeps the browser client because static hosting is the
  owner's constraint. The strict CSP with Trusted Types makes script injection harder; it does not
  stop injected script from running its own sign-in flow (§5.1.3). Each app records the choice in
  its architecture document, and a project that requires backend-for-frontend guarantees says so:
  `keycloak-spa-auth` then stops.

### Error reporting

- One funnel: the platform `reportError`. React's `onCaughtError`, `onUncaughtError` and
  `onRecoverableError` call it, so boundary-caught errors surface as `window` `error` events, the
  one place a tracker listens. `noConsole` forbids `console` in app code.
- `vite:preloadError` reloads onto the new `index.html` only while a navigation is pending
  (`router.state.status`), never on a hover preload, which would reload the page under the
  pointer and raise the leave dialog over a dirty form. It does not cancel the event (cancelled,
  Vite resolves the import with `undefined` and the router reports a TypeError) and never
  reloads twice within 60 s (a timestamp in `sessionStorage`), so each deploy recovers once and a
  broken deploy cannot loop. A failed lazy import that is not a route chunk (a language file, a
  realtime client) rejects to its importer, which reports it and keeps the current state.
- Start-up is `ready.then(render).catch(startFailed)`: the second argument of `then` would not
  catch a throw inside `render`. Unhandled rejections reach a tracker through its own
  `unhandledrejection` listener.

### Observability (add when needed)

- **Grafana Faro Web SDK**, loaded by dynamic import only when `PUBLIC_FARO_URL` is set, with
  `traceparent` sent only to the app's own API origins. `beforeSend` reduces every URL in every
  item to origin and path, so a sign-in callback's `code` and `state` and personal data in search
  params never reach the collector. `app.release` comes from a build-time `__RELEASE__` define
  that CI sets to the commit SHA, so source maps are matched to their release; maps are uploaded
  from CI. `startTelemetry` returns the Faro instance and the composition root sets an opaque user
  id once the session exists.
- `@grafana/faro-web-tracing` 2.14 pulls `@opentelemetry/api` 1.10 while its other OpenTelemetry
  packages accept only versions below 1.10: pin `"@opentelemetry/api": "1.9.1"` under `overrides`
  in `pnpm-workspace.yaml` until that is released consistently.

### Authentication (add when needed)

- **keycloak-js 26.2**: Authorization Code + PKCE, tokens in memory, `checkLoginIframe: false`, no
  `onLoad`. `updateToken(0)` means five seconds and `updateToken(-1)` forces a refresh.
- The session plugs into `configureApi({ getToken, retryToken })`. A 401 gets one forced
  refresh and one retry; a 403 is a no-access screen, never a login redirect. Once a refused
  refresh starts the sign-in redirect, `token()` and `retryToken()` never settle, so no request
  leaves without a token and no error shows before the page leaves. A token without `sub` fails
  start-up. A form that can outlast the SSO idle limit keeps the session alive through
  `session.activity()` on input, never a refresh loop. A sign-out in another tab reloads every
  signed-in tab: a public page stays, signed out, and a guarded one leaves through its guard.
- Sign-out keeps the ID token out of URLs: keycloak-js `logoutMethod: "POST"`, with the identity
  provider's origin added to the CSP's `form-action` by the add-on, verified against a Keycloak
  container in Chromium, Firefox and WebKit behind the generated headers. A page restored from the
  back-forward cache reloads (`pageshow` with `persisted`), so Back never shows a signed-out user's
  data. The `BroadcastChannel` name and the `sessionStorage` keys are scoped by
  `import.meta.env.BASE_URL`, so two apps under one origin do not sign each other out.
- A non-Keycloak identity provider uses **oidc-client-ts** with an in-memory store,
  `response_mode: "fragment"`, a foreign callback dropped instead of stopping the app, and
  sign-out posted as a form to `end_session_endpoint` (oidc-client-ts 3.5 has no POST option).
  keycloak-js's generic provider mode (`oidcProvider`) is not the default for that case: it
  passes against Keycloak's own issuer, but keycloak-js decodes the refresh token as a JWT, so a
  provider with opaque refresh tokens fails init (`Unable to decode token, payload not found.`).
  The add-on says when `oidcProvider` is enough.
- The RFC 10017 deviation is recorded under "Deploy and security".

### Translations (add when needed)

- **i18next 27 + react-i18next 18 + i18next-cli**: JSON v4 messages, generated key types that also
  check interpolation variables, lazy namespaces through `import.meta.glob`, and the CLI gates
  `extract --ci`, `types --ci` and `lint` in `pnpm check`. `status` fails on a missing
  translation, so it runs as `pnpm i18n:status` in the job that deploys production or tags a
  release, not in the commit gate. i18next-cli depends on
  `@swc/core`, which needs an `allowBuilds` decision.
- i18next 27 defaults `fallbackLng` to `false`, so the fallback language is set explicitly.
- A message file that fails to load is visible: at start-up `ready` rejects to the start-failure
  screen; on a later switch it is reported and the language stays. Field errors are translated
  in the bound field by backend `code` and zod issue kind, falling back to the error's own
  message; zod locales are not used.

### Realtime (add when needed)

- **SSE over `fetch` + `eventsource-parser`** for a one-way stream: the platform `EventSource`
  cannot send an `Authorization` header or a body. The server's `retry:` is clamped to at least
  one second, the attempt counter resets only after a stream stayed open 60 seconds, and a stream
  whose server promises heartbeats is aborted after an idle timeout, so a silently dead connection
  reconnects. Only a network `TypeError`, the read timeout, 408, 429 and 5xx reconnect, after
  `Retry-After` (capped at 300 s) plus jittered backoff; any other 4xx ends the feed. An error in
  the event handler goes to `reportError` and the feed continues. The stream is read with
  `getReader()`: async iteration of a `ReadableStream` needs Safari 27.
- **Centrifugo + `centrifuge`** for channels and recovery. `getData` runs before every connect
  attempt and carries the session's current token; `getToken` runs only when a token is missing or
  expired. A push waits for a first fetch still in flight, returns on an equal or older
  version, and only then cancels and writes with `setQueryData`; invalidating instead would lose
  the push, because a successful fetch clears `isInvalidated`. Signals no endpoint returns
  (typing, presence) live in a small store beside the channel hook. The realtime origin is listed as dialled (`wss://`): `connect-src` with the
  `https://` form does not allow the socket. Closing the last channel disconnects only after the
  commit, so a navigation between two live screens keeps the socket. `allow_subscribe_for_client`
  opens a whole namespace to every signed-in user; a channel carrying one user's data is
  user-limited or checked by a subscribe proxy.
- A raw WebSocket only for an own bidirectional protocol, with a handshake timeout.

### Shared packages (add when needed)

- A pnpm workspace of **source-only packages**: `exports` point at `.ts` files, every package
  extends one base tsconfig, the consuming app compiles them. One version of every dependency
  through `catalog:`. Lockstep versions with pnpm 12 `versioning.fixed` and `pnpm change`.
- A published package's peers are `"catalog:peers"`, a named catalog of caret ranges; a plain
  `catalog:` peer is packed as an exact version.
- A UI-kit package ships its CSS with `@source "./"`, or the app's Tailwind emits none of its
  classes. Node 26 refuses to strip types from `.ts` files inside `node_modules`, so a source-only
  package's values are loaded through Vite or Vitest only: nothing Node loads directly
  (`vite.config.ts`, `orval.config.ts`, scripts, Playwright specs and fixtures) imports them;
  `import type` is erased and safe.

## Watch

Picks that held on 22 November 2026 against a close alternative, reviewed 23 November 2026. Each row is reopened only when
its event happens; sizes are gzip.

| Pick | Alternative | Why not now | Revisit when |
|---|---|---|---|
| TypeScript 7.0, Biome `types` domain | TypeScript 7.1 with typescript-eslint | 7.0 ships no compiler API; typescript-eslint 8.73 peers only on 7.1 prerelease builds | TypeScript 7.1 and a typescript-eslint release supporting it are both stable |
| React Compiler through Babel (`@rolldown/plugin-babel`) | the native Oxc compiler, `react({ compiler: true })` | `@vitejs/plugin-react` calls it experimental; on the scaffold it built in about 250 ms against 0.8 to 1.25 s, same chunks, entry +96 B | `@vitejs/plugin-react` drops "experimental" from it |
| Biome 2 with the GritQL boundary plugin | Oxlint (type-aware) with oxfmt | oxfmt is 0.79, pre-1.0; Biome is the baseline the sibling stacks share | oxfmt 1.0 ships and Oxlint can express the boundary rules |
| jsdom for route tests | Vitest browser mode | moving rewrites `renderRoute` and the MSW setup (`vitest/browser` events, sealed-module mocking); the Node project already takes the tests that need no DOM (median run about 3.3 s, 102 tests, 23 November) | layout-dependent tests become common, such as the first app that must test a virtua list's rows |
| jsdom 31 | a real browser engine | the scaffold suite passes unchanged on jsdom 31; its gaps (layout, the new CSS engine's computed styles) are left to Playwright | a jsdom release breaks a route test on behaviour all three browser engines agree on |
| orval 8 | Kubb 5 | Kubb's client, zod and MSW plugins version independently (137 releases since May); orval ships weekly minors with no open regression in this config | orval releases stall for two months, or an 8.x regression in its react-query, zod or msw output stays open across a minor |
| zod 4 classic | `zod/mini` (orval `variant: "mini"`), valibot 1.5 | scaffold entry 147,692 B against 130,979 B with `zod/mini` (-16.7 KB) and 124,975 B with valibot (-22.7 KB), measured 19 November; the entry is 149,474 B on 23 November; `zod/mini` moves every schema to the functional API, valibot's output has no limit constants and developer-facing messages | the entry budget binds after everything that can leave the entry has left |
| TanStack Form 1 | TanStack Form 2 | 2.0 is an alpha (2.0.0-alpha.3, 23 October 2026) | 2.0 is released as stable, or `useFieldContext` checks the field's value type |
| TanStack Router | React Router 8 data mode | no typed, validated search params; typegen is framework-mode only | React Router ships typed, validated search params in data mode |
| Base UI | Ark UI 5 | both are clean under the CSP; Dialog, Select and Menu bundle to 74.9 KB with Base UI against 51.5 KB with Ark, but overlays load in route chunks and a switch migrates every kit | `src/shared/ui` breaks the entry budget, or Base UI's monthly minors stop |
| i18next + react-i18next | Lingui 6 | Lingui's runtime is 4.5 KB against 22.7 KB (esbuild, React external), but it needs a macro compiler plugin and existing apps run i18next | a new app with no i18next code starts and the entry budget binds |
| Caddy on `scratch` | static-web-server | 2.44.3 caches a missing chunk as `index.html` for a year; the 3.0 betas keep `immutable` on the 404 | a release serves a missing `/assets/*` file as an uncached 404 and answers HEAD like GET |
| Cloudflare SPA fallback with the known limit | a setting that returns 404 for a missing asset | none is documented; a guard Worker on `/assets/*` would add a Worker script | Cloudflare documents a configuration-only 404 for missing assets under `single-page-application` |
| bearer tokens in memory | DPoP (`dpopConfig` in keycloak-js 26.2) | 26.2.5 turns DPoP off when `token_type` is not DPoP; working with Keycloak's refresh-token-only binding is unproven | a keycloak-js release signs in and refreshes with DPoP against the Keycloak in use, proven by an end-to-end test |
| `Date` and `Intl` | `Temporal` | the browser floor lacks it (first in Chrome 144, Firefox 139 and Safari 27.3) | the floor reaches those versions |
| `new URL` in `try`/`catch`; a `getReader()` loop over a stream | `URL.parse`; `for await` over a `ReadableStream` | `URL.parse` needs Chrome 126 and Safari 18, stream async iteration Safari 27 | the floor reaches them |
| no `style-src-elem` in a CSP exception | `style-src-elem` to allow one `<style>` element | it needs Safari 26.2, above the floor; a Safari without it falls back to `style-src` | the floor reaches Safari 26.2 |
| root `shellComponent` for the first-load shell | a root `pendingComponent` (remounts the header), a router `defaultPendingComponent` (replaces the old page on later navigations) | `shellComponent` is documented for server-rendered shells; its client-side behaviour is verified on router 1.170.46 only | every router upgrade: rerun the first-load test in `src/routes/__root.test.tsx` and the slow-first-load spec in `e2e/smoke.spec.ts` |
| a 409 with field errors in `details` | the axum sibling's constant 409 body | the template's contract expects `details` naming the field; without it the form shows a form-level message | rust-powers sends field details on a conflict |
| a Vite harness app for a UI kit | Storybook 10 | the harness checks the kit as a production build under the production CSP; Storybook adds a catalogue, controls and story tests, not that check | a kit is consumed by more than one team or reviewed by designers who need a catalogue; Storybook then sits beside the harness |
| `.codex-plugin/plugin.json` | the root `plugin.json` of the portable Agent Plugins layout | Codex documents the current file as its compatibility fallback, and it installs | the Codex CLI's own scaffold stops emitting the compatibility layout; migrate with the sibling plugins |

## Rejected

A skill never recommends these; naming one is allowed only in a prior-version table, a Red Flags
row or the third-party precedence table.

| Name | Instead | Why |
|---|---|---|
| `react-router`, `react-router-dom` | TanStack Router | typed search params and loaders that share the Query cache |
| `axios`, `openapi-fetch`, `@hey-api/openapi-ts` | orval over `fetch` | one generator for client, zod schemas and MSW handlers |
| `redux`, `@reduxjs/toolkit`, `jotai`, `mobx`, `recoil` | URL, Query cache, `useState`; zustand when needed | server state already has an owner |
| `react-hook-form`, `formik` | TanStack Form | same schema library and adapter-free zod validation |
| `valibot`, `arktype`, `yup` | zod 4 | orval's zod output carries the limit constants forms reuse and user-facing messages; one schema API agents write fluently (sizes in `## Watch`) |
| `styled-components`, `@emotion/react` | Tailwind classes | inject `<style>` at runtime, blocked by the CSP |
| `sonner` | Base UI Toast | appends a `<style>` on import in every engine |
| `@mui/material` | Base UI wrappers in `src/shared/ui` | styles through Emotion by default, a `<style>` at runtime (read in 9.6); a second component system |
| `antd` | Base UI wrappers | `@ant-design/cssinjs` writes a `<style>` per component at runtime (read in 6.7) |
| `@mantine/core` | Base UI wrappers | renders `<style>` elements through `dangerouslySetInnerHTML`, which `style-src 'self'` blocks (read in 9.8); a second component system |
| shadcn/ui | the wrappers and `cx()` | no runtime style of its own, but its components are built on `cn()` (`clsx` + `tailwind-merge`) with their own token names: a second wrapper contract |
| Sass, Less, CSS Modules | Tailwind classes; plain CSS in `src/styles.css` | static CSS that passes the CSP, but a second styling language the role tokens and the Biome Tailwind rules do not reach |
| runtime configuration (`/config.json`, placeholder substitution, an inline config script) | build-time `PUBLIC_*` origins | see "Deploy and security" |
| `next-themes` | `light-dark()` tokens and `public/theme.js` | needs an inline script |
| `tailwind-merge`, `clsx`, `class-variance-authority`, `tailwind-variants` | `cx()` and variant records | nothing to merge under the wrapper contract |
| `framer-motion` | CSS transitions; `motion` (`motion.*`, plain `AnimatePresence`) when a design calls for it | renamed to `motion`; its `popLayout` and `AnimateView` append a `<style>` |
| `react-virtuoso`, `@tanstack/react-virtual` | virtua | 22 KB against 4 KB; the hook disables the React Compiler |
| `vite-tsconfig-paths`, `@vitejs/plugin-react-swc` | Vite 8 `resolve.tsconfigPaths`, `@vitejs/plugin-react` 6 | built in |
| `happy-dom` | jsdom | enforces CORS on test requests; one DOM for every app |
| `cypress` | Playwright | one runner with the axe and guard fixtures |
| `husky`, `lefthook`, `lint-staged` | prek | same hook runner as the sibling stacks |
| `dependency-cruiser` | the Biome GritQL plugin | no second tool |
| `size-limit` | the budget plugin in `vite.config.ts` | measures the real entry graph |
| `storybook` | a Vite harness app in the workspace | the harness checks the kit as a production build under the production CSP; Storybook would be a second tool for docs (see `## Watch`) |
| `turbo` (Turborepo), `lerna`, `@changesets/cli` | pnpm workspace, `pnpm change` | built into pnpm 12 |
| `socket.io-client`, `@microsoft/fetch-event-source` | `centrifuge`; `fetch` + `eventsource-parser` | own protocol and server; unmaintained |
| `react-oidc-context`, `@react-keycloak/web` | a session module over keycloak-js | wrappers hide refresh and error states |
| `react-intl`, `@lingui/core`, `i18next-icu` | i18next JSON v4 | typed keys and CLI gates from one toolchain; one stack across apps (Lingui in `## Watch`) |
| `@sentry/react`, `@sentry/browser` | Grafana Faro | the organization's telemetry backend |
| `moment`, `dayjs` | `Intl` formatters and `Date` | display only needs the platform |
| `nginx`, `static-web-server` | Caddy on `scratch` | owner decision; static-web-server caches a missing chunk for a year (measured on 2.44.3 and the 3.0 betas) |

## Not covered

Left out on purpose, so a missing rule here is a decision, not an omission:

- **Backends without OpenAPI** (GraphQL, gRPC): the data layer is generated from `openapi.json`;
  such a backend needs its own client and is outside this stack.
- **Migrating from Create React App or Next.js**: `frontend-project-structure` brings an existing
  Vite app onto the standard; a framework migration comes first and is not described.
- **Bundle analysis beyond the entry budget**: the build fails on the entry; a finer look is a one-off
  reading of the chunk sizes the build prints, not a gate.
- **Commit and pull-request conventions**: the team's own.
- **Print styles**: not covered; Tailwind's `print:` variant is available.
- **Server rendering** of any kind: the app is static files under a strict CSP.

## package.json

The scaffold's `devEngines`, `dependencies` and `devDependencies`. The validator fails when this
block and `skills/frontend-scaffolding/assets/app/package.json` differ.

```json
{
  "devEngines": {
    "packageManager": {
      "name": "pnpm",
      "version": "12.22.0",
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
    "@tanstack/react-query": "5.108.0",
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
    "@testing-library/jest-dom": "8.0.0",
    "@testing-library/react": "16.3.3",
    "@testing-library/user-event": "14.6.13",
    "@types/node": "26.6.6",
    "@types/react": "19.3.0",
    "@types/react-dom": "19.3.0",
    "@vitejs/plugin-react": "6.3.0",
    "@vitest/coverage-v8": "5.1.1",
    "babel-plugin-react-compiler": "1.0.0",
    "jsdom": "31.0.1",
    "knip": "6.46.1",
    "msw": "3.0.7",
    "orval": "8.48.0",
    "tailwindcss": "4.3.5",
    "typescript": "7.0.2",
    "vite": "8.3.8",
    "vitest": "5.1.1",
    "wrangler": "4.165.0"
  }
}
```

Container images: `node:26.13.1-trixie-slim` (build stage), `caddy:2.11.9-alpine` (binary source),
both pinned by digest in the scaffold's `Dockerfile`; `mcr.microsoft.com/playwright:v1.65.1-noble`
in CI, pinned by digest like the CI `node` image. End-to-end services of the add-ons, pinned by
digest where the skills show them: `quay.io/keycloak/keycloak:26.8.2`,
`centrifugo/centrifugo:v6.10.3`.

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
    "i18next": "27.2.2",
    "keycloak-js": "26.2.5",
    "lucide-react": "1.76.0",
    "oidc-client-ts": "3.5.0",
    "react-i18next": "18.0.3",
    "virtua": "0.55.0",
    "zustand": "5.1.0"
  },
  "devDependencies": {
    "i18next-cli": "1.91.2"
  }
}
```
