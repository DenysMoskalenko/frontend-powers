# Navigation, guards, blockers and the router

## Contents

- `Link` options
- `navigate` and `redirect`
- A pathless guard layout and context extension
- `useBlocker`
- `createAppRouter` options
- Pending, error and not-found placement

## `Link` options

| Prop | Use |
|---|---|
| `to`, `params` | target route and its path params, both checked against the generated tree: `to="/users/$userId" params={{ userId }}` |
| `from` | the route the relative `to` and the `search` updater start from; `from={Route.fullPath}` with no `to` links to the current route |
| `search` | an object replaces the search; `(prev) => ({ ...prev, page })` keeps the other keys; `true` keeps the current search unchanged |
| `activeOptions` | `{ exact: true }` for a link to a parent path; `includeSearch` (default `true`) makes search part of the match, partially unless `exact`: a tab link with no search key stays active on every tab, so tab links set `exact: true` |
| `activeProps`, `inactiveProps` | props merged when active or inactive; the active link also gets `aria-current="page"` and `data-status="active"` |
| `disabled` | renders an `<a>` without `href` and with `aria-disabled` |
| `preload` | overrides `defaultPreload: "intent"` for one link: `false`, `"viewport"` or `"render"`; `preloadDelay` (default 50 ms) |
| `replace` | replaces the history entry: a filter typed into a search box, not a page change |
| `resetScroll` | `false` keeps the scroll position, for a tab or filter change inside one page |
| `ignoreBlocker` | skips `useBlocker`, for a Cancel link that already asked |

A link that leaves the app is a plain `<a href>`; `reloadDocument` forces a full load of an in-app URL.

## `navigate` and `redirect`

- `const navigate = Route.useNavigate()` fixes `from` to the route; `useNavigate()` from `@tanstack/react-router` is for components outside a route file.
- `navigate` returns a promise: `await` it inside an `async` handler, or `void` it in an event handler, because Biome's `noFloatingPromises` rejects a bare call. A navigation a blocker stops never settles, so nothing after an awaited `navigate` may be required for correctness.
- `throw redirect({ to, params, search, replace })` from `beforeLoad` or a loader. `beforeLoad` is the place when the decision needs only the URL or the router context; a loader when it needs fetched data.
- `router.invalidate()` re-runs the loaders of the current matches; it is what Try again calls.

## A pathless guard layout and context extension

Who is signed in, where a signed-out visitor goes and what happens on a 401 or 403 belong to `keycloak-spa-auth`. The router side is three edits, shown here with the auth skill's `session` and guard body.

1. Type the context on the root route: `createRootRouteWithContext<{ queryClient: QueryClient; session: Session }>()`.
2. Fill it in `createAppRouter`: `context: { queryClient, session }`, with `session` a parameter of `createAppRouter` so tests pass a fake one through `renderRoute`.
3. Put the guard on a pathless layout and move the protected routes under its folder:

```tsx
// src/routes/_signed-in.tsx; the policy in this body is keycloak-spa-auth's
export const Route = createFileRoute("/_signed-in")({
  beforeLoad: ({ context, location, preload }) => {
    const userId = context.session.userId();
    if (userId) return { userId };
    if (preload) throw new Error("Signed out");
    return context.session.signIn(location.href);
  },
});

// src/routes/_signed-in/reports.tsx: URL /reports
function ReportsPage() {
  const userId = Route.useRouteContext({ select: (context) => context.userId });
  return <h1>Reports for {userId}</h1>;
}
```

- The object `beforeLoad` returns is merged into the context of the layout and every child, typed: `context.userId` is a `string` in `reports.tsx`, narrowed by the guard.
- `beforeLoad` runs before any child loader, so no protected loader fires for a signed-out user. It runs again on every navigation and preload under the layout (`preload` is `true` for a hovered link): keep it to synchronous checks or cached reads.

## `useBlocker`

| Option | Meaning |
|---|---|
| `shouldBlockFn` | `({ current, next, action }) => boolean \| Promise<boolean>`; `true` blocks. Called at navigation time, so it reads live state |
| `enableBeforeUnload` | `boolean` or `() => boolean`: the browser's own leave prompt on reload, tab close or an external URL |
| `withResolver` | `true` returns `{ status, current, next, proceed, reset }` for an in-app dialog instead of a blocking `window.confirm` |
| `disabled` | turns the blocker off without unmounting it |

The scaffold's `CreateUserForm` uses `shouldBlockFn` with `window.confirm`. With `withResolver`, the dialog is a component of its own; its bare markup stands in for the app's Base UI `AlertDialog` wrapper (`tailwind-base-ui`):

```tsx,verify
import { useBlocker } from "@tanstack/react-router";
import { Button } from "@/shared/ui/button";

export function LeavePrompt({ isDirty }: { isDirty: () => boolean }) {
  const blocker = useBlocker({
    shouldBlockFn: isDirty,
    enableBeforeUnload: isDirty,
    withResolver: true,
  });
  if (blocker.status !== "blocked") return null;

  return (
    <div role="alertdialog" aria-label="Unsaved changes">
      <p>Leave for {blocker.next.pathname}? Your changes will be lost.</p>
      <Button onClick={blocker.proceed}>Leave</Button>
      <Button onClick={blocker.reset}>Stay</Button>
    </div>
  );
}
```

`isDirty` is a function so the blocker reads the state at navigation time: a value passed as a prop is the last render's, which is still dirty right after a successful submit resets the form and blocks the navigation that follows it.

## `createAppRouter` options

| Option | Scaffold | Default | Why |
|---|---|---|---|
| `routeTree` | generated tree | — | |
| `context` | `{ queryClient }` | — | loaders and guards reach the client without a module singleton |
| `history` | browser; memory in tests | browser history | `renderRoute` passes `createMemoryHistory({ initialEntries: [path] })` |
| `defaultPreload` | `"intent"` | `false` | hover, focus or touch on a link runs its loaders, so the next page is often cached |
| `defaultPreloadStaleTime` | `0` | `30_000` | with the default the router skips a loader preloaded in the last 30 s; with 0 the loader always runs and Query decides from its own `staleTime` |
| `scrollRestoration` | `true` | `false` | back and forward restore the scroll position |
| `Wrap` | `CSPProvider`, `QueryClientProvider`, `ToastProvider` | — | app-wide providers outside the router; `InnerWrap` is for a provider that needs router hooks |
| `defaultPendingMs`, `defaultPendingMinMs` | not set | `1000`, `500` | see below |
| `defaultErrorComponent` | `RouteError` | — | every route's error screen, inside its parent's layout; a route's own `errorComponent` overrides it |
| `notFoundMode` | not set | `"fuzzy"` | an unknown URL renders the nearest matched parent's `notFoundComponent` |

The `Register` declaration at the bottom of `src/app/router.tsx` is what types `Link`, `useNavigate` and `getRouteApi` everywhere; it names `ReturnType<typeof createAppRouter>`, so a new router option needs no type change.

## Pending, error and not-found placement

- A route's `pendingComponent` replaces its content after `pendingMs` (default 1000 ms) and stays at least `pendingMinMs` (default 500 ms), so a fast load never flashes it. Without one, the previous page stays on screen while the loader runs. A cached page skips both, because the `staleTime: "static"` read resolves at once.
- A failing route renders its `errorComponent`, or the router's `defaultErrorComponent` (`RouteError`), inside its parent's layout; the header and navigation stay. Give a route its own `errorComponent` only for a different screen.
- A `notFound()` thrown in a loader renders that route's `notFoundComponent` inside the parent layout; an unknown URL renders the root's `notFoundComponent` in the root layout's `<Outlet />`.
