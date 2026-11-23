# Adding translations to the scaffold

Contents

- [Steps](#steps)
- [Install](#install)
- [`src/app/i18n.ts`](#srcappi18nts)
- [`src/main.tsx`](#srcmaintsx)
- [`src/app/router.tsx`](#srcapproutertsx)
- [Message files](#message-files)
- [Typed keys](#typed-keys)
- [What loads when, and the entry budget](#what-loads-when-and-the-entry-budget)

Every block in these references is the complete file for the bare scaffold. In an app that already
has another add-on (`keycloak-spa-auth`, `frontend-realtime`) or its own changes, merge the
additions listed here into the existing file and never replace it; `frontend-project-structure`'s
app-composition reference shows the combined files. What this add-on adds, per file:

- `src/main.tsx`: `createI18n(pickLanguage(...))`, `i18n` passed to `createAppRouter`, the router's
  first load started at once, and the render moved into `ready.then(render).catch(startFailed)`.
- `src/app/router.tsx`: an `i18n: I18n` parameter and `<I18nextProvider>` in `Wrap`, inside
  `CSPProvider`, around `QueryClientProvider`.
- `src/test/render-route.tsx`: the message-file glob, a `language` option, the instance passed to
  `createAppRouter` and returned.
- `src/routes/__root.tsx`: `<LanguageSelect languages={LANGUAGES} />` in the header.
- `src/shared/lib/format-date.ts`: a `language` parameter on `formatDateTime` and `formatDate`, one
  formatter per language; each caller (`src/features/users/user-table.tsx`, `user-details.tsx`)
  passes `i18n.language` from `useTranslation()`.
- `src/shared/hooks/use-app-form.tsx`: field errors by `code` or issue kind (messages reference).
- Text an add-on added before this one: `t()` calls for `keycloak-spa-auth`'s Sign in, Sign out and
  no-access screen and `frontend-realtime`'s `LiveStatus` labels; the lint baseline would keep the
  first English, and lint never sees the second, a table outside JSX.
- `pnpm-workspace.yaml`: `"@swc/core": false` under `allowBuilds`.
- `package.json`, `biome.json`, `knip.json`, `.pre-commit-config.yaml` and the CI file the app has:
  the lines in the gates reference.
- `vite.config.ts`: `ENTRY_BUDGET_BYTES` raised by the growth `pnpm build` reports.

## Steps

In this order; after the last one `pnpm check`, `pnpm build` and `pnpm test:e2e` are green.

1. Add `"@swc/core": false` to `allowBuilds`, then install ([Install](#install)).
2. Add `src/app/i18n.ts`, then replace `src/main.tsx`, `src/app/router.tsx` and, from the tests
   reference, `src/test/render-route.tsx`: `tsc` fails until all three are in, because the router
   now requires `i18n`.
3. Replace `src/shared/lib/format-date.ts` and pass `i18n.language` at each caller (messages
   reference, which shows `user-table.tsx`): `tsc` lists the callers with `TS2554`. Replace
   `src/shared/hooks/use-app-form.tsx` from the same reference. A field now shows the app's text,
   not zod's or the server's: the scaffold's `users/new.test.tsx` asserts `Invalid email address`
   and `This email is already taken.`, which become the `fieldErrors.email` and
   `fieldErrors.taken` text written in step 7.
4. Add the language switcher and mount it in `src/routes/__root.tsx` (messages reference); until
   something imports `LANGUAGES`, knip reports it unused.
5. Add `src/app/i18n.dom.test.ts` (tests reference), which keeps CI's coverage gate green.
6. Add `i18next.config.ts` and the lines the gates reference lists for `package.json`, `biome.json`,
   `knip.json`, the hook and CI.
7. Run `pnpm i18n:extract`, write the text of the new keys into every
   `src/app/locales/<language>/common.json` (the switcher's `language` label, the field errors), run it again, then
   format `src/app/i18next.d.ts` and add `strictKeyChecks: true` ([Typed keys](#typed-keys)).
8. Run `pnpm exec i18next-cli lint --update-baseline` once and commit
   `i18next-lint-baseline.json`: it records the English JSX the app already has. After that a new
   finding is translated, never baselined.
9. Run `pnpm build` and raise `ENTRY_BUDGET_BYTES` by the growth it reports
   ([the entry budget](#what-loads-when-and-the-entry-budget)).

## Install

```bash
pnpm add i18next react-i18next
pnpm add -D i18next-cli
```

i18next-cli brings `@swc/core`, whose postinstall only re-checks a binary an optional dependency
already installed. Without a decision in `pnpm-workspace.yaml`, pnpm stops with
`ERR_PNPM_IGNORED_BUILDS ... Ignored build scripts: @swc/core@<version>`. Beside the scaffold's
entries:

```yaml
allowBuilds:
  # Both postinstalls only re-check the platform binary that an optional dependency already installed.
  esbuild: false
  workerd: false
  # i18next-cli's parser; the postinstall only re-checks the platform binary.
  "@swc/core": false
```

No language-detector package: choosing the language is `pickLanguage` below.

## `src/app/i18n.ts`

The setup module. It lives in `src/app/` because it is composition; components reach the instance
through `useTranslation()`, never by importing this file (`features/` and `shared/` cannot).

```ts,verify
// file: src/app/i18n.ts
import { type BackendModule, createInstance, type Resource, type ResourceKey } from "i18next";

export const LANGUAGES = ["en", "ru"] as const;
export type Language = (typeof LANGUAGES)[number];

const FALLBACK_LANGUAGE: Language = "en";
const STORAGE_KEY = "app.language";

// One chunk per language and namespace; none of them is in the entry bundle.
const messageFiles = import.meta.glob<ResourceKey>("./locales/*/*.json", { import: "default" });
const NAMESPACES = [
  ...new Set(
    Object.keys(messageFiles).map((path) => path.slice(path.lastIndexOf("/") + 1, -".json".length)),
  ),
];

const lazyMessages: BackendModule = {
  type: "backend",
  callbackApi: false,
  init() {},
  read(language: string, namespace: string) {
    const load = messageFiles[`./locales/${language}/${namespace}.json`];
    if (!load) throw new Error(`No messages for ${language}/${namespace}`);
    return load();
  },
};

const asLanguage = (value: unknown) => LANGUAGES.find((language) => language === value);

/** The stored choice, then the browser's languages, then English: the first one the app offers. */
export function pickLanguage(candidates: readonly unknown[]): Language {
  for (const candidate of candidates) {
    const language = typeof candidate === "string" && asLanguage(candidate.split("-")[0]);
    if (language) return language;
  }
  return FALLBACK_LANGUAGE;
}

export function storedLanguage(): unknown {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // storage blocked: fall through to the browser's languages
  }
}

/**
 * One instance per app or test, like the QueryClient. With `resources` (tests) it is ready on
 * return; without, `ready` resolves once the language's message files have loaded, and rejects
 * when one of them failed.
 */
export function createI18n(language: Language, resources?: Resource) {
  const i18n = createInstance();
  // i18next resolves `init` and `changeLanguage` when a file fails and shows the fallback or keys.
  const failed = new Map<string, Error>();
  i18n.on("failedLoading", (lng, ns, cause) => {
    failed.set(lng, new Error(`The ${lng}/${ns} messages did not load`, { cause }));
  });
  let current: string = language;
  i18n.on("languageChanged", (lng) => {
    const error = i18n.isInitialized && lng !== current && failed.get(lng);
    if (error) {
      reportError(error);
      void i18n.changeLanguage(current);
      return;
    }
    // The first language follows the browser; only a later switch is the user's choice.
    const chosen = i18n.isInitialized && lng !== current;
    current = lng;
    document.documentElement.lang = lng;
    document.documentElement.dir = i18n.dir(lng);
    if (chosen) rememberLanguage(lng);
  });
  if (!resources) i18n.use(lazyMessages);
  const init = i18n.init({
    lng: language,
    supportedLngs: LANGUAGES,
    fallbackLng: FALLBACK_LANGUAGE,
    ns: NAMESPACES,
    defaultNS: "common",
    // React escapes text; i18next escaping would show `&amp;` in the page.
    interpolation: { escapeValue: false },
    // Every namespace of the language is loaded before the first render and before a switch.
    react: { useSuspense: false },
    ...(resources && { resources, initAsync: false }),
  });
  const ready = init.then(() => {
    const [error] = failed.values();
    if (error) throw error;
  });
  return { i18n, ready };
}

function rememberLanguage(language: string) {
  try {
    localStorage.setItem(STORAGE_KEY, language);
  } catch {
    // storage blocked: the choice lasts for this page
  }
}
```

| Line | Why |
| --- | --- |
| `createInstance()`, not the default `i18next` export | Each router gets its own instance, so a test that switches to Russian cannot leak into the next shuffled test; no module singleton, as with the QueryClient. |
| `LANGUAGES` / `supportedLngs` | The only languages the app offers. i18next appends `cimode` to `supportedLngs` itself; `changeLanguage("de")` with `de` unlisted resolves to the fallback. |
| `fallbackLng: FALLBACK_LANGUAGE` | i18next 27 defaults it to `false`: a key missing in `ru` would render as the key instead of English. |
| `ns: NAMESPACES` from the glob | Every namespace of the active language (and of the fallback) loads before `ready` resolves and before `changeLanguage` emits, so nothing renders as keys. |
| `callbackApi: false` | `read` returns a promise; leaving the flag out makes i18next guess from the parameter count, which is deprecated. |
| `failedLoading` | A file that does not load (a network error, a chunk a new deploy removed) emits this event and nothing else: `init` and `changeLanguage` still resolve, and the screen shows the English fallback or keys. So `ready` rejects with it (the start-failure screen), and a later switch to that language reports it and switches back. i18next does not read a failed file again in that page; a reload does. |
| `current`, `chosen` | The switch back emits `languageChanged` for the language already in use: it restores `lang` and `dir` and is not stored as a choice. |
| `escapeValue: false` | React escapes interpolated values; the default `true` shows `&amp;`. A value with markup (`& <b>Jerry</b>`) still renders as text. On i18next 27.2.2 it also lets a value rewrite the options of a `$t(key, {...})` nested in a message, so messages never nest one (tests reference guard). |
| `react: { useSuspense: false }` | Nothing suspends, since all namespaces are loaded first; a namespace missing from the files renders its keys, which a route test shows at once, instead of an endless Suspense fallback. The root layout is the router's `shellComponent`, outside every Suspense boundary while the first page loads: a suspending `useTranslation` there would blank the page. react-i18next 18 keeps `react` options per instance. |
| `pickLanguage([stored, ...navigator.languages])` | The stored value is untrusted input, matched like a browser tag: a string whose primary subtag is in `LANGUAGES` passes (`ru-RU` -> `ru`), anything else is skipped. |
| `isInitialized` guard | The first `languageChanged` fires during `init`, before `isInitialized` is set, so only a later switch is stored and the first visit keeps following the browser. |
| `document.documentElement.lang` and `dir` | Screen readers, hyphenation and `:lang()` read `lang`; `i18n.dir(lng)` gives `rtl` for Arabic or Hebrew. |

`load` is left at its default `"all"`: languages are always bare (`en`, `ru`), so there is no
`en-US` to look up. With `ru` active the browser loads `ru` and the `en` fallback files.

## `src/main.tsx`

```tsx,verify
// file: src/main.tsx
import "@/app/zod-config";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { configureApi } from "@/api/fetcher";
import { env } from "@/app/env";
import { reloadOnStaleChunk, rootErrorHandlers } from "@/app/error-reporting";
import { createI18n, pickLanguage, storedLanguage } from "@/app/i18n";
import { createAppRouter } from "@/app/router";
import "@/styles.css";

configureApi({ baseUrl: env.apiOrigin });
const { i18n, ready } = createI18n(pickLanguage([storedLanguage(), ...navigator.languages]));
const router = createAppRouter({ i18n });
reloadOnStaleChunk(router);
// The first page's requests start now, beside the message files, not after them.
router.load().catch(reportError);

const container = document.getElementById("root");
if (!container) throw new Error("index.html has no #root");
const root = createRoot(container, rootErrorHandlers);

function render() {
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

function startFailed(error: unknown) {
  reportError(error);
  // English on purpose: the messages may not have loaded.
  // i18next-instrument-ignore-next-line
  root.render(<p role="alert">The app could not start. Reload the page to try again.</p>);
}

// The first screen renders in its language, never as keys. `catch` also catches a throw in render.
ready.then(render).catch(startFailed);
```

`ready` rejects when a message file fails to load, and `startFailed` reports it and renders the
one static message. With a session (`keycloak-spa-auth`) both join one promise,
`Promise.all([..., ready])` before `.catch(startFailed)`, every add-on uses the same function and
message, and the router is built once the session exists. Its first load then starts at once only
for a signed-in user: signed out, a guarded page leaves for sign-in, and leaving while the message
files load aborts them (WebKit rejects the imports), so `ready` rejects and the start fails
(`frontend-project-structure` shows the combined file). The
`i18next-instrument-ignore-next-line` directive keeps the lint gate from reporting the English text.

`router.load()` runs the first page's loaders while the message files load, so the first API
request no longer waits for them; `RouterProvider` sees a load that is running or finished and does
not start another (tests reference). On a production build in Chromium with 150 ms of added latency
per request, the first API request started about 300 ms earlier (about 420 ms at 400 ms latency).

A message file that fails on a later language switch no longer reloads the page: the scaffold's
`reloadOnStaleChunk` reloads only for a navigation, so `createI18n` reports the failure and keeps the
current language; the next navigation that misses a route chunk reloads.

## `src/app/router.tsx`

The scaffold's file with the instance as a required parameter and `I18nextProvider` in `Wrap`
inside `CSPProvider`, so `RouteError`, the toasts and every route see it in the app and in tests;
nothing else changes.

```tsx,verify
// file: src/app/router.tsx
import { CSPProvider } from "@base-ui/react/csp-provider";
import { Toast } from "@base-ui/react/toast";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createRouter,
  parseSearchWith,
  type RouterHistory,
  stringifySearchWith,
} from "@tanstack/react-router";
import type { i18n as I18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import { ApiError } from "@/api/api-error";
import { routeTree } from "@/routeTree.gen";
import { RouteError } from "@/shared/ui/route-error";
import { ToastProvider } from "@/shared/ui/toast";
import { createQueryClient } from "./query-client";

const NOTICES = {
  refresh: "Could not refresh the data",
  mutation: "The change was not saved",
} as const;

// The default parser rewrites `?q=1.50` to 1.5 and ids past 2^53 to another number: a top-level
// value is a number only when it prints back as typed, so free text and long ids stay text.
const exactJson = (value: string): unknown => {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed === "number" && String(parsed) !== value) throw new Error("not exact");
  return parsed;
};

/** The whole app: route tree, QueryClient, providers. `main.tsx` and every route test build it. */
export function createAppRouter({ history, i18n }: { history?: RouterHistory; i18n: I18n }) {
  const toastManager = Toast.createToastManager();
  const queryClient = createQueryClient((reason, error) =>
    toastManager.add({
      // One toast per reason: a repeated failure updates it, with its latest request id.
      id: reason,
      title: NOTICES[reason],
      description: error instanceof ApiError && error.requestId && `Request id: ${error.requestId}`,
      // A failure is announced at once and stays until dismissed: a 5 s polite toast is easy to miss.
      priority: "high",
      timeout: 0,
    }),
  );
  const router = createRouter({
    routeTree,
    context: { queryClient },
    ...(history && { history }),
    parseSearch: parseSearchWith(exactJson),
    stringifySearch: stringifySearchWith(JSON.stringify, exactJson),
    defaultPreload: "intent",
    // Query owns freshness: the router always runs loaders and waits for them; they read the cache.
    defaultPreloadStaleTime: 0,
    defaultStaleReloadMode: "blocking",
    scrollRestoration: true,
    // Each route catches its own error, so the root layout and its navigation stay on screen.
    defaultErrorComponent: RouteError,
    // The provider slot: app-wide providers (i18n, a realtime client) go here, once for app and tests.
    // biome-ignore lint/correctness/noComponentHookFactories: built once per router, which keeps it.
    Wrap: ({ children }) => (
      // Base UI's inline <style> tags would break the CSP's `style-src 'self'`.
      <CSPProvider disableStyleElements>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <ToastProvider manager={toastManager}>{children}</ToastProvider>
          </QueryClientProvider>
        </I18nextProvider>
      </CSPProvider>
    ),
  });
  // A screen reader hears nothing after a client-side navigation unless focus moves to the new page.
  // Not on the first render or a search-only change; `preventScroll` leaves scroll restoration alone.
  router.subscribe("onRendered", ({ fromLocation, pathChanged }) => {
    const heading = fromLocation && pathChanged && document.querySelector<HTMLElement>("main h1");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
```

The toast text is the next thing to translate (lint cannot see it: it is not JSX). `NOTICES` goes,
and each reason becomes a literal call, read when the toast shows; the router's tests keep passing
once `en/common.json` holds the same English words:

```tsx
id: reason,
title: reason === "refresh" ? i18n.t("notices.refresh") : i18n.t("notices.mutation"),
description:
  error instanceof ApiError &&
  error.requestId &&
  i18n.t("notices.requestId", { requestId: error.requestId }),
```

## Message files

```text
src/app/locales/
  en/common.json   layout, navigation, shared UI (the default namespace)
  en/users.json    one namespace per feature, named after its folder
  ru/common.json
  ru/users.json
```

One JSON v4 file per language and namespace. `common` holds what `src/routes/__root.tsx` and
`src/shared/ui` show; each feature reads its own namespace with `useTranslation("users")`. A key
used by two features lives in `common`, not in the other feature's file. Keys nest by screen part,
camelCase, describing the place, never the English text:

```json
{
  "details": {
    "created": "Created",
    "email": "Email"
  },
  "list": {
    "pageOf": "Page {{page}} of {{pages}}",
    "title": "Users"
  },
  "summary": {
    "total_one": "{{count, number}} user",
    "total_other": "{{count, number}} users"
  }
}
```

The Russian file carries the same keys with the plural forms Russian needs:

```json
{
  "summary": {
    "total_one": "{{count, number}} пользователь",
    "total_few": "{{count, number}} пользователя",
    "total_many": "{{count, number}} пользователей",
    "total_other": "{{count, number}} пользователя"
  }
}
```

Write these files only through `pnpm i18n:extract` plus your own text: the extractor adds new
keys (the key itself as the English value, `""` in the others), writes each language's plural
forms in CLDR order and deletes keys no code uses.

## Typed keys

`pnpm i18n:extract` runs `i18next-cli types` after extracting. It writes two files from the
English JSON:

| File | Contents | Committed | Biome |
| --- | --- | --- | --- |
| `src/app/resources.d.ts` | `export default interface Resources` with every message as a literal type; regenerated on every run | yes | excluded (default export, its own quoting) |
| `src/app/i18next.d.ts` | the `CustomTypeOptions` augmentation; written only when missing | yes | format it once, then edit by hand |

`src/app/i18next.d.ts` after `pnpm exec biome format --write src/app/i18next.d.ts` and one added
line:

```ts
// This file is automatically generated by i18next-cli, because it was not existing. You can edit it based on your needs: https://www.i18next.com/overview/typescript#custom-type-options
import type Resources from "./resources";

declare module "i18next" {
  interface CustomTypeOptions {
    enableSelector: false;
    strictKeyChecks: true;
    defaultNS: "common";
    resources: Resources;
  }
}
```

`strictKeyChecks: true` closes the one hole: without it `t("list.nope", "Default text")`
compiles, because a default value disables the key check. With the generated literal types `tsc`
fails on:

| Mistake | `tsc` says |
| --- | --- |
| `t("list.missingKey")` | TS2345 `Argument of type '"list.missingKey"' is not assignable to parameter of type '"details.created" \| ...` |
| `t("list.pageOf")`, variables left out | TS2345 `... & { 'pass these arguments as t() options': { page: string \| number; } & { pages: string \| number; }; }` |
| `t("list.pageOf", { page: 1 })` | TS2769 `No overload matches this call.`, then the same `'pass these arguments as t() options'` type |
| `` t(`table.${code}`) `` | TS2345 ``Argument of type '`table.${string}`' is not assignable to parameter of type`` |
| `t("summary.total")` without `count` | TS2345 `'pass these arguments as t() options': { count: number; }` |
| `t("list.invited", { context: "guest" })`, no `invited_guest` key | TS2769 `No overload matches this call.` |
| `<Trans i18nKey="list.helpx" />` | TS2322 `Type '"list.helpx"' is not assignable to type ...` |
| `t("list.nope", "Default text")` | TS2769 `No overload matches this call.` (compiles without `strictKeyChecks`) |

Typing from `typeof import("./locales/en/users.json")` instead widens every value to `string`, so
keys are checked and interpolation variables are not. The suffixed key itself
(`t("summary.total_one", { count })`) still compiles: write the base key. The selector API
(`t(($) => $.list.title)`, `enableSelector`) is not used: string keys are what the extractor,
the lint and every example read.

## What loads when, and the entry budget

| In the entry chunk | Loaded before the first render | Loaded on a switch |
| --- | --- | --- |
| i18next, react-i18next, `src/app/i18n.ts` | one chunk per namespace of the chosen language, plus the `en` fallback chunks | the new language's namespace chunks |

`vite build` emits each JSON file as its own hashed chunk (`common-<hash>.js`, `users-<hash>.js`
per language), served from `/assets/` with the immutable cache policy. i18next and react-i18next
must be in the entry, because the first render waits for them: measured on the scaffold after these
steps, the entry plus static imports grows by about 20 KB gzip (about 148 KB to 167 KB), over the
160 KB budget. Raise `ENTRY_BUDGET_BYTES` in `vite.config.ts` by the growth `pnpm build` reports
in your app, in the same change, naming i18next and react-i18next as the cause; never a fixed
number without the build; another add-on adds its own cost on top (`frontend-tooling` owns the budget
plugin).
Every namespace of a language loads at start. When one feature's messages grow large, loading
its namespace in that route's loader (`i18n.loadNamespaces`, with `i18n` added to the router
context) is the next step; measure first.
