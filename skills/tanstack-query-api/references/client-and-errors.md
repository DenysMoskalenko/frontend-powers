# apiFetch, ApiError and the QueryClient

Contents:

- [apiFetch and configureApi](#apifetch-and-configureapi)
- [ApiError](#apierror)
- [Turning an ApiError into words](#turning-an-apierror-into-words)
- [createQueryClient](#createqueryclient)
- [Who shows which error](#who-shows-which-error)
- [Wire formats](#wire-formats)

## apiFetch and configureApi

`src/api/fetcher.ts` as the scaffold ships it, plus `xhrSend` and `apiUpload` after `apiFetch`, which
an app adds only when it shows upload progress (the files reference). `apiFetch` is orval's mutator,
so every generated function calls it, and this is the only module that knows the base URL, the
token and the error shape.

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

/** The orval mutator: the only place that knows the base URL, the token, the timeout and the error shape. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  const body = await readBody(response);
  if (response.ok) return body as T;
  throw toApiError(response, body);
}

const NULL_BODY_STATUSES = new Set([204, 205, 304]);

function xhrSend(
  url: string,
  method: string,
  body: XMLHttpRequestBodyInit,
  token: string | undefined,
  signal: AbortSignal | undefined,
  onProgress: ((loaded: number, total: number) => void) | undefined,
) {
  return new Promise<Response>((resolve, reject) => {
    // Rejects the promise: the signal may have fired while the token was awaited.
    signal?.throwIfAborted();
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    xhr.responseType = "arraybuffer";
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.upload.addEventListener("progress", (event) => onProgress?.(event.loaded, event.total));
    xhr.addEventListener("load", () => {
      const headers = new Headers();
      for (const line of xhr
        .getAllResponseHeaders()
        .trim()
        .split(/[\r\n]+/)) {
        const at = line.indexOf(":");
        if (at > 0) headers.append(line.slice(0, at).trim(), line.slice(at + 1).trim());
      }
      const blob = NULL_BODY_STATUSES.has(xhr.status) ? null : (xhr.response as ArrayBuffer);
      resolve(new Response(blob, { status: xhr.status, headers }));
    });
    // The same errors fetch gives: a TypeError for the network, the signal's reason for an abort.
    xhr.addEventListener("error", () => reject(new TypeError("Network request failed")));
    xhr.addEventListener("abort", () => reject(signal?.reason));
    signal?.addEventListener("abort", () => xhr.abort(), { once: true });
    xhr.send(body);
  });
}

/**
 * A write that reports upload progress, which `fetch` cannot. Only for that: same base URL, token,
 * 401 retry, body reading and `ApiError` as `apiFetch`, and no timeout, like every write.
 */
export async function apiUpload<T>(
  path: string,
  body: FormData | Blob,
  options: {
    method?: "POST" | "PUT";
    signal?: AbortSignal;
    onProgress?: (loaded: number, total: number) => void;
  } = {},
): Promise<T> {
  const { method = "POST", signal, onProgress } = options;
  const send = (token: string | undefined) =>
    xhrSend(config.baseUrl + path, method, body, token, signal, onProgress);
  const token = await config.getToken();
  let response = await send(token);
  if (response.status === 401) {
    const fresh = await config.retryToken(token);
    if (fresh) response = await send(fresh);
  }
  const result = await readBody(response);
  if (response.ok) return result as T;
  throw toApiError(response, result);
}

/** orval types every query and mutation error with this instead of the spec's error body. */
export type ErrorType<_Body> = ApiError | Error;
```

- `configureApi` is one call at startup; a second call replaces the first, and every key it leaves
  out goes back to its default. `main.tsx` passes `{ baseUrl: env.apiOrigin }`; with the auth add-on
  that one call carries `getToken` and `retryToken` too (`keycloak-spa-auth`). `renderRoute` calls it
  with `TEST_API_ORIGIN` before every route test, which is why it replaces instead of merging.
- `baseUrl` is the bare origin (`PUBLIC_API_ORIGIN`); paths come from the generated client and start
  with `/`, a path prefix included (orval's `output.baseUrl`).
- A 401 is retried exactly once, and only when `retryToken` returns a token; a second 401 throws.
- The body by content type: JSON is parsed, `text/*` or no content type is a string, anything else
  (`application/octet-stream`, `application/pdf`, `image/*`) is a `Blob`. An empty body is
  `undefined` whatever the status, so a 204 resolves to `undefined`. A non-2xx always throws
  `ApiError`, an empty or unparsable body included (`body` is then the raw text or `undefined`); a
  2xx with unparsable JSON rejects with the `SyntaxError`, which no query retries. Downloads and
  uploads have their own reference.
- Reads time out, writes do not. A GET or HEAD that has no response headers after `timeoutMs`
  (30 000 by default, set through `configureApi`) rejects with the platform `DOMException` named
  `TimeoutError`, not an `ApiError`, because there is no response. The timer stops when the headers
  arrive, so a slow body is read to the end. A POST, PUT, PATCH or DELETE has no client timeout: the
  server may still apply a write the client gave up on. A timeout is not retried, so a read that
  never answers costs the user one `timeoutMs` under the pending bar, then the error. A shorter
  limit for one query is in the polling reference.
- `fetch` itself rejects with a `TypeError` on a network failure and an `AbortError` when the
  query's `signal` aborts; `apiFetch` lets both through unchanged.

Call `apiFetch` directly only for an endpoint the backend's document does not describe yet, and never
for a different origin: it would send the API token there.

## ApiError

`src/api/api-error.ts`. `toApiError(response, body)` builds one from any non-2xx response:

| Body | `message` | `code` | `fieldErrors` |
|---|---|---|---|
| axum `ErrorBody` `{ error, request_id, details }` | `error` | `undefined` | `details` flattened: `{ email: [{ code, message }] }` gives `email: [{ message, code }]`, a nested struct `address.city`, a list item `items[0].name`; `message` falls back to `code`, then `"invalid"`; nesting past 32 levels is ignored, so a hostile body still yields an `ApiError` |
| RFC 9457 `{ type, title, detail }` | `detail`, else `title` | `type`, unless it is `about:blank` | `{}` |
| FastAPI 422 `{ detail: [{ loc, msg, type }] }` | `"validation failed"` | `undefined` | `loc` without its first entry (`body`), joined as a TanStack Form field name (`items[0].name`); `message` is `msg` without pydantic's `Value error, ` or `Assertion failed, ` prefix (`"invalid"` when nothing is left), `code` is pydantic's `type` |
| FastAPI `{ detail: "..." }` | `detail` | `undefined` | `{}` |
| anything else (a proxy's HTML page) | `` `HTTP ${status}` `` | `undefined` | `{}` |

- `status`: the HTTP status. `body`: the parsed body, for debugging only.
- `requestId`: the body's `request_id`, else the `x-request-id` response header. On a cross-origin
  API the browser hides that header unless the backend lists it in `Access-Control-Expose-Headers`.
- `fieldErrors` is `Record<string, FieldError[]>` with `interface FieldError { message: string;
  code?: string }`, always an object (`{}` when there are none), keyed by field names in TanStack
  Form's syntax (`address.city`, `items[0].name`), so no form translates paths. A form shows
  `message` unless the app translates by `code` (`frontend-i18n`); mapping onto fields, and where a
  409 goes, is `frontend-forms`'s.
- `message` is the backend's text for developers: English, unstable, sometimes internal. Never render
  it. Branch on `status` and `code`, write the words in the UI, and show `requestId` so a report can
  be matched to the backend's logs.

`apiFetch` throws exactly `ApiError` for every HTTP failure. orval types errors as
`ErrorType<ErrorBody>`, which resolves to `ApiError | Error`, and Query's `Register` types every
`error` the same way. Narrow with `error instanceof ApiError`; never with the generated `ErrorBody`
or `CreateUserMutationError` types, and never add a second HTTP error class.

## Turning an ApiError into words

```ts,verify
// file: src/features/users/user-error-message.ts
import { ApiError } from "@/api/api-error";

export function userErrorMessage(error: unknown) {
  if (error instanceof ApiError && error.status === 404) return "This user no longer exists.";
  if (error instanceof ApiError && error.status === 409) {
    return "Someone else changed this user. Reload the page and try again.";
  }
  const reference =
    error instanceof ApiError && error.requestId ? ` Request id: ${error.requestId}.` : "";
  return `Something went wrong.${reference}`;
}
```

A loader turns a 404 into the route's not-found screen with `throw notFound()`; the scaffold's
`src/routes/users/$userId.tsx` shows it, and `tanstack-router-spa` owns that shape.

## createQueryClient

`src/app/query-client.ts` as the scaffold ships it. `createAppRouter` builds one per router and hands
in a `notify` that adds a Base UI toast titled `NOTICES[reason]` (in `src/app/router.tsx`) with the
request id, one per reason: a repeated failure updates that toast instead of stacking another. This file holds no user-facing text.

```ts,verify
// file: src/app/query-client.ts
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
```

- `staleTime: 30_000`: a page revisited within 30 s renders from the cache with no request; after
  that the cached data shows at once and refetches in the background. Loaders read through
  `loadQuery` (`tanstack-router-spa`): old data at once, an invalidated query refetched and awaited.
- `retry`: up to two retries (three attempts), only for what a second attempt can change cheaply: a
  network failure (`TypeError`, which fails fast) and 408, 429, 502, 503, 504. Never retried: a read
  timeout (`TimeoutError`: the server already had the whole `timeoutMs`, and three attempts would
  keep the user waiting three times as long), any other `ApiError` (400, 404, 409, 422, 500), an
  abort, a `SyntaxError` from a broken 2xx body, a `ZodError`. One limit: a `TypeError` thrown by a bug inside a query function is retried too,
  because a network failure is the same bare `TypeError`. `src/app/query-client.test.ts` pins this.
- `mutations.retry: false`: a write that may have reached the server is never resent automatically.
  A retry is the user's click, with the same `Idempotency-Key` when the operation documents one.
- `mutations.networkMode: "always"`: a write started while the browser reports offline is sent at
  once and fails like any network failure (`TypeError`), so the form shows its error and the button
  comes back. With Query's default `"online"` it would pause: the button stays pending and the write
  goes out on reconnect, even after the user has left the page.
- `gcTime`, the queries' `networkMode`, `refetchOnWindowFocus` and `refetchOnReconnect` keep their
  defaults (five minutes, `"online"`, on, on).
- `Register.defaultError` makes `error` in every hook, callback and cache handler `ApiError | Error`.
- `Register.mutationMeta` and `Register.queryMeta` type `meta: { silent: true }`. On a mutation the
  screen shows its own errors, as a form does; on a query the screen shows a failed refresh itself,
  as a polled screen does. A first load is quiet either way.

## Who shows which error

| Failure | Shown by |
|---|---|
| a loader's or `useSuspenseQuery`'s first load | the router's `defaultErrorComponent`, `RouteError` in `src/shared/ui/route-error.tsx`, with the request id, inside the layout |
| a background refetch of data already on screen | the QueryCache toast, `NOTICES.refresh`; the stale data stays. With `meta: { silent: true }` the screen says it itself (polling reference) |
| a `useQuery` first load | the component, from `isError` |
| a mutation without `meta.silent` | the MutationCache toast, `NOTICES.mutation` |
| a mutation with `meta: { silent: true }` (a form) | the screen that started it: field errors inline, the rest at the top of the form (`frontend-forms`) |
| 401 after the one retry, 403 | the session's policy (`keycloak-spa-auth`) |
| a lost connection | no screen of its own: a `TypeError`, retried for a query, then one of the rows above. While the browser reports offline, fetches pause instead (polling reference); a mutation does not pause, it fails at once |

Both failure toasts are assertive and stay until the user dismisses them: a polite toast that
vanishes after five seconds is missed. The toast options that do it are `tailwind-base-ui`'s.

## Wire formats

| Schema | Generated type | Rule |
|---|---|---|
| `string`, `format: date-time` | `string` | ISO string in the cache; format at render |
| `string`, `format: decimal` | `string` | never `parseFloat`; send what the user typed |
| `integer`, `format: int64` | `number` | exact only to 2^53; larger ids need a string schema |
| `string`, `format: int64` | `string` | keep it a string |
| `enum` | const object and union type | compare with the literal `"paid"` |
| required, `type: [T, "null"]` | `x: T \| null` | key always present |
| not required | `x?: T` | omit the key; `undefined` is TS2375 (TS2379 as an argument) |
| not required, nullable | `x?: T \| null` | in query params omit it: `null` is sent as `"null"` |

Property names stay snake_case as the backend spells them. Display formatting is
`frontend-code-style`'s.
