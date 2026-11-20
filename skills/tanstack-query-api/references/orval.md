# orval: the committed document, the config, the generated names

Contents:

- [The regeneration loop](#the-regeneration-loop)
- [The config key by key](#the-config-key-by-key)
- [What one operation generates](#what-one-operation-generates)
- [Operation names come from operationId](#operation-names-come-from-operationid)
- [Parameters and headers](#parameters-and-headers)
- [Keys orval offers that stay off](#keys-orval-offers-that-stay-off)

## The regeneration loop

`openapi.json` at the project root is a committed copy of the backend's OpenAPI document, never
edited by hand: a wrong or missing endpoint is fixed in the backend and copied again.

1. Copy the backend's current document over `openapi.json`, then `pnpm format`: Biome checks the
   file like any other, and formatting it keeps diffs readable however the backend serialises it.
2. `pnpm api:generate` (runs `orval`, writes `src/api/generated/api.ts`, `api.zod.ts`, `api.msw.ts`).
3. Run `pnpm check`: `tsc` names every call site the contract change broke.
4. Commit `openapi.json` and `src/api/generated/` together.

CI runs the same generation and fails when the committed files differ. GitHub Actions:

```yaml
      # The committed client must be what openapi.json generates.
      - run: pnpm api:generate && git diff --exit-code src/api/generated
```

GitLab, whose Node image has no `git`:

```yaml
    # The committed client must be what openapi.json generates (the image has no git).
    - cp -R src/api/generated /tmp/generated-committed
    - pnpm api:generate && diff -r /tmp/generated-committed src/api/generated
```

The output is deterministic, so a diff in CI means someone edited a generated file or committed the
document without regenerating. `src/api/generated/` is excluded from Biome (`files.includes` has
`!src/api/generated`) and from knip; it is still type-checked by `tsc`, so a generator bump that
emits code the strict tsconfig rejects fails `pnpm check`.

## The config key by key

The scaffold's `orval.config.ts`:

```ts
import { defineConfig } from "orval";

const input = { target: "./openapi.json" };

export default defineConfig({
  api: {
    input,
    output: {
      target: "src/api/generated/api.ts",
      client: "react-query",
      httpClient: "fetch",
      mode: "single",
      mock: { generators: [{ type: "msw" }] },
      override: {
        mutator: { path: "src/api/fetcher.ts", name: "apiFetch" },
        fetch: { includeHttpResponseReturnType: false },
        query: { useSuspenseQuery: true, shouldSplitQueryKey: true },
      },
    },
  },
  zod: {
    input,
    output: { target: "src/api/generated/api.zod.ts", client: "zod", mode: "single" },
  },
});
```

| Key | Value | Why |
|---|---|---|
| `client` | `"react-query"` | emits fetch functions, `getXQueryOptions`, `getXQueryKey`, `getXMutationOptions` and hooks |
| `httpClient` | `"fetch"` | no HTTP library; the mutator below wraps `fetch` |
| `mode` | `"single"` | one file per output; per-tag splitting pays off only for specs with hundreds of operations, and Vite drops what is not imported either way |
| `mock.generators` | `[{ type: "msw" }]` | `api.msw.ts` with `getListUsersMockHandler(data)` and friends; their default bodies are faker-random, so tests always pass data (`frontend-testing`) |
| `override.mutator` | `apiFetch` in `src/api/fetcher.ts` | every request goes through the one function that knows the base URL, the token and the error shape; orval also imports `ErrorType` from that file to type errors, as `'../fetcher.ts'` because the tsconfig allows `.ts` extensions |
| `override.fetch.includeHttpResponseReturnType` | `false` | the default types every function as `Promise<{ data, status, headers }>` while `apiFetch` returns the bare body |
| `override.query.useSuspenseQuery` | `true` | adds `getXSuspenseQueryOptions` and `useXSuspense` for GET operations |
| `override.query.shouldSplitQueryKey` | `true` | keys become `['users', params]` and `['users', id]`; the default URL-string keys (`['/users', params]`, `['/users/42']`) share no prefix, so one invalidation cannot reach both |
| second output `client` | `"zod"` | `api.zod.ts`: request-body, query-param and response schemas; the body schemas are the base of form schemas (`frontend-forms`) |

A backend served under a path prefix that its document's paths leave out (`/api/v1` in front of
`/users`) gets `baseUrl: "/api/v1"` beside `httpClient` in the `api` output: at orval 8.48 every
generated URL starts with it, keys gain it as leading segments (`['api', 'v1', 'users', params]`,
still one prefix per resource) and the MSW handlers (`*/users`) match as before. When the paths
already include the prefix, nothing changes. `PUBLIC_API_ORIGIN` stays a bare origin either way.

Pin orval exactly and read the generated diff on every bump: it ships a minor release most weeks, and
generated signatures change between them.

orval decides which TanStack Query major to target from the `package.json` next to the config. Run
from a directory whose `package.json` lacks `@tanstack/react-query` (a workspace package, a bare
probe), it warns "Could not determine the installed @tanstack/react-query version, so hooks are
generated for v4": set `override.query.version: 5` or `output.packageJson` there.

## What one operation generates

For the scaffold's three operations (`operationId` `list_users`, `get_user`, `create_user`):

| Generated | Use |
|---|---|
| `listUsers(params, init)`, `getUser(id, init)`, `createUser(body, init)` | the plain fetch functions; inside a hand-built `queryFn` such as infinite options |
| `getListUsersQueryOptions(params, { query })`, `getGetUserQueryOptions(id, { query })` | `queryClient.query` in a loader, `useQuery` in a component |
| `getListUsersSuspenseQueryOptions(...)`, `getGetUserSuspenseQueryOptions(...)` | `useSuspenseQuery` |
| `getListUsersQueryKey(params?)`, `getGetUserQueryKey(id)` | invalidation, `setQueryData`, `cancelQueries` |
| `getCreateUserMutationOptions({ mutation, request })`, `getCreateUserMutationKey()` | `useMutation`; the key for `useMutationState` filters |
| `useListUsers`, `useListUsersSuspense`, `useGetUser`, `useCreateUser` | wrappers over the getters; the house calls TanStack's hooks with the getters, so loaders and components read the same names |
| types `UserResponse`, `PageUserResponse`, `CreateUser`, `ListUsersParams`, `CreateUserMutationVariables` | props, factories, `setQueryData` generics |
| `ErrorBody`, `ListUsersQueryError`, `CreateUserMutationError` | not used: errors are `ApiError` |
| zod `CreateUserBody`, `ListUsersQueryParams`, `ListUsersResponse`, `GetUserParams` | forms, search and path params; never to parse a response |
| MSW `getListUsersMockHandler`, `getGetUserMockHandler`, `getCreateUserMockHandler` | route tests (`frontend-testing`) |

The non-suspense getter sets `enabled: id !== null && id !== undefined` for a path parameter. The
suspense getter returns `queryOptions(...)` cast to `UseSuspenseQueryOptions`, which is why the two
cannot stand in for each other under `exactOptionalPropertyTypes`:

- `queryClient.query({ ...getListUsersSuspenseQueryOptions(p), staleTime: "static" })` fails with
  TS2379 "... is not assignable to parameter of type 'QueryExecuteOptions<...>' with
  'exactOptionalPropertyTypes: true'".
- `useSuspenseQuery(getGetUserQueryOptions(id))` fails with TS2379 "Argument of type
  'UseQueryOptions<...>' is not assignable to parameter of type 'UseSuspenseQueryOptions<...>'".

Both getters build the same key and the same `queryFn`, so the loader's fetch is the component's
cache hit.

## Operation names come from operationId

orval camel-cases the `operationId`: utoipa's `list_users` becomes `listUsers`,
`getListUsersQueryOptions` and `useListUsers`. FastAPI's default ids are
`<function>_<path>_<method>`, so `list_users_users_get` becomes `listUsersUsersGet` and
`getListUsersUsersGetQueryOptions`. Ask the backend for stable ids (FastAPI:
`FastAPI(generate_unique_id_function=lambda route: route.name)` with unique handler names) rather
than renaming in `override.operationName`: a renamed handler then renames the client in one
reviewed diff instead of silently.

## Parameters and headers

- A nullable query parameter (`q?: string | null`) accepts `null`, and the URL builder sends it as
  the string `null` (`value === null ? 'null' : String(value)`). Leave the key out instead.
- Under `exactOptionalPropertyTypes` an optional parameter cannot be `undefined` either:
  `listUsers({ limit: undefined })` fails with TS2379. Spread it in only when set:
  `{ ...toListParams(page), ...(q !== undefined && { q }) }`.
- A header parameter documented in the spec (`Idempotency-Key`) is dropped from the generated
  signature unless `output.headers: true` is set. With it, the mutation variables become
  `{ data, headers: { "Idempotency-Key": key } }`. Mint the key with `crypto.randomUUID()` once per
  user intent and reuse it only to resend the identical body.
- A fixed header for every call of one hook goes in the getter's `request` option, which is the
  `RequestInit` handed to `apiFetch`.
- Response headers are unreachable: the generated functions and `apiFetch` return the body only. A
  value the UI needs (a total, a location, a version) belongs in the response body; ask the backend.

## Keys orval offers that stay off

| Key | What it would do |
|---|---|
| `override.query.useQuery: true` | also generates query getters for POST and DELETE (`getCreateOrderQueryKey`); GET operations already get queries and the rest mutations by default |
| `override.query.mutationInvalidates` | its generated `onSuccess` calls `invalidateQueries` without returning it, so the mutation settles before the refetch, and the mutation getter's signature becomes `(queryClient, options)` |
| `override.operations.<id>.query.useInfinite` | keys the query `['infinite', 'users', params]`, which `getListUsersQueryKey()` invalidation misses, and casts its options so a missing `getNextPageParam` compiles |
| `runtimeValidation` (under `override.fetch` or `override.query`) | parses every own-backend response at runtime; the generated types and the CI drift check already hold the contract |
| `override.namingConvention.properties` | renames the TypeScript properties only; the JSON on the wire stays snake_case and no longer matches |
| `output.formatter` | formats files Biome is configured to skip; the drift check needs no formatting |
