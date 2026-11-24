# Centrifugo: the client, channels and the cache bridge

Contents

- [Adding it](#adding-it)
- [The connection module](#the-connection-module)
- [The hooks](#the-hooks)
- [Wiring in `createAppRouter`](#wiring-in-createapprouter)
- [A screen that follows a channel](#a-screen-that-follows-a-channel)
- [The cache bridge for versioned entities](#the-cache-bridge-for-versioned-entities)
- [Signals no endpoint returns](#signals-no-endpoint-returns)
- [Authentication](#authentication)
- [Recovery and the server side](#recovery-and-the-server-side)
- [Tests](#tests)
- [End-to-end](#end-to-end)

## Adding it

1. `pnpm add centrifuge` (bare, so the pin is exact). It stops on `ERR_PNPM_IGNORED_BUILDS ...
   Ignored build scripts: protobufjs@7.6.6`: `protobufjs` serves only centrifuge's protobuf
   entry, which this app does not import, and its postinstall only prints a version-range warning.
   Decline it under `allowBuilds` (the mechanism is `frontend-tooling`'s), then run `pnpm install`:

   ```yaml
   allowBuilds:
     # centrifuge's protobuf codec: the postinstall only warns, and the JSON client never imports it.
     protobufjs: false
   ```

2. `PUBLIC_REALTIME_ORIGIN` through `frontend-deploy`'s new-origin steps, with the value as the
   browser dials it: `wss://rt.example.com`, locally `ws://localhost:8001`. The origin check in
   `vite.config.ts` accepts a `wss://` or `ws://` origin, and the CSP's `connect-src` gets it as is.
   The Playwright run needs it too, with a socket mock and a Centrifugo server: [End-to-end](#end-to-end).
3. The new files below: `src/api/realtime.ts`, `src/shared/hooks/use-channel.ts`,
   `src/shared/ui/live-status.tsx`, `src/features/users/use-live-user.ts`, and for tests
   `src/test/fake-centrifuge.ts`, for end-to-end `e2e/realtime.ts`. Add each in the same change as its first caller (`useChannel`
   with the screen that follows a channel, `LiveStatus` with the route that shows it): knip fails
   on a file or export nothing imports.
4. The changed scaffold files. Every block of them here is the complete file for the bare
   scaffold. In an app that already has another add-on or its own changes, merge the additions
   below into the existing file and never replace it; `frontend-project-structure`'s
   app-composition reference shows the combined files.
   - `src/vite-env.d.ts`: `readonly PUBLIC_REALTIME_ORIGIN: string;`.
   - `src/app/env.ts`: `realtimeOrigin`.
   - `src/api/fetcher.ts`: the `apiToken` export (the SSE reference quotes the file).
   - `src/app/router.tsx`: `createRealtime` beside the QueryClient, and `RealtimeContext` between
     `QueryClientProvider` and `ToastProvider` in `Wrap`.
   - `src/routes/users/$userId.tsx`: `useLiveUser(userId)` and `<LiveStatus />`.
   - `src/test/setup.ts`: the `vi.mock("centrifuge", ...)` line.
   - `e2e/fixtures.ts` and `playwright.config.ts`: `e2e/realtime.ts` merged and listed.

```ts
// src/vite-env.d.ts
interface ImportMetaEnv {
  readonly PUBLIC_API_ORIGIN: string;
  readonly PUBLIC_REALTIME_ORIGIN: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
```

```ts,verify
// file: src/app/env.ts
/** The build's public configuration; vite.config.ts refused to build without valid values. */
export const env = {
  apiOrigin: import.meta.env.PUBLIC_API_ORIGIN,
  realtimeOrigin: import.meta.env.PUBLIC_REALTIME_ORIGIN,
};
```

## The connection module

A factory, not a module-level client: each router builds one, so the app has one connection and
every test its own. `centrifuge` loads on the first subscribe, a separate chunk of about 23 KB gzip
fetched only by a screen that subscribes. Measured on the scaffold, the wiring (this module,
`RealtimeContext` and the fetcher's `apiToken` in `router.tsx`) adds about 0.7 KB gzip to the
entry, and the live user page below about 0.7 KB more (1.3 KB together): raise
`ENTRY_BUDGET_BYTES` by what `pnpm build` reports, naming the cause, as `frontend-tooling` says.

```ts,verify
// file: src/api/realtime.ts
import type { Centrifuge } from "centrifuge";

export type RealtimeStatus = "disconnected" | "connecting" | "connected";

export interface ChannelListener {
  publication: (data: unknown) => void;
  /** Each (re)subscribe; `recovered: false` means publications may have been missed. */
  subscribed: (recovered: boolean) => void;
}

interface Channel {
  listeners: Set<ChannelListener>;
  /** The subscription's state; `unsubscribed` while followed means the server refused or ended it. */
  state: "subscribing" | "subscribed" | "unsubscribed";
  /** Set once the subscription exists; ends it. */
  close?: () => void;
}

/** centrifuge-js does not reconnect after these codes, and neither does this module. */
const isTerminal = (code: number) => (code >= 3500 && code < 4000) || (code >= 4500 && code < 5000);

export type Realtime = ReturnType<typeof createRealtime>;

/**
 * The app's one Centrifugo connection, built per router in `createAppRouter`. `centrifuge` is
 * imported on the first subscribe, so it stays out of the entry chunk; the last unsubscribe
 * disconnects. `getData` runs before every connect attempt, so a reconnect sends a fresh token.
 */
export function createRealtime({ url, getData }: { url: string; getData: () => Promise<unknown> }) {
  let client: Promise<Centrifuge> | undefined;
  let stopped = false;
  let connection: RealtimeStatus = "disconnected";
  const statusListeners = new Set<() => void>();
  const channels = new Map<string, Channel>();

  function notify() {
    for (const listener of statusListeners) listener();
  }

  function connect() {
    client ??= import("centrifuge").then(
      ({ Centrifuge }) => {
        const centrifuge = new Centrifuge(url, { getData });
        centrifuge.on("state", ({ newState }) => {
          connection = newState;
          notify();
        });
        centrifuge.on("disconnected", ({ code }) => {
          if (isTerminal(code)) stopped = true;
        });
        return centrifuge;
      },
      (error: unknown) => {
        client = undefined;
        throw error;
      },
    );
    return client;
  }

  async function open(name: string, channel: Channel) {
    const centrifuge = await connect();
    if (channels.get(name) !== channel) return;
    const subscription = centrifuge.newSubscription(name);
    channel.close = () => {
      centrifuge.removeSubscription(subscription);
      // A route change leaves one channel and follows the next in one commit: keep the socket.
      queueMicrotask(() => {
        if (channels.size === 0) centrifuge.disconnect();
      });
    };
    subscription.on("state", ({ newState }) => {
      channel.state = newState;
      notify();
    });
    subscription.on("unsubscribed", ({ code, reason }) => {
      // Only the server ends a channel still followed (102 unknown channel, 103 permission denied).
      if (channels.get(name) === channel) reportError(new Error(`${name}: ${code} ${reason}`));
    });
    subscription.on("publication", ({ data }) => {
      for (const listener of channel.listeners) listener.publication(data);
    });
    subscription.on("subscribed", ({ recovered }) => {
      for (const listener of channel.listeners) listener.subscribed(recovered);
    });
    subscription.subscribe();
    if (!stopped && centrifuge.state === "disconnected") centrifuge.connect();
  }

  return {
    /** "connected" only while every followed channel is subscribed, so a refused one never looks live. */
    getStatus(): RealtimeStatus {
      if (connection !== "connected") return connection;
      const states = [...channels.values()].map((channel) => channel.state);
      if (states.includes("unsubscribed")) return "disconnected";
      return states.includes("subscribing") ? "connecting" : "connected";
    },
    subscribeStatus(listener: () => void) {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },
    /** One centrifuge `Subscription` per channel serves every listener; returns the unsubscribe. */
    subscribe(name: string, listener: ChannelListener) {
      let channel = channels.get(name);
      if (!channel) {
        const created: Channel = { listeners: new Set(), state: "subscribing" };
        channels.set(name, created);
        open(name, created).catch((error: unknown) => {
          channels.delete(name);
          reportError(error);
        });
        channel = created;
      }
      channel.listeners.add(listener);
      const joined = channel;
      return () => {
        if (!joined.listeners.delete(listener) || joined.listeners.size > 0) return;
        channels.delete(name);
        joined.close?.();
        notify();
      };
    },
  };
}
```

- Reference counting is required: `newSubscription` throws when the channel already has a
  subscription, and two components on one channel must share it.
- A channel the server refuses (102 `unknown channel`, 103 `permission denied`) or unsubscribes
  stays `unsubscribed`. The status then reads off instead of "Live", and the error goes to
  `reportError` once, since nothing else shows it. The channel is tried again when a screen
  follows it anew. A temporary subscribe error is retried by centrifuge-js and reads "Connecting".
- `removeSubscription` unsubscribes as well. The last channel closing disconnects, unless a
  channel is followed in the same commit: React runs the old screen's cleanup and the new screen's
  effect together, so `/users/1` to `/users/2` keeps one socket instead of a new handshake, token
  read and connect-proxy call per navigation.
- A failed load of the `centrifuge` chunk, a stale tab after a deploy included, rejects to
  `subscribe`, which reports it and drops the channel: the status reads off and the page keeps the
  data it has. The scaffold reloads only on a navigation that misses a route chunk; the next screen
  that follows a channel imports again.
- centrifuge 5.8 already reconnects with full-jitter backoff (`minReconnectDelay` 500,
  `maxReconnectDelay` 20000), detects a dead connection from missing server pings
  (`maxServerPingDelay` 10000), reconnects on the `online` event, and closes on a bfcache
  `pagehide`, reopening on `pageshow`. It does not react to `visibilitychange`; leave it so.

## The hooks

```ts,verify
// file: src/shared/hooks/use-channel.ts
import { createContext, use, useEffect, useEffectEvent, useSyncExternalStore } from "react";
import type { z } from "zod";
import type { Realtime } from "@/api/realtime";

/** Provided in `createAppRouter`'s `Wrap`; one connection per router, so per app and per test. */
export const RealtimeContext = createContext<Realtime | null>(null);

function useRealtime() {
  const realtime = use(RealtimeContext);
  if (realtime === null)
    throw new Error("RealtimeContext is missing: mount it in createAppRouter's Wrap");
  return realtime;
}

export function useRealtimeStatus() {
  const realtime = useRealtime();
  return useSyncExternalStore(realtime.subscribeStatus, realtime.getStatus);
}

/**
 * Follows `channel` while the component is mounted. Each publication is parsed with `schema`; one
 * that fails is dropped, since a newer server may send types this build does not know. The
 * handlers may change every render: only `channel` resubscribes.
 */
export function useChannel<T>(
  channel: string,
  schema: z.ZodType<T>,
  onMessage: (message: T) => void,
  onSubscribed?: (recovered: boolean) => void,
) {
  const realtime = useRealtime();
  const publication = useEffectEvent((data: unknown) => {
    const parsed = schema.safeParse(data);
    if (parsed.success) onMessage(parsed.data);
  });
  const subscribed = useEffectEvent((recovered: boolean) => onSubscribed?.(recovered));
  useEffect(() => realtime.subscribe(channel, { publication, subscribed }), [realtime, channel]);
}
```

StrictMode's mount, unmount, mount leaves one subscription, because the module counts listeners
per channel. Biome 2.6 does not ask for the `useEffectEvent` functions in the dependency list.

```tsx,verify
// file: src/shared/ui/live-status.tsx
import type { RealtimeStatus } from "@/api/realtime";
import { useRealtimeStatus } from "@/shared/hooks/use-channel";

const labels: Record<RealtimeStatus, string> = {
  connecting: "Connecting to live updates…",
  connected: "Live",
  disconnected: "Live updates are off; this page shows the data as last loaded.",
};

/** The connection state, announced politely; mount it on screens that follow a channel. */
export function LiveStatus() {
  return (
    <p role="status" className="text-muted text-sm">
      {labels[useRealtimeStatus()]}
    </p>
  );
}
```

In a translated app the labels are `t()` calls inside the component (`frontend-i18n`): no i18n gate
finds English in a record.

## Wiring in `createAppRouter`

The scaffold's `src/app/router.tsx` plus the realtime client beside the QueryClient and its
provider between `QueryClientProvider` and `ToastProvider`:

```tsx,verify
// file: src/app/router.tsx
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
import { apiToken } from "@/api/fetcher";
import { createRealtime } from "@/api/realtime";
import { env } from "@/app/env";
import { routeTree } from "@/routeTree.gen";
import { RealtimeContext } from "@/shared/hooks/use-channel";
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
      // One toast per reason: a repeated failure updates it, with its latest request id.
      id: reason,
      title: NOTICES[reason],
      description: error instanceof ApiError && error.requestId && `Request id: ${error.requestId}`,
      // A failure is announced at once and stays until dismissed: a 5 s polite toast is easy to miss.
      priority: "high",
      timeout: 0,
    }),
  );
  // The token goes in connect data, which a Centrifugo connect proxy checks; never in the URL.
  const realtime = createRealtime({
    url: `${env.realtimeOrigin}/connection/websocket`,
    getData: async () => ({ token: await apiToken() }),
  });
  const router = createRouter({
    routeTree,
    context: { queryClient },
    ...(history && { history }),
    parseSearch: parseSearchWith(exactJson),
    stringifySearch: stringifySearchWith(JSON.stringify, exactJson),
    defaultPreload: "intent",
    // Query owns freshness: the router always runs loaders and waits for them; they read the cache.
    defaultPreloadStaleTime: 0,
    defaultStaleReloadMode: "blocking",
    scrollRestoration: true,
    // Each route catches its own error, so the root layout and its navigation stay on screen.
    defaultErrorComponent: RouteError,
    // The provider slot: app-wide providers (i18n, a realtime client) go here, once for app and tests.
    // biome-ignore lint/correctness/noComponentHookFactories: built once per router, which keeps it.
    Wrap: ({ children }) => (
      // Base UI's inline <style> tags would break the CSP's `style-src 'self'`.
      <CSPProvider disableStyleElements>
        <QueryClientProvider client={queryClient}>
          <RealtimeContext value={realtime}>
            <ToastProvider manager={toastManager}>{children}</ToastProvider>
          </RealtimeContext>
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
```

Sign-out with keycloak-js redirects, which unloads the page and closes the socket; nothing else
ends the connection.

## A screen that follows a channel

The user page follows `users:<id>`, a channel in the server's `users` namespace. The event names
a change without carrying a versioned user, so the handler invalidates; a subscribe that was not recovered invalidates too, which also covers the
window between the loader's fetch and the first subscribe.

```ts,verify
// file: src/features/users/use-live-user.ts
import { useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { getGetUserQueryKey } from "@/api/generated/api";
import { useChannel } from "@/shared/hooks/use-channel";

const UserChanged = z.object({ type: z.literal("user.changed") });

/** Keeps the open user fresh. The event carries no versioned entity, so the user is read again. */
export function useLiveUser(userId: string) {
  const queryClient = useQueryClient();
  const refetch = () =>
    void queryClient.invalidateQueries({ queryKey: getGetUserQueryKey(userId) });
  useChannel(`users:${userId}`, UserChanged, refetch, (recovered) => {
    // Recovered publications were replayed as messages; otherwise some may be lost.
    if (!recovered) refetch();
  });
}
```

```tsx,verify
// file: src/routes/users/$userId.tsx
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ApiError } from "@/api/api-error";
import { getGetUserQueryOptions, getGetUserSuspenseQueryOptions } from "@/api/generated/api";
import { GetUserParams } from "@/api/generated/api.zod";
import { useLiveUser } from "@/features/users/use-live-user";
import { UserDetails } from "@/features/users/user-details";
import { loadQuery } from "@/shared/lib/load-query";
import { LiveStatus } from "@/shared/ui/live-status";

export const Route = createFileRoute("/users/$userId")({
  loader: async ({ context, params }) => {
    // The API rejects a malformed id with 400; to the user it is a user that does not exist.
    if (!GetUserParams.safeParse({ id: params.userId }).success) throw notFound();
    try {
      await loadQuery(context.queryClient, getGetUserQueryOptions(params.userId));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) throw notFound();
      throw error;
    }
  },
  component: UserPage,
  notFoundComponent: UserNotFound,
});

function UserPage() {
  const { userId } = Route.useParams();
  const { data: user } = useSuspenseQuery(getGetUserSuspenseQueryOptions(userId));
  useLiveUser(userId);

  return (
    <div data-testid="users-detail-page" className="flex flex-col gap-4">
      <title>{user.name}</title>
      <h1 className="font-semibold text-2xl">{user.name}</h1>
      <LiveStatus />
      <UserDetails user={user} />
    </div>
  );
}

function UserNotFound() {
  return (
    <>
      <title>User not found</title>
      <h1 className="font-semibold text-2xl">User not found</h1>
      <Link to="/users">Back to users</Link>
    </>
  );
}
```

With `keycloak-spa-auth` the file is `src/routes/_signed-in/users/$userId.tsx` with the id
`/_signed-in/users/$userId`: merge these lines into it instead of writing a second route.

A list follows one channel for the whole collection, `users:list`, and its handler invalidates
`getListUsersQueryKey()` (every page and filter of the list); the backend publishes there after
each create, update and delete. The hook is `useLiveUser` with that channel and key.

## The cache bridge for versioned entities

When the event carries the whole entity with a version that grows on every write, write it
straight into the cache:

```ts,verify
// file: src/shared/lib/apply-push.ts
import type { QueryClient, QueryKey } from "@tanstack/react-query";

/**
 * Writes a pushed entity into the cache, keeping the higher version. A first fetch in flight is
 * awaited, never cancelled: cancelling a query without data rejects every caller awaiting it, a
 * route loader included. A fetch of an entity that has data is cancelled before the write, or its
 * older snapshot would land after the push.
 */
export async function applyPush<T extends { version: number }>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  next: T,
) {
  const query = queryClient.getQueryCache().find<T>({ queryKey, exact: true });
  if (query?.state.data === undefined) await query?.promise?.catch(() => undefined);
  const old = queryClient.getQueryData<T>(queryKey);
  // A duplicate or older push changes nothing, and leaves a refetch in flight alone.
  if (old && old.version >= next.version) return;
  // With data in the cache, a caller awaiting the cancelled fetch gets that data back.
  if (old) await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData<T>(queryKey, (current) =>
    current && current.version >= next.version ? current : next,
  );
}
```

A handler then switches on the event type, one branch per cache operation:

```ts
useChannel("orders", OrderEvent, (event) => {
  if (event.type === "order.updated")
    void applyPush(queryClient, getGetOrderQueryKey(event.order.id), event.order);
  if (event.type === "order.deleted")
    queryClient.removeQueries({ queryKey: getGetOrderQueryKey(event.id), exact: true });
  if (event.type === "order.deleted" || event.type === "orders.changed")
    void queryClient.invalidateQueries({ queryKey: getListOrdersQueryKey() });
});
```

- `applyPush` and `invalidateQueries` resolve even when a fetch fails, so `void` is safe on both.
- No loader meets `CancelledError` from a push. A list or layout that follows the channel stays
  mounted while the next route's loader awaits the same key through `loadQuery`: during a first
  fetch `applyPush` waits for it and then compares versions, and a cancelled fetch of an entity
  that has data resolves its callers with that data. An `invalidateQueries` during a first fetch
  would not help: the fetch's success clears the mark, and its older snapshot stays.
- A list cache holds entities without per-item versions: invalidate it instead of editing it.
- Optimistic updates (`tanstack-query-api`) carry the pre-write version, so a push of the saved
  entity replaces the optimistic value. A failed mutation's `onError` may then restore the older
  snapshot over the push; the recipe's `onSettled` invalidation repairs it, so keep it.

## Signals no endpoint returns

Presence, cursors and "is typing" arrive many times a second and no request returns them, so a
refetch cannot restore them and an invalidation has nothing to fetch. They stay out of the Query
cache: they live in a small store beside the hook that follows the channel, read with
`useSyncExternalStore`, and they expire on their own. A store that several routes read is the store
rung of `frontend-project-structure`'s state ladder. Anything a request can also return goes
through the cache bridge above.

```ts,verify
// file: src/features/chat/use-typing.ts
import { useEffect, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { useChannel } from "@/shared/hooks/use-channel";

const Typing = z.object({ type: z.literal("typing"), user: z.string() });

/** Who is typing; each signal lasts `ttlMs` unless repeated. Pushed only, never fetched or cached. */
export function createTypingStore(ttlMs: number) {
  let users: readonly string[] = [];
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const listeners = new Set<() => void>();
  const publish = (next: readonly string[]) => {
    users = next;
    for (const listener of listeners) listener();
  };
  return {
    getSnapshot: () => users,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    typing(user: string) {
      clearTimeout(timers.get(user));
      const expire = () => {
        timers.delete(user);
        publish(users.filter((other) => other !== user));
      };
      timers.set(user, setTimeout(expire, ttlMs));
      if (!users.includes(user)) publish([...users, user]);
    },
    /** A (re)subscribe or unmount: signals from before it are stale. */
    clear() {
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
      if (users.length > 0) publish([]);
    },
  };
}

/** The users typing in `roomId` right now. */
export function useTyping(roomId: string, ttlMs = 5_000) {
  const [store] = useState(() => createTypingStore(ttlMs));
  useEffect(() => store.clear, [store]);
  useChannel(`rooms:${roomId}`, Typing, ({ user }) => store.typing(user), store.clear);
  return useSyncExternalStore(store.subscribe, store.getSnapshot);
}
```

```ts,verify,test
// file: src/features/chat/use-typing.test.ts
import { expect, test, vi } from "vitest";
import { createTypingStore } from "./use-typing";

test("a typing signal lasts until its time runs out, and a repeat extends it", () => {
  vi.useFakeTimers();
  const store = createTypingStore(5_000);

  store.typing("ada");
  vi.advanceTimersByTime(4_000);
  store.typing("ada");
  vi.advanceTimersByTime(4_000);
  expect(store.getSnapshot()).toEqual(["ada"]);

  vi.advanceTimersByTime(1_000);
  expect(store.getSnapshot()).toEqual([]);
});

test("a resubscribe clears the signals from before it", () => {
  const store = createTypingStore(5_000);
  store.typing("ada");

  store.clear();

  expect(store.getSnapshot()).toEqual([]);
});
```

## Authentication

`getData` is called before every connect attempt, reconnects included, so the connect proxy sees
the session's current token: `apiToken()` returns what `configureApi`'s `getToken` gives, the
same function `apiFetch` uses (`keycloak-spa-auth` owns it). Checked against a running Centrifugo
6.10 with a connect proxy: after a server-forced disconnect the proxy saw the refreshed token, and
a proxy `disconnect` answer with code 4501 ended the connection with no retry.

| Backend auth mode | Client option | When the client calls it |
| --- | --- | --- |
| connect proxy (the default here) | `getData: async () => ({ token: await apiToken() })` | before every connect attempt |
| Centrifugo checks a JWT itself | `getToken` returning a connection JWT, or the access token from `apiToken()` when Centrifugo checks it against the identity provider's keys | only when the token is missing or expired (error 109) or after code 3014; not on every reconnect |

The proxy's answers: `{ result: { user } }` accepts, `{ disconnect: { code, reason } }` ends the
connection with that code, `{ error: { code, message, temporary: true } }` lets the client retry
with backoff. Without `temporary: true` (and with a code of 100 or more other than 109) the client
stops, as after a `disconnect` answer, until the page loads again. Codes
3500 to 3999 and 4500 to 4999 are terminal for centrifuge-js and for `createRealtime`: the status
stays `disconnected` until the page loads again.

## Recovery and the server side

With recovery on, a resubscribe after a drop replays the missed publications as `publication`
events and reports `recovered: true`; when the gap is too old for the history, `recovered` is
`false` and the handler refetches. Recovered publications arrive after the `subscribed` event.
The server keys that make it work, as run against Centrifugo 6.10.3 (configuration is the backend's):

```json
{
  "client": {
    "allowed_origins": ["https://app.example.com"],
    "proxy": { "connect": { "enabled": true, "endpoint": "http://backend/centrifugo/connect" } }
  },
  "channel": {
    "namespaces": [
      {
        "name": "users",
        "allow_subscribe_for_client": true,
        "history_size": 100,
        "history_ttl": "300s",
        "force_recovery": true
      }
    ]
  }
}
```

`allow_subscribe_for_client` lets every signed-in user subscribe to every channel of the
namespace. That is right for `users:<id>`, whose event only says "changed" and leaves the read to
the API's own permission check, and wrong for a channel that carries one user's data. Such a
channel is user-limited: `notifications:#<userId>` in a namespace with
`"allow_user_limited_channels": true` and without `allow_subscribe_for_client`, where `<userId>` is
the `user` the connect proxy returns. A rule that a name cannot express goes to a subscribe proxy
(`subscribe_proxy_enabled` on the namespace), which asks the backend. Checked against 6.10.3 with
a connect proxy returning user `42`: `notifications:#42` subscribed, `notifications:#7` was refused
with 103 `permission denied` (`createRealtime` reports it as a refused channel), and `open:#7` in a
namespace with only `allow_subscribe_for_client` subscribed.

The `:` in `users:<id>` separates the namespace. Each namespace the app subscribes to needs an
entry under `namespaces`, or the subscribe fails with 102 `unknown channel`; `without_namespace`
covers only channels with no `:`.

Version the payload by `type` names: add a new type rather than changing an existing shape, and
old clients drop what they do not know.

## Tests

The socket is network, like HTTP: every test gets a fake `centrifuge` from the setup file, and a
test drives it with `emit`. MSW's `ws.link` would have to speak Centrifugo's protocol. The setup's
`onUnhandledFrame: "error"` does not cover this: an unhandled socket only gets an `error` event,
and the `afterEach` fails on unhandled HTTP requests, never on a socket, so mock `centrifuge` here.

```ts,verify
// file: src/test/fake-centrifuge.ts
type Handler = (context: Record<string, unknown>) => void;

class Emitter {
  readonly handlers = new Map<string, Handler[]>();
  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
    return this;
  }
  /** What the server would cause: `publication`, `subscribed`, `state`, `disconnected`. */
  emit(event: string, context: Record<string, unknown> = {}) {
    for (const handler of this.handlers.get(event) ?? []) handler(context);
  }
}

class Subscription extends Emitter {
  readonly channel: string;
  constructor(channel: string) {
    super();
    this.channel = channel;
  }
  subscribe() {}
}

const clients: Centrifuge[] = [];

/** The client the app built most recently: one per router, so the current test's. */
export const lastCentrifuge = () => clients.at(-1);

/** centrifuge-js as far as `src/api/realtime.ts` uses it; `vi.mock("centrifuge")` swaps it in. */
export class Centrifuge extends Emitter {
  state = "disconnected";
  readonly subscriptions = new Map<string, Subscription>();
  constructor() {
    super();
    clients.push(this);
  }
  connect() {
    this.state = "connecting";
    this.emit("state", { newState: "connecting" });
  }
  disconnect() {
    this.state = "disconnected";
    this.emit("state", { newState: "disconnected" });
  }
  newSubscription(channel: string) {
    if (this.subscriptions.has(channel))
      throw new Error(`Subscription to ${channel} already exists`);
    const subscription = new Subscription(channel);
    this.subscriptions.set(channel, subscription);
    return subscription;
  }
  removeSubscription(subscription: Subscription) {
    this.subscriptions.delete(subscription.channel);
  }
}
```

The scaffold's `src/test/setup.ts` with one added `vi.mock` line, which applies to every test file
in both Vitest projects:

```ts,verify
// file: src/test/setup.ts
// Every test, in Node and in jsdom. The DOM-only part is setup-dom.ts.
import { faker } from "@faker-js/faker";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { server } from "./server";

// The realtime socket is network too: every test gets the fake client, driven with `emit`.
vi.mock("centrifuge", () => import("./fake-centrifuge"));

const unhandled: string[] = [];
server.events.on("request:unhandled", ({ request }) => {
  unhandled.push(`${request.method} ${request.url}`);
});

// The platform's reportError only logs. This one records the error, and the test fails unless it
// stubs reportError.
const reported: unknown[] = [];
globalThis.reportError = (error: unknown) => {
  reported.push(error);
};

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  // Same data whatever the shuffle order, so a failure reproduces.
  faker.seed(20_261_119);
});
afterEach(() => {
  // Also undoes a bare vi.setSystemTime(), which no config option resets.
  vi.useRealTimers();
  server.resetHandlers();
  // The app may turn a failed request into an error screen and the test still pass: fail it here.
  const requests = unhandled.splice(0);
  const errors = reported.splice(0);
  if (requests.length > 0)
    throw new Error(`Requests without an MSW handler: ${requests.join(", ")}`);
  if (errors.length > 0) throw new AggregateError(errors, "The app called reportError");
});
afterAll(() => server.close());
```

The bridge through the route, added to `src/routes/users/$userId.test.tsx`: the handler returns
the user as the API holds it now, the push makes the page read it again. A refused channel's test
stubs `reportError` as `frontend-testing` shows; only the module's explicit `reportError` call
reaches the stub.

```tsx,verify,test
import { act, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";
import { getGetUserMockHandler } from "@/api/generated/api.msw";
import { buildUser } from "@/test/factories/user";
import { lastCentrifuge } from "@/test/fake-centrifuge";
import { renderRoute } from "@/test/render-route";
import { server } from "@/test/server";

const id = "0193a1b2-0000-7000-8000-000000000001";

test("a user.changed push shows the user as the API now returns it", async () => {
  let user = buildUser({ id, name: "Ada Lovelace" });
  server.use(getGetUserMockHandler(() => user));
  renderRoute(`/users/${id}`);
  expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  await vi.dynamicImportSettled();
  const channel = lastCentrifuge()?.subscriptions.get(`users:${id}`);

  user = { ...user, name: "Ada King" };
  act(() => channel?.emit("publication", { data: { type: "user.changed" } }));

  expect(await screen.findByRole("heading", { name: "Ada King" })).toBeInTheDocument();
});

test("the page shows Live once the connection is up and the channel subscribed", async () => {
  server.use(getGetUserMockHandler(buildUser({ id, name: "Ada Lovelace" })));
  renderRoute(`/users/${id}`);

  expect(await screen.findByRole("status")).toHaveTextContent("Connecting to live updates…");
  await vi.dynamicImportSettled();
  act(() => lastCentrifuge()?.emit("state", { newState: "connected" }));
  expect(screen.getByRole("status")).toHaveTextContent("Connecting to live updates…");
  const channel = lastCentrifuge()?.subscriptions.get(`users:${id}`);
  act(() => channel?.emit("state", { newState: "subscribed" }));
  expect(screen.getByRole("status")).toHaveTextContent("Live");
});

test("a channel the server refuses is reported and never shown as live", async () => {
  const reportError = vi.fn();
  vi.stubGlobal("reportError", reportError);
  server.use(getGetUserMockHandler(buildUser({ id, name: "Ada Lovelace" })));
  renderRoute(`/users/${id}`);
  expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  await vi.dynamicImportSettled();
  const channel = lastCentrifuge()?.subscriptions.get(`users:${id}`);

  act(() => {
    lastCentrifuge()?.emit("state", { newState: "connected" });
    channel?.emit("state", { newState: "unsubscribed" });
    channel?.emit("unsubscribed", { code: 102, reason: "unknown channel" });
  });

  expect(screen.getByRole("status")).toHaveTextContent("Live updates are off");
  expect(reportError).toHaveBeenCalledOnce();
});
```

The deferred disconnect, beside `realtime.ts`; without the `queueMicrotask` the first assertion
gets `["disconnected", "connecting"]`:

```ts,verify,test
// file: src/api/realtime.test.ts
import { expect, test, vi } from "vitest";
import { lastCentrifuge } from "@/test/fake-centrifuge";
import { createRealtime } from "./realtime";

const listener = { publication: () => {}, subscribed: () => {} };

test("a route change from one channel to another keeps the socket; the last channel leaving closes it", async () => {
  const realtime = createRealtime({
    url: "wss://rt.test/connection/websocket",
    getData: async () => ({}),
  });
  const leaveFirst = realtime.subscribe("users:1", listener);
  await vi.dynamicImportSettled();
  const states: unknown[] = [];
  lastCentrifuge()?.on("state", ({ newState }) => states.push(newState));

  // React runs the old effect's cleanup and the new effect in one commit.
  leaveFirst();
  const leaveSecond = realtime.subscribe("users:2", listener);
  await vi.dynamicImportSettled();
  expect(states).toEqual([]);

  leaveSecond();
  await vi.dynamicImportSettled();
  expect(states).toEqual(["disconnected"]);
});
```

The version guard and the in-flight races are logic with branches, tested beside `apply-push.ts`.
The old order, `cancelQueries` before anything else, fails the first and the third test (the loader
rejects with `CancelledError`; the refetch's newer order is lost), and leaving out the cancel fails
the second:

```ts,verify,test
// file: src/shared/lib/apply-push.test.ts
import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";
import { applyPush } from "./apply-push";
import { loadQuery } from "./load-query";

interface Order {
  id: string;
  status: string;
  version: number;
}

const key = ["orders", "1"];
const order = (status: string, version: number): Order => ({ id: "1", status, version });

/** A fetch of the order that waits until the test answers it. */
function pendingFetch() {
  let answer = (_order: Order) => {};
  const queryFn = () => new Promise<Order>((resolve) => (answer = resolve));
  return { queryFn, answer: (value: Order) => answer(value) };
}

test("a push during a loader's first fetch neither fails the loader nor loses to its snapshot", async () => {
  const queryClient = new QueryClient();
  const fetch = pendingFetch();
  const loading = loadQuery(queryClient, { queryKey: key, queryFn: fetch.queryFn });

  const pushed = applyPush(queryClient, key, order("paid", 2));
  fetch.answer(order("new", 1));

  await expect(loading).resolves.toEqual(order("new", 1));
  await pushed;
  expect(queryClient.getQueryData(key)).toEqual(order("paid", 2));
});

test("a newer push beats the older snapshot of a refetch, and the loader awaiting it resolves", async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(key, order("new", 1));
  await queryClient.invalidateQueries({ queryKey: key });
  const fetch = pendingFetch();
  const loading = loadQuery(queryClient, { queryKey: key, queryFn: fetch.queryFn });

  await applyPush(queryClient, key, order("paid", 2));
  fetch.answer(order("new", 1));

  await expect(loading).resolves.toMatchObject({ id: "1" });
  expect(queryClient.getQueryData(key)).toEqual(order("paid", 2));
});

test("a duplicate push leaves the refetch a mutation started alone", async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(key, order("paid", 2));
  const fetch = pendingFetch();
  const refetch = queryClient.fetchQuery({ queryKey: key, queryFn: fetch.queryFn, staleTime: 0 });

  await applyPush(queryClient, key, order("paid", 2));
  fetch.answer(order("shipped", 3));
  await refetch;

  expect(queryClient.getQueryData(key)).toEqual(order("shipped", 3));
});

test("an out-of-order push leaves the newer entity", async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(key, order("shipped", 3));

  await applyPush(queryClient, key, order("paid", 2));

  expect(queryClient.getQueryData(key)).toEqual(order("shipped", 3));
});
```

## End-to-end

The scaffold's guard fixture fails a spec on any console error, and a page that follows a channel
with nothing to connect to logs "WebSocket connection to ... failed". So every spec gets a socket
mock, and a spec that needs a push writes `test.use({ mockRealtime: false })` and talks to a real
Centrifugo: the server at `E2E_REALTIME_ORIGIN` when it is set (the CI service), otherwise a
container the first such spec starts on this machine. A run whose specs all mock the socket never
starts Docker. Nothing keys on `CI`, so `CI=1 pnpm test:e2e` on a workstation still starts the
container. Run with Centrifugo 6.10.3 in both projects (`chromium` and the phone WebKit project):
the smoke specs pass with the mock and start no container; the spec below starts it, passes, and
fails when nothing publishes.

The add-on's end-to-end support is one file, `e2e/realtime.ts`: the `mockRealtime` option, the
start on first use, the build's `PUBLIC_REALTIME_ORIGIN`, and the teardown that removes the
container. The container runs with `client.insecure`: the stand-in API would accept every
connection anyway, so the server calls no connect proxy and the stub needs no new route; the spec
publishes through Centrifugo's HTTP API itself. Never set `insecure` outside a test server.

```ts,verify
// file: e2e/realtime.ts
import { execFileSync } from "node:child_process";
import { test as base } from "@playwright/test";

/** Centrifugo for specs that need a push: E2E_REALTIME_ORIGIN (a CI service), else a local container. */
export const REALTIME_ORIGIN = process.env.E2E_REALTIME_ORIGIN ?? "http://127.0.0.1:8100";
/** The HTTP API key a spec publishes with; a CI service gets the same. */
export const REALTIME_API_KEY = "e2e-api-key";
/** The origin as the browser dials it, for the app's build. */
export const realtimeBuildEnv = { PUBLIC_REALTIME_ORIGIN: REALTIME_ORIGIN.replace(/^http/, "ws") };

const CONTAINER = "app-e2e-centrifugo";

const isUp = () =>
  fetch(`${REALTIME_ORIGIN}/health`).then(
    (response) => response.ok,
    () => false,
  );

async function startCentrifugo(appOrigin: string) {
  if (process.env.E2E_REALTIME_ORIGIN || (await isUp())) return;
  const settings = {
    CENTRIFUGO_HTTP_API_KEY: REALTIME_API_KEY,
    CENTRIFUGO_HEALTH_ENABLED: "true",
    // No connect proxy: the stand-in API accepts every page anyway. Never outside a test server.
    CENTRIFUGO_CLIENT_INSECURE: "true",
    CENTRIFUGO_CLIENT_ALLOWED_ORIGINS: appOrigin,
    CENTRIFUGO_CHANNEL_NAMESPACES: JSON.stringify([{ name: "users" }]),
  };
  const port = new URL(REALTIME_ORIGIN).port;
  const env = Object.entries(settings).flatMap(([name, value]) => ["-e", `${name}=${value}`]);
  // Published on 127.0.0.1 only: the API key is in this file.
  const publish = `127.0.0.1:${port}:8000`;
  try {
    const image = "centrifugo/centrifugo:v6.10.3";
    const run = ["run", "-d", "--rm", "--name", CONTAINER, "-p", publish, ...env, image];
    execFileSync("docker", run, { stdio: "pipe" });
  } catch (error) {
    // Another worker started it first.
    if (!String((error as { stderr?: unknown }).stderr).includes("is already in use")) throw error;
  }
  for (const deadline = Date.now() + 30_000; Date.now() < deadline; ) {
    if (await isUp()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Centrifugo did not answer at ${REALTIME_ORIGIN}/health`);
}

let started: Promise<void> | undefined;

export const test = base.extend<{ mockRealtime: boolean }>({
  // A spec that needs a push writes `test.use({ mockRealtime: false })`.
  mockRealtime: [true, { option: true }],
  context: [
    async ({ context, mockRealtime, baseURL }, use) => {
      // The socket opens and never answers, so a page that follows a channel stays "Connecting".
      if (mockRealtime) await context.routeWebSocket(/\/connection\/websocket$/, () => {});
      else {
        started ??= startCentrifugo(new URL(baseURL ?? "").origin);
        await started;
      }
      await use(context);
    },
    // Its own timeout: the first start may pull the image.
    { scope: "test", timeout: 180_000 },
  ],
});

/** Playwright's globalTeardown: removes the local container, if a spec started one. */
// biome-ignore lint/style/noDefaultExport: Playwright runs the default export of a globalTeardown file.
export default function removeCentrifugo() {
  if (process.env.E2E_REALTIME_ORIGIN) return;
  try {
    execFileSync("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
  } catch {
    // No container, or no Docker: nothing to remove.
  }
}
```

`e2e/fixtures.ts` merges it with the template's fixtures, and `playwright.config.ts` lists the
teardown and the build's origin. Both blocks are the template's files with only those lines added;
with another add-on, `frontend-testing`'s Playwright reference shows the merged form.

```ts,verify
// file: e2e/fixtures.ts
import { test as base, expect, mergeTests, type Page } from "@playwright/test";
import { test as realtime } from "./realtime.ts";

/** Where the stub API listens; a real backend's origin works the same way. */
export const API_ORIGIN = "http://127.0.0.1:4010";

interface Options {
  /** Errors a spec provokes on purpose (the route error screen reports one); others still fail it. */
  expectedErrors: RegExp[];
}

/**
 * Every test fails on a console error, an uncaught page error or a CSP / Trusted Types violation.
 * "Failed to load resource" is the browser logging an HTTP error status a test asked for.
 */
const app = base.extend<Options & { guard: undefined }>({
  expectedErrors: [[], { option: true }],
  guard: [
    async ({ page, expectedErrors }, use) => {
      const problems: string[] = [];
      const record = (text: string) => {
        if (!expectedErrors.some((expected) => expected.test(text))) problems.push(text);
      };
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
          record(message.text());
        }
      });
      page.on("pageerror", (error) => record(error.message));
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
        });
      });
      await use(undefined);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

export const test = mergeTests(app, realtime);

/** The page never scrolls sideways (a wide table scrolls inside its own container). */
export async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

export { expect };
```

```ts,verify
// file: playwright.config.ts
import { defineConfig, devices } from "@playwright/test";
import { API_ORIGIN } from "./e2e/fixtures.ts";
import { realtimeBuildEnv } from "./e2e/realtime.ts";

const isCI = !!process.env.CI;
const APP_ORIGIN = "http://localhost:4173";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // A test that passes only on a retry fails CI; the retry still records its trace.
  failOnFlakyTests: isCI,
  reporter: isCI ? [["list"], ["junit", { outputFile: "test-results/junit.xml" }]] : "list",
  use: { baseURL: APP_ORIGIN, trace: "on-first-retry" },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    // Safari's engine on a phone-sized touch screen: the narrow layout and WebKit-only bugs.
    { name: "phone", use: devices["iPhone 17e"] },
  ],
  // Removes the Centrifugo container a spec started on this machine.
  globalTeardown: "./e2e/realtime.ts",
  webServer: [
    {
      command: "node e2e/stub-api.ts",
      url: `${API_ORIGIN}/health/live`,
      env: { PORT: new URL(API_ORIGIN).port },
      reuseExistingServer: !isCI,
    },
    {
      // The production build with the generated security headers, as users get it.
      command: "pnpm build && pnpm preview",
      url: APP_ORIGIN,
      env: { PUBLIC_API_ORIGIN: API_ORIGIN, ...realtimeBuildEnv },
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
```

- The container publishes its port on `127.0.0.1` only, since its API key is known. It is `--rm`,
  so the teardown leaves nothing behind; a container left by a killed run answers `/health` and is
  reused.
- The local port is 8100, so a development Centrifugo on 8001 is never mistaken for it. Another
  port changes only `REALTIME_ORIGIN`; another preview port also changes `preview.port` in
  `vite.config.ts` and the CI service's `CENTRIFUGO_CLIENT_ALLOWED_ORIGINS`.

The spec. A publication tells the page that the user changed, and the page reads the user again;
`page.route` answers that read with the name another client saved:

```ts,verify
// file: e2e/realtime.spec.ts
import { API_ORIGIN, expect, test } from "./fixtures.ts";
import { REALTIME_API_KEY, REALTIME_ORIGIN } from "./realtime.ts";

test.use({ mockRealtime: false });

test("a user.changed publication shows the user as the API now returns it", async ({
  page,
  request,
}, testInfo) => {
  const created = await request.post(`${API_ORIGIN}/users`, {
    data: {
      name: "Katherine Johnson",
      email: `e2e-${testInfo.testId}-${testInfo.retry}@example.com`,
    },
  });
  const user = await created.json();
  await page.goto(`/users/${user.id}`);
  await expect(page.getByRole("status")).toHaveText("Live");

  // The stand-in API has no update: the next read returns what another client saved.
  await page.route(`${API_ORIGIN}/users/${user.id}`, async (route) => {
    const json = { ...user, name: "Katherine G. Johnson" };
    await route.fulfill({ response: await route.fetch(), json });
  });
  await request.post(`${REALTIME_ORIGIN}/api/publish`, {
    headers: { "x-api-key": REALTIME_API_KEY },
    data: { channel: `users:${user.id}`, data: { type: "user.changed" } },
  });

  await expect(page.getByRole("heading", { name: "Katherine G. Johnson" })).toBeVisible();
});
```

CI runs the end-to-end job inside the Playwright image, which has no Docker, so Centrifugo is a
service of the job, reached by its name, with its settings as environment variables; the job waits
for it (GitHub by its `--health-cmd`, GitLab by `HEALTHCHECK_TCP_PORT`). Add it to the CI file the
app has. GitHub, in the `e2e` job:

```yaml
    services:
      centrifugo:
        image: centrifugo/centrifugo@sha256:33fdbbce7d195dde316cbde17bc1d2a17b9e345de82799d1ec3c2bb8916e3803 # v6.10.3
        env:
          CENTRIFUGO_HTTP_API_KEY: e2e-api-key
          CENTRIFUGO_HEALTH_ENABLED: "true"
          CENTRIFUGO_CLIENT_INSECURE: "true"
          CENTRIFUGO_CLIENT_ALLOWED_ORIGINS: http://localhost:4173
          CENTRIFUGO_CHANNEL_NAMESPACES: '[{"name":"users"}]'
        options: --health-cmd "wget -qO- http://127.0.0.1:8000/health" --health-interval 2s --health-retries 15
    env:
      E2E_REALTIME_ORIGIN: http://centrifugo:8000
```

GitLab, in the `e2e` job:

```yaml
  services:
    - name: centrifugo/centrifugo@sha256:33fdbbce7d195dde316cbde17bc1d2a17b9e345de82799d1ec3c2bb8916e3803 # v6.10.3
      alias: centrifugo
      variables:
        CENTRIFUGO_HTTP_API_KEY: e2e-api-key
        CENTRIFUGO_HEALTH_ENABLED: "true"
        CENTRIFUGO_CLIENT_INSECURE: "true"
        CENTRIFUGO_CLIENT_ALLOWED_ORIGINS: http://localhost:4173
        CENTRIFUGO_CHANNEL_NAMESPACES: '[{"name":"users"}]'
        HEALTHCHECK_TCP_PORT: "8000"
  variables:
    E2E_REALTIME_ORIGIN: http://centrifugo:8000
```

The service runs the settings of `startCentrifugo` in `e2e/realtime.ts`; change both together. A
stream every page opens needs a stub route too, as the SSE reference says.
