# AGENTS.md

A client-rendered React SPA (Vite, TanStack Router + Query, Base UI, Tailwind) talking to one
OpenAPI backend.

## Commands

- `pnpm check` - the gate after every change: Biome, `tsc`, knip, Vitest.
- `pnpm test` / `pnpm exec vitest related <files> --run` - all tests / the tests a change touches.
- `pnpm test:e2e` - Playwright against the production build and `e2e/stub-api.ts`; run it when
  routes, `vite.config.ts`, `deploy/` or `index.html` change.
- `pnpm api:generate` - regenerate `src/api/generated/` after `openapi.json` changes.
- `pnpm format` - Biome formatting and safe fixes.

## Layout and layers

- `src/routes/` - file routes: `validateSearch`, `loaderDeps`, `loader`, error and not-found
  components, and an unexported page component. A route file exports only `Route`.
- `src/features/<domain>/` - the domain's components and pure helpers. A feature never imports
  another feature.
- `src/shared/ui/` (Base UI wrappers), `src/shared/lib/`, `src/shared/hooks/` - domain-free code.
- `src/api/` - `apiFetch`, `ApiError` and the generated client. Never edit `src/api/generated/`.
- `src/app/` - composition root: `createAppRouter`, `createQueryClient`, error reporting, env.
- `src/test/` - test harness (`renderRoute`, MSW `server`, `build*` factories); tests only.

Imports go `routes -> features -> shared | api`; `app` may import anything. Use `@/...` for other
folders and `./x` for the same folder, never `../`. `biome-plugins/boundaries.grit` enforces this.
No barrels, no default exports (config files excepted), kebab-case file names.

## Rules that are easy to miss

- Server data lives in the Query cache: loaders call `queryClient.query({ ...getXQueryOptions(),
  staleTime: "static" })`, components call `useSuspenseQuery(getXSuspenseQueryOptions())`.
- URL state (page, filters) goes in `validateSearch`, never in `useState`; a link or redirect that
  changes one key writes `search={(prev) => ({ ...prev, page })}` to keep the others.
- Every page renders exactly one `h1` inside `main`: `createAppRouter` moves focus to it after a
  navigation that changes the path.
- The React Compiler is on: write no new `useMemo`, `useCallback` or `memo`.
- The CSP is strict (`deploy/headers.ts`): no inline scripts or styles, no `innerHTML`, no eval.
  Every new origin the browser calls goes into `PUBLIC_ENV` in `vite.config.ts`.
- Build-time values are public: name them `PUBLIC_*` and list them in `PUBLIC_ENV`.
- Colours are role tokens (`bg`, `surface`, `fg`, `muted`, `line`, `control`, `accent`,
  `accent-fg`, `danger`), defined once in `src/styles.css` as `light-dark()` pairs; palette
  utilities such as `bg-red-500` generate nothing. A missing role is a new token, not a raw colour or `[...]` value.
- Wrappers in `src/shared/ui/` take a `variant` for looks; their `className` is layout only
  (margin, width, placement). Style state with Base UI `data-*` variants, join classes with
  `cx()`, and never build a class name from parts. Biome's Tailwind rules enforce this.
- An auth session plugs into `configureApi({ getToken, retryToken })`: after a 401,
  `retryToken(rejected)` may return a fresh token for exactly one retry; `undefined` throws the
  401 as `ApiError`.
- Tests render the whole app with `renderRoute(path)` and answer the network with
  `server.use(...)`; never mock the app's own modules.
- `wrangler` is the Cloudflare deploy CLI (`pnpm exec wrangler deploy`); no CI job deploys yet.
