import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/api-error";

declare module "@tanstack/react-query" {
  interface Register {
    defaultError: ApiError | Error;
    queryMeta: { silent?: boolean };
    mutationMeta: { silent?: boolean };
  }
}

/** Why the user is told about an error the screen does not show itself. */
export type Notify = (reason: "refresh" | "mutation", error: unknown) => void;

const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504]);

// A network failure fails fast, so it is cheap to retry; a read timeout already waited the whole
// limit. Never a broken body or a schema error.
const isTransient = (error: unknown) =>
  error instanceof ApiError ? RETRYABLE_STATUSES.has(error.status) : error instanceof TypeError;

export function createQueryClient(notify: Notify) {
  return new QueryClient({
    queryCache: new QueryCache({
      // A failed first load is the route's error screen; only a failed background refresh toasts.
      // `silent`: the screen shows a failed refresh itself, as a polled screen does.
      onError: (error, query) => {
        if (query.state.data !== undefined && !query.meta?.silent) notify("refresh", error);
      },
    }),
    mutationCache: new MutationCache({
      // `silent`: the screen that started the mutation shows its errors itself, as a form does.
      onError: (error, _variables, _onMutateResult, mutation) => {
        if (!mutation.meta?.silent) notify("mutation", error);
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (failureCount, error) => failureCount < 2 && isTransient(error),
      },
      // A write is never repeated or sent later behind the user's back: offline, it fails at once.
      mutations: { retry: false, networkMode: "always" },
    },
  });
}
