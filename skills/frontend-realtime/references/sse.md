# Server-sent events over fetch

Contents

- [The seam in `src/api/fetcher.ts`](#the-seam-in-srcapifetcherts)
- [The stream module](#the-stream-module)
- [A stream on screen: `experimental_streamedQuery`](#a-stream-on-screen-experimental_streamedquery)
- [Tests](#tests)
- [Facts checked at the pinned versions](#facts-checked-at-the-pinned-versions)

## The seam in `src/api/fetcher.ts`

The base URL and the token are private to `src/api/fetcher.ts`. A stream needs the `Response`
before its body is read, so the fetcher exports three more functions and `apiFetch` becomes a
caller of the first. Its behaviour is unchanged: the scaffold's `fetcher.test.ts` passes against
this file. The block is the complete file for the bare scaffold; in a file that already has other
changes, add the three exports and move the body parsing into `readBody` without replacing it.

| Export | For |
| --- | --- |
| `apiResponse(path, init)` | a 2xx `Response` with the body unread; base URL, bearer token, one retry after a 401, `ApiError` on any other status |
| `apiToken()` | the session's current token, for a transport that sends it itself (Centrifugo connect data, a socket's first frame) |
| `apiRetryToken(rejected)` | a fresh token after a socket's server rejected `rejected` (close code 4401), as `apiFetch` gets one after a 401 |

```ts,verify
// file: src/api/fetcher.ts
import { type ApiError, toApiError } from "./api-error";

interface ApiConfig {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
  /** After a 401 to `rejected`: a fresh token for one retry, or `undefined` to fail. */
  retryToken: (rejected: string | undefined) => Promise<string | undefined>;
}

const defaults: ApiConfig = {
  baseUrl: "",
  getToken: async () => undefined,
  retryToken: async () => undefined,
};

let config = defaults;

/** Sets what every API call needs; each call starts again from the defaults. */
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

/** A 2xx response with its body unread, for a stream; anything else throws `ApiError`. */
export async function apiResponse(path: string, init: RequestInit = {}): Promise<Response> {
  const send = (token: string | undefined) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(config.baseUrl + path, { ...init, headers });
  };
  const token = await config.getToken();
  let response = await send(token);
  if (response.status === 401) {
    const fresh = await config.retryToken(token);
    if (fresh) response = await send(fresh);
  }
  if (response.ok) return response;
  throw toApiError(response, await readBody(response));
}

async function readBody(response: Response): Promise<unknown> {
  const text = await response.text();
  let body: unknown = text;
  if (text && /\bjson\b/.test(response.headers.get("content-type") ?? "")) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      // A proxy's error page under a JSON content type is still the response's ApiError.
      if (response.ok) throw error;
    }
  }
  return body;
}

/** The orval mutator: the only place that knows the base URL, the token and the error shape. */
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
import { type EventSourceMessage, EventSourceParserStream } from "eventsource-parser/stream";
import { ApiError } from "./api-error";
import { apiResponse } from "./fetcher";

/** Unbounded by default; one event larger than this errors the stream with a `ParseError`. */
const MAX_EVENT_CHARS = 1024 * 1024;

/**
 * One server-sent event stream from the API: base URL, token and 401 retry as `apiFetch`, a non-2xx
 * answer as `ApiError` before the first event. Ends when the server closes it or `init.signal` aborts.
 */
export async function* apiEvents(
  path: string,
  init: RequestInit = {},
  onRetry?: (ms: number) => void,
): AsyncGenerator<EventSourceMessage> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "text/event-stream");
  const response = await apiResponse(path, { ...init, headers });
  if (!response.body || !response.headers.get("content-type")?.startsWith("text/event-stream")) {
    throw new Error(`${path} did not answer with an event stream`);
  }
  yield* response.body
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(new EventSourceParserStream({ maxBufferSize: MAX_EVENT_CHARS, onRetry }));
}

const MAX_RETRY_DELAY = 30_000;

/** A dropped connection or a server error may heal; a 4xx, a bad stream or a parse error will not. */
const isTransient = (error: unknown) =>
  error instanceof TypeError || (error instanceof ApiError && error.status >= 500);

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

/**
 * A resumable GET feed: after a dropped connection or a 5xx it reconnects with `Last-Event-ID` and
 * full-jitter backoff. Returns on an `end` event or when `signal` aborts; any other error throws.
 */
export async function followEvents(
  path: string,
  onEvent: (event: EventSourceMessage) => void,
  signal: AbortSignal,
) {
  let lastEventId: string | undefined;
  let retry = 1_000;
  for (let attempt = 0; !signal.aborted; attempt++) {
    try {
      const headers = lastEventId === undefined ? {} : { "Last-Event-ID": lastEventId };
      for await (const event of apiEvents(path, { headers, signal }, (ms) => (retry = ms))) {
        if (event.event === "end") return;
        attempt = 0;
        lastEventId = event.id ?? lastEventId;
        onEvent(event);
      }
    } catch (error) {
      if (!(signal.aborted || isTransient(error))) throw error;
    }
    await sleep(Math.random() * Math.min(MAX_RETRY_DELAY, retry * 2 ** attempt), signal);
  }
}
```

- Every attempt goes through `apiResponse`, so a reconnect sends the session's current token.
- The server's `retry:` field becomes the base delay through `onRetry`.
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
        for await (const event of apiEvents(`/jobs/${jobId}/log`, { signal })) {
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

## Tests

Tests run in jsdom, which has no `EventSource`, and MSW's `sse()` handler needs one: it throws on
creation without it, and it matches only `GET` with `Accept: text/event-stream` exactly. Mock a
stream with `http.get` or `http.post` returning a `ReadableStream` with the `text/event-stream`
content type; split chunks mid-event to prove the parser joins them.

```ts,verify,test
// file: src/api/event-stream.test.ts
import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
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
    http.get(`${origin}/jobs/7/log`, () =>
      HttpResponse.text(
        "event: line\ndata: one\n\nevent: line\ndata: two\n\nevent: done\ndata:\n\n",
        {
          headers: { "Content-Type": "text/event-stream" },
        },
      ),
    ),
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

## Facts checked at the pinned versions

| Fact | Version |
| --- | --- |
| `EventSourceParserStream` comes from `eventsource-parser/stream`; `maxBufferSize` defaults to unbounded and, when exceeded, always errors the stream | eventsource-parser 4.1.3 |
| `onError` defaults to ignoring parse errors; `"terminate"` errors the stream | eventsource-parser 4.1.3 |
| exported as `experimental_streamedQuery`; options `streamFn`, `refetchMode` (`reset`, `append`, `replace`), `reducer` with `initialValue`; no `queryFn` or `maxChunks` option | TanStack Query 5.107.1 |
| `sse()` asserts a global `EventSource` when created and matches `GET` with `accept: text/event-stream` only | MSW 3.0.6 |
| jsdom and Node have no `EventSource`; both have `fetch`, `ReadableStream`, `TextDecoderStream` | jsdom 30.1, Node 26.13 |
