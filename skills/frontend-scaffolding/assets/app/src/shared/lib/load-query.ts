import type { QueryClient, QueryExecuteOptions, QueryKey } from "@tanstack/react-query";

/**
 * A loader's read: cached data at once however old, but an invalidated query is refetched and
 * awaited. Pass the `getXQueryOptions` of the key the component reads with `useSuspenseQuery`.
 */
export function loadQuery<TQueryFnData, TError, TData, TQueryKey extends QueryKey>(
  queryClient: QueryClient,
  options: QueryExecuteOptions<TQueryFnData, TError, TData, TQueryFnData, TQueryKey>,
): Promise<TData> {
  return queryClient.query({
    ...options,
    // `"static"` alone also returns invalidated data: query-core checks it before isInvalidated.
    staleTime: (query) => (query.state.isInvalidated ? 0 : "static"),
  });
}
