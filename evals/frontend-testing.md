# frontend-testing

### Triggering

**Should load**

1. "write tests for the users list page: it should show the users from the API and an empty state when there are none"
2. "my test passes but then fails in afterEach with `Requests without an MSW handler: GET https://api.test/users/0193...`, what does that mean?"
3. "how do I make the API return a 409 in a route test with msw so I can check the conflict message?"
4. "the test hangs forever after I added vi.useFakeTimers() and user.type, why?"
5. "`TypeError: window.matchMedia is not a function` when the settings page renders in vitest"
6. "add a Playwright spec that creates a user and checks it shows up in the list"
7. "coverage dropped to 78% branches and `pnpm test:coverage` fails, how do I get it back over 80?"
8. "this vitest test is flaky, fails only with some shuffle seeds"
9. "all my assertions pass but the test fails with `AggregateError: The app called reportError`, what is failing it?"

**Should not load**

1. "add a coverage job to the GitLab CI file that runs on every merge request" -> `frontend-tooling`
2. "is this test actually useful or is it just testing the mock? review it" -> `writing-good-tests`
3. "regenerate the orval client and MSW handlers after the backend added GET /orders" -> `tanstack-query-api`
4. "the Playwright run reports a CSP violation for an inline style, which header should allow it?" -> `frontend-deploy`
5. "how do I fake a logged-in Keycloak session in route tests for the admin pages?" -> `keycloak-spa-auth`
6. "map ApiError.fieldErrors onto the TanStack Form fields when the server returns 422" -> `frontend-forms`
7. "where should a new test helper module live, and can feature code import from src/test?" -> `frontend-project-structure`
8. "write a test for the live order feed that fakes the Centrifugo client and pushes a publication" -> `frontend-realtime`

### Eval 1 - route tests for list paging and a failed first load

**Prompt**: "Add tests for /users: on page 2, Previous goes back to the first page, and when the first load fails with a server error the page shows the request id and Try again reloads the list."

**Fixture**: scaffold

**Must produce**:

- tests that call `renderRoute`, one of them with `/users?page=2`
- `server.use(getListUsersMockHandler(...))` with explicit data built from `buildUser({ name: ... })`, computed from the request's `offset` where the page matters
- the error answer written as `http.get` on `TEST_API_ORIGIN` for `/users` with an axum-style body containing `request_id` and status 500
- the failure-then-success sequence using `{ once: true }` on the error handler before the success handler
- assertions with `findByRole` or `findByText`
- clicks through `await user.click(...)`
- the page change checked with `router.state.location.search` or the rendered `Page 1 of …` text

**Must not produce**:

- `vi.mock` of `@/api/generated/api`, `@tanstack/react-query` or `@tanstack/react-router`
- a component rendered inside a hand-made `QueryClientProvider` or `RouterProvider`
- `getListUsersMockHandler()` called without data
- `vi.stubGlobal("fetch", ...)`
- `waitFor` wrapped around a `findBy` query, or a `setTimeout` sleep
- `vi.stubGlobal("reportError", ...)` or an assertion that the failed first load was reported

### Eval 2 - timer behaviour under fake timers

**Prompt**: "Test that the 'Could not refresh the data' toast on /users closes by itself after a few seconds. My attempt with vi.useFakeTimers() just times out."

**Fixture**: scaffold

**Must produce**:

- `vi.useFakeTimers()` together with `vi.stubGlobal("jest", { advanceTimersByTime: vi.advanceTimersByTime })`
- a user-event instance created with `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })` if the test interacts, not the `user` from `renderRoute`
- time advanced with `await act(() => vi.advanceTimersByTimeAsync(...))`
- the background refresh triggered with `vi.setSystemTime` and a `visibilitychange` event and a 500 handler on `TEST_API_ORIGIN`
- an assertion that the toast is present before the timeout and absent after it

**Must not produce**:

- `vi.useFakeTimers({ shouldAdvanceTime: true })`
- a raised test timeout as the fix
- `await new Promise((r) => setTimeout(r, ...))`

### Eval 3 - end-to-end spec

**Prompt**: "Write a Playwright test that checks a new user's detail page has no accessibility violations and that the page survives a failing user lookup."

**Fixture**: scaffold

**Must produce**:

- `test` and `expect` imported from `./fixtures.ts`
- a user created with a unique email built from `testInfo.testId` and `testInfo.retry`
- the detail page scanned by `AxeBuilder` with WCAG tags in `light` and `dark` via `page.emulateMedia`, in new code or by naming the existing smoke axe test; any new axe run also covers both schemes
- the failing lookup (a 500 from `GET /users/{id}`) tested as a route test through `renderRoute` with an `http.get` on `TEST_API_ORIGIN`, not in the spec, because the production build reports the boundary error and the guard fails the spec on it
- role locators and web-first `expect(...).toBeVisible()` assertions

**Must not produce**:

- `import { test, expect } from "@playwright/test"` in the spec
- `page.waitForTimeout`
- an assertion that the user list is empty or has a fixed length
- `page.route` fulfilling a 500 for the user lookup in a spec
- an allow-list option added to `e2e/fixtures.ts` so the guard ignores the reported error

### Probe 1 - no mocking of the generated client

**Prompt**: "Quick test for the users page: just mock the listUsers call so it returns two users and check both names render."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:vi\.mock\(\s*["'][^"']*(api/generated|react-query|react-router))`

**Right answer**: `getListUsersMockHandler\(`

### Probe 2 - explicit handler data

**Prompt**: "In a route test for /users, I just need some users to show up, I don't care which. Set up the API for that."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:server\.use\([^;]*getListUsersMockHandler\(\s*\))|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:setupServer\(\s*\.\.\.get\w*Mock\(\s*\))`

### Probe 3 - MSW 3 option name

**Prompt**: "In the Vitest setup file of an app using MSW 3's setupServer, make any request that has no handler an error."

**Fixture**: empty

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:onUnhandledRequest\s*:\s*["'])`

**Right answer**: `onUnhandledFrame`

### Probe 4 - no fetch stub

**Prompt**: "Test that the user page shows 'User not found' when the API answers 404. Simplest way to fake the response?"

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:stubGlobal\(\s*["']fetch["'])|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:global(This)?\.fetch\s*=)`

### Probe 5 - asserting the cache

**Prompt**: "Test that creating a user on /users/new adds it to the users list cache."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:expect\(\s*|=\s*)[\w.]*\.getQueryData(?:<[^>]*>)?\()`

**Right answer**: `renderRoute\(|new\.test\.tsx`

### Probe 6 - a boundary error is not reported in a route test

**Prompt**: "We added /orders/$orderId (loader calls GET /orders/{id} through the generated client). Write its route test for a 500 from that endpoint: the page shows the error screen, and the error must reach our error tracking."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:stubGlobal\(\s*["']reportError["'](?:(?!\btest\()[\s\S])*(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)renderRoute\()|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:renderRoute\((?:(?!\btest\()[\s\S])*(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)stubGlobal\(\s*["']reportError)`

**Right answer**: `findByRole\(\s*["']alert["']`

### Probe 7 - fake timers with user-event

**Prompt**: "With vi.useFakeTimers() on, my route test hangs at `await user.hover(toast)`. Fix the setup inside the test."

**Fixture**: scaffold

**Wrong answer**: `(?:^|\n)\s*vi\.useFakeTimers\(\s*\{[^}]*shouldAdvanceTime\s*:\s*true`

**Right answer**: `advanceTimers:\s*vi\.advanceTimersByTime`

### Probe 8 - Playwright imports from the fixtures

**Prompt**: "Add an e2e spec that opens an unknown URL such as /does-not-exist in the production build and checks the not-found page renders inside the layout."

**Fixture**: scaffold

**Wrong answer**: `(?:^|\n)\s*import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*["']@playwright/test["']`

**Right answer**: `from\s*["']\./fixtures(\.ts)?["']`

### Probe 9 - coverage by exclusion

**Prompt**: "pnpm test:coverage fails at 79% branches because of src/shared/ui/route-error.tsx. Make the gate pass."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:exclude:\s*\[[^\]]*route-error)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:branches:\s*[0-7]\d\b)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:v8|istanbul|c8)\s+ignore)`

### Probe 10 - an expected reportError call

**Prompt**: "Our Vitest setup fails any test in which the app calls reportError. My test calls `rootErrorHandlers.onCaughtError(error)` on purpose and fails after its assertions. The report is what I am testing; make the test assert it."

**Fixture**: empty

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(globalThis|window)\.reportError\s*=)`

**Right answer**: `vi\.stubGlobal\(\s*["']reportError["']`

### Probe 11 - a request the root layout makes on every page

**Prompt**: "Our root layout now calls GET /me on every page to show the user's name, and every route test fails with `Requests without an MSW handler: GET https://api.test/me`. Fix the test setup once, not in each test."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:setupServer\(\s*(?:http\.|get\w+MockHandler|\.\.\.\w|handlers\b))|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:onUnhandledFrame\s*:\s*["'](?:bypass|warn)["'])`

**Right answer**: `beforeEach\([\s\S]*?server\.use\(`

### Probe 12 - coverage is not what pnpm check measures

**Prompt**: "In our app, `pnpm check` fails since I added a page because line coverage is 79 % against the 80 % threshold. Make `pnpm check` pass."

**Fixture**: scaffold

**Note**: `pnpm check` runs `vitest run` without coverage; only `pnpm test:coverage` measures it. A right answer says so, finds what really fails `pnpm check`, and covers the new page with tests instead of lowering the threshold.

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:thresholds\s*:\s*\{[^}]*\b(?:lines|branches|functions|statements)\s*:\s*[0-7]?\d\b)`

**Right answer**: `pnpm test:coverage`
