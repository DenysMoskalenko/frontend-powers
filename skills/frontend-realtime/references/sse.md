# Server-sent events over fetch

Contents

- [The seam in `src/api/fetcher.ts`](#the-seam-in-srcapifetcherts)
- [The stream module](#the-stream-module)
- [A stream on screen: `experimental_streamedQuery`](#a-stream-on-screen-experimental_streamedquery)
- [A feed on screen: `followEvents`](#a-feed-on-screen-followevents)
- [Tests](#tests)
- [End-to-end](#end-to-end)
- [Facts checked at the pinned versions](#facts-checked-at-the-pinned-versions)

## The seam in `src/api/fetcher.ts`

The base URL, the token and the timeout are private to `src/api/fetcher.ts`. A stream needs the
`Response` before its body is read, so the fetcher exports four more functions and `apiFetch`
becomes a caller of the first. Its behaviour is unchanged: the scaffold's `fetcher.test.ts` passes
against this file. The block is the complete file for the bare scaffold; in a file that already has
other changes, add the exports and move the send and 401 retry into `apiResponse` without replacing
the rest.

| Export | For |
| --- | --- |
| `apiResponse(path, init)` | a 2xx `Response` with the body unread; base URL, bearer token, read timeout, one retry after a 401, `ApiError` on any other status |
| `apiRetryAfter(error)` | the wait in milliseconds an `ApiError`'s `Retry-After` header asked for (seconds or an HTTP date), if any |
| `apiToken()` | the session's current token, for a transport that sends it itself (Centrifugo connect data, a socket's first frame) |
| `apiRetryToken(rejected)` | a fresh token after a socket's server rejected `rejected` (close code 4401), as `apiFetch` gets one after a 401 |

The read timeout covers a stream too: a GET that gets no response headers within `timeoutMs`
rejects with a `TimeoutError`, and the timer stops once the headers arrive, so an open stream is
never cut. A browser hides `Retry-After` from a cross-origin read unless the API sends
`Access-Control-Expose-Headers: Retry-After`; without it `apiRetryAfter` returns `undefined`.

```ts,verify
// file: src/api/fetcher.ts
import { type ApiError, toApiError } from "./api-error";

interface ApiConfig {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
  /** After a 401 to `rejected`: a fresh token for one retry, or `undefined` to fail. */
  retryToken: (rejected: string | undefined) => Promise<string | undefined>;
  /** How long a GET or HEAD waits for response headers before it rejects with a `TimeoutError`. */
  timeoutMs: number;
}

const defaults: ApiConfig = {
  baseUrl: "",
  getToken: async () => undefined,
  retryToken: async () => undefined,
  timeoutMs: 30_000,
};

let config = defaults;

/** Sets what every API call needs, once at startup; a second call replaces the first, unset keys back to the defaults. */
export function configureApi(options: Partial<ApiConfig>) {
  config = { ...defaults, ...options };
}

/** The session's current token, for a transport that sends it itself (a socket's connect data). */
export function apiToken() {
  return config.getToken();
}

/** After the server rejected `rejected` (a socket closed with 4401): a fresh token, or `undefined`. */
export function apiRetryToken(rejected: string | undefined) {
  return config.retryToken(rejected);
}

// A write gets no client timeout: the server may still apply a write the client gave up on.
const isRead = (method: string | undefined) => /^(GET|HEAD)$/i.test(method ?? "GET");

async function fetchWithin(url: string, init: RequestInit, timeoutMs: number) {
  const timeout = new AbortController();
  // Cleared once headers arrive, so a slow body is never cut.
  const timer = setTimeout(
    () => timeout.abort(new DOMException("No response in time", "TimeoutError")),
    timeoutMs,
  );
  const signal = init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal;
  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    throw timeout.signal.aborted ? timeout.signal.reason : error;
  } finally {
    clearTimeout(timer);
  }
}

/** JSON parsed, `text/*` and untyped bodies as text, anything else a `Blob`; an empty body is `undefined`. */
async function readBody(response: Response): Promise<unknown> {
  const type = response.headers.get("content-type") ?? "";
  if (type && !/\bjson\b|^text\//i.test(type)) {
    const blob = await response.blob();
    return blob.size > 0 ? blob : undefined;
  }
  const text = await response.text();
  if (!text) return undefined;
  if (!/\bjson\b/i.test(type)) return text;
  try {
    return JSON.parse(text);
  } catch (error) {
    // A proxy's error page under a JSON content type is still the response's ApiError.
    if (response.ok) throw error;
    return text;
  }
}

const retryAfter = new WeakMap<ApiError, number>();

/** The wait a refused answer asked for in `Retry-After`, in milliseconds; `undefined` without one. */
export function apiRetryAfter(error: ApiError) {
  return retryAfter.get(error);
}

function parseRetryAfter(value: string | null) {
  if (!value) return undefined;
  const ms = /^\d+$/.test(value.trim()) ? Number(value) * 1000 : Date.parse(value) - Date.now();
  return Number.isNaN(ms) ? undefined : Math.max(0, ms);
}

/** A 2xx response with its body unread, for a stream; anything else throws `ApiError`. */
export async function apiResponse(path: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string | undefined) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const request = { ...init, headers };
    const url = config.baseUrl + path;
    return isRead(init.method) ? fetchWithin(url, request, config.timeoutMs) : fetch(url, request);
  };
  const token = await config.getToken();
  let response = await send(token);
  if (response.status === 401) {
    const fresh = await config.retryToken(token);
    if (fresh) response = await send(fresh);
  }
  if (response.ok) return response;
  const error = toApiError(response, await readBody(response));
  const wait = parseRetryAfter(response.headers.get("retry-after"));
  if (wait !== undefined) retryAfter.set(error, wait);
  throw error;
}

/** The orval mutator: the only place that knows the base URL, the token, the timeout and the error shape. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  return (await readBody(await apiResponse(path, init))) as T;
}

/** orval types every query and mutation error with this instead of the spec's error body. */
export type ErrorType<_Body> = ApiError | Error;
```

## The stream module

`pnpm add eventsource-parser` (bare, so the pin is exact).

`apiEvents` reads one response; `followEvents` keeps a resumable GET feed open across drops. Both
live in `src/api/`, beside the fetcher whose seam they use.

```ts,verify
// file: src/api/event-stream.ts
import {
  type EventSourceMessage,
  EventSourceParserStream,
  type StreamOptions,
} from "eventsource-parser/stream";
import { ApiError } from "./api-error";
import { apiResponse, apiRetryAfter } from "./fetcher";

/** Unbounded by default; one event larger than this errors the stream with a `ParseError`. */
const MAX_EVENT_CHARS = 1024 * 1024;

/**
 * One server-sent event stream from the API: base URL, token and 401 retry as `apiFetch`, a non-2xx
 * answer as `ApiError` before the first event. Ends when the server closes it or `init.signal` aborts.
 */
export async function* apiEvents(
  path: string,
  init: RequestInit = {},
  parser: Pick<StreamOptions, "onRetry" | "onComment"> = {},
): AsyncGenerator<EventSourceMessage> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "text/event-stream");
  const response = await apiResponse(path, { ...init, headers });
  if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
    throw new Error(`${path} did not answer with an event stream`);
  }
  // A reader loop, not `for await` over the stream: Safari before 27 cannot iterate a ReadableStream.
  const reader = response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream({ maxBufferSize: MAX_EVENT_CHARS, ...parser }))
    .getReader();
  let done = false;
  try {
    while (!done) {
      const next = await reader.read();
      done = next.done;
      if (!next.done) yield next.value;
    }
  } finally {
    // Stopping early (break, return, abort) cancels the response body.
    if (!done) await reader.cancel();
  }
}

const MIN_RETRY_DELAY = 1_000;
const MAX_RETRY_DELAY = 30_000;
/** A `Retry-After` longer than this is cut, so one wrong header cannot stop the feed for the session. */
const MAX_RETRY_AFTER = 300_000;

/**
 * Failures of the connection or of reading it may heal: a network error, a read timeout, 408, 429,
 * a 5xx. Any other 4xx, a stream of another content type or a parse error will not.
 */
const isTransient = (error: unknown) =>
  error instanceof TypeError ||
  (error instanceof DOMException && error.name === "TimeoutError") ||
  (error instanceof ApiError && (error.status >= 500 || [408, 429].includes(error.status)));

/** The wait `Retry-After` asks for before the next attempt; throws an error that will not heal. */
function waitAfter(error: unknown, silent: boolean) {
  if (!(silent || isTransient(error))) throw error;
  return error instanceof ApiError ? Math.min(MAX_RETRY_AFTER, apiRetryAfter(error) ?? 0) : 0;
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, signal.aborted ? 0 : ms);
    signal.addEventListener("abort", done);
  });
}

/** Aborts its signal once `alive` has not been called for `ms`; without `ms`, never. */
function watchdog(ms: number | undefined) {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const alive = () => {
    clearTimeout(timer);
    if (ms) timer = setTimeout(() => controller.abort(), ms);
  };
  alive();
  return { signal: controller.signal, alive, stop: () => clearTimeout(timer) };
}

/**
 * A resumable GET feed: after a dropped connection, a read timeout, 408, 429 or a 5xx it reconnects
 * with `Last-Event-ID`, after any `Retry-After` plus full-jitter backoff. `idleMs` (twice the
 * heartbeat interval the server promises) also treats a silent connection as dropped. An error
 * thrown by `onEvent` is reported and the feed goes on with the next event. Returns on an `end`
 * event or when `signal` aborts; any other error throws.
 */
export async function followEvents(
  path: string,
  onEvent: (event: EventSourceMessage) => void,
  signal: AbortSignal,
  { idleMs }: { idleMs?: number } = {},
) {
  let lastEventId: string | undefined;
  let retry = MIN_RETRY_DELAY;
  // A bug in the handler is not a dropped connection: reconnecting would replay nothing and hide it.
  const deliver = (event: EventSourceMessage) => {
    try {
      onEvent(event);
    } catch (error) {
      reportError(error);
    }
  };
  /** One connection: true once the server sent `end`. */
  const connect = async (silence: ReturnType<typeof watchdog>) => {
    const headers = lastEventId === undefined ? {} : { "Last-Event-ID": lastEventId };
    const init = { headers, signal: AbortSignal.any([signal, silence.signal]) };
    for await (const event of apiEvents(path, init, {
      // `retry: 0` from a proxy or a bug would otherwise reconnect in a loop.
      onRetry: (ms) => (retry = Math.max(MIN_RETRY_DELAY, ms)),
      onComment: silence.alive,
    })) {
      silence.alive();
      if (event.event === "end") return true;
      lastEventId = event.id ?? lastEventId;
      deliver(event);
    }
    return false;
  };
  for (let attempt = 0; !signal.aborted; attempt++) {
    const openedAt = Date.now();
    const silence = watchdog(idleMs);
    let wait = 0;
    try {
      if (await connect(silence)) return;
    } catch (error) {
      if (signal.aborted) return;
      wait = waitAfter(error, silence.signal.aborted);
    } finally {
      silence.stop();
    }
    // Only a connection that held for a minute starts the backoff again: one that drops after each
    // event would otherwise reconnect at the minimum delay forever.
    if (Date.now() - openedAt >= 60_000) attempt = 0;
    const backoff = Math.random() * Math.min(MAX_RETRY_DELAY, retry * 2 ** attempt);
    await sleep(wait + backoff, signal);
  }
}
```

- Every attempt goes through `apiResponse`, so a reconnect sends the session's current token.
- Only the connection and its reading are retried. An error thrown by `onEvent` is a bug in the
  app: it goes to `reportError` and the feed goes on with the next event. Each event stands alone
  and `Last-Event-ID` is already past it, so a reconnect would not replay it; it would only hide
  the bug behind an endless silent reconnect, and stopping would leave the screen frozen for the
  session.
- 408 and 429 come exactly when many tabs reconnect at once, so they are retried like a 5xx; a
  `Retry-After` on any of them (at most five minutes) comes before the jittered backoff, so the
  tabs do not all return at the same instant. Any other 4xx ends the feed.
- The server's `retry:` field becomes the backoff's base through `onRetry`, never below one second.
  Full jitter draws each wait between zero and the bound, so a single wait may be near zero; the
  clamp keeps the bound at one second or more, so it still doubles per attempt. Unclamped, a
  `retry: 0` from a proxy or a bug made every open tab reconnect hundreds of times a second.
- The backoff starts again only after a connection held for 60 s. Resetting it on an event made a
  server that sends one event and drops get reconnects at the minimum delay forever.
- `idleMs`, for a server that promises a heartbeat (an event or a `: keepalive` comment every
  N seconds): twice N. A connection silent that long is dropped and resumed, since a dead
  connection (a laptop waking, an expired NAT entry) otherwise hangs until the operating system's
  TCP timeout with stale data and no error. Without such a promise, leave it unset.
- `Last-Event-ID` resumes only a GET feed whose server keeps events by id and honours the header.
  A POST answer stream (a generated answer) is read once with `apiEvents` and never resumed.
- Unknown `event:` names are skipped by the consumer's `if` chain, never thrown on: a newer server
  may add kinds.

## A stream on screen: `experimental_streamedQuery`

A stream the screen shows (a job log, progress, a generated answer) is a query whose `queryFn` is
`experimental_streamedQuery`. `data` grows per chunk (an array by default, or `reducer` plus
`initialValue` for a string), `status` is `success` from the first chunk, and `fetchStatus` stays
`fetching` until the stream ends. The key is hand-written because the generated client has no
stream functions.

```ts,verify
// file: src/features/jobs/job-log-stream.ts
import { queryOptions, experimental_streamedQuery as streamedQuery } from "@tanstack/react-query";
import { apiEvents } from "@/api/event-stream";

/** Log lines as the job writes them: `data` grows per event, `fetchStatus` stays "fetching" to the end. */
export const jobLogQueryOptions = (jobId: string) =>
  queryOptions({
    // A stream is not in the generated client, so its key is written here.
    queryKey: ["jobs", jobId, "log"],
    queryFn: streamedQuery({
      // Query aborts `signal` when the last component reading the log unmounts.
      streamFn: async function* ({ signal }) {
        for await (const event of apiEvents(`/jobs/${encodeURIComponent(jobId)}/log`, { signal })) {
          if (event.event === "done") return;
          if (event.event === "error") throw new Error(`job ${jobId} log failed`);
          if (event.event === "line") yield event.data;
        }
        throw new Error(`job ${jobId} log ended before done`);
      },
    }),
    // Each fetch replays the whole log: never refetch it behind the reader's back.
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });
```

```tsx,verify
// file: src/features/jobs/job-log.tsx
import { useQuery } from "@tanstack/react-query";
import { jobLogQueryOptions } from "./job-log-stream";

export function JobLog({ jobId }: { jobId: string }) {
  const log = useQuery(jobLogQueryOptions(jobId));
  return (
    <section aria-label="Job log" aria-busy={log.fetchStatus === "fetching"}>
      <pre className="text-sm">{log.data?.join("\n")}</pre>
      {log.isError ? <p role="alert">The log stopped before the job finished.</p> : null}
    </section>
  );
}
```

- Navigating away unmounts the component; the query loses its last observer and aborts the
  `signal`, which ends the `fetch`. Pass `signal` or the request runs on after unmount.
- The stream's failure is the query's `error`, shown where the stream is. A failure after the first
  chunk also raises the QueryClient's `refresh` notice, a "Could not refresh the data" toast,
  because the query already has data (`createQueryClient` is `tanstack-query-api`'s).
- `retry: false`: a retried stream replays from the start. A POST that starts work (a generated
  answer) puts a client-made request id in the key, so a remount within `gcTime` reads the cache
  instead of posting again.
- Render streamed text as text (`{text}`), never as HTML.
- A hand-written path encodes each dynamic segment with `encodeURIComponent`, as the generated
  client does, so an id like `../admin` cannot reach another endpoint with the token.

## A feed on screen: `followEvents`

A long-lived feed has no query function to await it: the feed writes into the Query cache, and the
component reads the cache through a query that never fetches. A failure that ends the feed (a 4xx,
a broken stream) is awaited by nobody, so it goes to `reportError`; drops and 5xx are retried
inside `followEvents` and show nothing.

```tsx,verify
// file: src/features/notifications/notification-feed.tsx
import { queryOptions, skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { z } from "zod";
import { followEvents } from "@/api/event-stream";

const Notification = z.object({ id: z.string(), text: z.string() });

/** Filled by the feed below, never fetched: the cache holds pushed data, not component state. */
const notificationsQuery = queryOptions<z.infer<typeof Notification>[]>({
  queryKey: ["notifications"],
  queryFn: skipToken,
});

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Follows the signed-in user's notification feed while mounted, newest first. */
export function NotificationFeed() {
  const queryClient = useQueryClient();
  useEffect(() => {
    const stop = new AbortController();
    const onEvent = ({ event, data }: { event?: string | undefined; data: string }) => {
      const parsed = Notification.safeParse(parseJson(data));
      if (event !== "notification" || !parsed.success) return;
      queryClient.setQueryData(notificationsQuery.queryKey, (old = []) =>
        [parsed.data, ...old].slice(0, 20),
      );
    };
    // The API promises a `: keepalive` comment every 30 s. A drop or a 5xx is retried inside
    // followEvents; what ends it (a 4xx, a broken stream) is awaited by nobody, so it is reported.
    followEvents("/notifications", onEvent, stop.signal, { idleMs: 60_000 }).catch(reportError);
    return () => stop.abort();
  }, [queryClient]);
  const { data: notifications = [] } = useQuery(notificationsQuery);

  return (
    <section aria-label="Latest notifications">
      <ul>
        {notifications.map((notification) => (
          <li key={notification.id}>{notification.text}</li>
        ))}
      </ul>
    </section>
  );
}
```

The root layout is the root route's `shellComponent`, rendered on a first load before the root is
ready, so nothing in it may suspend: the feed reads with `useQuery`, never `useSuspenseQuery`, and
takes the QueryClient from `useQueryClient`, never from the route context. There its request runs in
every route test: answer it once in the test setup, as `frontend-testing`'s rule for a request every
page makes says, and let the feed's own test declare its own.

Mounted in the root layout, the feed with `followEvents` added 5.0 KB gzip to the entry, measured
on an app that already had Centrifugo (eventsource-parser and the stream module): raise
`ENTRY_BUDGET_BYTES` by what `pnpm build` reports, naming the feed, as `frontend-tooling` says.

## Tests

Neither Node nor jsdom has `EventSource`, and MSW's `sse()` handler needs one: it throws on
creation without it, and it matches only `GET` with `Accept: text/event-stream` exactly. Mock a
stream with `http.get` or `http.post` returning a `ReadableStream` with the `text/event-stream`
content type; split chunks mid-event to prove the parser joins them.

```ts,verify,test
// file: src/api/event-stream.test.ts
import { HttpResponse, http } from "msw";
import { expect, onTestFinished, test, vi } from "vitest";
import { server } from "@/test/server";
import { ApiError } from "./api-error";
import { apiEvents, followEvents } from "./event-stream";
import { configureApi } from "./fetcher";

const origin = "https://api.test";

/** An SSE answer as a server writes it: chunks that need not end on an event boundary. */
const eventStream = (...chunks: string[]) =>
  new HttpResponse(
    new ReadableStream({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    { headers: { "Content-Type": "text/event-stream" } },
  );

test("events arrive parsed, with the bearer token, a split chunk and a multi-line data field", async () => {
  configureApi({ baseUrl: origin, getToken: async () => "token-1" });
  let authorization: string | null = null;
  server.use(
    http.post(`${origin}/jobs/7/log`, ({ request }) => {
      authorization = request.headers.get("authorization");
      return eventStream(
        "event: line\ndata: build",
        "ing\n\n",
        "event: line\ndata: a\ndata: b\n\n",
      );
    }),
  );

  const lines: string[] = [];
  for await (const event of apiEvents("/jobs/7/log", { method: "POST" })) lines.push(event.data);

  expect(lines).toEqual(["building", "a\nb"]);
  expect(authorization).toBe("Bearer token-1");
});

test("a refused stream throws ApiError before the first event", async () => {
  configureApi({ baseUrl: origin });
  server.use(
    http.get(`${origin}/jobs/7/log`, () =>
      HttpResponse.json({ error: "forbidden", request_id: "req-9" }, { status: 403 }),
    ),
  );

  const events = apiEvents("/jobs/7/log");

  await expect(events.next()).rejects.toMatchObject({ status: 403, requestId: "req-9" });
  await expect(apiEvents("/jobs/7/log").next()).rejects.toBeInstanceOf(ApiError);
});

test("a dropped feed reconnects after the backoff and resumes from Last-Event-ID", async () => {
  vi.useFakeTimers();
  configureApi({ baseUrl: origin });
  const sentIds: (string | null)[] = [];
  server.use(
    http.get(`${origin}/jobs/7/progress`, ({ request }) => {
      sentIds.push(request.headers.get("last-event-id"));
      return sentIds.length === 1
        ? eventStream("id: 1\ndata: 10\n\n", "id: 2\ndata: 20\n\n")
        : eventStream("id: 3\ndata: 30\n\n", "event: end\ndata:\n\n");
    }),
  );

  const progress: string[] = [];
  const done = followEvents(
    "/jobs/7/progress",
    (event) => progress.push(event.data),
    new AbortController().signal,
  );
  await vi.waitFor(() => expect(progress).toEqual(["10", "20"]));
  await vi.advanceTimersByTimeAsync(30_000);
  await done;

  expect(progress).toEqual(["10", "20", "30"]);
  expect(sentIds).toEqual([null, "2"]);
});

test("a server retry of 0 still backs off instead of reconnecting in a loop", async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  configureApi({ baseUrl: origin });
  let connections = 0;
  server.use(
    http.get(`${origin}/feed`, () => {
      connections++;
      // One event, then the stream ends: a proxy that cuts long responses does the same.
      return eventStream("retry: 0\nid: 1\ndata: x\n\n");
    }),
  );
  const stop = new AbortController();
  const done = followEvents("/feed", () => {}, stop.signal);

  // Waits of 500 and 1000 ms: the clamped base is one second, halved by the jitter.
  await vi.advanceTimersByTimeAsync(1_000);
  stop.abort();
  await done;

  expect(connections).toBe(2);
});

test("a stream that drops after each event backs off further each time", async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  configureApi({ baseUrl: origin });
  let connections = 0;
  server.use(
    http.get(`${origin}/feed`, () => {
      connections++;
      return eventStream("id: 1\ndata: x\n\n");
    }),
  );
  const stop = new AbortController();
  const done = followEvents("/feed", () => {}, stop.signal);

  // Delays of 500, 1000 and 2000 ms; resetting the backoff on each event would connect every 500.
  await vi.advanceTimersByTimeAsync(4_000);
  stop.abort();
  await done;

  expect(connections).toBe(4);
});

test("a stream silent for longer than the promised heartbeat reconnects from the last id", async () => {
  vi.useFakeTimers();
  vi.spyOn(Math, "random").mockReturnValue(0);
  configureApi({ baseUrl: origin });
  const sentIds: (string | null)[] = [];
  server.use(
    http.get(`${origin}/feed`, ({ request }) => {
      sentIds.push(request.headers.get("last-event-id"));
      // A dead connection: the server neither sends nor closes.
      const body = new ReadableStream({
        start: (controller) => controller.enqueue(new TextEncoder().encode("id: 7\ndata: x\n\n")),
      });
      // Chunked, as a server streams it: undici asserts on a close-delimited body after the abort.
      const headers = { "Content-Type": "text/event-stream", "Transfer-Encoding": "chunked" };
      return new HttpResponse(body, { headers });
    }),
  );
  const stop = new AbortController();
  const done = followEvents("/feed", () => {}, stop.signal, { idleMs: 30_000 });

  await vi.advanceTimersByTimeAsync(29_000);
  expect(sentIds).toEqual([null]);
  await vi.advanceTimersByTimeAsync(2_000);
  stop.abort();
  await done;

  expect(sentIds).toEqual([null, "7"]);
});

test("an error thrown by the handler is reported, and the feed goes on without reconnecting", async () => {
  const reportError = vi.fn();
  vi.stubGlobal("reportError", reportError);
  configureApi({ baseUrl: origin });
  let connections = 0;
  server.use(
    http.get(`${origin}/feed`, () => {
      connections++;
      return eventStream("id: 1\ndata: a\n\n", "id: 2\ndata: b\n\n", "event: end\ndata:\n\n");
    }),
  );
  const seen: string[] = [];
  const bug = new TypeError("Cannot read properties of undefined (reading 'text')");

  await followEvents(
    "/feed",
    (event) => {
      seen.push(event.data);
      if (event.data === "a") throw bug;
    },
    new AbortController().signal,
  );

  expect(seen).toEqual(["a", "b"]);
  expect(reportError).toHaveBeenCalledExactlyOnceWith(bug);
  expect(connections).toBe(1);
});

test.each([
  ["seconds", "5", 5_000],
  ["an HTTP date", "Mon, 23 Nov 2026 12:00:05 GMT", 5_000],
  ["a wait past the five-minute cap", "86400", 300_000],
])(
  "a 429 with Retry-After in %s waits that long before reconnecting",
  async (_form, header, ms) => {
    vi.useFakeTimers({ now: Date.UTC(2026, 10, 23, 12, 0, 0) });
    vi.spyOn(Math, "random").mockReturnValue(0);
    configureApi({ baseUrl: origin });
    let connections = 0;
    server.use(
      http.get(`${origin}/feed`, () => {
        connections++;
        if (connections > 1) return eventStream("event: end\ndata:\n\n");
        const headers = { "Retry-After": header };
        return HttpResponse.json({ error: "too many requests" }, { status: 429, headers });
      }),
    );
    const done = followEvents("/feed", () => {}, new AbortController().signal);

    await vi.advanceTimersByTimeAsync(ms - 1);
    expect(connections).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    await done;

    expect(connections).toBe(2);
  },
);

test("any other 4xx ends the feed with its ApiError", async () => {
  configureApi({ baseUrl: origin });
  server.use(
    http.get(`${origin}/feed`, () => HttpResponse.json({ error: "forbidden" }, { status: 403 })),
  );

  const feed = followEvents("/feed", () => {}, new AbortController().signal);

  await expect(feed).rejects.toMatchObject({ status: 403 });
});

test("the stream is read without async iteration, which Safari before 27 lacks", async () => {
  const proto = ReadableStream.prototype;
  const saved = [Symbol.asyncIterator, "values"].map(
    (key) => [key, Object.getOwnPropertyDescriptor(proto, key)] as const,
  );
  for (const [key] of saved) Reflect.deleteProperty(proto, key);
  onTestFinished(() => {
    for (const [key, descriptor] of saved)
      if (descriptor) Object.defineProperty(proto, key, descriptor);
  });
  configureApi({ baseUrl: origin });
  server.use(http.get(`${origin}/feed`, () => eventStream("data: a\n\n", "data: b\n\n")));

  const seen: string[] = [];
  for await (const event of apiEvents("/feed")) seen.push(event.data);

  expect(seen).toEqual(["a", "b"]);
});

test("a reader that stops early cancels the response body", async () => {
  configureApi({ baseUrl: origin });
  let cancelled = false;
  server.use(
    http.get(`${origin}/feed`, () => {
      const body = new ReadableStream({
        start: (controller) => controller.enqueue(new TextEncoder().encode("data: a\n\n")),
        cancel: () => {
          cancelled = true;
        },
      });
      const headers = { "Content-Type": "text/event-stream", "Transfer-Encoding": "chunked" };
      return new HttpResponse(body, { headers });
    }),
  );

  for await (const _event of apiEvents("/feed")) break;

  await vi.waitFor(() => expect(cancelled).toBe(true));
});
```

Without the `advanceTimersByTimeAsync` call the third test times out: the backoff sleep is a fake
timer. No user-event runs in it, so the `jest` shim from `frontend-testing` is not needed.

The streamed query and its abort, without rendering:

```ts,verify,test
// file: src/features/jobs/job-log-stream.test.ts
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
import { configureApi } from "@/api/fetcher";
import { server } from "@/test/server";
import { jobLogQueryOptions } from "./job-log-stream";

const origin = "https://api.test";
const encode = (text: string) => new TextEncoder().encode(text);

test("the log query holds every line once the stream reports done", async () => {
  configureApi({ baseUrl: origin });
  server.use(
    http.get(`${origin}/jobs/7/log`, () => {
      // Split mid-event: the parser joins the chunks.
      const chunks = [
        "event: line\ndata: one\n\nevent: li",
        "ne\ndata: two\n\nevent: done\ndata:\n\n",
      ];
      const body = new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encode(chunk));
          controller.close();
        },
      });
      return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } });
    }),
  );

  const lines = await new QueryClient().query(jobLogQueryOptions("7"));

  expect(lines).toEqual(["one", "two"]);
});

test("the last reader unsubscribing aborts the request", async () => {
  configureApi({ baseUrl: origin });
  let request: Request | undefined;
  server.use(
    http.get(`${origin}/jobs/7/log`, (info) => {
      request = info.request;
      // Never closed: the job is still running.
      const body = new ReadableStream({
        start: (c) => c.enqueue(encode("event: line\ndata: one\n\n")),
      });
      return new HttpResponse(body, { headers: { "Content-Type": "text/event-stream" } });
    }),
  );
  const observer = new QueryObserver(new QueryClient(), jobLogQueryOptions("7"));
  const unsubscribe = observer.subscribe(() => {});
  await vi.waitFor(() => expect(observer.getCurrentResult().data).toEqual(["one"]));

  unsubscribe();

  expect(request?.signal.aborted).toBe(true);
});
```

A screen that renders the stream is tested through `renderRoute` with the same handler.

## End-to-end

A stream that every page opens needs a route in `e2e/stub-api.ts` answering `text/event-stream`
(an open stream, or `event: end`): without one the stub's 404 reaches `reportError`, and the guard
fixture fails every spec.

```ts
function notifications(response: ServerResponse) {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  response.write(": open\n\n");
}
```

## Facts and the versions they were checked on

| Fact | Version |
| --- | --- |
| `EventSourceParserStream` comes from `eventsource-parser/stream`; `maxBufferSize` defaults to unbounded and, when exceeded, always errors the stream | eventsource-parser 4.1.3 |
| `onError` defaults to ignoring parse errors; `"terminate"` errors the stream | eventsource-parser 4.1.3 |
| exported as `experimental_streamedQuery`; options `streamFn`, `refetchMode` (`reset`, `append`, `replace`), `reducer` with `initialValue`; no `queryFn` or `maxChunks` option | TanStack Query 5.108.0 |
| `sse()` asserts a global `EventSource` when created and matches `GET` with `accept: text/event-stream` only | MSW 3.0.7 |
| jsdom and Node have no `EventSource`; both have `fetch`, `ReadableStream`, `TextDecoderStream` | jsdom 31.0, Node 26.13 |
