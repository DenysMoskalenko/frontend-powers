---
name: tanstack-router-spa
description: "Use when adding a page or URL, or changing a TanStack Router file route in src/routes: createFileRoute, validateSearch, filters, sort or paging kept in the URL, loaderDeps, a loader, notFound, redirect in beforeLoad, a pathless layout guard, Link or navigate, useBlocker, errorComponent, pendingComponent, createAppRouter, routeTree.gen.ts; also will not be code-split warnings and search params that arrive as numbers. Not for query options or mutations (tanstack-query-api), forms (frontend-forms), session or guard policy (keycloak-spa-auth), route tests (frontend-testing)."
metadata:
  version: "0.1.0"
---

# TanStack Router in a client-rendered SPA

Assumes @tanstack/react-router 1.170, @tanstack/router-plugin 1.169, @tanstack/react-query 5.108, zod 4.6.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another version of a package than the line above, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

## Important

- A route file exports only `Route`. Its page component is an unexported function; `autoCodeSplitting` keeps an exported one in the entry chunk, often without a warning.
- The loader fills the Query cache and the component reads it: `loadQuery(context.queryClient, getXQueryOptions(deps))` (`@/shared/lib/load-query`) in the loader, `useSuspenseQuery(getXSuspenseQueryOptions(...))` in the component. Never `Route.useLoaderData()` for server data: it does not follow cache updates.
- Shareable view state (page, filter, sort, tab) lives in `validateSearch`, never in `useState`: a zod schema passed directly (zod needs `src/app/zod-config.ts` imported first: `tanstack-query-api`), every key `.optional().catch(undefined)`, free text and string ids `z.coerce.string()`, because `?q=42` arrives as the number `42`. A search box trims on submit and navigates with `replace: true`; no `.trim()` in the schema.
- A page under a detail URL that is not shown inside the detail page is `users/$userId_/edit.tsx`: never a flat `$userId_.edit.tsx`, never `$userId.tsx` turned into a layout.

## References

- `references/route-files.md` — file names and URLs, layouts and groups, the generated tree, what `autoCodeSplitting` splits and what defeats it (measured), `getRouteApi` and links from a feature. When creating or moving a route file, or when the entry chunk grows.
- `references/search-and-loaders.md` — how search values parse (measured), a free-text search box and its test, a complete route with search ids, awaited and deferred loads and `notFound`, plus the test that proves them, loader shapes. When writing `validateSearch`, `loaderDeps` or a loader.
- `references/navigation-and-guards.md` — `Link` and `navigate` options, `redirect`, the guard layout and context extension, `useBlocker` with a resolver, `createAppRouter`'s options, focus after navigation, the pending bar, `pendingComponent`, error and not-found placement. When adding navigation, a guard, a blocker, a router option or pending UI.

## File routes

Directory routes mirror the URL:

| URL | File |
|---|---|
| `/users` | `src/routes/users/index.tsx` (id `/users/`) |
| `/users/:userId` | `src/routes/users/$userId.tsx` |
| `/users/:userId/edit`, a page of its own beside the detail page | `src/routes/users/$userId_/edit.tsx` |
| layout without a URL segment (guard, shell) | `src/routes/_signed-in.tsx` plus children in `src/routes/_signed-in/` |
| root layout | `src/routes/__root.tsx` with `createRootRouteWithContext<{ queryClient: QueryClient }>()` |

A file under `users/$userId/` renders inside `$userId.tsx`'s `<Outlet />`; the `_` of `$userId_/` keeps the URL and drops the nesting. Make `$userId.tsx` a layout only for children shown inside the detail page (a shared header, tabs).

Route tests sit next to the route, kept out of the tree by `routeFileIgnorePattern`. `src/routeTree.gen.ts` is generated and committed, never edited by hand.

## What a route file holds

Routing only: options, then unexported components that pass params and search as props to feature components. Options in this order:

| Option | Rule |
|---|---|
| `validateSearch` | the zod schema itself |
| `loaderDeps` | exactly what the loader needs from search, usually the API params |
| `beforeLoad` | sync checks, `throw redirect(...)`; parent to child, serially |
| `loader` | fills the Query cache; parent and child loaders run in parallel |
| `component` | an unexported function here, or one imported from its own feature file |
| `pendingComponent` | only where a slow load needs one; not code-split, so plain markup |
| `errorComponent` | only for a screen other than the default `RouteError` |
| `notFoundComponent` | where the loader throws `notFound()` |

Each page component, and each not-found and error component, renders React 19's `<title>` before its one `<h1>`; the root layout renders none. A project with its own `document.title` helper keeps the helper.

## Search params

- Defaults apply at the read (`search.page ?? 1`) and the default is written as `undefined`, so one page has one URL.
- Read with `Route.useSearch({ select })`, the API params with `Route.useLoaderDeps()`, path params with `Route.useParams()`; never `window.location.search`, which skips validation.
- Write with an updater that keeps the other keys: `<Link from={Route.fullPath} search={(prev) => ({ ...prev, page: page + 1 })}>`; a filter change also resets the page (`page: undefined`). In callbacks, `Route.useNavigate()` takes the same updater; a feature component writes `from="/users/"` as a literal.

## Loaders

```tsx
loaderDeps: ({ search }) => toListParams(search.page ?? 1),
loader: ({ context, deps }) => loadQuery(context.queryClient, getListUsersQueryOptions(deps)),
```

- `loadQuery` returns cached data at once however old, but refetches and awaits a query marked invalidated. A bare `queryClient.query({ ...options, staleTime: "static" })` returns invalidated data too (query-core checks `"static"` before `isInvalidated`), so a list visited before would paint its old rows after a create or a delete.
- `createAppRouter` sets `defaultStaleReloadMode: "blocking"`: on a return to a page the router still holds, it waits for the loader instead of painting the held page and re-running the loader behind it (the default, `"background"`, which paints the old rows even through `loadQuery`). The cost: a loader that awaits something slow keeps the previous page, under the pending bar, on every return.
- An optional search key enters the API params only when set: `...(search.q !== undefined && { q: search.q })`; a bare `q: search.q` is TS2375.
- Every loader that takes an id from the path (detail, edit, any child page) checks it with the generated params schema (`GetXParams` in `api.zod.ts`) and throws `notFound()` before any request, and turns a 404 into `notFound()`, with a `notFoundComponent` on the route (form in `references/search-and-loaders.md`).
- What the page shows on arrival is awaited, all of it in one `Promise.all`, and read with `useSuspenseQuery`. Only what it can render without (behind a tab or toggle, a widget allowed to fail alone) is started with `void loadQuery(...).catch(() => undefined)` before the loader's first `await`, and read with `useQuery`: started after an `await`, it waits a round trip.

## Navigation

- In-app links are `<Link to="/users/$userId" params={{ userId }}>`, type-checked; a plain `<a href>` reloads the app.
- `activeOptions={{ exact: true }}` on a link to a parent path, or it stays active on every child. `disabled` renders it without `href`.
- In a callback, `Route.useNavigate()` (after a write, in the order `tanstack-query-api`'s delete recipe gives); a redirect that needs only the URL or the context is `throw redirect({ to: "/users" })` in `beforeLoad` (the scaffold's `/`).

## Errors, pending, not found

- While a navigation waits for its loaders, the previous page stays and the root layout shows a `role="progressbar"` named "Loading page", invisible for 200 ms. On a first load the layout (the root's `shellComponent`) and the bar show instead of a blank page, through the root's empty `beforeLoad` and `pendingComponent: () => null`; keep them. A route adds a `pendingComponent` only when its loader is often slower than a second and a skeleton serves better than the old page (navigation reference).
- `RouteError` (`@/shared/ui/route-error`) shows `ApiError.requestId`; its Try again calls `router.invalidate()`, which re-runs the loaders.
- An unknown URL gets the root's `notFoundComponent` inside the layout.

## Guards

A pathless layout route whose `beforeLoad` reads the router context and either returns an object, merged into every child's context, or leaves the route; the three edits are in `references/navigation-and-guards.md`. Who may pass, where the rest go, and what 401 and 403 do belong to `keycloak-spa-auth`.

## Navigation blockers

`useBlocker({ shouldBlockFn, enableBeforeUnload, withResolver })`, with `shouldBlockFn` reading live state at navigation time; an in-app dialog is in the navigation reference, when a form uses one is `frontend-forms`'s.

## Router creation

`createAppRouter` (`src/app/router.tsx`) declares `Register`; its options and focus handling are in `references/navigation-and-guards.md`, the providers in its `Wrap` are `frontend-project-structure`'s. It focuses the first `h1` inside `main` after a path change, so every page renders exactly one `h1` and sets no `tabIndex`.

## Prior-version corrections

| Older examples write | Correct now |
|---|---|
| `react-router-dom`: `useSearchParams`, `useNavigate`, `<Navigate>`, `useLoaderData` | `Route.useSearch`, `Route.useNavigate`, `redirect` in `beforeLoad`, loader plus `useSuspenseQuery` |
| `TanStackRouterVite()`, `@tanstack/router-vite-plugin` | `tanstackRouter()` from `@tanstack/router-plugin/vite` (old name: deprecated alias) |
| `users.lazy.tsx` with `createLazyFileRoute`, `.component.tsx` files | one route file under `autoCodeSplitting` |
| flat dot routes, `users.$userId.tsx` | directory routes, `users/$userId.tsx` |
| `validateSearch: zodValidator(schema)` from `@tanstack/zod-adapter`, `fallback()` | `validateSearch: schema`, `.optional().catch(undefined)` |
| `useBlocker({ blockerFn, condition })`, `useBlocker(fn, condition)` | `useBlocker({ shouldBlockFn, enableBeforeUnload, withResolver })` |
| `preSearchFilters`, `postSearchFilters` | `search: { middlewares: [retainSearchParams([...]), stripSearchParams({...})] }` |
| `new FileRoute("/x").createRoute({...})` | `createFileRoute("/x")({...})` |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| `import { Route } from "@/routes/..."` in a feature | props, since the boundaries lint rejects the import; `getRouteApi("<id>")` only in a component used by one route, when the value would pass through several layers |
| `.default(1)` or a required key in a search schema | `.optional().catch(undefined)`, default at the read: one page keeps one URL, and a bad key falls back alone |
| Remove the root's empty `beforeLoad` or `pendingComponent: () => null` as dead code, or move the layout from `shellComponent` to `component` | keep them: they render the layout and the bar during a slow first load instead of a blank page, without mounting the layout twice |
| `errorComponent: RouteError` on a route | leave it out: `createAppRouter`'s `defaultErrorComponent` already renders it inside the parent's layout |
| Read in a loader with `queryClient.query({ ...options, staleTime: "static" })` or `ensureQueryData` | `loadQuery`: both return data already marked invalidated |
| Render "not found" from the component after a 404 | `throw notFound()` in the loader, plus `notFoundComponent`, so the page never renders without its data |
| Check the session in a component `useEffect` and call `navigate` | `beforeLoad` on a pathless layout, `throw redirect(...)`: the effect runs after the page and its loaders |
