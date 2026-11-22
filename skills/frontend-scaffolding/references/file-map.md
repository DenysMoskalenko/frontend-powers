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
| `package.json` | scripts, `devEngines` (pnpm 12.22.0, Node 26.13.1), exact pins | `frontend-tooling` |
| `pnpm-lock.yaml` | the tested dependency set; committed | `frontend-tooling` |
| `pnpm-workspace.yaml` | release cooldown, `saveExact`, trust policy, `allowBuilds`, skill permissions | `frontend-tooling` |
| `tsconfig.json` | the one TypeScript config, `@/*` paths | `frontend-tooling` |
| `biome.json` | formatter, linter, Tailwind rules, the boundary plugin | `frontend-tooling` |
| `biome-plugins/boundaries.grit` | the layer and import rules as a Biome GritQL plugin | `frontend-tooling` |
| `biome-plugins/boundaries.test.ts` | regression test that lints seeded violations | `frontend-tooling` |
| `knip.json` | unused files, exports and dependencies | `frontend-tooling` |
| `vite.config.ts` | build, dev server, Vitest config, the entry budget, the `zod` chunk group that runs `zod-config` first; `PUBLIC_ENV` and the header plugin, which calls `isBareOrigin`, are `frontend-deploy`'s | `frontend-tooling` |
| `vite.config.test.ts` | tests the entry-budget plugin | `frontend-tooling` |
| `playwright.config.ts` | E2E config: stub API and the production build as web servers; a test that passes only on a retry fails CI | `frontend-tooling` |
| `.pre-commit-config.yaml` | prek hooks, installed by `pnpm hooks` | `frontend-tooling` |
| `.github/workflows/ci.yml` | GitHub CI: `check`, `audit`, `e2e` | `frontend-tooling` |
| `.gitlab-ci.yml` | GitLab CI with the same jobs; checks the generated client with `diff -r`, as its image has no git | `frontend-tooling` |
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
| `deploy/Caddyfile` | the container's server config | `frontend-deploy` |
| `Dockerfile` | build stage, then Caddy on `scratch`, user 65532 | `frontend-deploy` |
| `.dockerignore` | keeps installs, output and `.env*` out of the build context | `frontend-deploy` |
| `wrangler.jsonc` | Cloudflare static assets, SPA fallback, public URLs off | `frontend-deploy` |

## API client

| File | What it is | Owner |
| --- | --- | --- |
| `openapi.json` | the backend's document, committed; **example** content | `tanstack-query-api` |
| `orval.config.ts` | client, zod and MSW generation | `tanstack-query-api` |
| `src/api/fetcher.ts` | `apiFetch` (the orval mutator) and `configureApi` | `tanstack-query-api` |
| `src/api/fetcher.test.ts` | base URL, token, the one 401 retry, empty and unparsable bodies | `tanstack-query-api` |
| `src/api/api-error.ts` | `ApiError` and `toApiError` | `tanstack-query-api` |
| `src/api/api-error.test.ts` | one case per backend error shape; field paths in TanStack Form syntax | `tanstack-query-api` |
| `src/api/generated/api.ts` | generated query options, mutations, types; never edited | `tanstack-query-api` |
| `src/api/generated/api.zod.ts` | generated zod schemas; never edited | `tanstack-query-api` |
| `src/api/generated/api.msw.ts` | generated MSW handlers; never edited | `tanstack-query-api` |

## Application source

| File | What it is | Owner |
| --- | --- | --- |
| `src/main.tsx` | entry: `zod-config` first, `configureApi`, `createRoot` with the error handlers | `frontend-project-structure` |
| `src/app/router.tsx` | `createAppRouter`: route tree, context, `defaultErrorComponent`, the `Wrap` provider slot, the toast titles in `NOTICES`, the search parser that keeps `?q=1.50` text, focus on the page's `h1` after a path change | `tanstack-router-spa` |
| `src/app/router.test.tsx` | search values as typed, focus after a path change but not after a search-only change or the first render; **example**: its `/users` paths and handlers | `tanstack-router-spa` |
| `src/app/query-client.ts` | `createQueryClient(notify)`, retry and error-toast policy; no user-facing text | `tanstack-query-api` |
| `src/app/query-client.test.ts` | which failures the retry policy repeats | `tanstack-query-api` |
| `src/app/error-reporting.ts` | `rootErrorHandlers` into `reportError`, `reloadOnStaleChunk` | `frontend-code-style` |
| `src/app/error-reporting.test.ts` | the funnel, and a stale-chunk event left uncancelled with no second reload within a minute | `frontend-code-style` |
| `src/app/env.ts` | the build's public values (`env.apiOrigin`) | `frontend-deploy` |
| `src/app/zod-config.ts` | `z.config({ jitless: true })`, required by the CSP; bundled with zod by `vite.config.ts` | `tanstack-query-api` |
| `src/vite-env.d.ts` | types for `import.meta.env.PUBLIC_*` | `frontend-deploy` |
| `src/styles.css` | Tailwind, role colour tokens (`control` for control outlines); **example**: `--grid-template-columns-label` | `tailwind-base-ui` |
| `src/routeTree.gen.ts` | generated by the router plugin; committed, never edited | `tanstack-router-spa` |
| `src/routes/__root.tsx` | layout (no `<title>`) and not-found page; **example**: its `/users` links | `tanstack-router-spa` |
| `src/routes/index.tsx` | `/` redirect; **example**: its target | `tanstack-router-spa` |
| `src/routes/users/index.tsx` | **example** list page, page number in the URL, past the end redirects to the last page | `tanstack-router-spa` |
| `src/routes/users/$userId.tsx` | **example** detail page; a malformed id (the generated params schema) or a 404 is not-found | `tanstack-router-spa` |
| `src/routes/users/new.tsx` | **example** create page | `tanstack-router-spa` |
| `src/features/users/user-table.tsx` | **example** list table | `frontend-project-structure` |
| `src/features/users/user-details.tsx` | **example** detail list | `frontend-project-structure` |
| `src/features/users/create-user-form.tsx` | **example** form: mutation, server field errors with the request id fallback, focus on the first invalid field, leave guard | `frontend-forms` |
| `src/features/users/pagination.ts` | **example** page number to `limit` and `offset` | `tanstack-query-api` |
| `src/shared/ui/button.tsx` | Base UI button with `variant` | `tailwind-base-ui` |
| `src/shared/ui/text-field.tsx` | Base UI field with label and error | `tailwind-base-ui` |
| `src/shared/ui/toast.tsx` | `ToastProvider` over Base UI Toast | `tailwind-base-ui` |
| `src/shared/ui/cx.ts` | the one-line class joiner | `tailwind-base-ui` |
| `src/shared/ui/route-error.tsx` | `RouteError`, the router's `defaultErrorComponent`, with its `<title>`, request id and Try again | `tanstack-router-spa` |
| `src/shared/lib/format-date.ts` | `formatDateTime` with a module-level `Intl.DateTimeFormat` | `frontend-code-style` |

## Tests

| File | What it is | Owner |
| --- | --- | --- |
| `src/test/setup.ts` | jest-dom, faker seed, MSW listen, both web storages cleared after each test; fails a test on an unhandled request or a `reportError` call it did not stub | `frontend-testing` |
| `src/test/setup.test.ts` | proves storage does not leak into the next test | `frontend-testing` |
| `src/test/server.ts` | the MSW server, no default handlers | `frontend-testing` |
| `src/test/render-route.tsx` | `renderRoute(path)` and `TEST_API_ORIGIN` | `frontend-testing` |
| `src/test/factories/user.ts` | **example** `buildUser` | `frontend-testing` |
| `src/routes/index.test.tsx` | redirect and not-found; **example**: the redirect test | `frontend-testing` |
| `src/routes/users/index.test.tsx`, `src/routes/users/$userId.test.tsx`, `src/routes/users/new.test.tsx` | **example** route tests for list, detail and form | `frontend-testing` |
| `src/features/users/pagination.test.ts` | **example** unit test | `frontend-testing` |
| `e2e/fixtures.ts` | `test` with the console, page-error and CSP guard; `API_ORIGIN` | `frontend-testing` |
| `e2e/smoke.spec.ts` | **example** flows: create and open, toast under the CSP, axe in both colour schemes | `frontend-testing` |
| `e2e/stub-api.ts` | **example** in-memory backend on port 4010 with the backend's error bodies | `frontend-testing` |

## The users example

What changes once the first real list, detail and form compile; delete each file unless the line says otherwise:

- `src/routes/users/` - `index.tsx` (list with paging in the URL and the past-the-end redirect),
  `$userId.tsx` (detail; a malformed id or a 404 is not-found), `new.tsx` (form), each with its
  `.test.tsx` and each page with its `<title>`.
- `src/features/users/` - `user-table.tsx`, `user-details.tsx`, `create-user-form.tsx`,
  `pagination.ts` and its test.
- `src/test/factories/user.ts`.
- `e2e/smoke.spec.ts` and `e2e/stub-api.ts` (rewritten for the new resource, not deleted).
- `--grid-template-columns-label` in `src/styles.css` (only `user-details.tsx` uses `grid-cols-label`).
- Lines in skeleton files: the two nav links and the not-found link in `src/routes/__root.tsx`,
  the redirect target in `src/routes/index.tsx`, the redirect test in `src/routes/index.test.tsx`,
  the line under the `README.md` heading.
- `src/app/router.test.tsx` uses the `users` list and its "New user" link: point it at the new
  list and create routes, keeping its four cases.
