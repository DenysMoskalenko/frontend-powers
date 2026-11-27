---
name: tanstack-query-api
description: "Use when calling the backend: openapi.json, orval.config.ts, pnpm api:generate, generated getXQueryOptions, getXSuspenseQueryOptions, getXQueryKey or getXMutationOptions, apiFetch, configureApi, ApiError, TimeoutError, createQueryClient, useSuspenseQuery, useMutation, invalidateQueries, optimistic updates, infinite lists, refetchInterval polling, file download or upload progress, ensureQueryData deprecated, TS2379, decimal and date wire formats. Not for route files and loaders (tanstack-router-spa), form fields (frontend-forms), MSW handlers (frontend-testing), tokens and 401 (keycloak-spa-auth)."
metadata:
  version: "0.1.1"
---

# Server state and the API client

Assumes TanStack Query 5.108, orval 8.48, zod 4.6.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another major of a package than the line above, or an older minor, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

## Important

- Every request goes through the generated client, which calls `apiFetch`. Never `fetch` in a
  component, never edit `src/api/generated/`: copy the backend's document over `openapi.json`, run
  `pnpm format` and `pnpm api:generate`, commit both; CI fails on drift. The exceptions are a
  signed storage URL and upload progress (`references/files.md`).
- Keys and fetch functions come from the generated getters, never hand-written arrays. Loaders call
  `loadQuery(context.queryClient, getXQueryOptions(p))` (`tanstack-router-spa`); components call
  `useSuspenseQuery(getXSuspenseQueryOptions(p))`. Swapping the two is TS2379. `ensureQueryData`,
  `prefetchQuery` and `fetchQuery` are deprecated.
- `onSuccess` returns `client.invalidateQueries({ queryKey: getListUsersQueryKey() })`, `client`
  from its fourth argument. A delete from the entity's own page passes `refetchType: "none"` there
  and navigates in `mutate`'s own `onSuccess`, after the mutation settled; no mutation callback
  awaits `navigate`.
- Errors are `ApiError`, branched on `status`, `code` and `fieldErrors`. Show users `requestId`,
  never `message`. A read with no response headers in `timeoutMs` rejects with a `TimeoutError`;
  a write has no client timeout. No second HTTP error class, no generated error types, no zod on
  own-backend responses.

## References

- `references/orval.md` — changing `orval.config.ts` or `openapi.json`: the regeneration loop,
  every key, the generated names, `operationId`s, parameters and headers, a path prefix, keys that
  stay off.
- `references/client-and-errors.md` — touching `apiFetch`, `configureApi`, `ApiError` or
  `createQueryClient`, or deciding who shows an error: the files quoted, the error mapping, the
  timeout, retry and toast policy; wire formats: decimal, date-time, int64, nullable.
- `references/queries-and-mutations.md` — writing a query or mutation: `select`, dependent and
  parallel reads, invalidation, a delete from the detail page and its route test, optimistic UI,
  pagination, infinite lists, older v5 and v4 names.
- `references/polling.md` — a screen that refetches on an interval: what stops it, offline and
  `networkMode`, a failed poll, a shorter timeout, showing how old the data is.
- `references/files.md` — downloading a protected file, uploading through the generated client or
  to a signed storage URL, upload progress, a failed upload.

## Ownership

The loader, `loadQuery` and the route file shape are `tanstack-router-spa`'s, form state and
on-screen field errors `frontend-forms`'s, MSW handlers and factories `frontend-testing`'s, the
token and the 401/403 policy `keycloak-spa-auth`'s, pushed cache updates `frontend-realtime`'s.

## The client

orval names functions after the camel-cased `operationId` (`list_users` gives `listUsers`), and
`shouldSplitQueryKey: true` makes `['users', params]` and `['users', id]` share a prefix, so one
getter invalidates both; the rest of the config is in `references/orval.md`. `apiFetch` adds the
base URL and the bearer token, retries a 401 once, throws `ApiError` on any non-2xx, resolves
`undefined` for an empty body and a `Blob` for a file. `configureApi` is one call at startup; a
second call replaces the first. A hand-written path encodes each dynamic segment with
`encodeURIComponent`.

## QueryClient defaults

`createQueryClient(notify)` in `src/app/query-client.ts`: `staleTime: 30_000`; queries retry twice,
only a network `TypeError` and 408, 429, 502, 503, 504, never a `TimeoutError` (the server already
had the whole timeout). Mutations never retry and use `networkMode: "always"`: offline, a submit
fails at once instead of pausing and going out on reconnect. A failed first load is the route's
`RouteError`, a failed background refetch or mutation an assertive toast that stays until
dismissed, unless the query or mutation sets `meta: { silent: true }` (forms and polled screens do).

## Queries

| Situation | Read with |
|---|---|
| route data, filled by the loader | `useSuspenseQuery(getXSuspenseQueryOptions(p))` |
| part of an entity | the getter's `query: { select: (user) => user.name }` |
| keep fresh while visible | `query: { refetchInterval: 30_000, retry: false }` (`references/polling.md`) |
| a widget no loader owns, or dependent on a pick | `useQuery(getXQueryOptions(id ?? "", { query: { enabled: id !== undefined } }))` |
| several reads the page shows on arrival (a section under the details included) | in parallel in the loader, one `Promise.all`; one child component per id with `useSuspenseQuery` |
| data from another read | `await` the first in the loader, then load the second |
| data the page can render without (behind a tab or toggle) | `useQuery(getXQueryOptions(p))` with its own pending and error state; the loader starts it before its first `await` (`tanstack-router-spa`) |

Pass options through the getter's `query` argument so `select` infers its types.
`useSuspenseQueries` over the suspense getters fails with TS2769 for a fixed list and types `data`
as `unknown` for a mapped one.

A polled query sets `retry: false`, so a failed poll waits for the next tick, and
`meta: { silent: true }`, because the screen shows the time of `dataUpdatedAt` and says the data is
old while `isRefetchError || isPaused`. There is no
offline screen: a lost connection is a `TypeError` the retry rule and the error screens handle.

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

- The returned invalidation keeps `isPending` true until the active queries are refetched. An
  inactive list is only marked, and its loader's `loadQuery` awaits the fresh list on the next
  visit, so the list never paints the old rows.
- `mutateAsync` rejects with the `ApiError`, for a caller that continues and catches; `mutate` never
  rejects: the error lands in `mutation.error` and the MutationCache toast.

## Infinite lists

`infiniteQueryOptions` around `listUsers`, keyed `[...getListUsersQueryKey({ limit }), "infinite"]`.
orval's `useInfinite` keys it `['infinite', 'users', ...]`, which the list invalidation misses.

## Wire formats

Property names stay snake_case as the backend spells them. Decimal, date-time, int64 and nullable
fields follow the table in `references/client-and-errors.md`; display formatting is
`frontend-code-style`'s.

## Where zod validates

Validate what the app does not control: search params, form input (schemas from `api.zod.ts`),
`localStorage` and `sessionStorage` reads, socket and SSE messages, `postMessage`. Never parse an
own-backend response: the backend owns its contract and publishes it as `openapi.json`, the CI drift
check keeps the client equal to that committed copy, and a response that breaks it is a backend bug
to fix there.

`src/app/zod-config.ts` sets `z.config({ jitless: true })` before any schema is built; without it
each object schema's `new Function` probe is a Trusted Types violation.

## Prior-version corrections

| Older examples write | Correct now |
|---|---|
| `queryClient.ensureQueryData(opts)` in a loader | `loadQuery(context.queryClient, opts)` |
| `queryClient.query({ ...opts, staleTime: "static" })` in a loader | `loadQuery(context.queryClient, opts)`: `"static"` also returns an invalidated entry |
| `prefetchQuery(opts)` / `fetchQuery(opts)` | `void queryClient.query(opts).catch(() => undefined)` / `await queryClient.query(opts)`; in a loader, `loadQuery` |
| `fetchInfiniteQuery` / `ensureInfiniteQueryData` | `queryClient.infiniteQuery(opts)` |
| `queryClient.query()` or `infiniteQuery()` in a project below TanStack Query 5.102 | they do not exist there: keep `fetchQuery` and `fetchInfiniteQuery`, and say which rules do not apply |
| `onSuccess(data, variables, context)` with `onMutate`'s return as `context` | `(data, variables, onMutateResult, { client, meta, mutationKey })` |
| `useQueryClient()` only to invalidate in a callback | `context.client` |
| `isLoading` meaning "no data yet" | `isPending`; `isLoading` is `isPending && isFetching` |
| hand-written `queryKey: ["users", id]` | `getGetUserQueryKey(id)` |
| an `axios` instance with interceptors | `apiFetch` with `configureApi` |
| `apiFetch` resolving `""` for a 204, a file as text | `undefined` for any empty body, a `Blob` for a binary content type |
| orval `shouldExportQueryKey` | `shouldExportKeys` |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| Check `error.response?.status` or a generated `ErrorBody` | `error instanceof ApiError && error.status` |
| Add `retry` to a mutation | `retry: false` stays; the user retries |
| `await navigate(...)` inside a mutation's `onSuccess` | Navigate after the mutation settled: a blocked navigation never resolves and leaves it pending |
| Pass `{ q: null }` or `{ q: undefined }` as a query param | Omit the key: `null` is sent as the string `"null"` |
| `parseFloat` a decimal field, or `new Date()` it into the cache | Keep the string, convert at render: a float loses digits, a `Date` is not what the cache holds |
| Set `useQuery: true` or `mutationInvalidates` in orval | Defaults plus explicit invalidation in `onSuccess`: `mutationInvalidates` does not return the promise |
| `` `/users/${id}` `` in a hand-written path | `` `/users/${encodeURIComponent(id)}` ``: a raw `../admin` or `?x=y` reaches another endpoint with the token |
| Retry a `TimeoutError` like a network failure | Leave it unretried: the server already had the whole `timeoutMs`; lower `timeoutMs` instead |
| Hide a polled screen's refresh toast in the QueryCache handler | `meta: { silent: true }` on the polled query, whose screen says its data is old |
| Pass a timeout as the getter's `request: { signal }` | Override `queryFn` and combine the query's `signal` with `AbortSignal.any` (`references/polling.md`) |
