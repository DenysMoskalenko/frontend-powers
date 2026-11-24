# Route integration tests

## Contents

- [What renderRoute builds](#what-renderroute-builds)
- [Two projects, two setup files](#two-projects-two-setup-files)
- [MSW 3 recipes](#msw-3-recipes)
- [Queries for this stack](#queries-for-this-stack)
- [Factories](#factories)
- [Verified examples](#verified-examples)
- [A component rendered on its own](#a-component-rendered-on-its-own)
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

## Two projects, two setup files

Vitest runs two projects, and the file name alone picks one (the configuration is `frontend-tooling`'s):

| File name | Project | Environment | Setup files |
|---|---|---|---|
| `*.test.tsx`, `*.dom.test.ts` | `dom` | jsdom | `src/test/setup.ts`, then `src/test/setup-dom.ts` |
| every other `*.test.ts` | `node` | Node, no DOM | `src/test/setup.ts` |

A test that touches `window`, `document`, storage or the DOM matchers is a `.test.tsx`, or a `.dom.test.ts` when it has no JSX: a stale-chunk handler on `window`, a storage helper, a query with `refetchInterval` (TanStack Query starts no interval where `window` is undefined), a `matchMedia` stub. Everything else, the pure logic and the config tests, is a plain `.test.ts`. In the wrong project such a test fails with `ReferenceError: document is not defined` (or `window`), and a `localStorage` call with `TypeError: Cannot read properties of undefined (reading 'setItem')`; rename the file, never add `// @vitest-environment` to it. `isolate: false` and `pool: "vmThreads"` are not used: the first gave no steady gain on the template's suite, the second breaks MSW (`WritableStream is not defined`).

`src/test/setup.ts`, as the scaffold ships it; `src/test/server.ts` is `setupServer()` with no handlers:

```ts
// Every test, in Node and in jsdom. The DOM-only part is setup-dom.ts.
import { faker } from "@faker-js/faker";
import { afterAll, afterEach, beforeAll, beforeEach, vi } from "vitest";
import { server } from "./server";

const unhandled: string[] = [];
server.events.on("request:unhandled", ({ request }) => {
  unhandled.push(`${request.method} ${request.url}`);
});

// The platform's reportError only logs. This one records the error, and the test fails unless it
// stubs reportError.
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

`src/test/setup-dom.ts`:

```ts
// `*.test.tsx` and `*.dom.test.ts` only, after setup.ts.
import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/dom";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// The bound only ends a hang; a loaded CI machine must never reach it.
configure({ asyncUtilTimeout: 5_000 });
// jsdom has no layout; the router restores scroll after every navigation.
window.scrollTo = () => {};

// Runs before setup.ts's afterEach (hooks run in reverse), so an unmount's reportError still fails the test.
afterEach(() => {
  // `globals: false` turns off Testing Library's automatic cleanup.
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
```

- `afterEach` hooks run in reverse order of registration (Vitest's default `sequence.hooks: "stack"`): `setup-dom.ts` unmounts and clears storage first, then `setup.ts` checks requests and reports, so an error raised while unmounting still fails the test. Something that must happen for every test goes in `setup.ts`; something that needs a DOM goes in `setup-dom.ts`.
- The unhandled-request check is needed beside `onUnhandledFrame: "error"`: that option alone only makes `fetch` reject, `RouteError` (the router's `defaultErrorComponent`) renders the failure, and a test that asserts on something else passes. The failure reads `Requests without an MSW handler: GET https://api.test/users?limit=20&offset=0`.
- jsdom 31 has a `reportError` of its own, which only dispatches an `error` event and logs to the virtual console, and Node has none, so a reported error would pass the test or throw a `TypeError` of its own. The recording one fails a test that reports unexpectedly. `renderRoute` renders without `rootErrorHandlers`, so a failed loader that shows `RouteError` reports nothing here: its test needs no stub. Vitest prints the `AggregateError` as its inner errors, so the failure shows the app's own error, once per report. A test that expects a report replaces it with `vi.stubGlobal("reportError", vi.fn())` and asserts on that stub, as `src/app/error-reporting.dom.test.ts` does; `unstubGlobals` puts the recording one back for the next test.
- When a test both missed a handler and reported, only the request failure is thrown; fix it and rerun.
- `localStorage` and `sessionStorage` are cleared after every test, so a remembered choice (a theme, a return path) never leaks into the next test under the shuffled order; a test that needs a stored value writes it in its arrange block. `src/test/setup.dom.test.ts` pins this with a `describe(..., { shuffle: false })` pair.

What the rest of the test configuration means for a test:

| Setting | Consequence for a test |
|---|---|
| `globals: false` | import `test`, `expect`, `vi` from `vitest`; `setup-dom.ts` calls `cleanup()` |
| `sequence.shuffle: true` | order varies per run; the seed is printed as `Running tests with seed "…"` |
| `restoreMocks: true` | every `vi.spyOn` is restored after each test |
| `unstubGlobals: true`, `unstubEnvs: true` | `vi.stubGlobal` and `vi.stubEnv` are undone before the next test, `reportError` back to the recording one; a direct `window.x = …` assignment is not |
| `isolate` on (the default) | each file has its own module graph, so module state (a store, user-event's clipboard stub) carries over only between tests in one file; reset it where it is set |
| `env: { TZ: "UTC" }` | `"2026-11-01T09:30:00Z"` renders `Nov 1, 2026, 9:30 AM` on every machine |

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
| Nothing for an endpoint | omit it; the unhandled-request check names it if the page calls it; a click that a navigation blocker cancels requests nothing |

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
| Failure toast | `const alert = await screen.findByRole("alert")`, then `expect(alert).toHaveTextContent("Could not refresh the data")`: a high-priority Base UI toast is announced through a visually hidden `role="alert"` copy, so `getByText(title)` finds two elements. The toast itself is an `aria-hidden` `alertdialog` with an `aria-hidden` Dismiss button until F6 moves focus into the toasts: `await user.keyboard("{F6}")`, then `getByRole("button", { name: "Dismiss" })` |
| A disabled TanStack `Link` | `getByRole("link", { name: "Next" })` with `toHaveAttribute("aria-disabled", "true")`; it renders without `href` |
| Navigation in progress | `findByRole("progressbar", { name: "Loading page" })` while a client-side navigation waits for its loader (a held handler, as `src/routes/__root.test.tsx` does); a page's own progress indicator needs another name. A first load shows the layout and the bar while the loaders run, so a test that starts at a slow page sees them; the page's own content arrives when the loader resolves |
| An empty state | `findByText("No users yet.")` |
| An element that is gone | `expect(screen.queryByText("…")).not.toBeInTheDocument()` |
| A browser event user-event has no verb for | `window.dispatchEvent(new Event("visibilitychange"))` |

A query that finds nothing by role means the markup lacks a role or an accessible name: fix the component, not the query. The `data-testid` attributes (`users-create-submit`, ``users-row-${id}``) are for automation outside the repository; a route test uses `getByTestId` only for an element with no stable accessible name, such as a canvas, with a one-line reason.

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

## A component rendered on its own

A component that takes props and renders DOM, and needs no router, no QueryClient and no context, may be rendered directly with `render` when it has more visual states than its routes reach cheaply (a status badge, a table of cell formats, an empty and a full variant). Its routes still get their route tests. The line is the first provider: the moment the component renders a `Link`, calls a hook that reads the router, a query or a context, or is wrapped in anything to make it mount, it is tested through `renderRoute` instead. A wrapper in `src/shared/ui` needs no test of its own: the route tests that use it cover it. The direct test lives beside the component, as a `.test.tsx`:

```tsx,verify,test
// file: src/features/users/user-details.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { buildUser } from "@/test/factories/user";
import { UserDetails } from "./user-details";

test("the details show the email and the creation time", () => {
  const user = buildUser({ email: "ada@example.com", created_at: "2026-11-01T09:30:00Z" });

  render(<UserDetails user={user} />);

  expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  expect(screen.getByText("Nov 1, 2026, 9:30 AM")).toBeInTheDocument();
});
```

## A unit test and a config test

App-wide router behaviour (the lossless search parser, focus moving to the page's `h1` after a path change but not after a search-only change or on the first render) and the failure toasts (one per reason, updated in place) are tested through `renderRoute` in `src/app/router.test.tsx`, the navigation progress bar, on a first load and after one, in `src/routes/__root.test.tsx`, and the test harness itself in `src/test/setup.dom.test.ts`.

A unit test is for a pure function or policy with branches worth enumerating, next to it, with `test.each`, as a plain `.test.ts` in the `node` project: `src/features/users/pagination.test.ts` for paging math, `src/app/query-client.test.ts` for the retry policy (each status and failure count against the `retry` that `createQueryClient` configures, no QueryClient run). It imports the function and nothing else; if it needs `renderRoute` or MSW, it is a route test. When it needs one browser API (`window`, storage), it is a `.dom.test.ts`, as `src/app/error-reporting.dom.test.ts` is.

A config test is for configuration that carries logic: `deploy/headers.test.ts` pins the whole generated CSP string with `toBe` and checks the cache headers each platform merges, `vite.config.test.ts` runs a real `vite build` against the exported `entryBudget` plugin, `biome-plugins/boundaries.test.ts` lints seeded violations with the real Biome binary. Each exports the logic from the config file and drives it with real inputs; none mocks the tool. The boundary test writes a `tmp-boundaries-*` directory inside the project while it runs, so do not run `biome check` in parallel with Vitest.
