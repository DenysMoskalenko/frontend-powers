import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureApi } from "@/api/fetcher";
import { createAppRouter } from "@/app/router";

/** The API origin route tests run against; MSW answers it. */
export const TEST_API_ORIGIN = "https://api.test";

/**
 * Renders the whole app at `path`: the real route tree, a fresh QueryClient, the app's providers.
 * Only the network is fake (MSW, per test).
 */
export function renderRoute(path: string) {
  configureApi({ baseUrl: TEST_API_ORIGIN });
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  const { queryClient } = router.options.context;
  // The app's defaults minus retries: a failed request shows its error at once, not after backoff.
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  const user = userEvent.setup();
  render(<RouterProvider router={router} />);
  return { user, router };
}
