# Polling and a lost connection

Contents:

- [What polls and what stops it](#what-polls-and-what-stops-it)
- [Offline: networkMode](#offline-networkmode)
- [A failed poll](#a-failed-poll)
- [A shorter timeout for one query](#a-shorter-timeout-for-one-query)
- [Showing how old the data is](#showing-how-old-the-data-is)
- [The polled component and its test](#the-polled-component-and-its-test)

A screen that refetches on an interval: a job's status, a dashboard, a "running now" list. Every fact
below is TanStack Query 5.108's behaviour.

## What polls and what stops it

`refetchInterval` (milliseconds, or a function of the query that returns a number or `false`) goes
through the getter's `query` argument. Polling runs only while an observer is mounted and the tab
is visible. It stops when the component unmounts, when `enabled` is `false`, when the function
returns `false` (a job that has finished), and while the tab is hidden unless
`refetchIntervalInBackground: true`. A tick that arrives while the previous request is still running
starts no second one. Polling never runs where there is no `window`, so its test is a
`*.dom.test.ts` or `*.test.tsx` file.

## Offline: networkMode

The house default is Query's own `networkMode: "online"`; `createQueryClient` does not change it.
After the browser's `offline` event a fetch pauses instead of failing: `isPaused` is true,
`isError` stays false, no toast, and `dataUpdatedAt` stays where it was. Paused fetches run again on
the `online` event. A loader's first load pauses too, so the route's pending bar stays until the
connection returns.

There is no separate offline screen. When the browser still believes it is online, a lost connection
is a `TypeError` from `fetch`: the retry rule retries it, then the route's error screen or the
refresh toast shows it (both in the client reference). A polled screen adds one thing: it says its
data is old.

## A failed poll

Set `retry: false` on the polled query: the next tick is the retry. With the app's default rule a
network failure is retried twice within seconds, tripling the load just when the backend struggles.
The loader's first load keeps the default rule, because the loader passes the plain getter options.
The data stays on screen (`isRefetchError` true, `data` kept). Set `meta: { silent: true }` too: the
screen already says its data is old, and without it every failed tick raises the refresh toast,
which stays until dismissed long after the next poll succeeded.

## A shorter timeout for one query

`apiFetch` gives every read 30 seconds to answer. A poll every 30 seconds needs less: override the
getter's `queryFn` and pass the query's own `signal` combined with `AbortSignal.timeout(ms)` through
`AbortSignal.any`. The request then rejects with a `TimeoutError`, which no query retries. A request
that never answers costs one timeout, then the error: a poll marks its data old after
`POLL_TIMEOUT_MS`, and a first load shows the route's error screen after the app's `timeoutMs`
(30 s by default). Never pass the limit as the getter's `request: { signal }`: the generated function
spreads it over the query's signal, so leaving the page no longer cancels the request, and the
timer starts when the options are built, not when the request is sent.

## Showing how old the data is

| Field | Meaning |
|---|---|
| `dataUpdatedAt` | when the data on screen arrived; show it as "updated HH:MM" |
| `errorUpdatedAt` | when the last attempt failed; later than `dataUpdatedAt` means the latest attempt failed |
| `isRefetchError` | the latest refetch failed and the old `data` is still there |
| `isPaused` | a fetch waits for the browser to come back online |

The data is old when `isRefetchError || isPaused`. Say so next to the time, in words, and keep the
data visible. The line is not a live region: a screen reader would hear it on every tick.

## The polled component and its test

```tsx,verify
// file: src/features/users/live-users.tsx
import { useSuspenseQuery } from "@tanstack/react-query";
import {
  getListUsersSuspenseQueryOptions,
  type ListUsersParams,
  listUsers,
} from "@/api/generated/api";
import { formatDateTime } from "@/shared/lib/format-date";

export const POLL_MS = 30_000;
const POLL_TIMEOUT_MS = 10_000;

/** The `query` options that make a users list poll; pass them to either getter. */
export const livePolling = (params: ListUsersParams) => ({
  // The query's signal combined with a shorter limit: a poll slower than this is dropped.
  queryFn: ({ signal }: { signal: AbortSignal }) =>
    listUsers(params, { signal: AbortSignal.any([signal, AbortSignal.timeout(POLL_TIMEOUT_MS)]) }),
  refetchInterval: POLL_MS,
  // A failed poll waits for the next tick instead of retrying seconds later.
  retry: false,
  // The screen says its data is old; a toast per failed tick would outlive the failure.
  meta: { silent: true },
});

export function LiveUserCount({ params }: { params: ListUsersParams }) {
  const users = useSuspenseQuery(
    getListUsersSuspenseQueryOptions(params, { query: livePolling(params) }),
  );
  const updated = formatDateTime(new Date(users.dataUpdatedAt).toISOString());
  // The last poll failed, or the browser is offline and polling is paused.
  const isOld = users.isRefetchError || users.isPaused;
  return (
    <p className={isOld ? "text-danger" : "text-muted"}>
      {users.data.total} users, updated {updated}
      {isOld && ". The latest refresh failed, so this may be out of date"}
    </p>
  );
}
```

The test drives the interval with fake timers through a `QueryObserver`. `queryClient.mount()` is what
`QueryClientProvider` does, and without it the `online` event reaches no query.

```ts,verify,test
// file: src/features/users/live-users.dom.test.ts
import { onlineManager, QueryClient, QueryObserver } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { configureApi } from "@/api/fetcher";
import { getListUsersQueryOptions } from "@/api/generated/api";
import { livePolling, POLL_MS } from "@/features/users/live-users";
import { server } from "@/test/server";

const origin = "https://api.test";
const params = { limit: 20, offset: 0 };
type Answer = "ok" | "network error" | "silence";

function pollUsers(answers: Answer[]) {
  configureApi({ baseUrl: origin });
  const queryClient = new QueryClient();
  // What QueryClientProvider does: listen to focus and online events.
  queryClient.mount();
  let requests = 0;
  server.use(
    http.get(`${origin}/users`, () => {
      const answer = answers[requests] ?? "ok";
      requests += 1;
      if (answer === "network error") return HttpResponse.error();
      if (answer === "silence") return new Promise<never>(() => {});
      return HttpResponse.json({ items: [], total: requests, ...params });
    }),
  );
  const observer = new QueryObserver(
    queryClient,
    getListUsersQueryOptions(params, { query: livePolling(params) }),
  );
  const unsubscribe = observer.subscribe(() => {});
  const stop = () => {
    unsubscribe();
    queryClient.unmount();
  };
  return { observer, stop, requests: () => requests };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  onlineManager.setOnline(true);
});

test("a failed poll keeps the data, marks it old and waits for the next tick", async () => {
  const poll = pollUsers(["ok", "network error", "ok"]);
  await vi.advanceTimersByTimeAsync(0);
  const firstUpdate = poll.observer.getCurrentResult().dataUpdatedAt;

  await vi.advanceTimersByTimeAsync(POLL_MS + 5_000);

  const failed = poll.observer.getCurrentResult();
  expect(poll.requests()).toBe(2);
  expect(failed.isRefetchError).toBe(true);
  expect(failed.data?.total).toBe(1);
  expect(failed.dataUpdatedAt).toBe(firstUpdate);
  expect(failed.error).toBeInstanceOf(TypeError);

  await vi.advanceTimersByTimeAsync(POLL_MS);

  expect(poll.observer.getCurrentResult()).toMatchObject({
    isRefetchError: false,
    data: { total: 3 },
  });
  poll.stop();
});

test("offline, a poll pauses instead of failing and runs again on reconnect", async () => {
  const poll = pollUsers(["ok"]);
  await vi.advanceTimersByTimeAsync(0);

  onlineManager.setOnline(false);
  await vi.advanceTimersByTimeAsync(POLL_MS);

  expect(poll.requests()).toBe(1);
  expect(poll.observer.getCurrentResult()).toMatchObject({ isPaused: true, isError: false });

  onlineManager.setOnline(true);
  await vi.advanceTimersByTimeAsync(0);

  expect(poll.requests()).toBe(2);
  expect(poll.observer.getCurrentResult().isPaused).toBe(false);
  poll.stop();
});

test("a poll with no answer gives up after the query's own timeout", async () => {
  // The platform's AbortSignal.timeout runs on a timer fake timers do not reach.
  vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
    const controller = new AbortController();
    setTimeout(() => controller.abort(new DOMException("timed out", "TimeoutError")), ms);
    return controller.signal;
  });
  const poll = pollUsers(["ok", "silence"]);
  await vi.advanceTimersByTimeAsync(0);

  await vi.advanceTimersByTimeAsync(POLL_MS + 10_000);

  expect(poll.observer.getCurrentResult()).toMatchObject({
    isRefetchError: true,
    error: { name: "TimeoutError" },
  });
  poll.stop();
});

test("unsubscribing stops the polling", async () => {
  const poll = pollUsers(["ok"]);
  await vi.advanceTimersByTimeAsync(0);

  poll.stop();
  await vi.advanceTimersByTimeAsync(POLL_MS * 3);

  expect(poll.requests()).toBe(1);
});
```
