# Search params and loaders

## Contents

- How the router reads and writes search values
- Schema rules
- A free-text search box
- A complete route: ids in the URL, parallel and deferred loads, not found
- What its test proves
- Loader shapes

## How the router reads and writes search values

Parsing has two steps. The query-string decoder turns `true` and `false` into booleans and a value into a number when the number prints back exactly as written (`?q=42` is `42`, `?q=1.50` stays text), and a repeated key into an array. Then the router's parser runs on each value that is still text: by default `JSON.parse`, keeping the text when it throws, so `?q=1.50` becomes `1.5`, `?q=1e3` becomes `1000` and an id past 2^53 becomes another number. `createAppRouter` passes `parseSearch: parseSearchWith(exactJson)` and `stringifySearch: stringifySearchWith(JSON.stringify, exactJson)`, where `exactJson` rejects a parsed number that does not print back as the raw text; numbers then come only from the decoder, while quoted strings, `null`, arrays and objects still parse. Measured with `router.state.location.search` through `createAppRouter`:

| URL | `search` |
|---|---|
| `?q=42` | `{ q: 42 }` |
| `?t=true` | `{ t: true }` |
| `?u=abc` | `{ u: "abc" }` |
| `?s=%2242%22` | `{ s: "42" }` |
| `?q=1.50` | `{ q: "1.50" }` (default parser: `1.5`) |
| `?q=1e3` | `{ q: "1e3" }` (default parser: `1000`) |
| `?id=12345678901234567890` | `{ id: "12345678901234567890" }` (default parser: `12345678901234567000`) |

Writing goes the other way: `navigate({ search: { q: "42", n: 5, a: "1.50" } })` produces `?q=%2242%22&n=5&a=1.50`. So a schema key that holds text or an id must still accept a number (`z.coerce.string()`), because `?q=42` stays the number `42`; with `z.string()` plus `.catch(undefined)`, `?q=42` silently becomes "no query". A project on the default parser keeps `z.coerce.string()` and loses the three text rows above; adopting `exactJson` is one change in its router factory.

## Schema rules

- Pass the zod schema itself to `validateSearch`; the router reads it as a Standard Schema.
- Every key `.optional().catch(undefined)`: one bad key falls back alone instead of failing the whole route into `RouteError`.
- Defaults live at the read (`search.page ?? 1`) and the default value is written as `undefined`, so one page has one URL. `search: { middlewares: [stripSearchParams({ page: 1 })] }` is the alternative when many links write the default.
- Numbers: `z.int().min(1)`; enums: `z.enum(["name", "-created_at"])`; booleans arrive as booleans (`z.boolean()`).
- A schema reused by several routes lives in the feature (`@/features/<domain>/<domain>-search.ts`), never exported from a route file.

## A free-text search box

The box is uncontrolled: it holds the draft, and the URL changes only on submit. A box whose `value` is the URL's `q` shows whatever the schema returned, so a schema that trims eats the space the user just typed; trim on submit instead. `key={q}` remounts the input when the URL changes under it (Back, a link). Submitting replaces the history entry and resets the page.

The scaffold's `ListUsersParams` has no `q`; these blocks assume the backend added one and orval regenerated it as `q?: string`. The optional key goes into the API params only when it is set, because a bare `q: search.q` fails `exactOptionalPropertyTypes`.

```tsx,verify
// file: src/features/users/user-search.tsx
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

export function UserSearch({
  q,
  onSearch,
}: {
  q: string | undefined;
  onSearch: (q: string | undefined) => void;
}) {
  return (
    <form
      key={q}
      aria-label="Search users"
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const value = String(new FormData(event.currentTarget).get("q") ?? "").trim();
        onSearch(value || undefined);
      }}
    >
      <TextField label="Name" name="q" type="search" defaultValue={q ?? ""} />
      <Button type="submit">Search</Button>
    </form>
  );
}
```

The scaffold's `src/routes/users/index.tsx` with `q` added:

```tsx,verify
// file: src/routes/users/index.tsx
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import * as z from "zod";
import { getListUsersQueryOptions, getListUsersSuspenseQueryOptions } from "@/api/generated/api";
import { pageCount, toListParams } from "@/features/users/pagination";
import { UserSearch } from "@/features/users/user-search";
import { UserTable } from "@/features/users/user-table";
import { loadQuery } from "@/shared/lib/load-query";

// `.catch(undefined)`: a hand-edited URL falls back to the first page instead of failing.
const searchSchema = z.object({
  page: z.int().min(1).optional().catch(undefined),
  q: z.coerce.string().min(1).optional().catch(undefined),
});

export const Route = createFileRoute("/users/")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({
    ...toListParams(search.page ?? 1),
    ...(search.q !== undefined && { q: search.q }),
  }),
  // Same key and fetch as the component's suspense options; `loadQuery` rejects those under
  // exactOptionalPropertyTypes.
  loader: async ({ context, deps }) => {
    const users = await loadQuery(context.queryClient, getListUsersQueryOptions(deps));
    // A page past the end (an edited URL, the last user on it deleted) opens the last page.
    if (users.items.length === 0 && deps.offset > 0) {
      const last = pageCount(users);
      throw redirect({
        to: "/users",
        search: (prev) => ({ ...prev, page: last > 1 ? last : undefined }),
        replace: true,
      });
    }
    return users;
  },
  component: UsersPage,
});

function UsersPage() {
  const params = Route.useLoaderDeps();
  const page = Route.useSearch({ select: (search) => search.page ?? 1 });
  const q = Route.useSearch({ select: (search) => search.q });
  const navigate = Route.useNavigate();
  const { data } = useSuspenseQuery(getListUsersSuspenseQueryOptions(params));
  const pages = pageCount(data);

  return (
    <div data-testid="users-list-page" className="flex flex-col gap-4">
      <title>Users</title>
      <h1 className="font-semibold text-2xl">Users</h1>
      <UserSearch
        q={q}
        onSearch={(next) =>
          navigate({ search: (prev) => ({ ...prev, q: next, page: undefined }), replace: true })
        }
      />
      <UserTable users={data.items} />
      <nav aria-label="Pagination" className="flex items-center gap-4">
        <Link
          from={Route.fullPath}
          search={(prev) => ({ ...prev, page: page > 2 ? page - 1 : undefined })}
          disabled={page <= 1}
        >
          Previous
        </Link>
        <span>
          Page {page} of {pages}
        </span>
        <Link
          from={Route.fullPath}
          search={(prev) => ({ ...prev, page: page + 1 })}
          disabled={page >= pages}
        >
          Next
        </Link>
      </nav>
    </div>
  );
}
```

Changed from the scaffold: the `q` key, the `loaderDeps` spread, `UserSearch`, and search updaters that keep `q` in the redirect and the pagination links. Its test types a two-word name. A box controlled from `q` (`value={q ?? ""}`, navigating on every change) over a schema with `.trim()` fails the first assertion with "adalovelace".

```tsx,verify,test
// file: src/routes/users/search.test.tsx
import { screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { getListUsersMockHandler } from "@/api/generated/api.msw";
import { buildUser } from "@/test/factories/user";
import { renderRoute } from "@/test/render-route";
import { server } from "@/test/server";

test("a search keeps the typed text, replaces the entry and opens the first page", async () => {
  const requested: string[] = [];
  server.use(
    getListUsersMockHandler(({ request }) => {
      const url = new URL(request.url);
      requested.push(url.search);
      const offset = Number(url.searchParams.get("offset"));
      return { items: [buildUser({ name: "Ada Lovelace" })], total: 45, limit: 20, offset };
    }),
  );
  const { user, router } = renderRoute("/users?page=2");

  await user.type(await screen.findByRole("searchbox", { name: "Name" }), " ada lovelace");
  expect(screen.getByRole("searchbox", { name: "Name" })).toHaveValue(" ada lovelace");
  await user.keyboard("{Enter}");

  expect(await screen.findByText("Page 1 of 3")).toBeInTheDocument();
  expect(router.state.location.search).toEqual({ q: "ada lovelace" });
  expect(screen.getByRole("searchbox", { name: "Name" })).toHaveValue("ada lovelace");
  expect(requested).toEqual(["?limit=20&offset=20", "?limit=20&offset=0&q=ada+lovelace"]);
  expect(router.history.length).toBe(1);
});
```

## A complete route: ids in the URL, parallel and deferred loads, not found

`/users/compare?a=<id>&b=<id>` shows two users side by side and, below them, the five newest users, which the page can render without.

```tsx,verify
// file: src/routes/users/compare.tsx
import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import * as z from "zod";
import { ApiError } from "@/api/api-error";
import {
  getGetUserQueryOptions,
  getGetUserSuspenseQueryOptions,
  getListUsersQueryOptions,
} from "@/api/generated/api";
import { UserDetails } from "@/features/users/user-details";
import { loadQuery } from "@/shared/lib/load-query";

const NEWEST = { limit: 5, offset: 0 };

// The router turns `?a=42` into a number, so ids are coerced to strings.
const searchSchema = z.object({
  a: z.coerce.string().optional().catch(undefined),
  b: z.coerce.string().optional().catch(undefined),
});

export const Route = createFileRoute("/users/compare")({
  validateSearch: searchSchema,
  loaderDeps: ({ search }) => ({ ids: [search.a, search.b].filter((id) => id !== undefined) }),
  loader: async ({ context, deps }) => {
    // Started before the first `await`, so it runs alongside the awaited reads.
    void loadQuery(context.queryClient, getListUsersQueryOptions(NEWEST)).catch(() => undefined);
    try {
      await Promise.all(
        deps.ids.map((id) => loadQuery(context.queryClient, getGetUserQueryOptions(id))),
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) throw notFound();
      throw error;
    }
  },
  component: ComparePage,
  notFoundComponent: UserNotFound,
});

function ComparePage() {
  const { ids } = Route.useLoaderDeps();

  return (
    <>
      <title>Compare users</title>
      <h1 className="font-semibold text-2xl">Compare users</h1>
      {ids.length < 2 ? <p>Pick two users to compare.</p> : null}
      <div className="grid gap-6 sm:grid-cols-2">
        {ids.map((id) => (
          <UserColumn key={id} id={id} />
        ))}
      </div>
      <Link from={Route.fullPath} search={(prev) => ({ a: prev.b, b: prev.a })}>
        Swap
      </Link>
      <NewestUsers />
    </>
  );
}

function UserColumn({ id }: { id: string }) {
  const { data: user } = useSuspenseQuery(getGetUserSuspenseQueryOptions(id));

  return (
    <section aria-label={user.name}>
      <h2 className="font-semibold text-xl">{user.name}</h2>
      <UserDetails user={user} />
    </section>
  );
}

function NewestUsers() {
  const { data, isPending, isError } = useQuery(getListUsersQueryOptions(NEWEST));
  if (isPending) return <p aria-busy="true">Loading the newest users…</p>;
  if (isError) return <p>The newest users could not be loaded.</p>;

  return (
    <section aria-label="Newest users">
      <h2 className="font-semibold text-xl">Newest users</h2>
      <ul>
        {data.items.map((user) => (
          <li key={user.id}>{user.name}</li>
        ))}
      </ul>
    </section>
  );
}

function UserNotFound() {
  return (
    <>
      <title>User not found</title>
      <h1 className="font-semibold text-2xl">User not found</h1>
      <Link to="/users">Back to users</Link>
    </>
  );
}
```

Points to copy:

- `loaderDeps` returns only what the loader uses; the loader re-runs when the returned value changes, so returning the whole `search` re-runs it for keys it never reads.
- `UserColumn` and `NewestUsers` are module-level, unexported components, so they split with `ComparePage`; a component defined inside another is a Biome error (`noNestedComponentDefinitions`).
- The search updater receives the validated search and returns the next one, typed by the schema.

## What its test proves

How to write route tests belongs to `frontend-testing`; this one is evidence for the rules above. Replacing `z.coerce.string()` with `z.string()` fails the third test; moving the `void loadQuery(...)` line below the `try` fails the second; reading with `query({ ...options, staleTime: "static" })` or removing `defaultStaleReloadMode: "blocking"` from `createAppRouter` fails the last.

```tsx,verify,test
// file: src/routes/users/compare.test.tsx
import { act, screen } from "@testing-library/react";
import { delay, HttpResponse, http } from "msw";
import { beforeEach, expect, test } from "vitest";
import { getGetUserMockHandler, getListUsersMockHandler } from "@/api/generated/api.msw";
import { buildUser } from "@/test/factories/user";
import { renderRoute, TEST_API_ORIGIN } from "@/test/render-route";
import { server } from "@/test/server";

beforeEach(() => {
  server.use(getListUsersMockHandler({ items: [], total: 0, limit: 5, offset: 0 }));
});

test("loads both users named in the URL", async () => {
  server.use(
    getGetUserMockHandler(({ params }) =>
      buildUser({ id: String(params.id), name: `User ${params.id}` }),
    ),
  );

  renderRoute("/users/compare?a=ada&b=grace");

  expect(await screen.findByRole("heading", { name: "User ada" })).toBeInTheDocument();
  expect(screen.getByRole("heading", { name: "User grace" })).toBeInTheDocument();
});

test("the page paints before the deferred list, whose request started with the awaited ones", async () => {
  const { promise: listAnswered, resolve: answerList } = Promise.withResolvers<void>();
  let listRequested = false;
  const listSeenByUserAnswers: boolean[] = [];
  server.use(
    getListUsersMockHandler(async () => {
      listRequested = true;
      await listAnswered;
      return { items: [buildUser({ name: "Newest Ada" })], total: 1, limit: 5, offset: 0 };
    }),
    getGetUserMockHandler(async ({ params }) => {
      await delay(20);
      listSeenByUserAnswers.push(listRequested);
      return buildUser({ id: String(params.id), name: `User ${params.id}` });
    }),
  );

  renderRoute("/users/compare?a=ada&b=grace");

  expect(await screen.findByRole("heading", { name: "User ada" })).toBeInTheDocument();
  expect(screen.getByText("Loading the newest users…")).toBeInTheDocument();
  expect(listSeenByUserAnswers).toEqual([true, true]);
  answerList();
  expect(await screen.findByText("Newest Ada")).toBeInTheDocument();
});

test("an id that looks like a number is still requested as a string", async () => {
  const requested: string[] = [];
  server.use(
    getGetUserMockHandler(({ params }) => {
      requested.push(String(params.id));
      return buildUser({ id: String(params.id), name: `User ${params.id}` });
    }),
  );

  renderRoute("/users/compare?a=42&b=43");

  expect(await screen.findByRole("heading", { name: "User 42" })).toBeInTheDocument();
  expect(requested.toSorted()).toEqual(["42", "43"]);
});

test("an unknown id shows the not-found page", async () => {
  server.use(
    http.get(`${TEST_API_ORIGIN}/users/:id`, () =>
      HttpResponse.json({ error: "user not found" }, { status: 404 }),
    ),
  );

  renderRoute("/users/compare?a=ada&b=nobody");

  expect(await screen.findByRole("heading", { name: "User not found" })).toBeInTheDocument();
});

test("a failed load shows the error screen inside the layout", async () => {
  server.use(
    http.get(`${TEST_API_ORIGIN}/users/:id`, () =>
      HttpResponse.json({ error: "internal server error", request_id: "req-1" }, { status: 500 }),
    ),
  );

  renderRoute("/users/compare?a=ada&b=grace");

  expect(await screen.findByRole("alert")).toHaveTextContent("Request id: req-1");
  expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
});

test("Swap exchanges the two ids in the URL", async () => {
  server.use(
    getGetUserMockHandler(({ params }) =>
      buildUser({ id: String(params.id), name: `User ${params.id}` }),
    ),
  );
  const { user, router } = renderRoute("/users/compare?a=ada&b=grace");

  await user.click(await screen.findByRole("link", { name: "Swap" }));

  expect(router.state.location.search).toEqual({ a: "grace", b: "ada" });
});

test("a revisit after an invalidation paints the fresh data first", async () => {
  let adaName = "Ada Lovelace";
  server.use(
    getGetUserMockHandler(async ({ params }) => {
      // Slower than a paint, so a page painted from the invalidated cache would be seen.
      if (adaName !== "Ada Lovelace") await delay(100);
      return buildUser({ id: String(params.id), name: params.id === "ada" ? adaName : "Grace" });
    }),
  );
  const { user, router } = renderRoute("/users/compare?a=ada&b=grace");
  await screen.findByRole("heading", { name: "Ada Lovelace" });
  await user.click(screen.getByRole("link", { name: "Users" }));
  await screen.findByRole("heading", { name: "Users" });

  adaName = "Ada King";
  await router.options.context.queryClient.invalidateQueries();
  act(() => router.history.back());

  await screen.findByRole("heading", { name: "Compare users" });
  expect(screen.getByRole("heading", { name: "Ada King" })).toBeInTheDocument();
});
```

## Loader shapes

The rule for what to await and what to defer is in `SKILL.md` under Loaders; these are the forms.

| Need | Loader |
|---|---|
| one resource the page renders | `await loadQuery(context.queryClient, getXQueryOptions(deps))` (returning it changes nothing) |
| several resources the page shows on arrival | one `await Promise.all([...])` of the same calls |
| a resource that may be missing | the detail form below |
| a second resource that needs the first | await the first, then the second; or let the component fetch the second with `useQuery` |
| data the page can render without | `void loadQuery(...).catch(() => undefined)` before the first `await`; the component reads it with `useQuery` and renders its own pending and error state |
| nothing from the API | no loader |

A route that takes an id from the path checks it with the generated params schema before any request, and turns a 404 into its `notFoundComponent`; any other error is rethrown to `RouteError`:

```tsx
if (!GetUserParams.safeParse({ id: params.userId }).success) throw notFound();
try {
  await loadQuery(context.queryClient, getGetUserQueryOptions(params.userId));
} catch (error) {
  if (error instanceof ApiError && error.status === 404) throw notFound();
  throw error;
}
```

A loader may return what it fetched (the users list loader does), but no component reads it with `Route.useLoaderData()`: that value is a snapshot, while `useSuspenseQuery` follows refetches and invalidations.
