# The API-client package, the UI-kit package and the harness

Complete files for `packages/api`, `packages/ui` and `apps/ui-harness`, as built and checked in a
workspace at pnpm 12.22. Shown in the in-repository form: `"private": true`, no `version`, no
`files`. A package published for other repositories replaces `"private": true` with
`"version": "0.1.0"` and adds the `files` line given under each manifest.

## Contents

- [packages/api](#packagesapi)
- [What each app keeps](#what-each-app-keeps)
- [packages/ui](#packagesui)
- [The kit's CSS and the app's](#the-kits-css-and-the-apps)
- [Kit tests](#kit-tests)
- [apps/ui-harness](#appsui-harness)
- [Errors at the package boundary](#errors-at-the-package-boundary)

## packages/api

Moved from the app: `openapi.json`, `orval.config.ts`, `src/api/fetcher.ts`,
`src/api/api-error.ts` and their tests, `src/api/generated/`. `fetcher.ts` already imports
`./api-error`; `fetcher.test.ts` changes `@/test/server` to `./test/server`. `orval.config.ts`
drops the `api/` segment from its three paths (`src/generated/api.ts`, `src/generated/api.zod.ts`,
mutator `src/fetcher.ts`). The generated `api.ts` imports `'../fetcher.ts'`, which still resolves
after the move, so `api:generate` leaves the committed output unchanged.

```json
{
  "name": "@org/api",
  "private": true,
  "type": "module",
  "sideEffects": false,
  "exports": {
    "./api-error": "./src/api-error.ts",
    "./fetcher": "./src/fetcher.ts",
    "./generated/api": "./src/generated/api.ts",
    "./generated/api.msw": "./src/generated/api.msw.ts",
    "./generated/api.zod": "./src/generated/api.zod.ts"
  },
  "scripts": {
    "typecheck": "tsc",
    "test": "vitest run",
    "api:generate": "orval"
  },
  "peerDependencies": {
    "@faker-js/faker": "catalog:",
    "@tanstack/react-query": "catalog:",
    "msw": "catalog:",
    "react": "catalog:",
    "zod": "catalog:"
  },
  "peerDependenciesMeta": {
    "@faker-js/faker": { "optional": true },
    "msw": { "optional": true }
  },
  "devDependencies": {
    "@faker-js/faker": "catalog:",
    "@tanstack/react-query": "catalog:",
    "@types/node": "catalog:",
    "msw": "catalog:",
    "orval": "catalog:",
    "react": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:",
    "zod": "catalog:"
  }
}
```

Published form: `"files": ["src", "!src/**/*.test.ts", "!src/test"]`.

- Every library the generated files import is a peer, so the app's single copy serves both:
  `ApiError` checks with `instanceof` and the Query cache are per copy. `msw` and `faker` are
  imported only by `api.msw.ts`, which only tests load, so they are optional peers: a consumer
  without them installs neither, and one that has them shares its copy.
- `@tanstack/react-query` in this `package.json` is also what makes orval generate for Query 5;
  without it orval warns that it generates hooks for v4.
- `sideEffects: false`: importing a module only defines things; `configureApi` is a call.

`vitest.config.ts`, `src/test/server.ts` and `src/test/setup.ts`: the package's own MSW server
for the fetcher tests, which import it as `./test/server`. Its tests are `*.test.ts` and run in
Node, as in the app. The app's two setup files, with the `reportError` double, stay in the app;
package code never reports, so the packages' setups leave it out.

```ts
// packages/api/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { setupFiles: ["src/test/setup.ts"], sequence: { shuffle: true } },
});

// packages/api/src/test/server.ts
import { setupServer } from "msw/node";

export const server = setupServer();

// packages/api/src/test/setup.ts
import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "./server";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

## What each app keeps

The app's code changes import paths only: `@/api/api-error` becomes `@org/api/api-error`,
`@/api/fetcher` becomes `@org/api/fetcher`, `@/api/generated/api` becomes
`@org/api/generated/api` (likewise `.zod` and `.msw`). Each app configures the client once, in its
own `src/main.tsx`, and its `renderRoute` does the same for tests:

```ts
import { configureApi } from "@org/api/fetcher";

configureApi({ baseUrl: env.apiOrigin });
```

The module-level configuration lives in each app's bundle, so two apps never share it. The auth
seam is unchanged: `configureApi({ baseUrl, getToken, retryToken })` from the app's session module
(`keycloak-spa-auth`). `createQueryClient`, the `Register` declaration that types
`defaultError: ApiError | Error`, `RouteError` and anything else that knows the router stay in the
app.

`src/app/zod-config.ts` stays in each app, imported first in its `main.tsx`, and each app's
`vite.config.ts` keeps the `zod` group in `build.rolldownOptions.output.codeSplitting`. The
package's generated schemas import the same zod (one catalog version, one install), so their chunk
imports the app's `zod` chunk and `jitless` is set before any schema is built: checked on a
workspace build under the production CSP, with `api.zod` loaded from `packages/api`.

## packages/ui

Moved from the app: `src/shared/ui/button.tsx`, `text-field.tsx`, `toast.tsx` and `cx.ts`, with
their `./cx` imports unchanged. `route-error.tsx` stays in the app: it imports `ApiError` and the
router, and the kit depends on neither; its `./button` import becomes `@org/ui/button`.

```json
{
  "name": "@org/ui",
  "private": true,
  "type": "module",
  "sideEffects": ["*.css"],
  "exports": {
    "./button": "./src/button.tsx",
    "./text-field": "./src/text-field.tsx",
    "./toast": "./src/toast.tsx",
    "./styles.css": "./src/styles.css"
  },
  "scripts": {
    "typecheck": "tsc",
    "test": "vitest run"
  },
  "peerDependencies": {
    "@base-ui/react": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "tailwindcss": "catalog:"
  },
  "devDependencies": {
    "@base-ui/react": "catalog:",
    "@testing-library/dom": "catalog:",
    "@testing-library/jest-dom": "catalog:",
    "@testing-library/react": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "jsdom": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

Published form: `"files": ["src", "!src/**/*.test.tsx", "!src/test"]`.

- `cx.ts` has no `exports` entry: it is private to the kit, and an app that imports
  `@org/ui/cx` gets a resolution error. An app wrapper that needs `cx` keeps its own one-line copy.
- `tailwindcss` is a peer because the kit ships Tailwind source (`@theme`, `@source`), compiled by
  the app's Tailwind.
- `sideEffects: ["*.css"]` keeps the stylesheet when a bundler drops unused modules.

```ts
// packages/ui/vitest.config.ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "jsdom", setupFiles: ["src/test/setup-dom.ts"] },
});

// packages/ui/src/test/setup-dom.ts: the app's DOM setup without the router's scrollTo stub
import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/dom";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// The bound only ends a hang; a loaded CI machine must never reach it.
configure({ asyncUtilTimeout: 5_000 });

afterEach(() => {
  // `globals: false` turns off Testing Library's automatic cleanup.
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
```

## The kit's CSS and the app's

`packages/ui/src/styles.css` is the scaffold's `src/styles.css` without `@import "tailwindcss"`,
without the app's own scales and without the `#root` rule, plus `@source`:

```css
/* Imported by each app's styles.css right after @import "tailwindcss". */

/* Tailwind skips node_modules and the app's dependencies: scan this package's classes too. */
@source "./";

:root {
  color-scheme: light dark;

  --bg: light-dark(oklch(0.985 0 0), oklch(0.18 0 0));
  /* ...the scaffold's other role tokens, `--control` included... */
}

/* Only role colours exist as utilities: bg-red-500 generates nothing. */
@theme {
  --color-*: initial;
  --color-transparent: transparent;
  --color-current: currentColor;
}

@theme inline {
  --color-bg: var(--bg);
  /* ...one line per role token... */
}

@layer base {
  /* the scaffold's element defaults, unchanged */
}

/* Base UI's scrollbar rules, which <CSPProvider disableStyleElements> stops it injecting. */
.base-ui-disable-scrollbar {
  scrollbar-width: none;
}

.base-ui-disable-scrollbar::-webkit-scrollbar {
  display: none;
}
```

Each app's `src/styles.css`:

```css
@import "tailwindcss";
@import "@org/ui/styles.css";

@theme {
  --grid-template-columns-label: auto 1fr;
}

/* Popups portal to <body>; the app root is its own stacking context so they always sit above it. */
#root {
  isolation: isolate;
}
```

Measured on the production build: with `@source "./"` the app's CSS has the kit-only
`data-disabled:opacity-50` rule, without it the rule is absent. The path is relative to the kit's
CSS file, so it holds for a workspace link and for `node_modules` alike. Token values and
`@theme` mechanics are `tailwind-base-ui`'s; the app imports the kit's CSS, never its own copy of
the tokens.

## Kit tests

A kit test exists only inside the kit package, beside the wrapper, and renders it alone; the
apps' route tests still cover it inside screens. In a single app there is no kit test: route tests
cover a `src/shared/ui` wrapper (`frontend-testing`). In the kit this file is
`packages/ui/src/button.test.tsx`; the block is checked against the scaffold's `button.tsx`.

```tsx,verify,test
// file: src/shared/ui/button.test.tsx
import { render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { Button } from "./button";

test("a disabled button exposes its state to CSS and keeps the caller's layout class", () => {
  render(
    <Button variant="primary" disabled className="w-full">
      Save
    </Button>,
  );

  const button = screen.getByRole("button", { name: "Save" });
  expect(button).toHaveAttribute("data-disabled");
  expect(button).toHaveClass("bg-accent", "w-full");
});
```

## apps/ui-harness

A private Vite app that renders every kit component in its variants: the workshop during kit
work (`pnpm --filter ui-harness dev`) and, built and previewed under the production CSP, the
kit's CSP regression check in CI. It is never deployed. It is the kit's
check because it runs the kit's production build under the production CSP and Trusted Types,
which a component-catalogue preview does not; visual regression, when wanted, is `toHaveScreenshot` in its spec.

```json
{
  "name": "ui-harness",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@base-ui/react": "catalog:",
    "@org/ui": "workspace:*",
    "react": "catalog:",
    "react-dom": "catalog:"
  },
  "devDependencies": {
    "@playwright/test": "catalog:",
    "@tailwindcss/vite": "catalog:",
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "tailwindcss": "catalog:",
    "typescript": "catalog:",
    "vite": "catalog:"
  }
}
```

`vite.config.ts` (a second Vite config, so it is not compiled with the single-app snippets; it
passes `tsc` and Biome in the workspace):

```ts
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The production policy: preview fails the harness when a kit change needs an exception.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; object-src 'none'; base-uri 'none'; require-trusted-types-for 'script'; trusted-types 'none'";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { assetsInlineLimit: 0 },
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true, headers: { "Content-Security-Policy": CSP } },
});
```

`src/main.tsx` (imports `@org/ui/*`, so it compiles only in the workspace). `src/styles.css` is
the two `@import` lines above, and `index.html` the app's with the title changed.

```tsx
import { CSPProvider } from "@base-ui/react/csp-provider";
import { Toast } from "@base-ui/react/toast";
import { Button } from "@org/ui/button";
import { TextField } from "@org/ui/text-field";
import { ToastProvider } from "@org/ui/toast";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function Harness() {
  const toasts = Toast.useToastManager();
  return (
    <main className="grid max-w-md gap-6 p-6">
      <section aria-label="Button" className="flex gap-2">
        <Button variant="primary">Primary</Button>
        <Button>Secondary</Button>
        <Button disabled>Disabled</Button>
        <Button onClick={() => toasts.add({ title: "Saved" })}>Show toast</Button>
      </section>
      <section aria-label="TextField" className="grid gap-4">
        <TextField label="Name" />
        <TextField label="Email" error="Enter an email address." />
      </section>
    </main>
  );
}

function App() {
  const [manager] = useState(() => Toast.createToastManager());
  return (
    <ToastProvider manager={manager}>
      <Harness />
    </ToastProvider>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("index.html has no #root");
createRoot(container).render(
  <StrictMode>
    <CSPProvider disableStyleElements>
      <App />
    </CSPProvider>
  </StrictMode>,
);
```

`playwright.config.ts` is the app's, with both browser projects, one `webServer` and no stub API:

```ts
import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;
const APP_ORIGIN = "http://localhost:4174";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // A test that passes only on a retry fails CI; the retry still records its trace.
  failOnFlakyTests: isCI,
  reporter: isCI ? [["list"], ["junit", { outputFile: "test-results/junit.xml" }]] : "list",
  use: { baseURL: APP_ORIGIN, trace: "on-first-retry" },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    // Safari's engine on a phone-sized touch screen: the narrow layout and WebKit-only bugs.
    { name: "phone", use: devices["iPhone 17e"] },
  ],
  webServer: {
    // The production build under the production CSP.
    command: "pnpm build && pnpm preview",
    url: APP_ORIGIN,
    reuseExistingServer: !isCI,
    timeout: 120_000,
  },
});
```

`e2e/fixtures.ts` is a copy of the app's without `API_ORIGIN`: its auto fixture fails a test on a
console error, a page error or a `securitypolicyviolation`. The spec, at
`apps/ui-harness/e2e/csp.spec.ts`, imports `test` from it; a `<style>` appended at runtime fails it
with `Applying inline style violates the following Content Security Policy directive 'style-src
'self''`:

```ts,verify
// file: e2e/kit-csp.spec.ts
import { expect, test } from "./fixtures.ts";

test("every kit component renders under the production CSP", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Show toast" }).click();

  await expect(page.getByText("Saved")).toBeVisible();
});
```

A new kit component gets a section in `Harness` in the same change, so the CSP check exercises it.

## Errors at the package boundary

| Mistake | What fails |
|---|---|
| An app imports a file the kit does not export (`@org/ui/src/cx.ts`) | `tsc`: `TS2307: Cannot find module '@org/ui/src/cx.ts'`; `vite build`: `"./src/cx.ts" is not exported under the conditions ["module", "browser", "production", "import"] from package .../@org/ui (see exports field in .../package.json)` |
| A package imports another it does not declare | Biome: `Dependency @org/api isn't specified in packages/ui/package.json.`; the package's `tsc`: TS2307 |
| `@/x` inside a package | the package's `tsc`: TS2307; the boundary plugin: `A package never imports @/` |
| A stricter flag in one project's `tsconfig.json` | that project's `tsc` reports errors inside the packages' `src/` (TS4111 and the like) |
| Anything Node loads imports a value from a published source-only package: `vite.config.ts`, `orval.config.ts`, a script, a Playwright spec or fixture | `failed to load config from .../vite.config.ts` / `Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is currently unsupported for files under node_modules`; a Playwright spec fails to load with the same message. Vitest compiles the package and passes; `import type` is erased and safe |
| The kit's CSS without `@source "./"` | nothing fails: the app's CSS lacks every class used only inside the kit |
| Two packages depend on each other | install warns `There are cyclic workspace dependencies:` |
