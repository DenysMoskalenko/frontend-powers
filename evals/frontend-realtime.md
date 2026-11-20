# frontend-realtime

### Triggering

**Should load**

1. "stream the job log from GET /jobs/{id}/log (it's text/event-stream) into the job page, it needs our bearer token"
2. "EventSource doesn't let me set the Authorization header, how do I consume our SSE endpoint then?"
3. "hook the order page up to Centrifugo so it updates when someone else changes the order"
4. "the pushed order sometimes flips back to the old status right after the websocket event, we call setQueryData in the subscription handler"
5. "show the assistant's answer token by token as the backend streams it, with experimental_streamedQuery"
6. "after a reconnect we refetch everything and the API melts; centrifuge says recovered false sometimes, what should we do"
7. "the browser blocks wss://rt.example.com with a connect-src violation even though https://rt.example.com is in the CSP"
8. "write a test for the live user page: simulate a publication from the channel and check the page updates"
9. "we have our own game server protocol over websockets, how should the client module handle reconnects and close codes"

**Should not load**

1. "refresh the dashboard numbers every 10 seconds while the page is open" -> `tanstack-query-api`
2. "add PUBLIC_AUTH_ORIGIN for the identity provider so the build and the CSP know it" -> `frontend-deploy`
3. "the access token expires mid-session and API calls return 401, refresh it before retrying" -> `keycloak-spa-auth`
4. "write a route test for the users list that checks the pagination buttons" -> `frontend-testing`
5. "add an optimistic update when creating a user so it shows in the list before the server answers" -> `tanstack-query-api`
6. "explain the difference between WebSocket and WebTransport in browsers and which ones support it" -> `modern-web-guidance`
7. "poll the users list every 5 seconds while a bulk import is running" -> `tanstack-query-api`

### Eval 1 - a streamed job log

**Prompt**: "Our backend has `GET /jobs/{id}/log`, which answers `text/event-stream` with `event: line` per log line, then `event: done`, or `event: error` on failure. It needs the same bearer token as the rest of the API. Show the log live on the job page and stop the request when the user leaves the page."

**Fixture**: scaffold

**Must produce**:

- reads the stream with `fetch` through the fetcher's seam (an exported `apiResponse` or equivalent in `src/api/fetcher.ts`), so the base URL, token, 401 retry and `ApiError` apply
- parses with `EventSourceParserStream` from `eventsource-parser/stream` after a `TextDecoderStream`, with `maxBufferSize` set
- exposes the stream as a query with `experimental_streamedQuery` and `streamFn`, passing the query's `signal` to the request
- ends on `done`, throws on `error` and on a stream that closes without `done`, and skips unknown event names
- renders the lines as text and shows the query's error on the page
- tests it with an MSW `http.get` handler returning a `ReadableStream` with `Content-Type: text/event-stream`

**Must not produce**:

- `new EventSource(...)`
- a token in the URL query string
- a second `fetch` wrapper that reads `import.meta.env` or builds the `Authorization` header itself
- a `useState` accumulator fed from a `useEffect` with no abort on unmount
- MSW `sse()` in the test

### Eval 2 - Centrifugo on the user page

**Prompt**: "The backend now publishes `{\"type\":\"user.changed\"}` on the Centrifugo channel `users:<id>` whenever a user is edited. Make the user detail page update live, show whether live updates are working, and test it. Centrifugo authenticates through a connect proxy that checks our access token."

**Fixture**: scaffold

**Must produce**:

- one client created per router in `createAppRouter` (or the app's composition root) and provided through a Context in `Wrap`
- `centrifuge` loaded with a dynamic `import("centrifuge")` on the first subscribe
- the access token sent through `getData` (connect data), taken from the same token source as `apiFetch`
- a hook that subscribes in an effect depending on the client and the channel name only, with handlers through `useEffectEvent`, and unsubscribes on unmount through a reference-counted channel
- the event validated with a zod schema and `safeParse`
- `invalidateQueries` with the generated user query key on `user.changed` and on `subscribed` with `recovered: false`
- a status line fed by the client's `state` event through `useSyncExternalStore`
- a channel the server refuses (the subscription ends `unsubscribed`) shown as not live and passed to `reportError` once
- `protobufjs: false` under `allowBuilds` for the `ERR_PNPM_IGNORED_BUILDS` that `pnpm add centrifuge` stops on
- `PUBLIC_REALTIME_ORIGIN` as a `wss://` origin, wired through the new-origin steps
- the Playwright run kept green: the origin in the `webServer` env, and the socket mocked with `page.routeWebSocket` in the e2e fixture or a Centrifugo container beside the stub API
- a route test through `renderRoute` with `centrifuge` replaced by a fake via `vi.mock` in the setup file, emitting a publication and asserting the new name on the page

**Must not produce**:

- `new Centrifuge(...)` at module level or inside a component body or a provider's effect
- a token in the connection URL
- hand-written reconnect, ping or `visibilitychange` handling around centrifuge
- the user copied into `useState`, a Context value or a store
- `onMessage` or the handler in the effect's dependency list
- a status that reads live from the connection state alone
- `setQueryData` with a partial user built from the event

### Eval 3 - a versioned entity pushed into the cache

**Prompt**: "Orders are published on the `orders` channel as `{\"type\":\"order.updated\",\"order\":{...}}` with the full order including a `version` that increases on every write, plus `{\"type\":\"order.deleted\",\"id\":\"...\"}`. Apply them to the cached order details. We sometimes see an order jump back to an older status right after an update."

**Fixture**: scaffold

**Must produce**:

- `await queryClient.cancelQueries({ queryKey, exact: true })` before writing the pushed order
- `setQueryData` with an updater that keeps the cached order when its `version` is greater than or equal to the pushed one
- explains the jump back as an in-flight fetch landing its older snapshot after the push
- `removeQueries` for the deleted order's detail key and invalidation of the order lists
- a discriminated-union zod schema on `type`, with unknown types dropped
- a unit test where a fetch is in flight when the push arrives and the pushed version remains

**Must not produce**:

- `setQueryData(key, event.order)` with no cancel and no version check
- `invalidateQueries` presented as the fix for the in-flight race
- splicing the pushed order into a cached list page
- a separate store or Context holding pushed orders

### Probe 1 - EventSource with a token

**Prompt**: "Consume our authenticated SSE endpoint `/notifications/stream` in the notifications panel; the API expects the usual bearer token."

**Fixture**: scaffold

**Wrong answer**: `=\s*new\s+EventSource\(`

**Right answer**: `eventsource-parser`

### Probe 2 - token in the socket URL

**Prompt**: "Connect to our Centrifugo at wss://rt.example.com and authenticate with the user's access token."

**Fixture**: scaffold

**Wrong answer**: `(wss?|https?):\/\/[^"'\x60\s]*[?&](access_)?token=`

**Right answer**: `\bget(?:Data|Token)\s*:\s*async\b`

### Probe 3 - push without cancel

**Prompt**: "When an `invoice.updated` event with the full invoice arrives on the channel, put it into the invoice detail query cache. The backend increments `invoice.version` on every write."

**Fixture**: scaffold

**Wrong answer**: `^(?![\s\S]*cancelQueries)[\s\S]*setQueryData\(`

**Right answer**: `cancelQueries`

### Probe 4 - client in a component

**Prompt**: "Add a component that shows a live counter from the Centrifugo channel `stats`."

**Fixture**: scaffold

**Wrong answer**: `useEffect\(\s*\(\)\s*=>\s*\{[^}]*new Centrifuge\(|(?:^|\n)(?:export\s+)?(?:const|let)\s+\w+\s*=\s*new Centrifuge\(|use(?:Memo|State|Ref)\(\s*\(\)\s*=>\s*new Centrifuge\(`

### Probe 5 - handler in effect deps

**Prompt**: "Write a `useChannel(channel, onMessage)` hook for our Centrifugo client."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:,\s*onMessage\s*\])|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:useCallback\()`

**Right answer**: `useEffectEvent`

### Probe 6 - cast instead of validate

**Prompt**: "Handle the JSON messages coming from our game server's websocket in the lobby screen."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:JSON\.parse\([^;\n]*\)\s+as\s+[A-Z])|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?::\s*[A-Z]\w*(?:<[^>]*>)?\s*=\s*JSON\.parse\()`

**Right answer**: `safeParse`

### Probe 7 - refetch on every reconnect

**Prompt**: "After the Centrifugo connection drops and comes back, make sure the orders page is not showing stale data."

**Fixture**: scaffold

**Wrong answer**: `on\(\s*["']connected["'][\s\S]{0,200}invalidateQueries`

**Right answer**: `recovered`

### Probe 8 - MSW sse for a POST stream

**Prompt**: "Write a Vitest test for `streamAnswer`, which POSTs a question to `/assistant/answers` and reads the `text/event-stream` answer."

**Fixture**: scaffold

**Wrong answer**: `\bsse\(\s*["'\x60]`

**Right answer**: `ReadableStream`

### Probe 9 - channel namespace missing on the server

**Prompt**: "The user page subscribes to the Centrifugo 6 channel `users:<id>`. Write the server's channel configuration so browsers may subscribe to it, with history and recovery."

**Fixture**: scaffold

**Wrong answer**: `^(?![\s\S]*"namespaces")[\s\S]*"without_namespace"\s*:\s*\{`

**Right answer**: `"namespaces"\s*:\s*\[`
