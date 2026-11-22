# apiFetch, ApiError and the QueryClient

Contents:

- [apiFetch and configureApi](#apifetch-and-configureapi)
- [ApiError](#apierror)
- [Turning an ApiError into words](#turning-an-apierror-into-words)
- [createQueryClient](#createqueryclient)
- [Who shows which error](#who-shows-which-error)
- [Wire formats](#wire-formats)

## apiFetch and configureApi

`src/api/fetcher.ts` as the scaffold ships it. It is orval's mutator, so every generated function
calls it, and it is the only module that knows the base URL, the token and the error shape.

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

/** The orval mutator: the only place that knows the base URL, the token and the error shape. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
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
  if (response.ok) return body as T;
  throw toApiError(response, body);
}

/** orval types every query and mutation error with this instead of the spec's error body. */
export type ErrorType<_Body> = ApiError | Error;
```

- `configureApi` replaces the whole configuration on each call, starting from the defaults. `main.tsx`
  calls it once with `{ baseUrl: env.apiOrigin }`; the auth add-on calls it again with all three
  fields (`keycloak-spa-auth` owns `getToken` and `retryToken`). A test sets
  `{ baseUrl: "https://api.test" }`, which `renderRoute` already does.
- `baseUrl` is the bare origin (`PUBLIC_API_ORIGIN`); paths come from the generated client and start
  with `/`, a path prefix included (orval's `output.baseUrl`).
- A 401 is retried exactly once, and only when `retryToken` returns a token; a second 401 throws.
- The body is read as text and parsed as JSON when it is not empty and the content type says so.
  A non-2xx always throws `ApiError`, an empty or unparsable body included (`body` is then the raw
  text); a 2xx with unparsable JSON rejects with the `SyntaxError`; an empty 2xx body (a 204)
  resolves to `""`. A binary download (`format: binary`) therefore arrives as text; before the first
  download endpoint, give `apiFetch` a `response.blob()` branch for non-JSON 2xx responses, never a
  second fetcher.
- A multipart body arrives as `FormData` from the generated function. Never set `Content-Type` for
  it: the browser adds the boundary.
- `fetch` itself rejects with a `TypeError` on a network failure and an `AbortError` when the query's
  `signal` aborts; `apiFetch` lets both through unchanged.

Call `apiFetch` directly only for an endpoint the backend's document does not describe yet, and never
for a different origin: it would send the API token there.

## ApiError

`src/api/api-error.ts`. `toApiError(response, body)` builds one from any non-2xx response:

| Body | `message` | `code` | `fieldErrors` |
|---|---|---|---|
| axum `ErrorBody` `{ error, request_id, details }` | `error` | `undefined` | `details` flattened: `{ email: [{ code, message }] }` gives `email`, a nested struct gives `address.city`, a list item `items[0].name`; the value is `message`, else `code`, else `"invalid"`; nesting past 32 levels is ignored, so a hostile body still yields an `ApiError` |
| RFC 9457 `{ type, title, detail }` | `detail`, else `title` | `type`, unless it is `about:blank` | `{}` |
| FastAPI 422 `{ detail: [{ loc, msg }] }` | `"validation failed"` | `undefined` | `loc` without its first entry (`body`), joined as a TanStack Form field name (`items[0].name`); the value is `msg` without pydantic's `Value error, ` or `Assertion failed, ` prefix, `"invalid"` when nothing is left |
| FastAPI `{ detail: "..." }` | `detail` | `undefined` | `{}` |
| anything else (a proxy's HTML page) | `` `HTTP ${status}` `` | `undefined` | `{}` |

- `status`: the HTTP status. `body`: the parsed body, for debugging only.
- `requestId`: the body's `request_id`, else the `x-request-id` response header. On a cross-origin
  API the browser hides that header unless the backend lists it in `Access-Control-Expose-Headers`.
- `fieldErrors` is always an object, `{}` when there are none, keyed by field names in TanStack Form's
  syntax (`address.city`, `items[0].name`), so no form translates paths; `frontend-forms` maps it
  onto the form.
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
    return "A user with this email already exists.";
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
request id. This file holds no user-facing text.

```ts,verify
// file: src/app/query-client.ts
import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api/api-error";

declare module "@tanstack/react-query" {
  interface Register {
    defaultError: ApiError | Error;
    mutationMeta: { silent?: boolean };
  }
}

/** Why the user is told about an error the screen does not show itself. */
export type Notify = (reason: "refresh" | "mutation", error: unknown) => void;

const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504]);

export function createQueryClient(notify: Notify) {
  return new QueryClient({
    queryCache: new QueryCache({
      // A failed first load is the route's error screen; only a failed background refresh toasts.
      onError: (error, query) => {
        if (query.state.data !== undefined) notify("refresh", error);
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
        retry: (failureCount, error) =>
          failureCount < 2 &&
          (!(error instanceof ApiError) || RETRYABLE_STATUSES.has(error.status)),
      },
      // A write is never repeated behind the user's back.
      mutations: { retry: false },
    },
  });
}
```

- `staleTime: 30_000`: a page revisited within 30 s renders from the cache with no request; after
  that the cached data shows at once and refetches in the background. Loaders pass
  `staleTime: "static"` to `queryClient.query` so they never wait on a refetch the component's
  observer will start anyway.
- `retry`: up to two retries (three attempts) for a network failure and for 408, 429, 502, 503 and
  504. Any other `ApiError` (400, 404, 409, 422, 500) fails at once: retrying it cannot change the
  answer and only delays the error screen. `src/app/query-client.test.ts` pins this policy.
- `mutations.retry: false`: a POST that may have reached the server is never resent automatically.
  A retry is the user's click, with the same `Idempotency-Key` when the operation documents one.
- `gcTime`, `refetchOnWindowFocus` and `refetchOnReconnect` keep their defaults (five minutes, on,
  on).
- `Register.defaultError` makes `error` in every hook, callback and cache handler `ApiError | Error`.
- `Register.mutationMeta` types `meta: { silent: true }` on a mutation. There is no `queryMeta`
  entry: a query's `meta.silent` would do nothing, because the QueryCache handler already stays quiet
  on a first load.

## Who shows which error

| Failure | Shown by |
|---|---|
| a loader's or `useSuspenseQuery`'s first load | the router's `defaultErrorComponent`, `RouteError` in `src/shared/ui/route-error.tsx`, with the request id, inside the layout |
| a background refetch of data already on screen | the QueryCache toast, `NOTICES.refresh`; the stale data stays |
| a `useQuery` first load | the component, from `isError` |
| a mutation without `meta.silent` | the MutationCache toast, `NOTICES.mutation` |
| a mutation with `meta: { silent: true }` (a form) | the screen that started it: field errors inline, the rest at the top of the form (`frontend-forms`) |
| 401 after the one retry, 403 | the session's policy (`keycloak-spa-auth`) |

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
