---
name: frontend-testing
description: "Use when writing or fixing Vitest route integration tests or Playwright specs in a Vite SPA: renderRoute, MSW 3 server.use with orval getXMockHandler, onUnhandledFrame, Requests without an MSW handler, user-event, findByRole, buildUser factories, vi.useFakeTimers hangs, vi.setSystemTime, jsdom lacking matchMedia or ResizeObserver, coverage thresholds, flaky shuffled runs, the e2e/fixtures.ts guard, axe scans. Not for test-quality principles (writing-good-tests), vite.config.ts test keys or CI jobs (frontend-tooling), test sessions (keycloak-spa-auth)."
metadata:
  version: "0.1.0"
---

# Testing a Vite SPA

Assumes Vitest 5.1, jsdom 31.0, @testing-library/react 16.3, @testing-library/dom 10.4, @testing-library/user-event 14.6, @testing-library/jest-dom 8.0, MSW 3.0, @faker-js/faker 10.6, @playwright/test 1.65, @axe-core/playwright 4.14.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another version of a package than the line above, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

What makes a test worth having (naming the break, literal expectations, no assertions on mocks, the mutation check) belongs to `writing-good-tests`. If that skill is available, load it before writing or reviewing a test. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules.

## Important

- A screen is tested through `renderRoute(path)`: the real route tree, router, QueryClient and providers, with only the network fake. Never render a route or feature component inside hand-made providers, and never `vi.mock` the app's own modules, the generated client, TanStack Router or TanStack Query; only a third-party network client with no HTTP seam (a WebSocket SDK) may become a fake module, as `frontend-realtime` shows.
- Every API answer a test depends on is declared in that test with `server.use(...)`: generated `get<Operation>MockHandler(<explicit data>)` for success, `http.<method>(\`${TEST_API_ORIGIN}/...\`)` with the backend's error body for failures. A generated handler called without data answers random strings. The one exception is a request the root layout makes on every page (a feed, `/me`): one `server.use(...)` in `src/test/setup.ts`'s `beforeEach` answers its neutral case, and a test of that request declares its own.
- The setup fails a test after its assertions when a request had no handler or the app called `reportError`. Route tests install no `rootErrorHandlers`, so a failed loader reports nothing; a test that expects a report stubs `vi.stubGlobal("reportError", vi.fn())` and asserts on it.
- Fake timers need three extras or the test hangs: `vi.stubGlobal("jest", { advanceTimersByTime: vi.advanceTimersByTime })`, your own `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` instead of `renderRoute`'s `user`, and `await act(() => vi.advanceTimersByTimeAsync(ms))` to advance. To pin "now" only, use `vi.setSystemTime` without fake timers.

## References

- `references/route-tests.md` — `renderRoute` and `src/test/setup.ts` quoted, MSW 3 recipes (request bodies, query strings, `once`, stateful handlers), queries for Base UI parts, factories, verified route tests, unit and config tests. Open before writing a route test.
- `references/time-and-jsdom.md` — `vi.setSystemTime`, the fake-timer recipe, the jsdom 31 gaps with a fix each (`reportError`, `confirm`, `matchMedia`, observers, focus after disabling). Open when a test touches time or a missing browser API.
- `references/playwright.md` — what belongs in E2E, `e2e/fixtures.ts` and `e2e/smoke.spec.ts` quoted, data, `page.route`, `page.clock`, axe in both colour schemes and per explicit theme choice, an app with add-ons (merged fixtures, `webServer` entries and CI job). Open before writing a spec in `e2e/`, and before installing a second add-on that brings its own E2E setup.

## Which test

| Behaviour | Test | File |
|---|---|---|
| A page: data, empty and error states, forms, navigation, search params | route test, `renderRoute` | `src/routes/users/index.test.tsx`; app-wide router behaviour in `src/app/router.test.tsx` |
| Pure logic with branches (pagination math, an error-body parser) | unit test, `test.each` | beside the module |
| Configuration that carries logic (generated headers, a Vite plugin, a lint rule) | config test driving the real tool | `deploy/headers.test.ts` |
| The production build, CSP, real navigation, layout, axe | Playwright | `e2e/*.spec.ts` |

A wrapper in `src/shared/ui` is covered by the route tests that use it; a component that needs a provider is tested through a route.

## renderRoute

```tsx
const { user, router } = renderRoute("/users?page=2");
expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
expect(router.state.location.search).toEqual({ page: 2 });
```

Query retries are off. Assert navigation through the page that renders and `router.state.location`, never a spy on `navigate`. Each page's tests assert `document.title` once. A failed submit asserts the first invalid field has focus: `await waitFor(() => expect(field).toHaveFocus())`, since focus moves a frame later.

## MSW 3

- Links preload on hover (`defaultPreload: "intent"`): hovering a link, or clicking one that navigates, requests the target route's data, so declare it. A click a blocker cancels requests nothing.
- Capture what the app sent inside the handler (`posted.push(await request.json())`) and compare to a literal.
- `ApiError` and the generated handlers are `tanstack-query-api`'s.

## Queries and interaction

| Situation | Write |
|---|---|
| A Base UI toast | `findByRole("dialog", { name: title })`; its Dismiss button is `aria-hidden` until `await user.hover(toast)` |
| A field error | `toHaveAccessibleDescription("Invalid email address")` on the textbox |
| A form or page error | `findByRole("alert")` |
| A browser event user-event has no verb for | `window.dispatchEvent(new Event("visibilitychange"))` |

`await` every `user.*` call and wait with `findBy*`. `act()` only around `vi.advanceTimersByTimeAsync`; Testing Library and user-event wrap the rest.

## Data and time

- Factories are `build<Entity>(overrides)` in `src/test/factories/<entity>.ts`, typed from the generated client. Pass every field the test asserts on; faker is seeded per test in the setup file. An id comes from the factory (`renderRoute(\`/users/${ada.id}\`)`), never a literal such as `"1"`: the detail loader checks the path id against its schema and answers not found for a malformed one.
- `TZ=UTC` is set for all tests: `"2026-11-01T09:30:00Z"` renders `Nov 1, 2026, 9:30 AM` everywhere.

## Isolation the config enforces

| Setting | Consequence for a test |
|---|---|
| `globals: false` | import `test`, `expect`, `vi` from `vitest`; the setup file calls `cleanup()` |
| `sequence.shuffle: true` | order varies per run; the seed is printed as `Running tests with seed "…"` |
| `restoreMocks: true` | every `vi.spyOn` is restored after each test |
| `unstubGlobals: true`, `unstubEnvs: true` | `vi.stubGlobal` and `vi.stubEnv` are undone, `reportError` back to the setup's recording one; a direct `window.x = …` assignment is not |
| one module graph per file | module state (a store, user-event's clipboard stub) carries over between tests in a file; reset it where it is set. `localStorage` and `sessionStorage` are cleared by the setup after each test |

## Coverage and running

`pnpm test:coverage` gates 80 % lines and branches (the config keys are `frontend-tooling`'s). An order-dependent failure reproduces with `pnpm exec vitest run --sequence.seed=<printed seed>`: from Vitest 5.1.1 one seed gives every file the same test order. After a change, `pnpm exec vitest related <changed file> --run` runs the tests that import it, then `pnpm check`.

## Flaky and red tests

| Symptom | Cause | Fix |
|---|---|---|
| `Requests without an MSW handler: GET …` after a test whose assertions passed | the page, or a hover preload, called an endpoint the test did not declare | add the handler with explicit data, or assert the error state on purpose |
| A test whose assertions passed fails with the app's own error (`Error: clipboard denied`), once per error | app code called `reportError` (a `.catch(reportError)`); the setup throws `AggregateError(errors, "The app called reportError")`, printed as its inner errors | fix the cause; if the report is the behaviour under test, stub it and assert the call |
| `Found multiple elements with the role …` on a page rendered once | an earlier test's DOM is still mounted | keep `cleanup()` in the setup's `afterEach` |
| Passes alone, fails with one seed | state left by an earlier test: a direct global assignment, module state, the clipboard stub | `vi.stubGlobal`; reset module state where it is set; rerun with that seed |
| A Playwright spec fails on rerun or in parallel | it assumed an empty list or reused an email | unique data from `testInfo.testId` and `testInfo.retry` |

## Playwright

An error screen is a route test only: the production build reports the error a boundary catches, and the guard fixture fails the spec on it by design. Everything else about specs, axe in both colour schemes included, is in `references/playwright.md`.

## Prior-version corrections

| Older examples write | Correct now |
|---|---|
| `vi.mock()` inside a `test` or a function | Vitest 5 fails the file: "was defined outside of the module's top level scope"; and the app's own modules are not mocked at all |
| `vi.mock` of the client, or `vi.stubGlobal("fetch", vi.fn(...))` that answers every request alike | per-test answers by URL, so `apiFetch` and `ApiError` run for real: MSW handlers here; a project's own URL-routing `fetch` stub under the real router is the same thing, keep it |
| `server.listen({ onUnhandledRequest: "error" })` | MSW 3: `onUnhandledFrame: "error"`, plus the `afterEach` check |
| `vi.useFakeTimers({ shouldAdvanceTime: true })` to unblock user-event | the global `jest` stub plus `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| Assert `queryClient.getQueryData(...)` | assert what the page shows and what the handler received; the cache shape is not the behaviour |
| Silence a `reportError` failure by stubbing it in a test that does not assert the report | fix the error the app reported: the stub hides a real failure |
| Add a file to coverage `exclude` to pass the gate | test the uncovered behaviour; an exclusion only moves the denominator |
| Import `test` from `@playwright/test` in a spec | import `test`, `expect` from `e2e/fixtures.ts`, or the guard fixture never runs |
| `page.route` every API call in a spec | the stub or real backend, with uniquely named data; route only an unreachable state, with a comment, or the spec tests the mock |
