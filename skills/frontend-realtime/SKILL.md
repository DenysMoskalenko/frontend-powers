---
name: frontend-realtime
description: "Use when adding live updates or streaming: SSE over fetch with eventsource-parser, EventSource cannot send an Authorization header, Last-Event-ID, experimental_streamedQuery, a Centrifugo channel with the centrifuge client, newSubscription, getData, recovered false, PUBLIC_REALTIME_ORIGIN or wss in connect-src, pushing events into the Query cache with cancelQueries and setQueryData, a raw WebSocket protocol, MSW ws.link or streamed responses in tests. Not for refetchInterval polling (tanstack-query-api), adding an origin to the CSP (frontend-deploy) or renderRoute basics (frontend-testing)."
metadata:
  version: "0.1.0"
---

# Realtime: streams and push

Assumes centrifuge 5.8, eventsource-parser 4.1, TanStack Query 5.108, zod 4.6, React 19.3, MSW 3.0.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another version of a package than the line above, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

## Important

- Pick the transport by the table below; never `new EventSource(...)` against the app's API (it cannot send `Authorization`) and never a token in a URL, where proxies and logs keep it.
- A stream goes through the fetcher's seam (`apiEvents` over `apiResponse`): base URL, bearer token, one retry after a 401, `ApiError` on any non-2xx. No second `fetch` wrapper and no second HTTP error class.
- One Centrifugo client per router, made by `createRealtime` in `createAppRouter` and provided through `RealtimeContext`; components follow a channel with `useChannel`, whose effect depends on the client and the channel name only. Never construct `Centrifuge` or `WebSocket` in a component, and never at module level.
- Pushed data lives in the Query cache. A whole entity with a version: `cancelQueries` and then a version-guarded `setQueryData` (`applyPush`). Anything else, and every subscribe that reports `recovered: false`: `invalidateQueries`. Never a store, Context or `useState` copy of server data.

## References

- `references/sse.md` — the changed `src/api/fetcher.ts`, `apiEvents` and the resumable `followEvents`, a streamed query, a feed on screen, MSW stream tests with fake timers, the stub route a feed needs end to end. Open before reading any `text/event-stream` response.
- `references/centrifugo.md` — installing it, `createRealtime`, `useChannel`, `useRealtimeStatus`, `LiveStatus`, the router wiring, a live route, `applyPush`, auth modes, recovery, server keys and channel permissions, the fake client and the route test, the Playwright and CI setup with a Centrifugo container. Open before adding or changing a channel.
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

- `eventsource-parser/stream`'s `EventSourceParserStream` after a `TextDecoderStream`.
- The add-on adds three exports to the scaffold's `src/api/fetcher.ts` (`references/sse.md`): `apiResponse(path, init)` (a 2xx `Response`, body unread), `apiToken()` and `apiRetryToken(rejected)`; `apiFetch` then reads the body of `apiResponse`.
- A hand-written path encodes each dynamic segment: `` `/jobs/${encodeURIComponent(jobId)}/log` ``.
- Pass the query's `signal` to `apiEvents`; Query aborts it when the last reader unmounts.
- Branch on `event.event`, skip unknown names, end on `done`; a stream that closes without it failed.
- The stream's failure is the query's `error`, rendered where the stream is. `reportError` takes only failures nobody awaits (a channel that could not open or was refused).
- Resume only GET feeds the server keys by event id: `followEvents` retries drops and 5xx with full jitter, sends `Last-Event-ID`, stops on a 4xx. It reads a server `retry:` as at least one second, restarts the backoff only after a connection held 60 s, and with `idleMs` (twice a promised heartbeat) drops a silent connection.
- A feed on screen writes into the Query cache and is read through a query that never fetches; what ends it goes to `reportError`.

## Centrifugo

- `PUBLIC_REALTIME_ORIGIN` is the origin as dialled, `wss://rt.example.com`; the client URL is `` `${env.realtimeOrigin}/connection/websocket` ``.
- `centrifuge` is imported on the first subscribe, never statically; the reference has the install (`ERR_PNPM_IGNORED_BUILDS` for `protobufjs`) and the entry cost.
- Auth: `getData: async () => ({ token: await apiToken() })` for the connect proxy; it runs before every connect, so a reconnect carries the current token (`getToken`, JWT mode, runs only when the token is missing or expired).
- Reconnect backoff, ping loss, `online` and the back/forward cache are built into centrifuge 5.8. Add no reconnect, heartbeat or `visibilitychange` code around it.
- A channel that carries one user's data is user-limited (`notifications:#<userId>` with `allow_user_limited_channels`) or checked by a subscribe proxy: `allow_subscribe_for_client` opens the whole namespace to every signed-in user.
- Show `LiveStatus` on every screen that follows a channel. It reads "Live" only while every followed channel is subscribed; a refused channel reads off and is reported once.
- Recovery and namespaces are server settings; recovered publications arrive as ordinary `publication` events after `subscribed`.

## Push to cache

| Event payload | Cache operation |
| --- | --- |
| whole entity with a growing `version` | `applyPush(queryClient, getXQueryKey(id), entity)`: `cancelQueries({ queryKey, exact: true })`, then `setQueryData` keeping the higher version |
| "X changed", a partial entity, or an entity without a version | `invalidateQueries({ queryKey })` |
| an entity in a list | invalidate the list key; never splice a cached page |
| deleted | `removeQueries({ queryKey, exact: true })` for the detail, invalidate the lists |
| `subscribed` with `recovered: false`, the first subscribe included (it covers the gap after the loader's fetch) | invalidate everything the channel feeds |

- A list invalidation here follows `tanstack-query-api`'s invalidation rules, as after a mutation.
- Without `cancelQueries` a fetch in flight lands its older snapshot after the push. `invalidateQueries` does not fix that: it refetches active queries only.

## Configuration and CSP

The steps for a new `PUBLIC_*` origin are `frontend-deploy`'s.

- `connect-src` must hold each origin with the scheme the browser dials: Chromium blocks `wss://rt.example.com` under `connect-src https://rt.example.com`. An SSE endpoint on the API origin needs nothing new.

## Testing

| What | How |
| --- | --- |
| A screen fed by a channel | route test; `vi.mock("centrifuge", ...)` once in `src/test/setup.ts`, `lastCentrifuge()` and `emit("publication", { data })` |
| A stream | MSW `http.get` or `http.post` returning a `ReadableStream` with `Content-Type: text/event-stream` |
| A raw socket | MSW `ws.link(url)` with a `connection` listener |
| A Playwright spec | `e2e/fixtures.ts` gains a `mockRealtime` fixture option, on by default, that mocks the socket for every spec, in the same change as the first channel; a spec that needs a push switches it off with `test.use({ mockRealtime: false })` and runs against a Centrifugo container |

- `await vi.dynamicImportSettled()` before reading `lastCentrifuge()`.
- A channel failure test stubs `reportError` as `frontend-testing` shows.
- A feed in the root layout runs in every route test: answer it once in the setup, under `frontend-testing`'s rule for a request every page makes.

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
| `new EventSourceParserStream()` with no options | set `maxBufferSize`: the default buffers without bound |
| accumulate a stream in `useState` from an effect | `experimental_streamedQuery`, which also aborts on unmount |
| `JSON.parse(data) as T` for a frame or event | zod `safeParse`; drop what fails or has an unknown `type` |
| `[channel, onMessage]` as effect dependencies, or `useCallback` around a handler | `useChannel`: `useEffectEvent`, depends on `[realtime, channel]` |
| Refetch on every reconnect | invalidate only on `subscribed` with `recovered: false` |
| Wrap centrifuge in backoff, ping or `visibilitychange` code | nothing: 5.8 handles it |
