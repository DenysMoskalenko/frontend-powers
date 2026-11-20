---
name: frontend-testing
description: "Use when writing or fixing Vitest route integration tests or Playwright specs in a Vite SPA: renderRoute, MSW 3 server.use with orval getXMockHandler, onUnhandledFrame, Requests without an MSW handler, user-event, findByRole, buildUser factories, vi.useFakeTimers hangs, vi.setSystemTime, jsdom lacking matchMedia or ResizeObserver, coverage thresholds, flaky shuffled runs, the e2e/fixtures.ts guard, axe scans. Not for test-quality principles (writing-good-tests), vite.config.ts test keys or CI jobs (frontend-tooling), test sessions (keycloak-spa-auth)."
metadata:
  version: "0.1.0"
---

# Testing a Vite SPA

Assumes Vitest 5.1, jsdom 30.1, @testing-library/react 16.3, @testing-library/dom 10.4, @testing-library/user-event 14.6, @testing-library/jest-dom 7.0, MSW 3.0, @faker-js/faker 10.6, @playwright/test 1.65, @axe-core/playwright 4.14.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, use its own modules, helpers and scripts, and say so when it has no equivalent instead of adding one unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If `pnpm-lock.yaml` pins another major version than the line above, follow the project and say which rules may not apply.

What makes a test worth having (naming the break, literal expectations, no assertions on mocks, the mutation check) belongs to `writing-good-tests`. If that skill is available, load it before writing or reviewing a test. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules.

## Important

- A screen is tested through `renderRoute(path)`: the real route tree, router, QueryClient and providers, with only the network fake. Never render a route or feature component inside hand-made providers, and never `vi.mock` the app's own modules, the generated client, TanStack Router or TanStack Query; only a third-party network client with no HTTP seam (a WebSocket SDK) may become a fake module, as `frontend-realtime` shows.
- Every API answer a test depends on is declared in that test with `server.use(...)`: generated `get<Operation>MockHandler(<explicit data>)` for success, `http.<method>(\`${TEST_API_ORIGIN}/...\`)` with the backend's error body for failures. A generated handler called without data answers random strings.
- The setup's `afterEach` fails a test whose assertions passed when the app made a request no handler answered, or called `reportError`. `renderRoute` does not install `rootErrorHandlers`, so an error a route's boundary catches (a failed loader showing `RouteError`) is not reported in a route test; only explicit calls such as `.catch(reportError)` are. A test that expects one stubs `vi.stubGlobal("reportError", vi.fn())` and asserts on the stub. That a boundary error reaches error tracking is tested once, in `src/app/error-reporting.test.ts`.
- Fake timers need two extras or the test hangs: `vi.stubGlobal("jest", { advanceTimersByTime: vi.advanceTimersByTime })` and your own `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` instead of `renderRoute`'s `user`. To pin "now" only, use `vi.setSystemTime` without fake timers.
- Playwright specs import `test` and `expect` from `e2e/fixtures.ts`, create their own uniquely named data, and use `page.route` only for a state the backend cannot produce.

## References

- `references/route-tests.md` — `renderRoute` and `src/test/setup.ts` quoted, MSW 3 recipes (request bodies, query strings, `once`, stateful handlers), queries for Base UI parts, factories, verified route tests, unit and config tests. Open before writing a route test.
- `references/time-and-jsdom.md` — `vi.setSystemTime`, the fake-timer recipe, the jsdom gaps with a fix each (`reportError`, `confirm`, `matchMedia`, observers). Open when a test touches time or a missing browser API.
- `references/playwright.md` — what belongs in E2E, `e2e/fixtures.ts` and `e2e/smoke.spec.ts` quoted, data, `page.route`, `page.clock`, axe. Open before writing a spec in `e2e/`.

## Which test

| Behaviour | Test | File |
|---|---|---|
| A page: data, empty and error states, forms, navigation, search params | route test, `renderRoute` | `src/routes/users/index.test.tsx` |
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

- `onUnhandledFrame: "error"` only rejects the `fetch`, and `RouteError` (the router's `defaultErrorComponent`) renders the failure, so the setup collects `request:unhandled` events and throws `Requests without an MSW handler: GET https://api.test/users/<id>` after the test.
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

- Factories are `build<Entity>(overrides)` in `src/test/factories/<entity>.ts`, typed from the generated client. Pass every field the test asserts on; faker is seeded per test in the setup file.
- `TZ=UTC` is set for all tests: `"2026-11-01T09:30:00Z"` renders `Nov 1, 2026, 9:30 AM` everywhere.

## Isolation the config enforces

| Setting | Consequence for a test |
|---|---|
| `globals: false` | import `test`, `expect`, `vi` from `vitest`; the setup file calls `cleanup()` |
| `sequence.shuffle: true` | order varies per run; the seed is printed as `Running tests with seed "…"` |
| `restoreMocks: true` | every `vi.spyOn` is restored after each test |
| `unstubGlobals: true`, `unstubEnvs: true` | `vi.stubGlobal` and `vi.stubEnv` are undone, `reportError` back to the setup's recording one; a direct `window.x = …` assignment is not |
| one module graph per file | module state (a store, user-event's clipboard stub) carries over between tests in a file; reset it where it is set |

## Coverage

`pnpm test:coverage` gates 80 % lines and 80 % branches globally, excluding `src/**/*.gen.ts`, `src/api/generated/**`, `src/test/**` and `src/main.tsx`. The React Compiler and route code splitting are off under Vitest; E2E runs both. Meet a threshold by testing an untested behaviour, never by widening `exclude`. The config keys are `frontend-tooling`'s.

## Running

| Goal | Command |
|---|---|
| After a change | `pnpm exec vitest related src/features/users/pagination.ts --run`, then `pnpm check` |
| Reproduce an order-dependent failure | `pnpm exec vitest run --sequence.seed=<printed seed>` |
| End-to-end | `pnpm test:e2e`; `pnpm exec playwright test --grep @smoke` |

## Flaky and red tests

| Symptom | Cause | Fix |
|---|---|---|
| `Requests without an MSW handler: GET …` after a test whose assertions passed | the page, or a hover preload, called an endpoint the test did not declare | add the handler with explicit data, or assert the error state on purpose |
| A test whose assertions passed fails with the app's own error (`Error: clipboard denied`), once per error | app code called `reportError` (a `.catch(reportError)`); the setup throws `AggregateError(errors, "The app called reportError")`, printed as its inner errors | fix the cause; if the report is the behaviour under test, stub it and assert the call |
| `Found multiple elements with the role …` on a page rendered once | an earlier test's DOM is still mounted | keep `cleanup()` in the setup's `afterEach` |
| Passes alone, fails with one seed | state left by an earlier test: a direct global assignment, module state, the clipboard stub | `vi.stubGlobal`; reset module state where it is set; rerun with that seed |
| A Playwright spec fails on rerun or in parallel | it assumed an empty list or reused an email | unique data from `testInfo.testId` and `testInfo.retry` |

## Playwright

The production build through `vite preview` against `e2e/stub-api.ts`; the guard fixture fails a test on a console error, a page error or a CSP violation (the CSP is `frontend-deploy`'s). E2E holds one smoke journey per critical flow, axe in both colour schemes, real navigation and layout; every branch of a page stays a route test. An error screen is a route test only: the production build reports the error a boundary catches, and the guard fails the spec on it by design.

## Prior-version corrections

| Older examples write | Correct now |
|---|---|
| `jest.fn()`, `jest.mock()`, `jest.useFakeTimers()`, globals without imports | `vi.fn()`, `vi.mock()`, `vi.useFakeTimers()` with `import { expect, test, vi } from "vitest"` |
| `vi.mock()` inside a `test` or a function | Vitest 5 fails the file: "was defined outside of the module's top level scope"; and the app's own modules are not mocked at all |
| `vi.stubGlobal("fetch", vi.fn(...))`, `global.fetch = ...` | an MSW handler, so `apiFetch` and `ApiError` run for real |
| `server.listen({ onUnhandledRequest: "error" })` | MSW 3: `onUnhandledFrame: "error"`, plus the `afterEach` check |
| `await waitFor(() => expect(screen.getByText("Ada")).toBeInTheDocument())` | `expect(await screen.findByText("Ada")).toBeInTheDocument()` |
| `fireEvent.click(button)`, `fireEvent.change(input, …)` | `await user.click(button)`, `await user.type(input, "Ada")` |
| `vi.useFakeTimers({ shouldAdvanceTime: true })` to unblock user-event | the global `jest` stub plus `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| Render `<UserTable users={…} />` or a route component in a hand-built `QueryClientProvider` | `renderRoute("/users")` with the API answer declared |
| `vi.mock("@/api/generated/api")` or mock a `use…Query` hook | `server.use(getListUsersMockHandler({ … }))` |
| Call `getListUsersMockHandler()` with no argument, or add handlers to `setupServer()` | pass data built with `buildUser({ name: … })` in the test |
| Assert `queryClient.getQueryData(...)` | assert what the page shows and what the handler received |
| Silence a `reportError` failure by stubbing it in a test that does not assert the report | fix the error the app reported |
| Add a file to coverage `exclude` to pass the gate | test the uncovered behaviour |
| Import `test` from `@playwright/test` in a spec | import `test`, `expect` from `e2e/fixtures.ts` |
| `page.route` every API call in a spec | the stub or real backend; route only an unreachable state, with a comment |
