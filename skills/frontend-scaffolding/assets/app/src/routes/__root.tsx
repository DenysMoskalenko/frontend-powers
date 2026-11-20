import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: PageNotFound,
});

function RootLayout() {
  return (
    <>
      <header className="border-line border-b">
        <nav aria-label="Main" className="mx-auto flex max-w-3xl gap-4 p-4">
          <Link to="/users" activeOptions={{ exact: true }}>
            Users
          </Link>
          <Link to="/users/new">New user</Link>
        </nav>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <Outlet />
      </main>
    </>
  );
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
