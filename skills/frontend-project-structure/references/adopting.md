# Adopting the standard in an existing app

An app that was not built from the frontend-scaffolding template moves onto this standard one
concern at a time. A big-bang rewrite mixes behaviour changes into moves and cannot be reviewed;
per-file fixes during feature work leave two styles side by side. Each step below is its own change.

## First: what the project has

Read the project's agent file, its architecture or plan document and `package.json` with the
lockfile. List which of the assumed pieces exist: zod, TanStack Form, MSW (or a per-URL `fetch`
stub that does the same job), user-event, the React Compiler in `vite.config.ts`, the `@/` alias,
`boundaries.grit`, orval's zod and MSW outputs, a router factory with providers in `Wrap`. Rules
that need an absent piece do not apply until the step that adopts it. A helper with a template name
(`apiFetch`, `ApiError`, `createAppRouter`) may have another shape: read it before relying on it.

## The order

Each step leaves the project's own lint, tests and build green and changes no behaviour but its
own. Steps whose pieces already exist are skipped.

1. Independent wins, each alone: stale-chunk reload and cache headers (`frontend-deploy`); the query
   retry predicate and the `requestId` in error copy (`tanstack-query-api`); exact pins
   (`saveExact`, `frontend-tooling`).
2. Lint: one Biome rule per change at `error`, its findings fixed in the same change; a suppression
   only with a reason (`frontend-tooling`).
3. Test harness before any refactor: app-wide providers into the router's `Wrap` (this skill), a
   `renderRoute` over the project's own router factory, and a request no handler answers failing
   the test (`frontend-testing`). That last needs MSW or a per-URL `fetch` stub that fails on an
   unknown URL: a project with the stub keeps it, and MSW replaces it as its own change before
   step 5, whose generated handlers need it.
4. zod as one step: the dependency, `src/app/zod-config.ts` imported first in `main.tsx`
   (`tanstack-query-api`), its chunk group and the entry budget (`frontend-tooling`); then search
   schemas route by route (`tanstack-router-spa`).
5. Generated zod and MSW outputs from orval (`tanstack-query-api`), released by the client's owner
   when the client is a shared package (`frontend-shared-packages`); then forms on TanStack Form,
   one form per change (`frontend-forms`).
6. Layout last: the `@/` alias and `boundaries.grit` (`frontend-tooling`), then moves into
   `features/` and `shared/` one feature per change (this skill), never one big move.
7. The React Compiler as its own step, with `useReactCompiler` at `error`
   (`frontend-tooling`); then memoization removed file by file, comparing the entry budget
   (`frontend-code-style`).

Never rename environment variables, scripts or a shared package's exports as a side effect. Record
each deliberate deviation in the project's architecture document, so later work keeps it.
