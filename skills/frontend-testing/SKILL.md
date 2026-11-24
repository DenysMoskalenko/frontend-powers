---
name: frontend-testing
description: "Use when writing or fixing Vitest route integration tests or Playwright specs in a Vite SPA: renderRoute, MSW 3 server.use with orval getXMockHandler, onUnhandledFrame, Requests without an MSW handler, document is not defined in a .test.ts, user-event, findByRole, buildUser factories, vi.useFakeTimers hangs, vi.stubEnv TZ, jsdom lacking matchMedia, data-testid, flaky shuffled runs, the e2e/fixtures.ts guard, expectedErrors, axe scans. Not for test-quality principles (writing-good-tests), vite.config.ts test keys or CI jobs (frontend-tooling), test sessions (keycloak-spa-auth)."
metadata:
  version: "0.1.0"
---

# Testing a Vite SPA

Assumes Vitest 5.1, jsdom 31.0, @testing-library/react 16.3, @testing-library/dom 10.4, @testing-library/user-event 14.6, @testing-library/jest-dom 8.0, MSW 3.0, @faker-js/faker 10.6, @playwright/test 1.65, @axe-core/playwright 4.14.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another version of a package than the line above, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

What makes a test worth having (naming the break, literal expectations, no assertions on mocks, the mutation check) belongs to `writing-good-tests`. If that skill is available, load it before writing or reviewing a test. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules.

## Important

- A screen is tested through `renderRoute(path)`: the real route tree, router, QueryClient and providers, with only the network fake. Never wrap a component in hand-made providers, and never `vi.mock` the app's own modules, the generated client, TanStack Router or TanStack Query; only a third-party network client with no HTTP seam (a WebSocket SDK) may become a fake module, as `frontend-realtime` shows. A component that needs no provider at all may be rendered bare (Which test).
- Every API answer a test depends on is declared in that test with `server.use(...)`: generated `get<Operation>MockHandler(<explicit data>)` for success, `http.<method>(\`${TEST_API_ORIGIN}/...\`)` with the backend's error body for failures. A generated handler called without data answers random strings. The one exception is a request the root layout makes on every page (`/me`): one `server.use(...)` in `src/test/setup.ts`'s `beforeEach` answers its neutral case.
- The setup fails a test after its assertions when a request had no handler or the app called `reportError`. Route tests install no `rootErrorHandlers`, so a failed loader reports nothing; only a test whose behaviour is the report stubs `vi.stubGlobal("reportError", vi.fn())` and asserts on it, since a stub anywhere else hides a real failure.
- The file name picks the environment: `*.test.tsx` and `*.dom.test.ts` run in jsdom, every other `*.test.ts` in Node, where `window`, `document` and storage are undefined.
- Fake timers need three extras or the test hangs: `vi.stubGlobal("jest", { advanceTimersByTime: vi.advanceTimersByTime })`, your own `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` instead of `renderRoute`'s `user`, and `await act(() => vi.advanceTimersByTimeAsync(ms))`; never `shouldAdvanceTime: true`, which also advances on the wall clock. To pin "now" only, `vi.setSystemTime` without fake timers.

## References

- `references/route-tests.md` — the two Vitest projects and setup files, isolation settings, `renderRoute`, MSW 3 recipes, queries, factories, a component rendered on its own, unit and config tests. Open before writing a route test or naming a test file.
- `references/time-and-jsdom.md` — `vi.setSystemTime`, a test under another time zone, fake timers with a failure toast, the jsdom 31 gaps with a fix each. Open when a test touches time, a date or a missing browser API.
- `references/playwright.md` — what belongs in E2E, the fixtures and shipped specs, the two projects, `page.route`, `page.clock`, axe, the `data-testid` convention, add-ons. Open before writing a spec, adding test ids, or installing a second add-on with its own E2E setup.

## Which test

| Behaviour | Test | File |
|---|---|---|
| A page: data, empty and error states, forms, navigation, search params | route test, `renderRoute` | `src/routes/users/index.test.tsx`; router-wide in `src/app/router.test.tsx` |
| A component with props and many visual states that needs no router, query or context | `render(<Component />)`; its first provider moves it to a route test | beside it, `.test.tsx` |
| Pure logic with branches | unit test, `test.each`, in Node | beside the module, `.test.ts` |
| Logic that needs one browser API (`window`, storage, a `refetchInterval` query) | unit test in jsdom | `.dom.test.ts` |
| Configuration that carries logic (headers, a Vite plugin, a lint rule) | config test driving the real tool | `deploy/headers.test.ts` |
| The production build, CSP, real navigation, phone width, error screens, axe | Playwright | `e2e/*.spec.ts` |

## renderRoute and MSW 3

```tsx
const { user, router } = renderRoute("/users?page=2");
expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
expect(router.state.location.search).toEqual({ page: 2 });
```

Query retries are off. Assert navigation through the page that renders and `router.state.location`, never a spy on `navigate`. Links preload on hover (`defaultPreload: "intent"`): hovering a link, or clicking one that navigates, requests the target route's data, so declare it. `ApiError` and the generated handlers are `tanstack-query-api`'s.

## Queries

| Situation | Write |
|---|---|
| A failure toast | `const alert = await screen.findByRole("alert")`, then `expect(alert).toHaveTextContent(title)`; the title is in the DOM twice, and Dismiss is `aria-hidden` until `await user.keyboard("{F6}")` |
| A navigation waiting for its loader | `findByRole("progressbar", { name: "Loading page" })`, on a first load too, with the layout around it |
| An element with no stable accessible name | `getByTestId("users-row-<id>")` with a one-line reason; role and name everywhere else |

`await` every `user.*` call and wait with `findBy*`. `act()` only around `vi.advanceTimersByTimeAsync`.

## Data and time

- Factories are `build<Entity>(overrides)` in `src/test/factories/<entity>.ts`; pass every field the test asserts on. An id comes from the factory (`renderRoute(\`/users/${ada.id}\`)`), never a literal: the detail loader answers not found for a malformed one.
- `TZ=UTC` is set for all tests. A date that must hold in another zone gets one test under `vi.stubEnv("TZ", "America/New_York")` that imports the formatter afresh after the stub.

## Coverage and running

`pnpm test:coverage` gates 80 % lines and branches (the config keys are `frontend-tooling`'s). Tests run shuffled; an order-dependent failure reproduces with `pnpm exec vitest run --sequence.seed=<printed seed>`: from Vitest 5.1.1 one seed gives every file the same test order. After a change, `pnpm exec vitest related <changed file> --run` runs the tests that import it, then `pnpm check`.

## Flaky and red tests

| Symptom | Cause | Fix |
|---|---|---|
| `Requests without an MSW handler: GET …` after a test whose assertions passed | the page, or a hover preload, called an endpoint the test did not declare | add the handler with explicit data, or assert the error state on purpose |
| A test whose assertions passed fails with the app's own error, once per error | app code called `reportError`; the setup throws `AggregateError(errors, "The app called reportError")`, printed as its inner errors | fix the cause; if the report is the behaviour under test, stub it and assert the call |
| `ReferenceError: document is not defined` (or `window`) | a test that needs a DOM is named `*.test.ts` | rename it `*.dom.test.ts`, or `.test.tsx` when it renders |
| `Found multiple elements with the role …` on a page rendered once | an earlier test's DOM is still mounted, or a failure toast's hidden alert copy | keep `cleanup()` in `setup-dom.ts`; find the toast by `findByRole("alert")` |
| Passes alone, fails with one seed | a direct global assignment, module state, the clipboard stub | `vi.stubGlobal`; reset module state where it is set; rerun with that seed |

## Playwright

The guard in `e2e/fixtures.ts` fails a spec on any console error, page error or CSP violation; a spec that provokes one on purpose (an error screen and its "Try again") names it with `test.use({ expectedErrors: [/…/] })`. Every spec runs in `chromium` and in the WebKit `phone` project, and checks each page with `expectNoSidewaysScroll(page)`.

## Prior-version corrections

| Older examples write | Correct now |
|---|---|
| `vi.mock()` inside a `test` or a function | Vitest 5 fails the file: "was defined outside of the module's top level scope"; and the app's own modules are not mocked at all |
| `vi.mock` of the client, or `vi.stubGlobal("fetch", vi.fn(...))` that answers every request alike | per-test answers by URL through MSW, so `apiFetch` and `ApiError` run for real; keep a project's own URL-routing `fetch` stub under the real router |
| `server.listen({ onUnhandledRequest: "error" })` | MSW 3: `onUnhandledFrame: "error"`, plus the `afterEach` check; MSW 2 has only `onUnhandledRequest`, so keep it there |
| One `environment: "jsdom"` for every test, or `// @vitest-environment jsdom` in a file | the `node` and `dom` projects, chosen by file name |
| `findByRole("dialog", { name: title })` for a failure toast | `findByRole("alert")`: failure toasts are high priority and persistent |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| Assert `queryClient.getQueryData(...)` | assert what the page shows and what the handler received |
| Add a file to coverage `exclude` to pass the gate | test the uncovered behaviour; an exclusion only moves the denominator |
| Import `test` from `@playwright/test` in a spec | import `test`, `expect` from `e2e/fixtures.ts`, or the guard never runs |
| Widen `expectedErrors` to `/.*/` or a status code | match the unique error text the spec itself sends; anything broader lets a CSP violation through |
| `getByTestId` where a role and name exist | `getByRole`, which also checks the accessible name; test ids are for automation outside the repository |
