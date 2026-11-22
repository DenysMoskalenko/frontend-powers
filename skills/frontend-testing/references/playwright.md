# Playwright end-to-end tests

## Contents

- [What belongs in E2E](#what-belongs-in-e2e)
- [The guard fixture](#the-guard-fixture)
- [The scaffold's suite](#the-scaffolds-suite)
- [Rules](#rules)
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

## An app with add-ons

`keycloak-spa-auth` and `frontend-realtime` each give `e2e/fixtures.ts`, `playwright.config.ts`
and the CI `e2e` job for the bare scaffold. Both follow one convention, so their additions combine
by union:

- One `test.extend` carries every add-on's fixtures and options. An option is a boolean that is
  `true` by default and that a spec turns off: `test.use({ signedIn: false })`,
  `test.use({ mockRealtime: false })`. The socket mock overrides `context`, so it exists before the
  sign-in fixture opens the first page.
- A server the suite needs has its origin in `e2e/fixtures.ts`, overridable by one variable,
  `E2E_<NAME>_ORIGIN`. Unset, Playwright starts the server in Docker as a `webServer` entry (bound
  to `127.0.0.1`, stopped with SIGTERM, ready when its `url` answers); set, a server already runs
  there and the entry is left out. Never the `CI` flag: `CI=1 pnpm test:e2e` on a workstation runs
  the containers as usual.
- One `webServer` array: the containers first, then the stub with every add-on's `env`, then the
  preview build with every `PUBLIC_*` origin.
- One CI `e2e` job with every service: on one network with the job (GitHub's job container,
  GitLab's `FF_NETWORK_PER_BUILD`), reached by name, configured by environment variables, waited
  for (`--health-cmd` on GitHub, `HEALTHCHECK_TCP_PORT` on GitLab), and named to the run in its
  `E2E_<NAME>_ORIGIN`.

With both add-ons, `e2e/keycloak-realm.ts`, `e2e/stub-api.ts` and the specs are as the add-ons give
them; the two files that change are these:

```ts,verify
// file: e2e/fixtures.ts
import { test as base, expect } from "@playwright/test";

/** Where the stub API listens; a real backend's origin works the same way. */
export const API_ORIGIN = "http://127.0.0.1:4010";
/** Keycloak: a container `playwright.config.ts` starts, unless E2E_AUTH_ORIGIN names one (CI). */
export const AUTH_ORIGIN = process.env.E2E_AUTH_ORIGIN ?? "http://127.0.0.1:8080";
/** Centrifugo: a container `playwright.config.ts` starts, unless E2E_REALTIME_ORIGIN names one (CI). */
export const REALTIME_ORIGIN = process.env.E2E_REALTIME_ORIGIN ?? "http://127.0.0.1:8100";
/** The password of the users `e2e/keycloak-realm.ts` creates, `e2e-0` to `e2e-<workers - 1>`. */
export const E2E_PASSWORD = "e2e-password";

/**
 * Every test fails on a console error, an uncaught page error or a CSP / Trusted Types violation.
 * "Failed to load resource" is the browser logging an HTTP error status a test asked for.
 */
export const test = base.extend<{
  guard: undefined;
  mockRealtime: boolean;
  signedIn: boolean;
  signIn: undefined;
}>({
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
  // A spec that needs a push writes `test.use({ mockRealtime: false })` and talks to Centrifugo.
  mockRealtime: [true, { option: true }],
  // The socket opens and never answers, so a page that follows a channel stays "Connecting".
  context: async ({ context, mockRealtime }, use) => {
    if (mockRealtime) await context.routeWebSocket(/\/connection\/websocket$/, () => {});
    await use(context);
  },
  // A spec that tests the signed-out state writes `test.use({ signedIn: false })`.
  signedIn: [true, { option: true }],
  // Tokens live in memory, so every page load runs the code flow again; only this first one shows
  // Keycloak's form, later ones pass on its SSO cookie.
  signIn: [
    async ({ page, signedIn }, use, testInfo) => {
      if (signedIn) {
        await page.goto("/users");
        await page
          .getByRole("textbox", { name: "Username or email" })
          .fill(`e2e-${testInfo.parallelIndex}`);
        await page.getByRole("textbox", { name: "Password" }).fill(E2E_PASSWORD);
        await page.getByRole("button", { name: "Sign In" }).click();
        // Signed in once the app shows it: a navigation started earlier races the app's start.
        await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
      }
      await use(undefined);
    },
    { auto: true },
  ],
});

export { expect };
```

```ts,verify
// file: playwright.config.ts
import { defineConfig, devices } from "@playwright/test";
import { API_ORIGIN, AUTH_ORIGIN, REALTIME_ORIGIN } from "./e2e/fixtures.ts";

const isCI = !!process.env.CI;
const APP_ORIGIN = "http://localhost:4173";

/** Keycloak's settings, test only; both CI files give their service the same. */
const keycloakEnv = { KC_BOOTSTRAP_ADMIN_USERNAME: "admin", KC_BOOTSTRAP_ADMIN_PASSWORD: "admin" };

/** Centrifugo's settings; both CI files give their service the same, with `build` as the host. */
const centrifugoEnv = {
  CENTRIFUGO_HTTP_API_KEY: "e2e-api-key",
  CENTRIFUGO_HEALTH_ENABLED: "true",
  CENTRIFUGO_CLIENT_ALLOWED_ORIGINS: APP_ORIGIN,
  CENTRIFUGO_CLIENT_PROXY_CONNECT_ENABLED: "true",
  CENTRIFUGO_CLIENT_PROXY_CONNECT_ENDPOINT: `http://host.docker.internal:${new URL(API_ORIGIN).port}/centrifugo/connect`,
  CENTRIFUGO_CHANNEL_NAMESPACES: JSON.stringify([
    { name: "users", allow_subscribe_for_client: true },
  ]),
};

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // A test that passes only on a retry fails CI; the retry still records its trace.
  failOnFlakyTests: isCI,
  reporter: isCI ? [["list"], ["junit", { outputFile: "test-results/junit.xml" }]] : "list",
  use: { baseURL: APP_ORIGIN, trace: "on-first-retry" },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  // Creates the realm and its users in whichever Keycloak AUTH_ORIGIN names.
  globalSetup: "./e2e/keycloak-realm.ts",
  webServer: [
    // Keycloak in Docker, on this machine only; none where E2E_AUTH_ORIGIN names one (CI).
    ...(process.env.E2E_AUTH_ORIGIN
      ? []
      : [
          {
            command: [
              `docker run --rm --name app-e2e-keycloak -p 127.0.0.1:${new URL(AUTH_ORIGIN).port}:8080`,
              ...Object.keys(keycloakEnv).map((name) => `-e ${name}`),
              "quay.io/keycloak/keycloak:26.8.2 start-dev",
            ].join(" "),
            env: keycloakEnv,
            url: `${AUTH_ORIGIN}/realms/master`,
            // The default SIGKILL ends the docker CLI and leaves the container running.
            gracefulShutdown: { signal: "SIGTERM" as const, timeout: 10_000 },
            reuseExistingServer: true,
            timeout: 180_000,
          },
        ]),
    // Centrifugo in Docker, on this machine only; none where E2E_REALTIME_ORIGIN names one (CI).
    ...(process.env.E2E_REALTIME_ORIGIN
      ? []
      : [
          {
            command: [
              `docker run --rm --name app-e2e-centrifugo -p 127.0.0.1:${new URL(REALTIME_ORIGIN).port}:8000`,
              "--add-host=host.docker.internal:host-gateway",
              ...Object.keys(centrifugoEnv).map((name) => `-e ${name}`),
              "centrifugo/centrifugo:v6.10.3",
            ].join(" "),
            env: centrifugoEnv,
            url: `${REALTIME_ORIGIN}/health`,
            // The default SIGKILL ends the docker CLI and leaves the container running.
            gracefulShutdown: { signal: "SIGTERM" as const, timeout: 10_000 },
            reuseExistingServer: true,
          },
        ]),
    {
      command: "node e2e/stub-api.ts",
      url: `${API_ORIGIN}/health/live`,
      env: {
        PORT: new URL(API_ORIGIN).port,
        // Reachable from the Centrifugo container, not only from this machine.
        HOST: "0.0.0.0",
        CENTRIFUGO_API_URL: REALTIME_ORIGIN,
      },
      reuseExistingServer: !isCI,
    },
    {
      // The production build with the generated security headers, as users get it.
      command: "pnpm build && pnpm preview",
      url: APP_ORIGIN,
      env: {
        PUBLIC_API_ORIGIN: API_ORIGIN,
        PUBLIC_AUTH_ORIGIN: AUTH_ORIGIN,
        PUBLIC_REALTIME_ORIGIN: REALTIME_ORIGIN.replace(/^http/, "ws"),
      },
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
```

The `e2e` job in `.github/workflows/ci.yml`, both services side by side:

```yaml
  e2e:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    # Pinned by digest; the tag in the comment equals @playwright/test in package.json. It carries the browsers.
    container:
      image: mcr.microsoft.com/playwright@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579 # v1.65.1-noble
      # `build`: the name Centrifugo calls the stub's connect proxy by.
      options: --user 1001 --network-alias build
    services:
      keycloak:
        image: quay.io/keycloak/keycloak@sha256:7e66a96e4739239070aeaf72e4c5decf0f7f682cfc725b9f7ea2b336eaba38b3 # 26.8.2
        command: start-dev
        env:
          # Test only, like the realm.
          KC_BOOTSTRAP_ADMIN_USERNAME: admin
          KC_BOOTSTRAP_ADMIN_PASSWORD: admin
        options: --health-cmd "exec 3<>/dev/tcp/127.0.0.1/8080" --health-interval 2s --health-retries 90
      centrifugo:
        image: centrifugo/centrifugo@sha256:33fdbbce7d195dde316cbde17bc1d2a17b9e345de82799d1ec3c2bb8916e3803 # v6.10.3
        env:
          CENTRIFUGO_HTTP_API_KEY: e2e-api-key
          CENTRIFUGO_HEALTH_ENABLED: "true"
          CENTRIFUGO_CLIENT_ALLOWED_ORIGINS: http://localhost:4173
          CENTRIFUGO_CLIENT_PROXY_CONNECT_ENABLED: "true"
          CENTRIFUGO_CLIENT_PROXY_CONNECT_ENDPOINT: http://build:4010/centrifugo/connect
          CENTRIFUGO_CHANNEL_NAMESPACES: '[{"name":"users","allow_subscribe_for_client":true}]'
        options: --health-cmd "wget -qO- http://127.0.0.1:8000/health" --health-interval 2s --health-retries 15
    env:
      E2E_AUTH_ORIGIN: http://keycloak:8080
      E2E_REALTIME_ORIGIN: http://centrifugo:8000
    steps:
      # ... as in the scaffold
```

The `e2e` job in `.gitlab-ci.yml`:

```yaml
e2e:
  # ... stage, image, script and artifacts as in the scaffold
  services:
    - name: quay.io/keycloak/keycloak@sha256:7e66a96e4739239070aeaf72e4c5decf0f7f682cfc725b9f7ea2b336eaba38b3 # 26.8.2
      alias: keycloak
      command: ["start-dev"]
      variables:
        # Test only, like the realm.
        KC_BOOTSTRAP_ADMIN_USERNAME: admin
        KC_BOOTSTRAP_ADMIN_PASSWORD: admin
        HEALTHCHECK_TCP_PORT: "8080"
    - name: centrifugo/centrifugo@sha256:33fdbbce7d195dde316cbde17bc1d2a17b9e345de82799d1ec3c2bb8916e3803 # v6.10.3
      alias: centrifugo
      variables:
        CENTRIFUGO_HTTP_API_KEY: e2e-api-key
        CENTRIFUGO_HEALTH_ENABLED: "true"
        CENTRIFUGO_CLIENT_ALLOWED_ORIGINS: http://localhost:4173
        CENTRIFUGO_CLIENT_PROXY_CONNECT_ENABLED: "true"
        CENTRIFUGO_CLIENT_PROXY_CONNECT_ENDPOINT: http://build:4010/centrifugo/connect
        CENTRIFUGO_CHANNEL_NAMESPACES: '[{"name":"users","allow_subscribe_for_client":true}]'
        HEALTHCHECK_TCP_PORT: "8000"
  variables:
    # The job and its services on one network, each reached by its name.
    FF_NETWORK_PER_BUILD: "true"
    E2E_AUTH_ORIGIN: http://keycloak:8080
    E2E_REALTIME_ORIGIN: http://centrifugo:8000
```

Each origin and port is written once in these files: the servers' in `e2e/fixtures.ts`, the app's in
`APP_ORIGIN`. Another preview port also changes `preview.port` in `vite.config.ts`; another preview
or stub port changes `CENTRIFUGO_CLIENT_ALLOWED_ORIGINS` and the proxy endpoint in both CI files.
A third add-on with a server follows the same shape: its origin and variable in the fixtures, its
container entry, its service.
