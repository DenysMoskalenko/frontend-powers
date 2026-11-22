# Route integration tests

## Contents

- [What renderRoute builds](#what-renderroute-builds)
- [The setup file](#the-setup-file)
- [MSW 3 recipes](#msw-3-recipes)
- [Queries for this stack](#queries-for-this-stack)
- [Factories](#factories)
- [Verified examples](#verified-examples)
- [A unit test and a config test](#a-unit-test-and-a-config-test)

## What renderRoute builds

`src/test/render-route.tsx`, as the scaffold ships it:

```tsx
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureApi } from "@/api/fetcher";
import { createAppRouter } from "@/app/router";

/** The API origin route tests run against; MSW answers it. */
export const TEST_API_ORIGIN = "https://api.test";

/**
 * Renders the whole app at `path`: the real route tree, a fresh QueryClient, the app's providers.
 * Only the network is fake (MSW, per test).
 */
export function renderRoute(path: string) {
  configureApi({ baseUrl: TEST_API_ORIGIN });
  const router = createAppRouter({ history: createMemoryHistory({ initialEntries: [path] }) });
  const { queryClient } = router.options.context;
  // The app's defaults minus retries: a failed request shows its error at once, not after backoff.
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  const user = userEvent.setup();
  render(<RouterProvider router={router} />);
  return { user, router };
}
```

- `createAppRouter` is the function `main.tsx` calls, so a provider added to its `Wrap` reaches the tests with no change here. Never add providers to `renderRoute` or wrap a component in hand-made ones.
- Each call resets `configureApi` to its defaults, so a token getter set by an earlier test in the file is gone. Session setup in tests is `keycloak-spa-auth`'s.
- Mutations never retry in the app; queries do in the app and not here.
- `router.state.location` holds `pathname`, `search` (parsed, so `{ page: 2 }`, not `"?page=2"`) and `hash`.
- `router.options.context.queryClient` is the client. Reach for it only to drive a state the UI cannot reach in a test (for example `invalidateQueries()` to force a refetch); never assert on cache contents.
- Returns `{ user, router }`; an add-on may add its own value and options (`i18n`, `session`, `language`). Query through `screen`; there is no `container`.

## The setup file

`src/test/setup.ts`, as the scaffold ships it; `src/test/server.ts` is `setupServer()` with no handlers:

```ts
import "@testing-library/jest-dom/vitest";
import { faker } from "@faker-js/faker";
import { configure } from "@testing-library/dom";
import { cleanup } from "@testing-library/react";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { server } from "./server";

// The bound only ends a hang; a loaded CI machine must never reach it.
configure({ asyncUtilTimeout: 5_000 });
// jsdom has no layout; the router restores scroll after every navigation.
window.scrollTo = () => {};

const unhandled: string[] = [];
server.events.on("request:unhandled", ({ request }) => {
  unhandled.push(`${request.method} ${request.url}`);
});

// jsdom's reportError only logs to the virtual console. This one records the error, and the test
// fails unless it stubs reportError.
const reported: unknown[] = [];
globalThis.reportError = (error: unknown) => {
  reported.push(error);
};

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
beforeEach(() => {
  // Same data whatever the shuffle order, so a failure reproduces.
  faker.seed(20_261_119);
});
afterEach(() => {
  // `globals: false` turns off Testing Library's automatic cleanup.
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
  // Also undoes a bare vi.setSystemTime(), which no config option resets.
  vi.useRealTimers();
  server.resetHandlers();
  // The app may turn a failed request into an error screen and the test still pass: fail it here.
  const requests = unhandled.splice(0);
  const errors = reported.splice(0);
  if (requests.length > 0)
    throw new Error(`Requests without an MSW handler: ${requests.join(", ")}`);
  if (errors.length > 0) throw new AggregateError(errors, "The app called reportError");
});
afterAll(() => server.close());
```

- The unhandled-request check is needed beside `onUnhandledFrame: "error"`: that option alone only makes `fetch` reject, `RouteError` (the router's `defaultErrorComponent`) renders the failure, and a test that asserts on something else passes. The failure reads `Requests without an MSW handler: GET https://api.test/users?limit=20&offset=0`.
- jsdom 31 has a `reportError` of its own, which only dispatches an `error` event and logs to the virtual console, so a reported error would pass the test. The recording one fails a test that reports unexpectedly. `renderRoute` renders without `rootErrorHandlers`, so a failed loader that shows `RouteError` reports nothing here: its test needs no stub. Vitest prints the `AggregateError` as its inner errors, so the failure shows the app's own error, once per report. A test that expects a report replaces it with `vi.stubGlobal("reportError", vi.fn())` and asserts on that stub, as `src/app/error-reporting.test.ts` does; `unstubGlobals` puts the recording one back for the next test.
- When a test both missed a handler and reported, only the request failure is thrown; fix it and rerun.
- `localStorage` and `sessionStorage` are cleared after every test, so a remembered choice (a theme, a return path) never leaks into the next test under the shuffled order; a test that needs a stored value writes it in its arrange block. `src/test/setup.test.ts` pins this with a `describe(..., { shuffle: false })` pair.

## MSW 3 recipes

| Need | Write |
|---|---|
| A success answer | `server.use(getListUsersMockHandler({ items: [ada], total: 1, limit: 20, offset: 0 }))` |
| An answer computed from the request | `getListUsersMockHandler(({ request }) => ({ ...page, offset: Number(new URL(request.url).searchParams.get("offset")) }))` |
| The request body the app sent | `getCreateUserMockHandler(async ({ request }) => { posted.push(await request.json()); return ada; })`, then `expect(posted).toEqual([{ name: "Ada", email: "ada@example.com" }])` |
| The query string the app sent | push `new URL(request.url).search` and compare to `["?limit=20&offset=20"]` |
| A header the app sent | `request.headers.get("authorization")` inside the resolver |
| An error status | `http.get(\`${TEST_API_ORIGIN}/users/:id\`, () => HttpResponse.json({ error: "user 1 not found" }, { status: 404 }))` |
| A failure, then success | the error handler with `{ once: true }` as third argument, followed by the success handler in the same `server.use` |
| Create, then list shows it | a closure array both handlers share (example below) |
| Nothing for an endpoint | omit it; the unhandled-request check names it if the page calls it |

- The generated handlers in `src/api/generated/api.msw.ts` match `*/users` on any origin and answer the first 2xx status of the operation. Called without an argument they return faker strings such as a 10-to-20-letter `name`, so a test never asserts on, or even renders against, one called without data. `getAppMock()` is that random set; never pass it to `setupServer`.
- Error answers use `TEST_API_ORIGIN` and the body the backend really sends (axum `{ error, request_id, details }`, FastAPI `{ detail }`, or RFC 9457), because `ApiError` is built from it: `request_id` becomes the "Request id" the UI prints, `details` the field errors. The mapping is `tanstack-query-api`'s.
- Later `server.use` calls take precedence over earlier ones; `server.resetHandlers()` in setup drops them all after each test.
- Handlers declared inside the test, in its arrange block; a module-level `beforeEach(() => server.use(...))` hides which endpoints a test depends on.
- The one exception: a request the root layout makes on every page (a notification feed, `/me`) runs in every route test, because `renderRoute` always renders `__root.tsx`. Answer its neutral case once, in the setup's `beforeEach`; `resetHandlers` drops it after each test, and a test of that request declares its own `server.use`, which takes precedence. Nothing else goes there:

```ts
// src/test/setup.ts: add `import { HttpResponse, http } from "msw";` and
// `import { TEST_API_ORIGIN } from "./render-route";`
beforeEach(() => {
  // Same data whatever the shuffle order, so a failure reproduces.
  faker.seed(20_261_119);
  // The root layout reads the signed-in user on every page; a test of that request declares its own.
  server.use(http.get(`${TEST_API_ORIGIN}/me`, () => HttpResponse.json({ name: "Test user" })));
});
```

The stateful create-then-list handlers, from the scaffold's `src/routes/users/new.test.tsx`:

```tsx
const ada = buildUser({ name: "Ada Lovelace", email: "ada@example.com" });
const stored: UserResponse[] = [];
const posted: unknown[] = [];
server.use(
  getListUsersMockHandler(() => ({ items: stored, total: stored.length, limit: 20, offset: 0 })),
  getCreateUserMockHandler(async ({ request }) => {
    posted.push(await request.json());
    stored.push(ada);
    return ada;
  }),
  getGetUserMockHandler(ada),
);
```

## Queries for this stack

| Element | Query |
|---|---|
| Page heading | `findByRole("heading", { name: "Users" })` |
| Document title | `expect(document.title).toBe("Users")`, once per page; each page renders React 19's `<title>` |
| Table, row, cell link | `findByRole("table", { name: "Users" })`, then `within(table).getByRole("row", { name: /Ada Lovelace/ })` |
| Text field | `getByRole("textbox", { name: "Email" })`; the name is the Base UI `Field.Label` |
| Field error | `expect(field).toHaveAccessibleDescription("Invalid email address")`; `Field.Error` is wired as the control's description. Invalid state: `toHaveAttribute("aria-invalid", "true")` |
| Focus after a failed submit | `await waitFor(() => expect(nameField).toHaveFocus())`; the form focuses the first invalid field in a `requestAnimationFrame` |
| Form-level error, route error | `findByRole("alert")`; the form error and `RouteError` render `role="alert"` |
| Toast | `findByText("Could not refresh the data")`, or `findByRole("dialog", { name: "Could not refresh the data" })`: a Base UI `Toast.Root` is a non-modal dialog named by its title. Its `Toast.Close` is `aria-hidden` until the stack is hovered or focused: `await user.hover(toast)`, then `getByRole("button", { name: "Dismiss" })` |
| A disabled TanStack `Link` | `getByRole("link", { name: "Next" })` with `toHaveAttribute("aria-disabled", "true")`; it renders without `href` |
| An empty state | `findByText("No users yet.")` |
| An element that is gone | `expect(screen.queryByText("…")).not.toBeInTheDocument()` |

A query that finds nothing by role means the markup lacks a role or an accessible name: fix the component, not the query. `getByTestId` needs a one-line reason, such as a canvas.

## Factories

`src/test/factories/<entity>.ts`, one exported `build<Entity>` per API type, typed from the generated client:

```ts
import { faker } from "@faker-js/faker";
import type { UserResponse } from "@/api/generated/api";

/** A valid user; pass every field a test asserts on. */
export function buildUser(overrides: Partial<UserResponse> = {}): UserResponse {
  return {
    id: faker.string.uuid(),
    email: faker.internet.email(),
    name: faker.person.fullName(),
    created_at: "2026-11-01T09:30:00Z",
    ...overrides,
  };
}
```

- Fields a test asserts on are passed explicitly, even when the seed would make them stable today: a new field added above them changes every later faker value.
- Timestamps are literals, not faker dates, so formatted dates are assertable under `TZ=UTC`.
- `faker.seed(20_261_119)` runs in the setup's `beforeEach`, so values do not depend on the shuffled order.
- A paged response is built inline (`{ items: [ada], total: 1, limit: 20, offset: 0 }`); no factory for envelopes.

## Verified examples

Navigation from a list into a detail page, asserted on the rendered page and the router location:

```tsx,verify,test
import { screen, within } from "@testing-library/react";
import { expect, test } from "vitest";
import { getGetUserMockHandler, getListUsersMockHandler } from "@/api/generated/api.msw";
import { buildUser } from "@/test/factories/user";
import { renderRoute } from "@/test/render-route";
import { server } from "@/test/server";

test("a name in the user list opens that user's page", async () => {
  const ada = buildUser({ name: "Ada Lovelace", email: "ada@example.com" });
  server.use(
    getListUsersMockHandler({ items: [ada], total: 1, limit: 20, offset: 0 }),
    getGetUserMockHandler(ada),
  );
  const { user, router } = renderRoute("/users");

  const table = await screen.findByRole("table", { name: "Users" });
  await user.click(within(table).getByRole("link", { name: "Ada Lovelace" }));

  expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  expect(router.state.location.pathname).toBe(`/users/${ada.id}`);
});
```

An error state: the backend's error body, the request the app sent, and what the user sees:

```tsx,verify,test
import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { renderRoute, TEST_API_ORIGIN } from "@/test/render-route";
import { server } from "@/test/server";

test("a server error on create keeps the form and says the user was not created", async () => {
  const posted: unknown[] = [];
  server.use(
    http.post(`${TEST_API_ORIGIN}/users`, async ({ request }) => {
      posted.push(await request.json());
      return HttpResponse.json(
        { error: "internal server error", request_id: "req-3" },
        { status: 500 },
      );
    }),
  );
  const { user } = renderRoute("/users/new");

  await user.type(await screen.findByRole("textbox", { name: "Name" }), "Ada");
  await user.type(screen.getByRole("textbox", { name: "Email" }), "ada@example.com");
  await user.click(screen.getByRole("button", { name: "Create user" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The user was not created. Try again. Request id: req-3",
  );
  expect(posted).toEqual([{ name: "Ada", email: "ada@example.com" }]);
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Ada");
  expect(screen.queryByText("The change was not saved")).not.toBeInTheDocument();
});
```

The last line pins the mutation's `meta: { silent: true }`: without it the form error and a toast would both show.

## A unit test and a config test

App-wide router behaviour (the lossless search parser, focus moving to the page's `h1` after a path change but not after a search-only change or on the first render) is tested through `renderRoute` in `src/app/router.test.tsx`; the test harness itself in `src/test/setup.test.ts`.

A unit test is for a pure function or policy with branches worth enumerating, next to it, with `test.each`: `src/features/users/pagination.test.ts` for paging math, `src/app/query-client.test.ts` for the retry policy (each status and failure count against the `retry` that `createQueryClient` configures, no QueryClient run). It imports the function and nothing else; if it needs `renderRoute` or MSW, it is a route test.

A config test is for configuration that carries logic: `deploy/headers.test.ts` pins the whole generated CSP string with `toBe` and checks the cache headers each platform merges, `vite.config.test.ts` runs a real `vite build` against the exported `entryBudget` plugin, `biome-plugins/boundaries.test.ts` lints seeded violations with the real Biome binary. Each exports the logic from the config file and drives it with real inputs; none mocks the tool. The boundary test writes a `tmp-boundaries-*` directory inside the project while it runs, so do not run `biome check` in parallel with Vitest.
