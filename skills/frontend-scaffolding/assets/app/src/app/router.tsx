import { CSPProvider } from "@base-ui/react/csp-provider";
import { Toast } from "@base-ui/react/toast";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createRouter,
  parseSearchWith,
  type RouterHistory,
  stringifySearchWith,
} from "@tanstack/react-router";
import { ApiError } from "@/api/api-error";
import { routeTree } from "@/routeTree.gen";
import { RouteError } from "@/shared/ui/route-error";
import { ToastProvider } from "@/shared/ui/toast";
import { createQueryClient } from "./query-client";

const NOTICES = {
  refresh: "Could not refresh the data",
  mutation: "The change was not saved",
} as const;

// The default parser rewrites `?q=1.50` to 1.5 and ids past 2^53 to another number: a top-level
// value is a number only when it prints back as typed, so free text and long ids stay text.
const exactJson = (value: string): unknown => {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed === "number" && String(parsed) !== value) throw new Error("not exact");
  return parsed;
};

/** The whole app: route tree, QueryClient, providers. `main.tsx` and every route test build it. */
export function createAppRouter({ history }: { history?: RouterHistory } = {}) {
  const toastManager = Toast.createToastManager();
  const queryClient = createQueryClient((reason, error) =>
    toastManager.add({
      title: NOTICES[reason],
      description: error instanceof ApiError && error.requestId && `Request id: ${error.requestId}`,
    }),
  );
  const router = createRouter({
    routeTree,
    context: { queryClient },
    ...(history && { history }),
    parseSearch: parseSearchWith(exactJson),
    stringifySearch: stringifySearchWith(JSON.stringify, exactJson),
    defaultPreload: "intent",
    // Query owns freshness: the router always runs loaders, and they read the cache.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    // Each route catches its own error, so the root layout and its navigation stay on screen.
    defaultErrorComponent: RouteError,
    // The provider slot: app-wide providers (i18n, a realtime client) go here, once for app and tests.
    // biome-ignore lint/correctness/noComponentHookFactories: built once per router, which keeps it.
    Wrap: ({ children }) => (
      // Base UI's inline <style> tags would break the CSP's `style-src 'self'`.
      <CSPProvider disableStyleElements>
        <QueryClientProvider client={queryClient}>
          <ToastProvider manager={toastManager}>{children}</ToastProvider>
        </QueryClientProvider>
      </CSPProvider>
    ),
  });
  // A screen reader hears nothing after a client-side navigation unless focus moves to the new page.
  // Not on the first render or a search-only change; `preventScroll` leaves scroll restoration alone.
  router.subscribe("onRendered", ({ fromLocation, pathChanged }) => {
    const heading = fromLocation && pathChanged && document.querySelector<HTMLElement>("main h1");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
