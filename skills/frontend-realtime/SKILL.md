---
name: frontend-realtime
description: "Use when adding live updates or streaming: SSE over fetch with eventsource-parser, EventSource cannot send an Authorization header, Last-Event-ID, experimental_streamedQuery, a Centrifugo channel with the centrifuge client, newSubscription, getData, recovered false, PUBLIC_REALTIME_ORIGIN or wss in connect-src, pushing events into the Query cache with cancelQueries and setQueryData, a raw WebSocket protocol, MSW ws.link or streamed responses in tests. Not for refetchInterval polling (tanstack-query-api), adding an origin to the CSP (frontend-deploy) or renderRoute basics (frontend-testing)."
metadata:
  version: "0.1.1"
---

# Realtime: streams and push

Assumes centrifuge 5.8, eventsource-parser 4.1, TanStack Query 5.108, zod 4.6, React 19.3, MSW 3.0.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another major of a package than the line above, or an older minor, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

## Important

- Pick the transport by the table below; never `new EventSource(...)` against the app's API (it cannot send `Authorization`) and never a token in a URL, where proxies and logs keep it.
- A stream goes through the fetcher's seam (`apiEvents` over `apiResponse`): base URL, bearer token, read timeout, one retry after a 401, `ApiError` on any non-2xx. No second `fetch` wrapper and no second HTTP error class.
- One Centrifugo client per router, made by `createRealtime` in `createAppRouter` and provided through `RealtimeContext`; components follow a channel with `useChannel`, whose effect depends on the client and the channel name only (handlers through `useEffectEvent`). Never construct `Centrifuge` or `WebSocket` in a component, and never at module level.
- Pushed data that a request can also return lives in the Query cache: a whole entity with a version through `applyPush`, anything else and every subscribe that reports `recovered: false` through `invalidateQueries`; never a store, Context or `useState` copy of it. Signals no endpoint returns (presence, cursors, typing) live in a store beside the channel hook, read with `useSyncExternalStore`, never in the Query cache.

## References

- `references/sse.md` — the changed `src/api/fetcher.ts`, `apiEvents` and the resumable `followEvents` with their retry rules, a streamed query, a feed on screen, MSW stream tests with fake timers, the stub route a feed needs end to end. Open before reading any `text/event-stream` response.
- `references/centrifugo.md` — installing it, `createRealtime`, `useChannel`, `LiveStatus`, the router wiring, a live route, `applyPush`, a store for signals no endpoint returns, auth modes, recovery, server keys and channel permissions, the fake client and route tests, `e2e/realtime.ts` and the CI service. Open before adding or changing a channel.
- `references/websocket.md` — rules and close-code table for an own protocol, the first-frame handshake with its timeout, `ws.link` tests. Open only when neither SSE nor Centrifugo fits.

## Choosing the transport

| Need | Use | Owner |
| --- | --- | --- |
| A value that changes every few seconds on one screen | `refetchInterval` on the query | `tanstack-query-api` |
| One response that streams: a job log, progress, a generated answer | SSE over `fetch`: `apiEvents`, shown through `experimental_streamedQuery` | this skill |
| A long-lived GET feed that must resume after a drop | `followEvents` with `Last-Event-ID` | this skill |
| Many clients receive channel events, with history and recovery | Centrifugo with `centrifuge` | this skill |
| An own bidirectional protocol | one raw `WebSocket` module | this skill |

## SSE over fetch

- `apiEvents(path, { signal })` adds `apiResponse`, `apiRetryAfter`, `apiToken` and `apiRetryToken` to the scaffold's `src/api/fetcher.ts` and parses with `EventSourceParserStream` (with `maxBufferSize`) after a `TextDecoderStream`, read through `getReader()`. Pass the query's `signal`; encode each dynamic path segment with `encodeURIComponent`.
- Branch on `event.event`, skip unknown names, end on `done`; a stream that closes without it failed. Its failure is the query's `error`, rendered where the stream is.
- `followEvents` resumes only a GET feed the server keys by event id. It retries a drop, a read timeout, 408, 429 and 5xx (after any `Retry-After`, then full jitter), ends on any other 4xx, and reports an error thrown by its handler without reconnecting. A feed on screen writes into the Query cache and is read through a query that never fetches; what ends it goes to `reportError`.

## Centrifugo

- `PUBLIC_REALTIME_ORIGIN` is the origin as dialled, `wss://rt.example.com`; the client URL is `` `${env.realtimeOrigin}/connection/websocket` ``.
- `centrifuge` is imported on the first subscribe, never statically; the reference has the install (`ERR_PNPM_IGNORED_BUILDS` for `protobufjs`) and the entry cost.
- Auth: `getData: async () => ({ token: await apiToken() })` for the connect proxy; it runs before every connect, so a reconnect carries the current token.
- Reconnect backoff, ping loss, `online` and the back/forward cache are built into centrifuge 5.8. Add no reconnect, heartbeat or `visibilitychange` code around it.
- A channel that carries one user's data is user-limited (`notifications:#<userId>` with `allow_user_limited_channels`) or checked by a subscribe proxy: `allow_subscribe_for_client` opens the whole namespace to every signed-in user.
- Show `LiveStatus` on every screen that follows a channel. It reads "Live" only while every followed channel is subscribed; a refused channel reads off and is reported once.

## Push to cache

| Event payload | Cache operation |
| --- | --- |
| whole entity with a growing `version` | `applyPush(queryClient, getXQueryKey(id), entity)`: waits for a first fetch, ignores an equal or lower version, else `cancelQueries` and a version-guarded `setQueryData` |
| "X changed", a partial entity, or an entity without a version | `invalidateQueries({ queryKey })` |
| an entity in a list | invalidate the list key; never splice a cached page |
| deleted | `removeQueries({ queryKey, exact: true })` for the detail, invalidate the lists |
| `subscribed` with `recovered: false`, the first subscribe included (it covers the gap after the loader's fetch) | invalidate everything the channel feeds |

- Without the cancel a fetch in flight lands its older snapshot after the push; `invalidateQueries` does not fix that. Cancelling a first fetch would reject the loader awaiting it, which is why `applyPush` waits for it instead.

## Configuration and CSP

The steps for a new `PUBLIC_*` origin are `frontend-deploy`'s. `connect-src` must hold each origin with the scheme the browser dials: Chromium blocks `wss://rt.example.com` under `connect-src https://rt.example.com`. An SSE endpoint on the API origin needs nothing new.

## Testing

| What | How |
| --- | --- |
| A screen fed by a channel | route test; `vi.mock("centrifuge", ...)` once in `src/test/setup.ts`, `await vi.dynamicImportSettled()`, then `lastCentrifuge()` and `emit("publication", { data })` |
| A stream | MSW `http.get` or `http.post` returning a `ReadableStream` with `Content-Type: text/event-stream` |
| A raw socket | MSW `ws.link(url)` with a `connection` listener |
| A Playwright spec | `e2e/realtime.ts`, merged into `e2e/fixtures.ts`, mocks the socket for every spec (`mockRealtime`, on by default) in the same change as the first channel; a spec that needs a push sets `test.use({ mockRealtime: false })`, which starts a local Centrifugo container on first use unless `E2E_REALTIME_ORIGIN` names a server |

A feed in the root layout (the root route's `shellComponent`, where nothing may suspend) runs in every route test: answer it once in the setup, under `frontend-testing`'s rule for a request every page makes.

## Prior-version corrections

| Older examples write | Correct now |
| --- | --- |
| `@microsoft/fetch-event-source` `fetchEventSource(...)` | `eventsource-parser/stream` `EventSourceParserStream` |
| `yield*` or `for await` over `response.body` | a `getReader()` loop, which Safari before 27 needs |
| `socket.io-client` with its own server | Centrifugo and `centrifuge`, or one raw `WebSocket` module |
| `centrifuge.subscribe(channel, handlers)`, `on("connect")`, `on("disconnect")` | `newSubscription(channel)`, `sub.on("publication")`, `sub.subscribe()`; `connected`, `disconnected`, `state` events |
| `streamedQuery({ queryFn, maxChunks })` | `experimental_streamedQuery({ streamFn, refetchMode, reducer, initialValue })` |
| MSW `sse()` for a stream (it needs a global `EventSource`, which jsdom lacks, and matches GET only) | `http.get` or `http.post` returning a `ReadableStream` |

## Red Flags — STOP

| About to… | Do this instead |
| --- | --- |
| `new EventSourceParserStream()` with no options | set `maxBufferSize`: the default buffers without bound |
| accumulate a stream in `useState` from an effect | `experimental_streamedQuery`, which also aborts on unmount |
| call a feed's handler inside the `try` that reconnects | report its error and go on: a bug is not a dropped connection |
| `JSON.parse(data) as T` for a frame or event | zod `safeParse`; drop what fails or has an unknown `type` |
| `cancelQueries` before reading the cached version | `applyPush`: a duplicate push would cancel a fresh refetch |
| a reconnect loop, ping or `visibilitychange` code around centrifuge | nothing: 5.8 handles it |
| refetch on every reconnect | invalidate only on `subscribed` with `recovered: false` |
