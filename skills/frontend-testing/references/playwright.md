# Playwright end-to-end tests

## Contents

- [What belongs in E2E](#what-belongs-in-e2e)
- [The guard fixture](#the-guard-fixture)
- [The scaffold's suite](#the-scaffolds-suite)
- [Rules](#rules)
- [Test ids](#test-ids)
- [An app with add-ons](#an-app-with-add-ons)

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
import { test as base, expect, type Page } from "@playwright/test";

/** Where the stub API listens; a real backend's origin works the same way. */
export const API_ORIGIN = "http://127.0.0.1:4010";

interface Options {
  /** Errors a spec provokes on purpose (the route error screen reports one); others still fail it. */
  expectedErrors: RegExp[];
}

/**
 * Every test fails on a console error, an uncaught page error or a CSP / Trusted Types violation.
 * "Failed to load resource" is the browser logging an HTTP error status a test asked for.
 */
export const test = base.extend<Options & { guard: undefined }>({
  expectedErrors: [[], { option: true }],
  guard: [
    async ({ page, expectedErrors }, use) => {
      const problems: string[] = [];
      const record = (text: string) => {
        if (!expectedErrors.some((expected) => expected.test(text))) problems.push(text);
      };
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
          record(message.text());
        }
      });
      page.on("pageerror", (error) => record(error.message));
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

/** The page never scrolls sideways (a wide table scrolls inside its own container). */
export async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

export { expect };
```

A test that provokes an HTTP error status still passes: the browser's "Failed to load resource" line is filtered. Any other console error, an uncaught exception or a `securitypolicyviolation` fails the test after its body. The CSP itself is `frontend-deploy`'s; when the guard reports a violation, fix the code that caused it, never the filter.

- `expectedErrors` is the one way out: a spec that provokes an error on purpose lists it with `test.use({ expectedErrors: [/e2e: the user is unavailable/] })` at the top of its file. Match the error text the spec itself sends (a unique `error` string in the faked body), never a broad pattern such as `/500/` or `/.*/`, which would also let a CSP violation through.
- `expectNoSidewaysScroll(page)` runs after every page a spec visits, once its heading is visible: the page never scrolls sideways at any width; a wide table scrolls inside its own container (the rule is `tailwind-base-ui`'s).

## The scaffold's suite

`playwright.config.ts` runs every spec in two projects:

| Project | Device | For |
|---|---|---|
| `chromium` | `devices["Desktop Chrome"]` | the desktop layout in the engine most users run |
| `phone` | `devices["iPhone 17e"]`: WebKit, 390 × 664, touch | the narrow layout (with `expectNoSidewaysScroll`) and bugs only Safari's engine has |

The `phone` project runs the WebKit that ships with `@playwright/test`, which is newer than the oldest browsers the app supports, so neither project catches an API or CSS feature missing on the floor; that rule is `frontend-code-style`'s, and the floor `frontend-tooling`'s. Locally, install both engines once with `pnpm exec playwright install chromium webkit`; the CI image carries them. `--project=chromium` runs one.

Three specs ship: `smoke.spec.ts` (below), `errors.spec.ts` (the route error screen and "Try again", below), and `stale-chunk.spec.ts` (a deploy under an open tab: a hover over a link whose chunk is gone keeps the page, a click reloads onto the new build; the reload policy is `frontend-deploy`'s).

`e2e/smoke.spec.ts`:

```ts
import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { API_ORIGIN, expect, expectNoSidewaysScroll, test } from "./fixtures.ts";

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
    // The page, not the URL: with sign-in the layout shows while the browser leaves for it.
    await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
    await expectNoSidewaysScroll(page);
    await page.getByRole("link", { name: "New user" }).click();
    await expect(page.getByRole("heading", { name: "New user" })).toBeVisible();
    await expectNoSidewaysScroll(page);
    await page.getByRole("textbox", { name: "Name" }).fill("Ada Lovelace");
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(page.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expectNoSidewaysScroll(page);
    await page.getByRole("link", { name: "Users", exact: true }).click();
    await expect(page.getByRole("row", { name: new RegExp(email) })).toBeVisible();
    await expectNoSidewaysScroll(page);
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

  // A failure toast is assertive: Base UI announces it through a visually hidden alert.
  await expect(page.getByRole("alert")).toContainText("Could not refresh the data");
  await expect(page.getByRole("alert")).toContainText("Request id: e2e-500");
  await expect(page.getByRole("alertdialog", { includeHidden: true })).toBeVisible();
});

test("a slow first load shows the layout and the progress bar first", async ({ page }) => {
  const { promise: answered, resolve: answer } = Promise.withResolvers<void>();
  await page.route(`${API_ORIGIN}/users?*`, async (route) => {
    await answered;
    await route.continue();
  });

  await page.goto("/users");

  await expect(page.getByRole("navigation", { name: "Main" })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Loading page" })).toHaveCSS("opacity", "1");
  await expect(page.getByRole("heading", { name: "Users" })).toBeHidden();
  answer();
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  await expect(page.getByRole("progressbar")).toBeHidden();
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
      await expectNoSidewaysScroll(page);
      await expectNoAxeViolations(page);
    }
  }
});
```

`e2e/errors.spec.ts`, an error screen end to end:

```ts
import { API_ORIGIN, expect, test } from "./fixtures.ts";

// The router reports the failed load to the error funnel, which the guard would otherwise fail.
test.use({ expectedErrors: [/e2e: the user is unavailable/] });

test("a page that fails to load shows the error screen, and Try again recovers", async ({
  page,
  request,
}, testInfo) => {
  const created = await request.post(`${API_ORIGIN}/users`, {
    data: {
      name: "Edsger Dijkstra",
      email: `e2e-${testInfo.testId}-${testInfo.retry}@example.com`,
    },
  });
  const { id } = await created.json();
  // The stub cannot fail on demand: the first request for this user is answered with a 500 here.
  let failed = false;
  await page.route(`${API_ORIGIN}/users/${id}`, async (route) => {
    if (failed) return route.continue();
    failed = true;
    await route.fulfill({
      status: 500,
      headers: { "access-control-allow-origin": "*" },
      json: { error: "e2e: the user is unavailable", request_id: "e2e-500" },
    });
  });

  await page.goto(`/users/${id}`);

  await expect(page.getByRole("heading", { name: "This page could not be loaded" })).toBeVisible();
  await expect(page.getByText("Request id: e2e-500")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Edsger Dijkstra" })).toBeVisible();
});
```

The status is 500 because the query client retries a 502, 503 or 504 (`tanstack-query-api`'s rule), which would answer the retry from the stub before the screen shows.

## Rules

- Locate by role and accessible name (`page.getByRole("textbox", { name: "Email" })`); `exact: true` when another accessible name on the page contains this one. `getByTestId` only for an element with no stable accessible name (see [Test ids](#test-ids)).
- Assert with web-first assertions, which retry: `await expect(locator).toBeVisible()`, `toHaveText`, `toHaveURL`, `toHaveCount(0)`. Never `page.waitForTimeout`, and never `expect(await locator.isVisible()).toBe(true)`, which checks once.
- Data: the stub keeps its users for the life of the server, across tests, retries and (locally) runs. Create what a test needs with a unique value built from `testInfo.testId` and `testInfo.retry`, through the UI or through the `request` fixture against `API_ORIGIN`, and assert on that item only. Never assume an empty list or a fixed count.
- `page.route` only for a state the backend cannot produce on demand (a 500, a race, a hang), with a comment saying so. The fulfilled response carries `access-control-allow-origin`, because the API is cross-origin from the app.
- A failure that a route's error screen shows (a loader's 500) is reported by the production build's `rootErrorHandlers`, and the browser raises a `pageerror` with the error's message. One spec per error screen proves it renders and recovers in the real build, as `errors.spec.ts` does, with that message in `expectedErrors`; which message each `ApiError` shows stays a route test. A not-found page and a failed background refresh (a toast) pass the guard without the option.
- `page.clock.install()` before `page.goto`, then `page.clock.fastForward("01:00")` to move the app past a stale time; never wait real time.
- Accessibility: `AxeBuilder` with the WCAG 2.0, 2.1 and 2.2 A/AA tags, after the page's heading is visible, under `page.emulateMedia({ colorScheme: "light" })` and `"dark"`. `expect(violations).toEqual([])` prints every violation on failure.
- With `tailwind-base-ui`'s theme add-on (`public/theme.js` copies `localStorage` key `theme` to `<html data-theme>` before first paint), the scan also runs once per explicit choice, under the opposite OS scheme so the choice must win. Init scripts accumulate in order, so the later choice overrides the earlier one on every `goto`:

```ts
for (const choice of ["light", "dark"] as const) {
  await page.emulateMedia({ colorScheme: choice === "dark" ? "light" : "dark" });
  await page.addInitScript((theme) => localStorage.setItem("theme", theme), choice);
  for (const [path, heading] of pages) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("data-theme", choice);
    await expectNoAxeViolations(page);
  }
}
```
- When an E2E test needs a new endpoint, add it to `e2e/stub-api.ts` with the backend's paths, status codes and error body, so the same suite runs unchanged against the real backend. A second resource gets its own dispatcher, `routeOrders(request, response, url, id, rest)`, called from `createServer` as `if (resource === "orders") return routeOrders(...)`; more `if` lines push the `createServer` callback past Biome's cognitive-complexity limit of 15.
- Running: `pnpm test:e2e`; `pnpm exec playwright test --grep @smoke`; `pnpm exec playwright test --last-failed`. The build needs no environment beyond what the config passes.
- In CI a test that passes only on a retry fails the run (`failOnFlakyTests: isCI`); the retry is kept for its trace. Fix the shared state the trace shows, never raise `retries`. Reporters, browsers and the CI job are `frontend-tooling`'s.

## Test ids

`data-testid` is a house convention for automation outside the repository (a QA team's suite, a monitoring script), which cannot rely on visible text that changes with wording and language:

- On form controls, action buttons, table rows or cards, dialogs and page containers; not on every element.
- Named `<feature>-<element>` in kebab-case; a row or card adds the entity id. The template's users feature: `users-list-page`, `users-detail-page`, `users-new-page`, `users-create-form`, `users-create-name`, `users-create-email`, `users-create-submit`, `users-row-<id>`.
- Never derived from visible text, never personal data (an email, a name): the attributes ship in the production build.
- `src/shared/ui` wrappers forward it to the interactive DOM element (`tailwind-base-ui`'s rule).
- Another attribute name (`data-qa`) is set once, in `playwright.config.ts` as `use: { testIdAttribute: "data-qa" }` and in `src/test/setup-dom.ts` as `configure({ testIdAttribute: "data-qa" })`, so `getByTestId` reads it in both runners.

Specs and route tests in the repository still query by role and name first, which also checks the accessible name; a test id is their fallback for an element with no stable accessible name, such as a row picked by entity id: ``page.getByTestId(`users-row-${id}`)``.

## An app with add-ons

An add-on with a server keeps its end-to-end support in one file that exports a `test` built with
`base.extend`: `e2e/auth.ts` (`keycloak-spa-auth`: the realm import, the Keycloak container, one
sign-in per worker, `signedIn`) and `e2e/realtime.ts` (`frontend-realtime`: the socket mock,
Centrifugo started on first use, `mockRealtime`, the teardown). Each reference shows its file, its
spec and the two shared files with that add-on alone. With both, the shared files only import and
list, always in the same order (auth, then realtime), so adding the add-ons in either order gives
the same files:

```ts
// e2e/fixtures.ts: the template's `test` is renamed `app`; nothing else changes
import { test as base, expect, mergeTests, type Page } from "@playwright/test";
import { test as auth } from "./auth.ts";
import { test as realtime } from "./realtime.ts";
// ... `const app = base.extend<Options & { guard: undefined }>({ ... });` as in the template
export const test = mergeTests(app, auth, realtime);
```

```ts
// playwright.config.ts: two imports, then below `projects`
import { authBuildEnv, authServers } from "./e2e/auth.ts";
import { realtimeBuildEnv } from "./e2e/realtime.ts";
// ...
  // Creates the realm and its users in whichever Keycloak `AUTH_ORIGIN` names.
  globalSetup: "./e2e/auth.ts",
  // Removes the Centrifugo container a spec started on this machine.
  globalTeardown: "./e2e/realtime.ts",
  webServer: [
    ...authServers,
    // the stub, then the preview build, as in the template, with the build's env:
    // env: { PUBLIC_API_ORIGIN: API_ORIGIN, ...authBuildEnv, ...realtimeBuildEnv },
  ],
```

- Each server is chosen by its own `E2E_<NAME>_ORIGIN`, never by `CI`. Keycloak is a `webServer`
  entry; Centrifugo has none, because only a spec with `test.use({ mockRealtime: false })` starts
  it. A second add-on with a global setup or teardown makes the key an array.
- The fixtures do not meet: the sign-in runs once per worker in its own context, and the socket
  mock overrides each test's `context`.
- The template's specs keep passing with sign-in: each `page.goto` of a guarded page goes to
  Keycloak and back, so a spec waits for something only the signed-in page shows, never the URL,
  and `e2e/stale-chunk.spec.ts` counts page loads from the moment its link shows.
- The CI `e2e` job gets both services in the same order, Keycloak first, each as its add-on's
  reference gives it, and both origins: on GitHub one `services` map and one `env` map
  (`E2E_AUTH_ORIGIN`, `E2E_REALTIME_ORIGIN`); on GitLab one `services` list and one `variables` map
  that also keeps Keycloak's `FF_NETWORK_PER_BUILD: "true"`.
- The preview origin appears once more, in Centrifugo's `CENTRIFUGO_CLIENT_ALLOWED_ORIGINS` in both
  CI files: another preview port changes it with `APP_ORIGIN` and `preview.port`.

Run this way with `keycloak-spa-auth`, `frontend-realtime`, `frontend-i18n` and Faro, added in
both orders: the template's specs and both add-ons' specs passed in `chromium` and `phone`.
