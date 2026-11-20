---
name: frontend-realtime
description: "Use when adding live updates or streaming: SSE over fetch with eventsource-parser, EventSource cannot send an Authorization header, Last-Event-ID, experimental_streamedQuery, a Centrifugo channel with the centrifuge client, newSubscription, getData, recovered false, PUBLIC_REALTIME_ORIGIN or wss in connect-src, pushing events into the Query cache with cancelQueries and setQueryData, a raw WebSocket protocol, MSW ws.link or streamed responses in tests. Not for refetchInterval polling (tanstack-query-api), adding an origin to the CSP (frontend-deploy) or renderRoute basics (frontend-testing)."
metadata:
  version: "0.1.0"
---

# Realtime: streams and push

Assumes centrifuge 5.8, eventsource-parser 4.1, TanStack Query 5.107, zod 4.6, React 19.3, MSW 3.0.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, use its own modules, helpers and scripts, and say so when it has no equivalent instead of adding one unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If `pnpm-lock.yaml` pins another major version than the line above, follow the project and say which rules may not apply.

## Important

- Pick the transport by the table below. Never `new EventSource(...)` against the app's API (it cannot send `Authorization`, a method or a body) and never a token in a URL query string, where proxies and logs keep it.
- A stream goes through the fetcher's seam (`apiEvents` over `apiResponse`): base URL, bearer token, one retry after a 401, `ApiError` on any non-2xx. No second `fetch` wrapper and no second HTTP error class.
- One Centrifugo client per router, made by `createRealtime` in `createAppRouter` and provided through `RealtimeContext`; components follow a channel with `useChannel`, whose effect depends on the client and the channel name only. Never construct `Centrifuge` or `WebSocket` in a component, and never at module level.
- Pushed data lives in the Query cache. A whole entity with a version: `cancelQueries` and then a version-guarded `setQueryData` (`applyPush`). Anything else, and every subscribe that reports `recovered: false`: `invalidateQueries`. Never a store, Context or `useState` copy of server data.
- Every frame and event is untrusted: zod `safeParse` per message, drop what fails or has an unknown `type`, never `JSON.parse(...) as T`.

## References

- `references/sse.md` — the changed `src/api/fetcher.ts`, `apiEvents` and the resumable `followEvents`, a streamed query and its component, MSW stream tests with fake timers. Open before reading any `text/event-stream` response.
- `references/centrifugo.md` — `createRealtime`, `useChannel`, `useRealtimeStatus`, `LiveStatus`, the router wiring, a live route, `applyPush`, auth modes, recovery and server keys, the fake client and the route test. Open before adding or changing a channel.
- `references/websocket.md` — rules and close-code table for an own protocol, the first-frame handshake, `ws.link` tests. Open only when neither SSE nor Centrifugo fits.

## Choosing the transport

| Need | Use | Owner |
| --- | --- | --- |
| A value that changes every few seconds on one screen | `refetchInterval` on the query | `tanstack-query-api` |
| One response that streams: a job log, progress, a generated answer | SSE over `fetch`: `apiEvents`, shown through `experimental_streamedQuery` | this skill |
| A long-lived GET feed that must resume after a drop | `followEvents` with `Last-Event-ID` | this skill |
| Many clients receive channel events, with history and recovery | Centrifugo with `centrifuge` | this skill |
| An own bidirectional protocol | one raw `WebSocket` module | this skill |

## SSE over fetch

- `eventsource-parser/stream`'s `EventSourceParserStream` after a `TextDecoderStream`, with `maxBufferSize` set: the default is unbounded.
- `src/api/fetcher.ts` exports `apiResponse(path, init)` (a 2xx `Response`, body unread), `apiToken()` and `apiRetryToken(rejected)`; `apiFetch` reads the body of `apiResponse`.
- Pass the query's `signal` to `apiEvents`; Query aborts it when the last reader unmounts.
- Branch on `event.event`, skip unknown names, end on `done`; a stream that closes without it failed.
- The stream's failure is the query's `error`, rendered where the stream is. `reportError` takes only failures nobody awaits (a channel that could not open or was refused).
- Resume only GET feeds the server keys by event id: `followEvents` retries drops and 5xx with full jitter up to 30 s, sends `Last-Event-ID`, stops on a 4xx.

## Centrifugo

- `PUBLIC_REALTIME_ORIGIN` is the origin as dialled, `wss://rt.example.com`; the client URL is `` `${env.realtimeOrigin}/connection/websocket` ``.
- `pnpm add centrifuge` stops on `ERR_PNPM_IGNORED_BUILDS` for `protobufjs`: decline it with `protobufjs: false`, as the reference shows.
- `centrifuge` is imported on the first subscribe: a chunk of about 23 KB gzip only screens that follow a channel fetch; the entry grows about 0.7 KB.
- Auth: `getData: async () => ({ token: await apiToken() })` for the connect proxy; it runs before every connect attempt, so a reconnect carries the session's current token. `getToken` (JWT mode) runs only when the token is missing or expired, not per reconnect.
- Codes 3500 to 3999 and 4500 to 4999 are terminal: centrifuge-js does not reconnect and `createRealtime` does not call `connect()` again.
- Reconnect backoff, ping loss, `online` and the back/forward cache are built into centrifuge 5.8. Add no reconnect, heartbeat or `visibilitychange` code around it.
- A channel `users:<id>` needs a `users` entry under the server's `namespaces`, or the subscribe fails with 102 `unknown channel`.
- Show `LiveStatus` on every screen that follows a channel. It reads "Live" only while every followed channel is subscribed; a refused channel reads off and is reported once.
- Recovery is a server setting (`force_recovery`, `history_size`, `history_ttl`); recovered publications arrive as ordinary `publication` events after `subscribed`.

## Push to cache

| Event payload | Cache operation |
| --- | --- |
| whole entity with a growing `version` | `applyPush(queryClient, getXQueryKey(id), entity)`: `cancelQueries({ queryKey, exact: true })`, then `setQueryData` keeping the higher version |
| "X changed", a partial entity, or an entity without a version | `invalidateQueries({ queryKey })` |
| an entity in a list | invalidate the list key; never splice a cached page |
| deleted | `removeQueries({ queryKey, exact: true })` for the detail, invalidate the lists |
| `subscribed` with `recovered: false`, the first subscribe included (it covers the gap after the loader's fetch) | invalidate everything the channel feeds |

- A list invalidation here behaves as after a mutation: what it also refetches and what an off-screen list shows on return are `tanstack-query-api`'s invalidation rules.
- Without `cancelQueries` a fetch in flight lands its older snapshot after the push. `invalidateQueries` does not fix that: it refetches active queries only.
- A push replaces an optimistic value; keep the optimistic recipe's `onSettled` invalidation, which repairs an `onError` rollback over a newer push.

## Configuration and CSP

The steps for a new `PUBLIC_*` origin are `frontend-deploy`'s.

- `connect-src` must hold each origin with the scheme the browser dials: Chromium blocks `wss://rt.example.com` under `connect-src https://rt.example.com`. An SSE endpoint on the API origin needs nothing new.
- The bare-origin check accepts `wss://` and `ws://` values; `.env.development` holds `ws://localhost:<port>`.

## Testing

| What | How |
| --- | --- |
| A screen fed by a channel | route test; `vi.mock("centrifuge", ...)` once in `src/test/setup.ts`, `lastCentrifuge()` and `emit("publication", { data })` |
| A stream | MSW `http.get` or `http.post` returning a `ReadableStream` with `Content-Type: text/event-stream` |
| A raw socket | MSW `ws.link(url)` with a `connection` listener |
| Backoff and reconnect | `vi.useFakeTimers()` and `vi.advanceTimersByTimeAsync` |
| The version guard | unit test beside `apply-push.ts` |

- `onUnhandledFrame: "error"` covers sockets too: an unhandled one gets an `error` event, but only HTTP requests fail the setup's `afterEach`.
- `await vi.dynamicImportSettled()` before reading `lastCentrifuge()`.
- A channel failure test stubs `reportError` as `frontend-testing` shows.

## Prior-version corrections

| Older examples write | Correct now |
| --- | --- |
| `new EventSource(url + "?token=" + token)` | `apiEvents(path, { signal })` over `fetch` with `Authorization` |
| `@microsoft/fetch-event-source` `fetchEventSource(...)` | `eventsource-parser/stream` `EventSourceParserStream` |
| `socket.io-client` with its own server | Centrifugo and `centrifuge`, or one raw `WebSocket` module |
| `centrifuge.subscribe(channel, handlers)`, `on("connect")`, `on("disconnect")` | `newSubscription(channel)`, `sub.on("publication")`, `sub.subscribe()`; `connected`, `disconnected`, `state` events |
| `streamedQuery({ queryFn, maxChunks })` | `experimental_streamedQuery({ streamFn, refetchMode, reducer, initialValue })` |
| MSW `sse()` for a stream (it needs a global `EventSource`, which jsdom lacks, and matches GET only) | `http.get` or `http.post` returning a `ReadableStream` |
| a reconnect loop with `setTimeout` in a component effect | centrifuge's built-in reconnect, or `followEvents` |
| a zustand or Redux slice holding pushed entities | the Query cache through `applyPush` or `invalidateQueries` |

## Red Flags — STOP

| About to… | Do this instead |
| --- | --- |
| `fetch(env.apiOrigin + ...)` with a hand-built `Authorization` header for a stream | `apiResponse` through `apiEvents` |
| `new Centrifuge(...)` in a component, a provider effect or at module level | `createRealtime` in `createAppRouter` |
| `[channel, onMessage]` as effect dependencies, or `useCallback` around a handler | `useChannel`: `useEffectEvent`, depends on `[realtime, channel]` |
| `setQueryData` from a push with no `cancelQueries` first | `applyPush` |
| Refetch on every reconnect | invalidate only on `subscribed` with `recovered: false` |
| Wrap centrifuge in backoff, ping or `visibilitychange` code | nothing: 5.8 handles it |
| `connect-src` with only the `https://` form of the realtime host | the `wss://` origin |
