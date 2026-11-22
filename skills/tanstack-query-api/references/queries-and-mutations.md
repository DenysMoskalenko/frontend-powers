# Queries and mutations with the generated getters

Contents:

- [Reading in a component](#reading-in-a-component)
- [Data no loader owns](#data-no-loader-owns)
- [Parallel reads](#parallel-reads)
- [Mutations and invalidation](#mutations-and-invalidation)
- [A delete from the entity's own page](#a-delete-from-the-entitys-own-page)
- [Optimistic UI from the mutation's variables](#optimistic-ui-from-the-mutations-variables)
- [Optimistic UI in the cache](#optimistic-ui-in-the-cache)
- [Pagination](#pagination)
- [Infinite lists](#infinite-lists)
- [An endpoint outside openapi.json](#an-endpoint-outside-openapijson)
- [Older v5 and v4 names](#older-v5-and-v4-names)

Every example uses the scaffold's generated client for `list_users`, `get_user` and `create_user`.
The loader that fills the cache first is `tanstack-router-spa`'s; these blocks are what goes inside it
and the components under it.

## Reading in a component

Options for one query go through the getter's `query` argument, so `select` and the other options
infer their types from the generated response type. `select` narrows what the component re-renders
on; `refetchInterval` polls while the component is mounted (a function of the query may return
`false` to stop).

```tsx,verify
// file: src/features/users/user-name.tsx
import { useSuspenseQuery } from "@tanstack/react-query";
import { getGetUserSuspenseQueryOptions } from "@/api/generated/api";

export function UserName({ userId }: { userId: string }) {
  const { data: name } = useSuspenseQuery(
    getGetUserSuspenseQueryOptions(userId, {
      query: { select: (user) => user.name, refetchInterval: 30_000 },
    }),
  );
  return <span>{name}</span>;
}
```

The key stays `['users', userId]` whatever `select` returns, so this component shares the cache entry
the route loader filled with `getGetUserQueryOptions(userId)`.

## Data no loader owns

A widget that appears after a user action (a hover card, a picker's details) uses `useQuery` with
the non-suspense getter. A dependent read waits on `enabled`; the generated getter already sets
`enabled: id !== null && id !== undefined`, and the `query` argument overrides it.

```tsx,verify
// file: src/features/users/user-preview.tsx
import { useQuery } from "@tanstack/react-query";
import { getGetUserQueryOptions } from "@/api/generated/api";

export function UserPreview({ userId }: { userId: string | undefined }) {
  const user = useQuery(
    getGetUserQueryOptions(userId ?? "", { query: { enabled: userId !== undefined } }),
  );
  if (userId === undefined) return null;
  if (user.isPending) return <p>Loading…</p>;
  if (user.isError) return <p role="alert">The user could not be loaded.</p>;
  return <p>{user.data.email}</p>;
}
```

`isPending` means "no data yet", including while disabled; `isLoading` is `isPending && isFetching`.
A failed first load of a `useQuery` raises no toast (the QueryCache handler toasts only when data
already exists), so the component renders its own error.

## Parallel reads

Fetch in parallel where the data is loaded: the route loader runs its `queryClient.query` calls in
one `Promise.all`, and each component reads its own entry with `useSuspenseQuery`. For a list of ids,
render one child per id, each calling `useSuspenseQuery(getGetUserSuspenseQueryOptions(id))`.
`useSuspenseQueries` over the generated suspense getters fails `tsc` with TS2769 for a fixed list
(the getters' `persister` type does not fit) and types `data` as `unknown` for a mapped one
(`ids.map(...)`).

Two `useSuspenseQuery` calls in one component run as a waterfall: the second starts only after the
first resolves. A read that needs the first one's data is a real dependency; fetch both in the loader
(`await` the first, then `query` the second) so the component only reads the cache.

## Mutations and invalidation

The test below pins the two facts the house mutation shape relies on: under `shouldSplitQueryKey` one
`getListUsersQueryKey()` call covers every list page and every detail, and a promise returned from
`onSuccess` keeps the mutation pending until the refetch has landed.

```ts,verify,test
import { MutationObserver, QueryObserver } from "@tanstack/react-query";
import { expect, test } from "vitest";
import { configureApi } from "@/api/fetcher";
import {
  getCreateUserMutationOptions,
  getGetUserQueryKey,
  getListUsersQueryKey,
  getListUsersQueryOptions,
} from "@/api/generated/api";
import { getCreateUserMockHandler, getListUsersMockHandler } from "@/api/generated/api.msw";
import { createQueryClient } from "@/app/query-client";
import { buildUser } from "@/test/factories/user";
import { server } from "@/test/server";

const firstPage = { limit: 20, offset: 0 };

test("the bare list key getter invalidates every list page and every detail", async () => {
  const queryClient = createQueryClient(() => {});
  const ada = buildUser();
  queryClient.setQueryData(getListUsersQueryKey(firstPage), {
    items: [ada],
    total: 1,
    ...firstPage,
  });
  queryClient.setQueryData(getGetUserQueryKey(ada.id), ada);

  await queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });

  expect(queryClient.getQueryState(getListUsersQueryKey(firstPage))?.isInvalidated).toBe(true);
  expect(queryClient.getQueryState(getGetUserQueryKey(ada.id))?.isInvalidated).toBe(true);
});

test("a returned invalidation resolves the mutation only after the list is refetched", async () => {
  configureApi({ baseUrl: "https://api.test" });
  const queryClient = createQueryClient(() => {});
  let listRequests = 0;
  server.use(
    getListUsersMockHandler(() => {
      listRequests += 1;
      return { items: [], total: 0, ...firstPage };
    }),
    getCreateUserMockHandler(buildUser()),
  );
  await queryClient.query(getListUsersQueryOptions(firstPage));
  const list = new QueryObserver(queryClient, getListUsersQueryOptions(firstPage));
  const unsubscribe = list.subscribe(() => {});
  const create = new MutationObserver(
    queryClient,
    getCreateUserMutationOptions({
      mutation: {
        onSuccess: (_user, _variables, _onMutateResult, { client }) =>
          client.invalidateQueries({ queryKey: getListUsersQueryKey() }),
      },
    }),
  );

  await create.mutate({ data: { email: "ada@example.com", name: "Ada" } });

  expect(listRequests).toBe(2);
  unsubscribe();
});
```

In a component the same options go to `useMutation(getCreateUserMutationOptions({ mutation }))`;
`src/features/users/create-user-form.tsx` is the scaffold's complete example, with `meta: { silent:
true }` because the form shows its own errors (`frontend-forms`).

- Invalidate only what the mutation changed. Only active queries refetch at once; inactive ones are
  marked stale and refetch when next used.
- After an update of one entity, `getListUsersQueryKey()` covers both the lists and that entity's
  detail key. Use `getGetUserQueryKey(id)` alone when the lists cannot have changed. A delete is the
  exception: the deleted entity's detail must not be refetched (next section).
- `setQueryData` on the detail shows the server's answer at once, but does not save a request: the
  list invalidation refetches that detail too while it is on screen.
- A list off screen keeps its old rows for the loader's `staleTime: "static"` read, invalidated or
  not; removing the inactive entries makes that read wait for the server. The test below pins both.
- `mutateAsync` returns the data and rejects with the `ApiError`: use it where the caller continues
  (a form's submit handler, navigation to the new entity) and catches. `mutate` returns nothing and
  never rejects; the error lands in `mutation.error` and, where the QueryClient has the
  MutationCache notice (`createQueryClient` does), the toast; without one, render `mutation.error`.

```ts,verify,test
import { expect, test } from "vitest";
import { configureApi } from "@/api/fetcher";
import { getListUsersQueryKey, getListUsersQueryOptions } from "@/api/generated/api";
import { getListUsersMockHandler } from "@/api/generated/api.msw";
import { createQueryClient } from "@/app/query-client";
import { server } from "@/test/server";

const firstPage = { limit: 20, offset: 0 };

test("a loader's static read serves an invalidated list until it is removed", async () => {
  configureApi({ baseUrl: "https://api.test" });
  const queryClient = createQueryClient(() => {});
  let listRequests = 0;
  server.use(
    getListUsersMockHandler(() => {
      listRequests += 1;
      return { items: [], total: 0, ...firstPage };
    }),
  );
  const loaderRead = () =>
    queryClient.query({ ...getListUsersQueryOptions(firstPage), staleTime: "static" });
  await loaderRead();

  await queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });
  await loaderRead();
  expect(listRequests).toBe(1);

  queryClient.removeQueries({ queryKey: getListUsersQueryKey(), type: "inactive" });
  await loaderRead();
  expect(listRequests).toBe(2);
});
```

## A delete from the entity's own page

A delete started on `/users/$userId` must not leave the detail query mounted while the lists are
invalidated: the shared key refetches the deleted user, the 404 lands on a query that already has
data, and the QueryCache handler toasts "Could not refresh the data". In `onSuccess`, first
`await navigate({ to: "/users" })`, so the detail unmounts, then remove its entry with
`client.removeQueries({ queryKey: getGetUserQueryKey(id), exact: true })`, then return the list
invalidation. The test pins both orders; unsubscribing the observer stands in for the navigation.

```ts,verify,test
import { QueryObserver } from "@tanstack/react-query";
import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
import { configureApi } from "@/api/fetcher";
import {
  getGetUserQueryKey,
  getGetUserQueryOptions,
  getListUsersQueryKey,
  getListUsersQueryOptions,
} from "@/api/generated/api";
import { getGetUserMockHandler, getListUsersMockHandler } from "@/api/generated/api.msw";
import { createQueryClient } from "@/app/query-client";
import { buildUser } from "@/test/factories/user";
import { server } from "@/test/server";

const origin = "https://api.test";
const firstPage = { limit: 20, offset: 0 };

async function detailPageAfterDelete() {
  configureApi({ baseUrl: origin });
  const notify = vi.fn();
  const queryClient = createQueryClient(notify);
  server.use(
    getGetUserMockHandler(buildUser({ id: "u1" })),
    getListUsersMockHandler({ items: [], total: 0, ...firstPage }),
  );
  await queryClient.query(getGetUserQueryOptions("u1"));
  await queryClient.query(getListUsersQueryOptions(firstPage));
  const detail = new QueryObserver(queryClient, getGetUserQueryOptions("u1"));
  const leavePage = detail.subscribe(() => {});
  server.use(
    http.get(`${origin}/users/u1`, () =>
      HttpResponse.json({ error: "user not found" }, { status: 404 }),
    ),
  );
  return { notify, queryClient, leavePage };
}

test("invalidating while the detail is mounted toasts a failed refresh", async () => {
  const { notify, queryClient, leavePage } = await detailPageAfterDelete();

  await queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });

  expect(notify).toHaveBeenCalledWith("refresh", expect.anything());
  leavePage();
});

test("leaving, removing the detail, then invalidating stays quiet", async () => {
  const { notify, queryClient, leavePage } = await detailPageAfterDelete();

  leavePage();
  queryClient.removeQueries({ queryKey: getGetUserQueryKey("u1"), exact: true });
  await queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });

  expect(notify).not.toHaveBeenCalled();
  expect(queryClient.getQueryData(getGetUserQueryKey("u1"))).toBeUndefined();
});
```

The `onSuccess` of the delete mutation, with `navigate` from `Route.useNavigate()`:

```ts
onSuccess: async (_data, _variables, _onMutateResult, { client }) => {
  await navigate({ to: "/users" });
  client.removeQueries({ queryKey: getGetUserQueryKey(userId), exact: true });
  return client.invalidateQueries({ queryKey: getListUsersQueryKey() });
},
```

## Optimistic UI from the mutation's variables

The default: render the pending item from the variables, and let the invalidation replace it with the
server's row. Nothing to roll back. `useMutationState` reads it anywhere in the tree, so the list and
the form need not share a component.

```tsx,verify
// file: src/features/users/pending-users.tsx
import { useMutationState } from "@tanstack/react-query";
import { type CreateUserMutationVariables, getCreateUserMutationKey } from "@/api/generated/api";

export function PendingUsers() {
  const pending = useMutationState({
    filters: { mutationKey: getCreateUserMutationKey(), status: "pending" },
    // `variables` is typed `unknown`; the mutationKey filter guarantees this shape.
    select: (mutation) => mutation.state.variables as CreateUserMutationVariables,
  });
  return pending.map(({ data }) => (
    <li key={data.email} className="text-muted">
      {data.name}
    </li>
  ));
}
```

Inside the component that owns the mutation, `mutation.isPending && mutation.variables` is enough.
The generated mutation options always set `mutationKey: ['createUser']`, which is what the filter
matches.

## Optimistic UI in the cache

Write to the cache only when the target query is certainly cached and the change is easy to
reproduce on the client (a toggle, a rename on a detail page). Cancel the in-flight refetch first or
it overwrites the optimistic value, return the snapshot from `onMutate`, restore it in `onError`, and
invalidate in `onSettled` either way.

```ts,verify
// file: src/features/users/use-create-user-optimistic.ts
import { useMutation } from "@tanstack/react-query";
import {
  getCreateUserMutationOptions,
  getListUsersQueryKey,
  type ListUsersParams,
  type PageUserResponse,
} from "@/api/generated/api";

export function useCreateUserOptimistic(params: ListUsersParams) {
  const queryKey = getListUsersQueryKey(params);
  return useMutation(
    getCreateUserMutationOptions({
      mutation: {
        onMutate: async ({ data }, { client }) => {
          await client.cancelQueries({ queryKey });
          const previous = client.getQueryData<PageUserResponse>(queryKey);
          const optimistic = { ...data, id: `pending:${data.email}`, created_at: "" };
          client.setQueryData<PageUserResponse>(
            queryKey,
            (page) =>
              page && { ...page, items: [optimistic, ...page.items], total: page.total + 1 },
          );
          return { previous };
        },
        onError: (_error, _variables, onMutateResult, { client }) => {
          client.setQueryData(queryKey, onMutateResult?.previous);
        },
        onSettled: (_user, _error, _variables, _onMutateResult, { client }) =>
          client.invalidateQueries({ queryKey: getListUsersQueryKey() }),
      },
    }),
  );
}
```

The third callback argument is `onMutate`'s return value (`onMutateResult`); the fourth is the
context `{ client, meta, mutationKey }`. Older v5 code that names the third argument `context`, or
calls `useQueryClient()` only to reach the client, is the previous shape.

## Pagination

The URL carries a 1-based `page`; the API takes `limit` and `offset`. The scaffold maps one to the
other in `src/features/users/pagination.ts` and the route passes the result to the getter, so each
page is its own cache entry (`['users', { limit: 20, offset: 40 }]`) and Back shows a cached page at
once.

```ts
export function toListParams(page: number) {
  return { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
}
```

The scaffold's envelope is `{ items, total, limit, offset }`, and `pageCount` in the same file
returns `Math.max(1, Math.ceil(total / limit))`. A URL-driven list needs no `placeholderData`: the
router keeps the previous page on screen while the next loader runs. `placeholderData:
keepPreviousData` is for a `useQuery` list whose params live in component state.

A backend that pages by `page` and `page_size` takes the URL's page as is, so `toListParams` goes;
`pageCount` divides its `total` by the page size the request sent, or reads a page count when the
generated envelope type has one.

## Infinite lists

Build infinite options with `infiniteQueryOptions` around the generated `listUsers` function. orval's
per-operation `useInfinite: true` stays off: at orval 8.48 it keys the query
`['infinite', 'users', params]`, outside the `['users']` prefix that `getListUsersQueryKey()`
invalidates, and casts its options so a missing `initialPageParam` or `getNextPageParam` still
compiles.

```ts,verify
// file: src/features/users/user-pages.ts
import { infiniteQueryOptions } from "@tanstack/react-query";
import { getListUsersQueryKey, listUsers, type PageUserResponse } from "@/api/generated/api";

const PAGE_SIZE = 20;

const nextOffset = (last: PageUserResponse) =>
  last.offset + last.limit < last.total ? last.offset + last.limit : undefined;

export const userPagesQueryOptions = () =>
  infiniteQueryOptions({
    // Under the list prefix, so getListUsersQueryKey() invalidates it together with the lists.
    queryKey: [...getListUsersQueryKey({ limit: PAGE_SIZE }), "infinite"],
    queryFn: ({ pageParam, signal }) =>
      listUsers({ limit: PAGE_SIZE, offset: pageParam }, { signal }),
    initialPageParam: 0,
    getNextPageParam: nextOffset,
  });
```

A component reads it with `useSuspenseInfiniteQuery(userPagesQueryOptions())` and calls
`fetchNextPage()` while `hasNextPage`; a loader fills it with
`queryClient.infiniteQuery({ ...userPagesQueryOptions(), staleTime: "static" })`.

```ts,verify,test
import { QueryClient } from "@tanstack/react-query";
import { expect, test } from "vitest";
import { configureApi } from "@/api/fetcher";
import { getListUsersQueryKey } from "@/api/generated/api";
import { getListUsersMockHandler } from "@/api/generated/api.msw";
import { userPagesQueryOptions } from "@/features/users/user-pages";
import { buildUser } from "@/test/factories/user";
import { server } from "@/test/server";

test("pages advance by offset and the list key getter invalidates them", async () => {
  configureApi({ baseUrl: "https://api.test" });
  const offsets: (string | null)[] = [];
  server.use(
    getListUsersMockHandler(({ request }) => {
      const offset = new URL(request.url).searchParams.get("offset");
      offsets.push(offset);
      return { items: [buildUser()], total: 30, limit: 20, offset: Number(offset) };
    }),
  );
  const queryClient = new QueryClient();

  const data = await queryClient.infiniteQuery({ ...userPagesQueryOptions(), pages: 2 });
  await queryClient.invalidateQueries({ queryKey: getListUsersQueryKey(), refetchType: "none" });

  expect(offsets).toEqual(["0", "20"]);
  expect(data.pageParams).toEqual([0, 20]);
  expect(queryClient.getQueryState(userPagesQueryOptions().queryKey)?.isInvalidated).toBe(true);
});
```

## An endpoint outside openapi.json

The fix is to get the endpoint into the backend's document. Until then, call `apiFetch` directly, so
the base URL, token and `ApiError` still apply, and pass the query's `signal`:

```ts,verify
// file: src/features/users/server-version.ts
import { queryOptions } from "@tanstack/react-query";
import { apiFetch } from "@/api/fetcher";

// TODO: replace with the generated getter once the backend documents GET /version.
export const serverVersionQueryOptions = queryOptions({
  queryKey: ["version"],
  queryFn: ({ signal }) => apiFetch<{ version: string }>("/version", { signal }),
});
```

A dynamic segment in such a path goes through `encodeURIComponent`, as the generated client's
`urlEncodeParameters` does: `` apiFetch(`/files/${encodeURIComponent(name)}/meta`, { signal }) ``.
The one hand-written key in an app belongs to an endpoint like this one, and it goes away with it.
This is a stopgap for a read; a write goes through the generated `getXMutationOptions` once the
backend documents it.

## Older v5 and v4 names

| Older examples write | Correct now |
|---|---|
| `onSuccess` / `onError` on `useQuery` | removed in v5; react in the cache handlers or render from `error` |
| `cacheTime` | `gcTime` |
| `keepPreviousData: true` | `placeholderData: keepPreviousData` |
| `isInitialLoading`, `isCancelledError()` | `isLoading`, `instanceof CancelledError` |
