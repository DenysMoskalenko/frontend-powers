---
name: tanstack-router-spa
description: "Use when adding a page or URL, or changing a TanStack Router file route in src/routes: createFileRoute, validateSearch, filters, sort or paging kept in the URL, loaderDeps, a loader, notFound, redirect in beforeLoad, a pathless layout guard, Link or navigate, useBlocker, errorComponent, pendingComponent, createAppRouter, routeTree.gen.ts; also will not be code-split warnings and search params that arrive as numbers. Not for query options or mutations (tanstack-query-api), forms (frontend-forms), session or guard policy (keycloak-spa-auth), route tests (frontend-testing)."
metadata:
  version: "0.1.0"
---

# TanStack Router in a client-rendered SPA

Assumes @tanstack/react-router 1.170, @tanstack/router-plugin 1.169, @tanstack/react-query 5.107, zod 4.6.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, use its own modules, helpers and scripts, and say so when it has no equivalent instead of adding one unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If `pnpm-lock.yaml` pins another major version than the line above, follow the project and say which rules may not apply.

## Important

- A route file exports only `Route`. Its page component is an unexported function; `autoCodeSplitting` keeps an exported one in the entry chunk, often without a warning (exporting `NewUserPage` adds about 19 KB gzip and fails the scaffold's 160 KB entry budget).
- The loader fills the Query cache and the component reads it: `context.queryClient.query({ ...getXQueryOptions(deps), staleTime: "static" })` in the loader, `useSuspenseQuery(getXSuspenseQueryOptions(...))` in the component. Never `Route.useLoaderData()` for server data: it does not follow cache updates.
- Shareable view state (page, filter, sort, tab) lives in `validateSearch`, never in `useState`: a zod schema passed directly, every key `.optional().catch(undefined)`, free text and string ids `z.coerce.string()`, because the router JSON-parses `?q=42` into the number `42`.
- `createAppRouter` sets `defaultErrorComponent: RouteError`, so a failed load renders inside its parent's layout. A route sets its own `errorComponent` only to show a different screen.
- `src/routeTree.gen.ts` is generated whenever Vite starts (dev, build, Vitest), committed, and never edited by hand.

## References

- `references/route-files.md` — file names and URLs, layouts and groups, the generated tree, what `autoCodeSplitting` splits and what defeats it (measured), `getRouteApi`. When creating or moving a route file, or when the entry chunk grows.
- `references/search-and-loaders.md` — how the router parses search values, a free-text search box and its test, a complete route with search ids, parallel loads, `notFound` and a pending component plus its test, loader shapes. When writing `validateSearch`, `loaderDeps` or a loader.
- `references/navigation-and-guards.md` — `Link` and `navigate` options, `redirect`, the guard layout and context extension, `useBlocker` with a resolver, router options and defaults, pending, error and not-found placement. When adding navigation, a guard, a blocker or a router option.

## File routes

Directory routes mirror the URL:

| URL | File |
|---|---|
| `/users` | `src/routes/users/index.tsx` (id `/users/`) |
| `/users/new` | `src/routes/users/new.tsx` |
| `/users/:userId` | `src/routes/users/$userId.tsx` |
| `/users/:userId/edit`, a page of its own beside the detail page | `src/routes/users/$userId_/edit.tsx` (id `/users/$userId_/edit`) |
| layout without a URL segment (guard, shell) | `src/routes/_signed-in.tsx` plus children in `src/routes/_signed-in/` |
| root layout | `src/routes/__root.tsx` with `createRootRouteWithContext<{ queryClient: QueryClient }>()` |

A file under `users/$userId/` nests inside `$userId.tsx`, which then shows only itself unless it renders `<Outlet />`. A child URL with its own page (edit, activity) goes under `$userId_/`: the trailing `_` keeps the URL and drops the nesting, and the detail file stays untouched. Turn `$userId.tsx` into a layout with `<Outlet />` only when the children render inside the detail page (a shared header, tabs).

Route tests sit next to the route as `*.test.tsx`, kept out of the tree by `routeFileIgnorePattern`.

## What a route file holds

Routing only: options, then unexported components that read params and search and pass them as props to feature components. Options in this order:

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

The loader and the component import from different modules (query options from `@/api/generated/api`, UI from feature files): chunks are assigned per module, so a shared barrel pulls the component into the entry chunk.

Each page component, and each not-found and error component, renders React 19's `<title>` before its `<h1>`; the root layout renders none.

## Search params

```tsx
const searchSchema = z.object({
  page: z.int().min(1).optional().catch(undefined),
  q: z.coerce.string().min(1).optional().catch(undefined),
});
```

- Defaults apply at the read (`search.page ?? 1`) and the default is written as `undefined`, so one page has one URL.
- Read with `Route.useSearch({ select })`, the API params with `Route.useLoaderDeps()`, path params with `Route.useParams()`; never `window.location.search`, which skips validation.
- Write with an updater that keeps the other keys: `<Link from={Route.fullPath} search={(prev) => ({ ...prev, page: page + 1 })}>`; a filter change also resets the page (`page: undefined`). In callbacks, `Route.useNavigate()` takes the same updater. A feature component, which may not import `Route`, writes the route's full path as a literal, still checked against the tree: `<Link from="/users/" search={...}>`, `useNavigate({ from: "/users/" })`.
- A free-text box is uncontrolled (`defaultValue={q}`, `key={q}`) and trims on submit, which navigates with `replace: true` and `page: undefined`. No `.trim()` in the schema: a box fed from the URL value then cannot hold a space.

## Loaders

```tsx
loaderDeps: ({ search }) => toListParams(search.page ?? 1),
loader: async ({ context, deps }) => {
  const users = await context.queryClient.query({
    ...getListUsersQueryOptions(deps),
    staleTime: "static",
  });
  if (users.items.length === 0 && deps.offset > 0) {
    const last = pageCount(users);
    throw redirect({
      to: "/users",
      search: { page: last > 1 ? last : undefined },
      replace: true,
    });
  }
  return users;
},
```

- `staleTime: "static"` returns cached data at once and fetches only on a cold cache; `useSuspenseQuery` refetches stale data later.
- Both getters take the same arguments; `query()` rejects the suspense options with TS2379.
- An optional search key enters the API params only when set: `...(search.q !== undefined && { q: search.q })`; a bare `q: search.q` is TS2375.
- The list loader above sends a page past the end to the last page. A loader may return what it fetched, as this one does, but no component reads that value (see Important).
- Every loader that takes an id from the path (detail, edit, any child page) checks it with the generated params schema (`GetXParams` in `api.zod.ts`) and throws `notFound()` before any request, and turns a 404 into `notFound()`, with a `notFoundComponent` on the route:

```tsx
if (!GetUserParams.safeParse({ id: params.userId }).success) throw notFound();
try {
  await context.queryClient.query({
    ...getGetUserQueryOptions(params.userId),
    staleTime: "static",
  });
} catch (error) {
  if (error instanceof ApiError && error.status === 404) throw notFound();
  throw error;
}
```

- Await only what the first paint needs; start the rest with `void context.queryClient.query({ ...options, staleTime: "static" }).catch(() => undefined)` and read it with `useQuery`.

## Navigation

- In-app links are `<Link to="/users/$userId" params={{ userId }}>`, type-checked; a plain `<a href>` reloads the app.
- `activeOptions={{ exact: true }}` on a link to a parent path, or it stays active on every child. `disabled` renders it without `href`.
- In a callback (after a mutation), `Route.useNavigate()`; a redirect that needs only the URL or the context is `throw redirect({ to: "/users" })` in `beforeLoad` (the scaffold's `/`).

## Errors, pending, not found

- `RouteError` (`@/shared/ui/route-error`) resets the Query error boundary, shows `ApiError.requestId`, and its Try again calls `router.invalidate()`, which re-runs the loaders.
- An unknown URL gets the root's `notFoundComponent` inside the layout.

## Guards

A pathless layout route whose `beforeLoad` reads the router context and either returns an object, merged into every child's context, or leaves the route. Context is typed on `createRootRouteWithContext<...>()` and filled in `createAppRouter`. Who may pass, where the rest go, and what 401 and 403 do belong to `keycloak-spa-auth`.

## Navigation blockers

`useBlocker({ shouldBlockFn, enableBeforeUnload })`: `shouldBlockFn` runs at navigation time and returns `true` to block, so it reads live state, never a rendered snapshot; `withResolver: true` returns `{ status, proceed, reset }` for an in-app dialog. When a form uses it belongs to `frontend-forms`.

## Router creation

`createAppRouter` (`src/app/router.tsx`) builds the router, its `QueryClient` and providers, and declares `Register`; its options are in `references/navigation-and-guards.md`. `Wrap` is the one provider slot shared with route tests. Never create a `QueryClient` or router at module level.

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
| `export function UsersPage` from a route file | keep it unexported; shared code goes to a feature file |
| `import { Route } from "@/routes/..."` in a feature | props; `getRouteApi("<id>")` only in a component used by one route, when the value would pass through several layers |
| `.default(1)` or a required key in a search schema | `.optional().catch(undefined)`, default at the read |
| Render "not found" from the component after a 404 | `throw notFound()` in the loader, plus `notFoundComponent` |
| Check the session in a component `useEffect` and call `navigate` | `beforeLoad` on a pathless layout, `throw redirect(...)` |
| Remove `defaultPreloadStaleTime: 0` | keep it: Query owns freshness |
