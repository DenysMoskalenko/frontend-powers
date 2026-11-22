# Centrifugo: the client, channels and the cache bridge

Contents

- [Adding it](#adding-it)
- [The connection module](#the-connection-module)
- [The hooks](#the-hooks)
- [Wiring in `createAppRouter`](#wiring-in-createapprouter)
- [A screen that follows a channel](#a-screen-that-follows-a-channel)
- [The cache bridge for versioned entities](#the-cache-bridge-for-versioned-entities)
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
   `src/test/fake-centrifuge.ts`. Add each in the same change as its first caller (`useChannel`
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
- A failed chunk load is reported and leaves that channel unsubscribed until the screen mounts
  again; a stale chunk after a deploy is already handled by the scaffold's `vite:preloadError`
  reload.
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
      title: NOTICES[reason],
      description: error instanceof ApiError && error.requestId && `Request id: ${error.requestId}`,
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
import { LiveStatus } from "@/shared/ui/live-status";

export const Route = createFileRoute("/users/$userId")({
  loader: async ({ context, params }) => {
    // The API rejects a malformed id with 400; to the user it is a user that does not exist.
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
  },
  component: UserPage,
  notFoundComponent: UserNotFound,
});

function UserPage() {
  const { userId } = Route.useParams();
  const { data: user } = useSuspenseQuery(getGetUserSuspenseQueryOptions(userId));
  useLiveUser(userId);

  return (
    <>
      <title>{user.name}</title>
      <h1 className="font-semibold text-2xl">{user.name}</h1>
      <LiveStatus />
      <UserDetails user={user} />
    </>
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
 * Writes a pushed entity into the cache. A fetch in flight is cancelled first, or its older
 * snapshot would land after the push; the version guard drops duplicates and out-of-order pushes.
 */
export async function applyPush<T extends { version: number }>(
  queryClient: QueryClient,
  queryKey: QueryKey,
  next: T,
) {
  await queryClient.cancelQueries({ queryKey, exact: true });
  queryClient.setQueryData<T>(queryKey, (old) => (old && old.version >= next.version ? old : next));
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
- `cancelQueries` makes a `queryClient.query()` awaiting the same key reject with
  `CancelledError`. Channels are subscribed by mounted components, after their loader resolved, so
  only a preload of another screen can meet it.
- A list cache holds entities without per-item versions: invalidate it instead of editing it.
- To skip entities nobody views, test `queryClient.getQueryState(queryKey)`, not `getQueryData`: an
  entry whose first fetch is in flight has a state and no data, and that is the race `applyPush`
  closes.
- Optimistic updates (`tanstack-query-api`) carry the pre-write version, so a push of the saved
  entity replaces the optimistic value. A failed mutation's `onError` may then restore the older
  snapshot over the push; the recipe's `onSettled` invalidation repairs it, so keep it.

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

The scaffold's `src/test/setup.ts` with one added `vi.mock` line, which applies to every test file:

```ts,verify
// file: src/test/setup.ts
import "@testing-library/jest-dom/vitest";
import { faker } from "@faker-js/faker";
import { configure } from "@testing-library/dom";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { server } from "./server";

// The realtime socket is network too: every test gets the fake client, driven with `emit`.
vi.mock("centrifuge", () => import("./fake-centrifuge"));

// The bound only ends a hang; a loaded CI machine must never reach it.
configure({ asyncUtilTimeout: 5_000 });
// jsdom has no layout; the router restores scroll after every navigation.
window.scrollTo = () => {};

const unhandled: string[] = [];
server.events.on("request:unhandled", ({ request }) => {
  unhandled.push(`${request.method} ${request.url}`);
});

// jsdom's reportError only logs to the virtual console. This one records the error, and the test
// fails unless it stubs reportError.
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
  // `globals: false` turns off Testing Library's automatic cleanup.
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
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

The version guard and the in-flight race are logic with branches, tested beside `apply-push.ts`:

```ts,verify,test
import { CancelledError, QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";
import { applyPush } from "@/shared/lib/apply-push";

interface Order {
  id: string;
  status: string;
  version: number;
}

const key = ["orders", "1"];

test("a push beats the older snapshot of a fetch that was in flight", async () => {
  const queryClient = new QueryClient();
  let resolveFetch = (_order: Order) => {};
  const fetching = queryClient.query({
    queryKey: key,
    queryFn: () => new Promise<Order>((resolve) => (resolveFetch = resolve)),
  });

  await applyPush(queryClient, key, { id: "1", status: "paid", version: 2 });
  resolveFetch({ id: "1", status: "new", version: 1 });
  await expect(fetching).rejects.toBeInstanceOf(CancelledError);

  expect(queryClient.getQueryData(key)).toEqual({ id: "1", status: "paid", version: 2 });
});

test("a duplicate or out-of-order push leaves the newer entity", async () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData<Order>(key, { id: "1", status: "shipped", version: 3 });

  await applyPush(queryClient, key, { id: "1", status: "paid", version: 2 });
  await applyPush(queryClient, key, { id: "1", status: "shipped", version: 3 });

  expect(queryClient.getQueryData(key)).toEqual({ id: "1", status: "shipped", version: 3 });
});
```

Without the `cancelQueries` line the first test fails: the fetch lands `new` after the push.

## End-to-end

The scaffold's guard fixture fails a spec on any console error, and a page that follows a channel
with nothing to connect to logs "WebSocket connection to ... failed". So every spec gets a socket
mock, and a spec that needs a push switches it off and talks to a real Centrifugo: a container
started by Playwright locally, a service in CI. Run with Centrifugo 6.10.3: the smoke specs pass
with the mock; the spec below passes against the server and fails when the stub does not publish;
the same run passes inside the Playwright image with Centrifugo as a service on the job's network.
The host port is 8100, so a development Centrifugo on 8001 is never mistaken for it.
`frontend-testing`'s Playwright reference shows these files merged with `keycloak-spa-auth`'s, for
an app with both add-ons.

What the add-on adds to the template's files: in `e2e/fixtures.ts`, `REALTIME_ORIGIN`, the
`mockRealtime` option and the `context` override that mocks the socket; in `playwright.config.ts`,
`centrifugoEnv`, the Centrifugo container as the first `webServer` entry unless
`E2E_REALTIME_ORIGIN` is set, the stub's `HOST` and `CENTRIFUGO_API_URL`, and
`PUBLIC_REALTIME_ORIGIN` for the build. The mock is on the context, so every tab gets it before its
first page loads:

```ts,verify
// file: e2e/fixtures.ts
import { test as base, expect } from "@playwright/test";

/** Where the stub API listens; a real backend's origin works the same way. */
export const API_ORIGIN = "http://127.0.0.1:4010";
/** Centrifugo: a container `playwright.config.ts` starts, unless E2E_REALTIME_ORIGIN names one (CI). */
export const REALTIME_ORIGIN = process.env.E2E_REALTIME_ORIGIN ?? "http://127.0.0.1:8100";

/**
 * Every test fails on a console error, an uncaught page error or a CSP / Trusted Types violation.
 * "Failed to load resource" is the browser logging an HTTP error status a test asked for.
 */
export const test = base.extend<{ guard: undefined; mockRealtime: boolean }>({
  guard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
          problems.push(message.text());
        }
      });
      page.on("pageerror", (error) => problems.push(error.message));
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
  // A spec that needs a push writes `test.use({ mockRealtime: false })` and talks to Centrifugo.
  mockRealtime: [true, { option: true }],
  // The socket opens and never answers, so a page that follows a channel stays "Connecting".
  context: async ({ context, mockRealtime }, use) => {
    if (mockRealtime) await context.routeWebSocket(/\/connection\/websocket$/, () => {});
    await use(context);
  },
});

export { expect };
```

`playwright.config.ts`: the stub listens where the container can call its connect proxy and
publishes to `CENTRIFUGO_API_URL`:

```ts,verify
// file: playwright.config.ts
import { defineConfig, devices } from "@playwright/test";
import { API_ORIGIN, REALTIME_ORIGIN } from "./e2e/fixtures.ts";

const isCI = !!process.env.CI;
const APP_ORIGIN = "http://localhost:4173";

/** Centrifugo's settings; both CI files give their service the same, with `build` as the host. */
const centrifugoEnv = {
  CENTRIFUGO_HTTP_API_KEY: "e2e-api-key",
  CENTRIFUGO_HEALTH_ENABLED: "true",
  CENTRIFUGO_CLIENT_ALLOWED_ORIGINS: APP_ORIGIN,
  CENTRIFUGO_CLIENT_PROXY_CONNECT_ENABLED: "true",
  CENTRIFUGO_CLIENT_PROXY_CONNECT_ENDPOINT: `http://host.docker.internal:${new URL(API_ORIGIN).port}/centrifugo/connect`,
  CENTRIFUGO_CHANNEL_NAMESPACES: JSON.stringify([
    { name: "users", allow_subscribe_for_client: true },
  ]),
};

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // A test that passes only on a retry fails CI; the retry still records its trace.
  failOnFlakyTests: isCI,
  reporter: isCI ? [["list"], ["junit", { outputFile: "test-results/junit.xml" }]] : "list",
  use: { baseURL: APP_ORIGIN, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: [
    // Centrifugo in Docker, on this machine only; none where E2E_REALTIME_ORIGIN names one (CI).
    ...(process.env.E2E_REALTIME_ORIGIN
      ? []
      : [
          {
            command: [
              `docker run --rm --name app-e2e-centrifugo -p 127.0.0.1:${new URL(REALTIME_ORIGIN).port}:8000`,
              "--add-host=host.docker.internal:host-gateway",
              ...Object.keys(centrifugoEnv).map((name) => `-e ${name}`),
              "centrifugo/centrifugo:v6.10.3",
            ].join(" "),
            env: centrifugoEnv,
            url: `${REALTIME_ORIGIN}/health`,
            // The default SIGKILL ends the docker CLI and leaves the container running.
            gracefulShutdown: { signal: "SIGTERM" as const, timeout: 10_000 },
            reuseExistingServer: true,
          },
        ]),
    {
      command: "node e2e/stub-api.ts",
      url: `${API_ORIGIN}/health/live`,
      env: {
        PORT: new URL(API_ORIGIN).port,
        // Reachable from the Centrifugo container, not only from this machine.
        HOST: "0.0.0.0",
        CENTRIFUGO_API_URL: REALTIME_ORIGIN,
      },
      reuseExistingServer: !isCI,
    },
    {
      // The production build with the generated security headers, as users get it.
      command: "pnpm build && pnpm preview",
      url: APP_ORIGIN,
      env: {
        PUBLIC_API_ORIGIN: API_ORIGIN,
        PUBLIC_REALTIME_ORIGIN: REALTIME_ORIGIN.replace(/^http/, "ws"),
      },
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
```

- `E2E_REALTIME_ORIGIN` set means a Centrifugo already runs there (the CI service): no container.
  The run never keys on `CI`, so `CI=1 pnpm test:e2e` on a workstation starts the container and
  the container calls the stub on this machine.
- The container publishes its port on `127.0.0.1` only: its API key is known. The stub listens on
  every interface, because the container calls it.
- Each origin and port is written once: `REALTIME_ORIGIN` and `API_ORIGIN` in `e2e/fixtures.ts`
  (the container's `-p` and the proxy endpoint follow them), the app's in `APP_ORIGIN`. Another
  preview or stub port also changes `preview.port` in `vite.config.ts` and
  `CENTRIFUGO_CLIENT_ALLOWED_ORIGINS` and the proxy endpoint in both CI files.

`e2e/stub-api.ts` gains the connect proxy, the write the spec saves through (the `PATCH` of
`frontend-forms`' edit page) with its publish call, and a configurable listen address:

```ts,verify
// file: e2e/stub-api.ts
// An in-memory stand-in for the backend's users API, with the same paths, status codes and
// `ErrorBody` shapes, so the E2E suite runs without a database. Point PUBLIC_API_ORIGIN at a real
// backend to run the same suite against it.
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

const users: User[] = [];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function send(response: ServerResponse, status: number, body?: unknown) {
  response.writeHead(status, body === undefined ? {} : { "content-type": "application/json" });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function errorBody(response: ServerResponse, error: string, details?: unknown) {
  const request_id = String(response.getHeader("x-request-id"));
  return details === undefined ? { error, request_id } : { error, request_id, details };
}

// The shape `validator` serialises a failed rule to.
const rule = (code: string, params: Record<string, unknown>) => [{ code, message: null, params }];

async function readJson(request: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) text += chunk;
  return JSON.parse(text);
}

function listUsers(response: ServerResponse, query: URLSearchParams) {
  const limit = Number(query.get("limit") ?? 20);
  const offset = Number(query.get("offset") ?? 0);
  const details = {
    ...(!(limit >= 1 && limit <= 100) && {
      limit: rule("range", { min: 1, max: 100, value: limit }),
    }),
    ...(!(offset >= 0 && offset <= 10_000) && {
      offset: rule("range", { max: 10_000, value: offset }),
    }),
  };
  if (Object.keys(details).length > 0) {
    return send(response, 422, errorBody(response, "validation failed", details));
  }
  const items = users.toReversed().slice(offset, offset + limit);
  send(response, 200, { items, total: users.length, limit, offset });
}

async function createUser(request: IncomingMessage, response: ServerResponse) {
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return send(response, 400, errorBody(response, "Failed to parse the request body as JSON"));
  }
  const { email, name }: { email?: unknown; name?: unknown } =
    typeof body === "object" && body !== null ? body : {};
  const details = {
    ...(!(typeof email === "string" && /^[^@\s]+@[^@\s]+$/.test(email)) && {
      email: rule("email", { value: email }),
    }),
    ...(!(typeof name === "string" && name.length >= 1 && name.length <= 100) && {
      name: rule("length", { min: 1, max: 100, value: name }),
    }),
  };
  if (Object.keys(details).length > 0 || typeof email !== "string" || typeof name !== "string") {
    return send(response, 422, errorBody(response, "validation failed", details));
  }
  if (users.some((user) => user.email === email)) {
    return send(response, 409, errorBody(response, "conflict"));
  }
  const user = { id: randomUUID(), email, name, created_at: new Date().toISOString() };
  users.push(user);
  send(response, 201, user);
}

/** Centrifugo's connect proxy. A real backend checks `data.token`; the stub accepts every page. */
function centrifugoConnect(response: ServerResponse) {
  send(response, 200, { result: { user: "e2e" } });
}

/** What the backend does after a write: tells the open pages through the realtime server's API. */
async function publishUserChanged(id: string) {
  const api = process.env.CENTRIFUGO_API_URL;
  if (!api) return;
  await fetch(`${api}/api/publish`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": "e2e-api-key" },
    body: JSON.stringify({ channel: `users:${id}`, data: { type: "user.changed" } }),
  });
}

async function updateUser(request: IncomingMessage, response: ServerResponse, id: string) {
  const user = users.find((candidate) => candidate.id === id);
  if (!user) return send(response, 404, errorBody(response, `user ${id} not found`));
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return send(response, 400, errorBody(response, "Failed to parse the request body as JSON"));
  }
  const { email, name }: { email?: unknown; name?: unknown } =
    typeof body === "object" && body !== null ? body : {};
  if (typeof email === "string") user.email = email;
  if (typeof name === "string") user.name = name;
  await publishUserChanged(id);
  send(response, 200, user);
}

function getUser(response: ServerResponse, id: string) {
  if (!uuid.test(id)) return send(response, 400, errorBody(response, `Invalid URL: ${id}`));
  const user = users.find((candidate) => candidate.id === id);
  if (!user) return send(response, 404, errorBody(response, `user ${id} not found`));
  send(response, 200, user);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://stub");
  response.setHeader("x-request-id", randomUUID());
  // The backend's CORS layer: the browser app runs on another origin.
  response.setHeader("access-control-allow-origin", request.headers.origin ?? "*");
  response.setHeader("vary", "origin");
  if (request.method === "OPTIONS") {
    response.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE");
    response.setHeader("access-control-allow-headers", "*");
    return send(response, 204);
  }

  const [, resource, id, ...rest] = url.pathname.split("/");
  if (request.method === "GET" && url.pathname === "/health/live") return send(response, 200);
  if (resource === "users" && id === undefined && request.method === "GET") {
    return listUsers(response, url.searchParams);
  }
  if (resource === "users" && id === undefined && request.method === "POST") {
    return createUser(request, response);
  }
  if (resource === "users" && id && rest.length === 0 && request.method === "GET") {
    return getUser(response, id);
  }
  if (resource === "users" && id && rest.length === 0 && request.method === "PATCH") {
    return updateUser(request, response, id);
  }
  if (request.method === "POST" && url.pathname === "/centrifugo/connect") {
    return centrifugoConnect(response);
  }
  send(response, 404, errorBody(response, "route not found"));
});

// HOST: a realtime server in another container calls the connect proxy here.
server.listen(Number(process.env.PORT ?? 4010), process.env.HOST ?? "127.0.0.1");
```

The spec. The edit page is `frontend-forms`'; any save the stub publishes for works the same way.

```ts,verify
// file: e2e/realtime.spec.ts
import { API_ORIGIN, expect, test } from "./fixtures.ts";

test.use({ mockRealtime: false });

test("a save in one tab reaches the user page open in another", async ({
  page,
  context,
  request,
}, testInfo) => {
  const created = await request.post(`${API_ORIGIN}/users`, {
    data: {
      name: "Katherine Johnson",
      email: `e2e-${testInfo.testId}-${testInfo.retry}@example.com`,
    },
  });
  const { id } = await created.json();
  const reader = await context.newPage();
  await reader.goto(`/users/${id}`);
  await expect(reader.getByRole("status")).toHaveText("Live");

  // The edit page is frontend-forms'; its save is a PATCH the stub publishes for.
  await page.goto(`/users/${id}/edit`);
  await page.getByRole("textbox", { name: "Name" }).fill("Katherine G. Johnson");
  await page.getByRole("button", { name: "Save" }).click();

  await expect(reader.getByRole("heading", { name: "Katherine G. Johnson" })).toBeVisible();
});
```

CI runs the e2e job inside the Playwright image, which has no Docker, so Centrifugo is a service of
the job: on one network with the job, reached by its name, its settings as environment variables
(a service cannot mount a file from the repository), and the job waits for it (GitHub by its
`--health-cmd`, GitLab by `HEALTHCHECK_TCP_PORT`). It calls the stub's connect proxy in the job
container, named `build` on that network. GitHub, in the `e2e` job (the alias goes in the
container's `options`):

```yaml
    container:
      image: mcr.microsoft.com/playwright@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579 # v1.65.1-noble
      # `build`: the name Centrifugo calls the stub's connect proxy by.
      options: --user 1001 --network-alias build
    services:
      centrifugo:
        image: centrifugo/centrifugo@sha256:33fdbbce7d195dde316cbde17bc1d2a17b9e345de82799d1ec3c2bb8916e3803 # v6.10.3
        env:
          CENTRIFUGO_HTTP_API_KEY: e2e-api-key
          CENTRIFUGO_HEALTH_ENABLED: "true"
          CENTRIFUGO_CLIENT_ALLOWED_ORIGINS: http://localhost:4173
          CENTRIFUGO_CLIENT_PROXY_CONNECT_ENABLED: "true"
          CENTRIFUGO_CLIENT_PROXY_CONNECT_ENDPOINT: http://build:4010/centrifugo/connect
          CENTRIFUGO_CHANNEL_NAMESPACES: '[{"name":"users","allow_subscribe_for_client":true}]'
        options: --health-cmd "wget -qO- http://127.0.0.1:8000/health" --health-interval 2s --health-retries 15
    env:
      E2E_REALTIME_ORIGIN: http://centrifugo:8000
```

GitLab, in the `e2e` job (`FF_NETWORK_PER_BUILD` puts the job and its services on one network,
where the job container is `build`):

```yaml
  services:
    - name: centrifugo/centrifugo@sha256:33fdbbce7d195dde316cbde17bc1d2a17b9e345de82799d1ec3c2bb8916e3803 # v6.10.3
      alias: centrifugo
      variables:
        CENTRIFUGO_HTTP_API_KEY: e2e-api-key
        CENTRIFUGO_HEALTH_ENABLED: "true"
        CENTRIFUGO_CLIENT_ALLOWED_ORIGINS: http://localhost:4173
        CENTRIFUGO_CLIENT_PROXY_CONNECT_ENABLED: "true"
        CENTRIFUGO_CLIENT_PROXY_CONNECT_ENDPOINT: http://build:4010/centrifugo/connect
        CENTRIFUGO_CHANNEL_NAMESPACES: '[{"name":"users","allow_subscribe_for_client":true}]'
        HEALTHCHECK_TCP_PORT: "8000"
  variables:
    # The job and its services on one network, each reached by its name.
    FF_NETWORK_PER_BUILD: "true"
    E2E_REALTIME_ORIGIN: http://centrifugo:8000
```

The service runs the same settings as `centrifugoEnv` in `playwright.config.ts`, with `build` for
the stub's host; change both together. A stream every page opens needs a stub route too, as the
SSE reference says.
