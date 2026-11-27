# Template file map

Every file in `assets/app/`, what it is, and the skill that owns changes to it once the app
exists. Rows marked **example** belong to the `users` example and go when the real domain
replaces it; the full list is under [The users example](#the-users-example).

## Contents

- [Root and tooling](#root-and-tooling)
- [Deploy](#deploy)
- [API client](#api-client)
- [Application source](#application-source)
- [Tests](#tests)
- [The users example](#the-users-example)

## Root and tooling

| File | What it is | Owner |
| --- | --- | --- |
| `package.json` | scripts, `devEngines` (pnpm 12.22.0, Node 26.13.1), exact versions: the tested baseline that step 9 moves within each major | `frontend-tooling` |
| `pnpm-lock.yaml` | the tested dependency set; committed | `frontend-tooling` |
| `pnpm-workspace.yaml` | release cooldown, `saveExact`, trust policy, `allowBuilds`, skill permissions | `frontend-tooling` |
| `tsconfig.json` | the one TypeScript config, `@/*` paths | `frontend-tooling` |
| `biome.json` | formatter, linter, Tailwind rules, the boundary plugin, no Node globals in browser code | `frontend-tooling` |
| `biome-plugins/boundaries.grit` | the layer and import rules as a Biome GritQL plugin | `frontend-tooling` |
| `biome-plugins/boundaries.test.ts` | regression test that lints seeded violations | `frontend-tooling` |
| `knip.json` | unused files, exports and dependencies | `frontend-tooling` |
| `vite.config.ts` | build with the browser floor, dev server, the two Vitest projects (`node`, `dom`), the React Compiler off only for coverage, the entry budget, the `zod` chunk group that runs `zod-config` first; `PUBLIC_ENV` and the header plugin, which calls `isBareOrigin`, are `frontend-deploy`'s | `frontend-tooling` |
| `vite.config.test.ts` | tests the entry-budget plugin | `frontend-tooling` |
| `playwright.config.ts` | E2E config: projects `chromium` and `phone` (WebKit), stub API and the production build as web servers; a test that passes only on a retry fails CI | `frontend-tooling` |
| `.pre-commit-config.yaml` | prek hooks, installed by `pnpm hooks` | `frontend-tooling` |
| `.github/workflows/ci.yml` | GitHub CI: `check`, `audit` (production dependencies), `e2e`; `audit-full` weekly and by hand; deleted when the app uses GitLab | `frontend-tooling` |
| `.gitlab-ci.yml` | GitLab CI with the same jobs (`audit-full` from a pipeline schedule); checks the generated client with `diff -r`, as its image has no git; deleted when the app uses GitHub | `frontend-tooling` |
| `.gitignore` | build output, `*.local`, `.tanstack/` | `frontend-tooling` |
| `.editorconfig` | editor whitespace settings | `frontend-tooling` |
| `.vscode/settings.json`, `.vscode/extensions.json` | Biome as formatter, the native TypeScript preview | `frontend-tooling` |
| `AGENTS.md` | the app's own agent instructions | the app |
| `CLAUDE.md` | `@AGENTS.md` | the app |
| `README.md` | how to get pnpm, run, check, build and deploy commands; **example** in the line under its heading | the app; renamed in step 2 |

## Deploy

| File | What it is | Owner |
| --- | --- | --- |
| `.env.development` | `PUBLIC_API_ORIGIN` for `pnpm dev` | `frontend-deploy` |
| `index.html` | the document: the fallback title, `color-scheme` meta, entry script | `frontend-deploy` |
| `public/favicon.svg` | the icon | `frontend-deploy` |
| `deploy/headers.ts` | the CSP and every response header, rendered for Cloudflare, Caddy and `vite preview`; `isBareOrigin`, the check every `PUBLIC_*` value passes (no wildcard, no CSP or Caddy metacharacter) | `frontend-deploy` |
| `deploy/headers.test.ts` | pins the whole CSP, tests the rendered header files and which values `isBareOrigin` refuses | `frontend-deploy` |
| `deploy/Caddyfile` | the container's server config; deleted with the container target | `frontend-deploy` |
| `Dockerfile` | build stage, then Caddy on `scratch`, user 65532; deleted with the container target | `frontend-deploy` |
| `.dockerignore` | keeps installs, output and `.env*` out of the build context | `frontend-deploy` |
| `wrangler.jsonc` | Cloudflare static assets, SPA fallback, public URLs off; deleted with the Cloudflare target | `frontend-deploy` |

## API client

| File | What it is | Owner |
| --- | --- | --- |
| `openapi.json` | the backend's document, committed; **example** content | `tanstack-query-api` |
| `orval.config.ts` | client, zod and MSW generation | `tanstack-query-api` |
| `src/api/fetcher.ts` | `apiFetch` (the orval mutator) and `configureApi` | `tanstack-query-api` |
| `src/api/fetcher.test.ts` | base URL, token, the one 401 retry, the read timeout, empty and unparsable bodies | `tanstack-query-api` |
| `src/api/api-error.ts` | `ApiError` and `toApiError` | `tanstack-query-api` |
| `src/api/api-error.test.ts` | one case per backend error shape; field paths in TanStack Form syntax | `tanstack-query-api` |
| `src/api/generated/api.ts` | generated query options, mutations, types; never edited | `tanstack-query-api` |
| `src/api/generated/api.zod.ts` | generated zod schemas; never edited | `tanstack-query-api` |
| `src/api/generated/api.msw.ts` | generated MSW handlers; never edited | `tanstack-query-api` |

## Application source

| File | What it is | Owner |
| --- | --- | --- |
| `src/main.tsx` | entry: `zod-config` first, `configureApi`, `createRoot` with the error handlers | `frontend-project-structure` |
| `src/app/router.tsx` | `createAppRouter`: route tree, context, `defaultErrorComponent`, the `Wrap` provider slot, the failure toasts (titles in `NOTICES`, assertive, persistent, one per reason), the search parser that keeps `?q=1.50` text, focus on the page's `h1` after a path change | `tanstack-router-spa` |
| `src/app/router.test.tsx` | search values as typed, focus after a path change but not after a search-only change or the first render, a failure toast that stays until dismissed, a repeated failure that updates its toast; **example**: its `/users` paths and handlers | `tanstack-router-spa` |
| `src/app/query-client.ts` | `createQueryClient(notify)`, retry and error-toast policy, mutations that fail at once offline; no user-facing text | `tanstack-query-api` |
| `src/app/query-client.test.ts` | which failures the retry policy repeats, and a `silent` query's failed refresh raising no toast | `tanstack-query-api` |
| `src/app/error-reporting.ts` | `rootErrorHandlers` into `reportError`, `reloadOnStaleChunk(router)` (reloads during a navigation only) | `frontend-code-style` |
| `src/app/error-reporting.dom.test.ts` | the funnel, and a stale chunk that reloads during a navigation only, uncancelled, not twice within a minute | `frontend-code-style` |
| `src/app/react-compiler.dom.test.ts` | the React Compiler is on under `pnpm test` and off in a coverage run | `frontend-tooling` |
| `src/app/env.ts` | the build's public values (`env.apiOrigin`) | `frontend-deploy` |
| `src/app/zod-config.ts` | `z.config({ jitless: true })`, required by the CSP; bundled with zod by `vite.config.ts` | `tanstack-query-api` |
| `src/vite-env.d.ts` | types for `import.meta.env.PUBLIC_*` | `frontend-deploy` |
| `src/styles.css` | Tailwind, role colour tokens (`control` for control outlines); **example**: `--grid-template-columns-label` | `tailwind-base-ui` |
| `src/routeTree.gen.ts` | generated by the router plugin; committed, never edited | `tanstack-router-spa` |
| `src/routes/__root.tsx` | the layout as the root's `shellComponent` (no `<title>`), shown with the progress bar from a first load on, and the not-found page; **example**: its `/users` links | `tanstack-router-spa` |
| `src/routes/index.tsx` | `/` redirect; **example**: its target | `tanstack-router-spa` |
| `src/routes/users/index.tsx` | **example** list page, page number in the URL, past the end redirects to the last page | `tanstack-router-spa` |
| `src/routes/users/$userId.tsx` | **example** detail page; a malformed id (the generated params schema) or a 404 is not-found | `tanstack-router-spa` |
| `src/routes/users/new.tsx` | **example** create page | `tanstack-router-spa` |
| `src/features/users/user-table.tsx` | **example** list table | `frontend-project-structure` |
| `src/features/users/user-details.tsx` | **example** detail list | `frontend-project-structure` |
| `src/features/users/create-user-form.tsx` | **example** form on `useAppForm`: mutation, leave guard | `frontend-forms` |
| `src/features/users/pagination.ts` | **example** page number to `limit` and `offset` | `tanstack-query-api` |
| `src/shared/ui/button.tsx` | Base UI button with `variant` | `tailwind-base-ui` |
| `src/shared/ui/text-field.tsx` | Base UI field with label and error | `tailwind-base-ui` |
| `src/shared/ui/toast.tsx` | `ToastProvider` over Base UI Toast | `tailwind-base-ui` |
| `src/shared/ui/cx.ts` | the one-line class joiner | `tailwind-base-ui` |
| `src/shared/ui/route-error.tsx` | `RouteError`, the router's `defaultErrorComponent`, with its `<title>`, request id and Try again | `tanstack-router-spa` |
| `src/shared/lib/format-date.ts` | `formatDateTime` with a module-level `Intl.DateTimeFormat` | `frontend-code-style` |
| `src/shared/lib/load-query.ts` | `loadQuery(queryClient, options)`, every loader's read: cached data at once, an invalidated query refetched and awaited | `tanstack-router-spa` |
| `src/shared/lib/submit-errors.ts` | `submitErrors`: a failed submit's server errors on the rendered fields, the rest as one form message with the request id | `frontend-forms` |
| `src/shared/hooks/use-app-form.tsx` | `useAppForm` (`createFormHook`): `form.Form`, `form.FormError`, `form.SubmitButton`, `field.TextField`; focus on the first invalid field; `onFieldErrors` for a form in steps | `frontend-forms` |
| `src/shared/hooks/use-app-form.test.tsx` | a server error for a field the user removed becomes the form message; in a form in steps it opens the field's step | `frontend-forms` |

## Tests

| File | What it is | Owner |
| --- | --- | --- |
| `src/test/setup.ts` | every test, Node and jsdom: faker seed, MSW listen; fails a test on an unhandled request or a `reportError` call it did not stub | `frontend-testing` |
| `src/test/setup-dom.ts` | the `dom` project only: jest-dom, Testing Library cleanup, both web storages cleared after each test | `frontend-testing` |
| `src/test/setup.dom.test.ts` | proves storage does not leak into the next test | `frontend-testing` |
| `src/test/server.ts` | the MSW server, no default handlers | `frontend-testing` |
| `src/test/render-route.tsx` | `renderRoute(path)` and `TEST_API_ORIGIN` | `frontend-testing` |
| `src/test/factories/user.ts` | **example** `buildUser` | `frontend-testing` |
| `src/routes/index.test.tsx` | redirect and not-found; **example**: the redirect test | `frontend-testing` |
| `src/routes/__root.test.tsx` | the layout and the progress bar during a first load and a navigation that wait for data; **example**: its `/users` paths and handler | `frontend-testing` |
| `src/routes/users/index.test.tsx`, `src/routes/users/$userId.test.tsx`, `src/routes/users/new.test.tsx` | **example** route tests for list, detail and form | `frontend-testing` |
| `src/features/users/pagination.test.ts` | **example** unit test | `frontend-testing` |
| `e2e/fixtures.ts` | `test` with the console, page-error and CSP guard and its `expectedErrors` option; `expectNoSidewaysScroll`; `API_ORIGIN` | `frontend-testing` |
| `e2e/smoke.spec.ts` | **example** flows: create and open, toast under the CSP, a slow first load shows the layout and the bar, axe in both colour schemes | `frontend-testing` |
| `e2e/errors.spec.ts` | **example** a failed page load shows the error screen and Try again recovers | `frontend-testing` |
| `e2e/stale-chunk.spec.ts` | **example** after a deploy, hover keeps the page and a click loads the new build | `frontend-testing` |
| `e2e/stub-api.ts` | **example** in-memory backend on port 4010 with the backend's error bodies | `frontend-testing` |

## The users example

What changes once the first real list, detail and form compile; delete each file unless the line says otherwise:

- `src/routes/users/` - `index.tsx` (list with paging in the URL and the past-the-end redirect),
  `$userId.tsx` (detail; a malformed id or a 404 is not-found), `new.tsx` (form), each with its
  `.test.tsx` and each page with its `<title>`.
- `src/features/users/` - `user-table.tsx`, `user-details.tsx`, `create-user-form.tsx`,
  `pagination.ts` and its test.
- `src/test/factories/user.ts`.
- `e2e/smoke.spec.ts`, `e2e/errors.spec.ts`, `e2e/stale-chunk.spec.ts` and `e2e/stub-api.ts`
  (rewritten for the new resource, not deleted).
- `--grid-template-columns-label` in `src/styles.css` (only `user-details.tsx` uses `grid-cols-label`).
- Lines in skeleton files: the two nav links and the not-found link in `src/routes/__root.tsx`,
  the redirect target in `src/routes/index.tsx`, the redirect test in `src/routes/index.test.tsx`,
  the line under the `README.md` heading.
- `src/app/router.test.tsx` uses the `users` list and its "New user" link, and
  `src/routes/__root.test.tsx` a held `/users` request: point them at the new list and create
  routes, keeping their cases.
