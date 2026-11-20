# Playwright end-to-end tests

## Contents

- [What belongs in E2E](#what-belongs-in-e2e)
- [The guard fixture](#the-guard-fixture)
- [The scaffold's suite](#the-scaffolds-suite)
- [Rules](#rules)

## What belongs in E2E

The suite runs `pnpm build && pnpm preview` (the production build, React Compiler on, routes code-split, served with the generated security headers) against `e2e/stub-api.ts` on `API_ORIGIN`. It proves what jsdom cannot:

| Belongs in E2E | Stays a route test |
|---|---|
| one smoke journey per critical flow, tagged `@smoke` | every branch of a form, a list or an error mapping |
| the CSP and Trusted Types holding on real pages (the guard fixture) | which message a given `ApiError` shows |
| real navigation through lazily loaded route chunks | search-param parsing, redirects, not-found pages |
| axe scans of each page in both colour schemes | accessible names, which `getByRole` already enforces |
| layout, scrolling, focus order, real pointer and keyboard | anything a stub in jsdom answers honestly |
| states that need a browser clock or a real refetch (`page.clock`) | timer logic with `vi.useFakeTimers()` |

A screen with tens of routes still has tens of E2E tests, not hundreds.

## The guard fixture

`e2e/fixtures.ts`, as the scaffold ships it. Every spec imports `test` and `expect` from here, never from `@playwright/test`, or the guard does not run:

```ts
import { test as base, expect } from "@playwright/test";

/** Where the stub API listens; a real backend's origin works the same way. */
export const API_ORIGIN = "http://127.0.0.1:4010";

/**
 * Every test fails on a console error, an uncaught page error or a CSP / Trusted Types violation.
 * "Failed to load resource" is the browser logging an HTTP error status a test asked for.
 */
export const test = base.extend<{ guard: undefined }>({
  guard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
          problems.push(message.text());
        }
      });
      page.on("pageerror", (error) => problems.push(error.message));
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
        });
      });
      await use(undefined);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
```

A test that provokes an HTTP error status still passes: the browser's "Failed to load resource" line is filtered. Any other console error, an uncaught exception or a `securitypolicyviolation` fails the test after its body. The CSP itself is `frontend-deploy`'s; when the guard reports a violation, fix the code that caused it, never the filter.

## The scaffold's suite

`e2e/smoke.spec.ts`:

```ts
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { API_ORIGIN, expect, test } from "./fixtures.ts";

const uniqueEmail = (testId: string, retry: number) => `e2e-${testId}-${retry}@example.com`;

async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(violations).toEqual([]);
}

test(
  "a user creates a user, opens it, and finds it in the list",
  { tag: "@smoke" },
  async ({ page }, testInfo) => {
    const email = uniqueEmail(testInfo.testId, testInfo.retry);
    const response = await page.goto("/");
    expect(response?.headers()["content-security-policy"]).toContain("trusted-types 'none'");

    await expect(page).toHaveURL("/users");
    await page.getByRole("link", { name: "New user" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill("Ada Lovelace");
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(page.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await page.getByRole("link", { name: "Users", exact: true }).click();
    await expect(page.getByRole("row", { name: new RegExp(email) })).toBeVisible();
  },
);

test("a failed background refresh shows a toast without breaking the CSP", async ({ page }) => {
  await page.clock.install();
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  // The stub cannot fail on demand: this one state is faked in the browser.
  await page.route(`${API_ORIGIN}/users?*`, (route) =>
    route.fulfill({
      status: 500,
      headers: { "access-control-allow-origin": "*" },
      json: { error: "internal server error", request_id: "e2e-500" },
    }),
  );

  await page.clock.fastForward("01:00");
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));

  await expect(page.getByText("Could not refresh the data")).toBeVisible();
  await expect(page.getByText("Request id: e2e-500")).toBeVisible();
});

test("the user pages have no detectable accessibility violations in either colour scheme", async ({
  page,
  request,
}, testInfo) => {
  const created = await request.post(`${API_ORIGIN}/users`, {
    data: { name: "Grace Hopper", email: uniqueEmail(testInfo.testId, testInfo.retry) },
  });
  const { id } = await created.json();

  const pages: [path: string, heading: string][] = [
    ["/users", "Users"],
    ["/users/new", "New user"],
    [`/users/${id}`, "Grace Hopper"],
  ];
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const [path, heading] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expectNoAxeViolations(page);
    }
  }
});
```

## Rules

- Locate by role and accessible name (`page.getByRole("textbox", { name: "Email" })`); `exact: true` when another accessible name on the page contains this one.
- Assert with web-first assertions, which retry: `await expect(locator).toBeVisible()`, `toHaveText`, `toHaveURL`, `toHaveCount(0)`. Never `page.waitForTimeout`, and never `expect(await locator.isVisible()).toBe(true)`, which checks once.
- Data: the stub keeps its users for the life of the server, across tests, retries and (locally) runs. Create what a test needs with a unique value built from `testInfo.testId` and `testInfo.retry`, through the UI or through the `request` fixture against `API_ORIGIN`, and assert on that item only. Never assume an empty list or a fixed count.
- `page.route` only for a state the backend cannot produce on demand (a 500, a race, a hang), with a comment saying so. The fulfilled response carries `access-control-allow-origin`, because the API is cross-origin from the app.
- Never route a failure that a route's error screen shows (a loader's 500): the production build's `rootErrorHandlers` report it, Chromium raises a `pageerror` with the error's message (`internal server error`), and the guard fails the spec by design. Error screens are route tests; a not-found page and a failed background refresh (a toast) pass the guard.
- `page.clock.install()` before `page.goto`, then `page.clock.fastForward("01:00")` to move the app past a stale time; never wait real time.
- Accessibility: `AxeBuilder` with the WCAG 2.0, 2.1 and 2.2 A/AA tags, after the page's heading is visible, under `page.emulateMedia({ colorScheme: "light" })` and `"dark"`. `expect(violations).toEqual([])` prints every violation on failure.
- When an E2E test needs a new endpoint, add it to `e2e/stub-api.ts` with the backend's paths, status codes and error body, so the same suite runs unchanged against the real backend. A second resource gets its own dispatcher, `routeOrders(request, response, url, id, rest)`, called from `createServer` as `if (resource === "orders") return routeOrders(...)`; more `if` lines push the `createServer` callback past Biome's cognitive-complexity limit of 15.
- Running: `pnpm test:e2e`; `pnpm exec playwright test --grep @smoke`; `pnpm exec playwright test --last-failed`. The build needs no environment beyond what the config passes.
- In CI a test that passes only on a retry fails the run (`failOnFlakyTests: isCI`); the retry is kept for its trace. Fix the shared state the trace shows, never raise `retries`. Reporters, browsers and the CI job are `frontend-tooling`'s.
