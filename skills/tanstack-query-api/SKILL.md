---
name: tanstack-query-api
description: "Use when calling the backend: openapi.json, orval.config.ts, pnpm api:generate, generated getXQueryOptions, getXSuspenseQueryOptions, getXQueryKey or getXMutationOptions, apiFetch, configureApi, ApiError, the error toast, createQueryClient, useSuspenseQuery, useMutation, invalidateQueries, optimistic updates, paginated or infinite lists, polling, ensureQueryData deprecated, TS2379 on queryClient.query, decimal and date wire formats, where zod validates. Not for route files and loaders (tanstack-router-spa), form fields (frontend-forms), MSW handlers in tests (frontend-testing), tokens and 401 (keycloak-spa-auth)."
metadata:
  version: "0.1.0"
---

# Server state and the API client

Assumes TanStack Query 5.107, orval 8.48, zod 4.6.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, use its own modules, helpers and scripts, and say so when it has no equivalent instead of adding one unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If `pnpm-lock.yaml` pins another major version than the line above, follow the project and say which rules may not apply.

## Important

- Every request goes through the generated client, which calls `apiFetch`. Never `fetch` in a
  component, never edit `src/api/generated/`: copy the backend's document over `openapi.json`, run
  `pnpm format` and `pnpm api:generate`, commit both; CI fails on drift.
- Keys and fetch functions come from the generated getters, never hand-written arrays. Loaders call
  `queryClient.query({ ...getXQueryOptions(p), staleTime: "static" })`, awaited or not; components call
  `useSuspenseQuery(getXSuspenseQueryOptions(p))`. Swapping the two is TS2379.
- `ensureQueryData`, `prefetchQuery` and `fetchQuery` are deprecated in 5.107; use `queryClient.query`.
- Mutations invalidate in `onSuccess` and return the promise:
  `(_data, _variables, _onMutateResult, { client }) => client.invalidateQueries({ queryKey: getListUsersQueryKey() })`.
- Errors are `ApiError`, branched on `status`, `code` and `fieldErrors`. Show users `requestId`,
  never `message`. No second HTTP error class, no generated error types, no zod on own-backend
  responses.

## References

- `references/orval.md` — changing `orval.config.ts` or `openapi.json`: every key, the generated
  names, `operationId`s, parameters and headers, keys that stay off.
- `references/client-and-errors.md` — touching `apiFetch`, `ApiError` or `createQueryClient`, or
  deciding who shows an error: the files quoted, the error mapping, retry and toast policy.
- `references/queries-and-mutations.md` — writing a query or mutation: `select`, polling, dependent
  and parallel reads, invalidation, optimistic UI, pagination, infinite lists.

## Ownership

The loader and route file shape are `tanstack-router-spa`'s, form state and on-screen field errors
`frontend-forms`'s, MSW handlers and factories `frontend-testing`'s, the token and the 401/403 policy
`keycloak-spa-auth`'s, pushed cache updates `frontend-realtime`'s.

## openapi.json and the generated client

`openapi.json` is a committed copy of the backend's document, never edited by hand; a wrong endpoint
is fixed in the backend and copied again. `pnpm format` lays it out as Biome formats every file, so
diffs stay readable however the backend serialises it. `PUBLIC_API_ORIGIN` stays a bare origin: a
path prefix the document's paths already include needs nothing, one they leave out (`/api/v1`) goes
in orval's `output.baseUrl`. `pnpm api:generate` writes `api.ts` (functions,
getters, key getters, types), `api.zod.ts` (request and response schemas) and `api.msw.ts` (test
handlers) under `src/api/generated/`.

Names come from the camel-cased `operationId` (`list_users` gives `listUsers`; FastAPI's default ids
give `listUsersUsersGet`, so ask the backend for stable ids). `shouldSplitQueryKey: true` makes keys
`['users', params]` and `['users', id]` share a prefix, so one getter invalidates both;
`includeHttpResponseReturnType: false` types results as the body `apiFetch` returns. Every other key
is in `references/orval.md`.

## apiFetch and ApiError

`apiFetch(path, init)` is the mutator: base URL, bearer token, one retry after a 401, `ApiError` on
any non-2xx whatever its body, `""` for an empty 2xx body. `configureApi({ baseUrl, getToken, retryToken })` replaces the whole configuration;
`main.tsx` sets `baseUrl`, the auth add-on the rest. Call `apiFetch` directly only for an endpoint
the document lacks; writes go through the generated `getXMutationOptions` once it is documented.

`ApiError` carries `status`, `code` (RFC 9457 `type`), `requestId` (body `request_id`, else the
`x-request-id` header, which a cross-origin backend must expose), `fieldErrors` (field path as
TanStack Form names it, `items[0].name`, to message; `{}` when none) and `body`. A network failure stays a `TypeError`, an abort an `AbortError`.

## QueryClient defaults

`createQueryClient(notify)` in `src/app/query-client.ts`:

- `staleTime: 30_000`; loaders pass `"static"` so they never wait on a refetch.
- Queries retry twice, only on network errors and 408, 429, 502, 503, 504. Mutations never retry.
- A failed first load renders the router's `defaultErrorComponent` (`RouteError`). A failed
  background refetch calls `notify("refresh", error)`, a failed mutation `notify("mutation", error)`
  unless it sets `meta: { silent: true }` (forms do); the toast titles live in `NOTICES` in
  `src/app/router.tsx`.
- `Register` types `defaultError` as `ApiError | Error` and `mutationMeta` as `{ silent?: boolean }`;
  `silent` does nothing on a query.

## Queries

| Situation | Read with |
|---|---|
| route data, filled by the loader | `useSuspenseQuery(getXSuspenseQueryOptions(p))` |
| part of an entity | the getter's `query: { select: (user) => user.name }` |
| keep fresh while visible | `query: { refetchInterval: 30_000 }`; a function may return `false` |
| a widget no loader owns, or dependent on a pick | `useQuery(getXQueryOptions(id ?? "", { query: { enabled: id !== undefined } }))` |
| several reads | in parallel in the loader; one child component per id with `useSuspenseQuery` |
| data from another read | `await` the first in the loader, then `query` the second |
| data the first paint does not need | `useQuery(getXQueryOptions(p))` with its own pending and error state; the loader starts it with `void context.queryClient.query({ ...options, staleTime: "static" }).catch(() => undefined)` |

Pass options through the getter's `query` argument so `select` infers its types.
`useSuspenseQueries` over the suspense getters fails with TS2769 for a fixed list and types `data`
as `unknown` for a mapped one. The unawaited prefetch may swallow its error because the component
reading the entry shows it; with `useSuspenseQuery` there, a failure becomes the whole route's
`RouteError`.

## Mutations

```ts
const createUser = useMutation(
  getCreateUserMutationOptions({
    mutation: {
      onSuccess: (_user, _variables, _onMutateResult, { client }) =>
        client.invalidateQueries({ queryKey: getListUsersQueryKey() }),
    },
  }),
);
createUser.mutate({ data: { name, email } });
```

- Callbacks are `(data, variables, onMutateResult, context)` with `context` =
  `{ client, meta, mutationKey }`; no `useQueryClient()` needed.
- The returned promise keeps `isPending` true until the refetch lands.
- `setQueryData(getGetUserQueryKey(user.id), user)` before the list invalidation shows the server's
  answer at once; the list key also covers that detail, so it is refetched once while on screen. A
  list off screen is served from the cache when the user returns (`"static"` ignores invalidation),
  then refetched. Where the old row misleads (a status just changed), call
  `client.removeQueries({ queryKey: getListUsersQueryKey(), type: "inactive" })` before invalidating,
  so the list loader waits for fresh data.
- `mutateAsync` rejects with the `ApiError`, for a caller that continues and catches; `mutate` never
  rejects, the error reaches `mutation.error` and the toast.

## Optimistic UI, pagination, infinite lists

- Optimistic default: render the pending item from `mutation.variables`, or elsewhere from
  `useMutationState` filtered by `getCreateUserMutationKey()` and `status: "pending"`.
- Write to the cache in `onMutate` only when the target query is certainly cached: cancel, snapshot,
  `setQueryData`, restore in `onError`, invalidate in `onSettled`.
- Pagination: `toListParams` maps the URL's 1-based `page` to `limit` and `offset`, and `pageCount`
  reads the envelope's `total` and `limit`; each page is its own cache entry and needs no
  `placeholderData`. A backend paging by `page` and `page_size` takes the URL's page as is.
- Infinite lists: `infiniteQueryOptions` around `listUsers`, keyed
  `[...getListUsersQueryKey({ limit }), "infinite"]`. orval's `useInfinite` keys it
  `['infinite', 'users', ...]`, which the list invalidation misses.

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

## Where zod validates

Validate what the app does not control: search params, form input (schemas from `api.zod.ts`),
`localStorage` and `sessionStorage` reads, socket and SSE messages, `postMessage`. Never parse an
own-backend response: the generated types are the contract and the CI drift check guards them.

`src/app/zod-config.ts` sets `z.config({ jitless: true })` before any schema is built; without it
each object schema's `new Function` probe is a Trusted Types violation.

## Prior-version corrections

| Older examples write | Correct now |
|---|---|
| `queryClient.ensureQueryData(opts)` in a loader | `queryClient.query({ ...opts, staleTime: "static" })` |
| `prefetchQuery(opts)` / `fetchQuery(opts)` | `void context.queryClient.query({ ...opts, staleTime: "static" }).catch(() => undefined)` / `await queryClient.query(opts)` |
| `fetchInfiniteQuery` / `ensureInfiniteQueryData` | `queryClient.infiniteQuery(opts)` / `queryClient.infiniteQuery({ ...opts, staleTime: "static" })` |
| `onSuccess(data, variables, context)` with `onMutate`'s return as `context` | `(data, variables, onMutateResult, { client, meta, mutationKey })` |
| `useQueryClient()` only to invalidate in a callback | `context.client` |
| `onSuccess` / `onError` on `useQuery` | removed in v5; react in the cache handlers or render from `error` |
| `isLoading` meaning "no data yet" | `isPending`; `isLoading` is `isPending && isFetching` |
| `cacheTime` | `gcTime` |
| `keepPreviousData: true` | `placeholderData: keepPreviousData` |
| `isInitialLoading`, `isCancelledError()` | `isLoading`, `instanceof CancelledError` |
| hand-written `queryKey: ["users", id]` | `getGetUserQueryKey(id)` |
| an `axios` instance with interceptors | `apiFetch` with `configureApi` |
| orval `shouldExportQueryKey` | `shouldExportKeys` |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| Write `fetch("/users")` or an `axios` call in a component | The generated getter; `apiFetch` owns origin, token and errors |
| Call `invalidateQueries` without returning it | Return it so the mutation stays pending |
| Check `error.response?.status` or a generated `ErrorBody` | `error instanceof ApiError && error.status` |
| Add `retry` to a mutation | `retry: false` stays; the user retries |
| Pass `{ q: null }` or `{ q: undefined }` as a query param | Omit the key |
| `parseFloat` a decimal field, or `new Date()` it into the cache | Keep the string; convert at render |
| `ListUsersResponse.parse(data)` on an API response | Trust the generated type |
| Set `useQuery: true` or `mutationInvalidates` in orval | Defaults plus explicit invalidation in `onSuccess` |
