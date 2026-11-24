import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // The shell stays mounted around the root's content, pending or not. The router renders nothing
  // until a match is pending or ready: the empty `beforeLoad` makes the root pending on a first load
  // only, so the layout and the bar show at once while the page loads, and a later navigation keeps
  // the previous page under the bar. `pendingMinMs` would hold a fast first load back.
  shellComponent: RootLayout,
  beforeLoad: () => {},
  pendingComponent: () => null,
  pendingMs: 0,
  pendingMinMs: 0,
  notFoundComponent: PageNotFound,
});

function RootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <NavigationProgress />
      <header className="border-line border-b">
        <nav aria-label="Main" className="mx-auto flex max-w-3xl gap-4 p-4">
          <Link to="/users" activeOptions={{ exact: true }}>
            Users
          </Link>
          <Link to="/users/new">New user</Link>
        </nav>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">{children}</main>
    </>
  );
}

/** While a navigation waits for its loaders; `.navigation-progress` stays invisible for the first 200 ms. */
function NavigationProgress() {
  const pending = useRouterState({ select: (state) => state.status === "pending" });
  return pending ? (
    <div role="progressbar" aria-label="Loading page" className="navigation-progress" />
  ) : null;
}

function PageNotFound() {
  return (
    <>
      <title>Page not found</title>
      <h1 className="font-semibold text-2xl">Page not found</h1>
      <Link to="/users">Back to users</Link>
    </>
  );
}
