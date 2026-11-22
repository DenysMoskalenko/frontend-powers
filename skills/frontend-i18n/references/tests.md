# Tests with real messages

Contents

- [`renderRoute` with an instance](#renderroute-with-an-instance)
- [Route tests](#route-tests)
- [The setup module's own test](#the-setup-modules-own-test)
- [What covers a missing key](#what-covers-a-missing-key)
- [No nested `$t()` with options](#no-nested-t-with-options)

## `renderRoute` with an instance

Route tests render the app's own JSON files, every language in memory, through a fresh instance per
render. `createI18n` with `resources` initializes synchronously, so `renderRoute` stays synchronous
and the first render already has its text. This is setup step 2, and the block is the complete file
for the bare scaffold: in an app with another add-on, merge the additions the setup reference lists
into the existing file (`frontend-project-structure` shows the combined one).

```tsx,verify
// file: src/test/render-route.tsx
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Resource, ResourceKey } from "i18next";
import { configureApi } from "@/api/fetcher";
import { createI18n, type Language } from "@/app/i18n";
import { createAppRouter } from "@/app/router";

/** The API origin route tests run against; MSW answers it. */
export const TEST_API_ORIGIN = "https://api.test";

// The app's own message files, every language in memory: the instance is ready before the render.
const messageFiles = import.meta.glob<ResourceKey>("/src/app/locales/*/*.json", {
  eager: true,
  import: "default",
});
const resources: Resource = {};
for (const [path, messages] of Object.entries(messageFiles)) {
  const [language = "", file = ""] = path.split("/").slice(-2);
  resources[language] = { ...resources[language], [file.replace(".json", "")]: messages };
}

/**
 * Renders the whole app at `path`: the real route tree, a fresh QueryClient, the app's providers
 * and real messages in `language`. Only the network is fake (MSW, per test).
 */
export function renderRoute(path: string, { language = "en" }: { language?: Language } = {}) {
  configureApi({ baseUrl: TEST_API_ORIGIN });
  const { i18n } = createI18n(language, resources);
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: [path] }),
    i18n,
  });
  const { queryClient } = router.options.context;
  // The app's defaults minus retries: a failed request shows its error at once, not after backoff.
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  const user = userEvent.setup();
  render(<RouterProvider router={router} />);
  return { user, router, i18n };
}
```

Existing calls (`renderRoute("/users")`) keep working: the default language is English and the
return value only gained `i18n`. The rest of `renderRoute` is `frontend-testing`'s.

## Route tests

Assert the text a user reads in one language, by role and name, as every route test does. A test
of another language passes `{ language: "ru" }`; a test of the switch itself changes it on the
returned instance (or through the switcher with `user.selectOptions`):

```tsx,verify,test
// file: src/routes/users/language.test.tsx
import { act, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { getListUsersMockHandler } from "@/api/generated/api.msw";
import { buildUser } from "@/test/factories/user";
import { renderRoute } from "@/test/render-route";
import { server } from "@/test/server";

test("switching to Russian re-renders dates in Russian and sets the page language", async () => {
  server.use(getListUsersMockHandler({ items: [buildUser()], total: 1, limit: 20, offset: 0 }));
  const { i18n } = renderRoute("/users");
  expect(await screen.findByText("Nov 1, 2026, 9:30 AM")).toBeInTheDocument();

  await act(() => i18n.changeLanguage("ru"));

  expect(screen.getByText("1 нояб. 2026 г., 09:30")).toBeInTheDocument();
  expect(document.documentElement).toHaveAttribute("lang", "ru");
});

test("a route renders in the language it is given", async () => {
  server.use(getListUsersMockHandler({ items: [buildUser()], total: 1, limit: 20, offset: 0 }));

  renderRoute("/users", { language: "ru" });

  expect(await screen.findByText("1 нояб. 2026 г., 09:30")).toBeInTheDocument();
});
```

With `keycloak-spa-auth`, which moves the users routes under `_signed-in/`, the test file lives at
`src/routes/_signed-in/users/language.test.tsx`; the URLs, and so the test, stay the same.

`act` wraps `changeLanguage` because the state change starts outside Testing Library. With the
users screen translated, the same test asserts `findByRole("heading", { name: "Пользователи" })`
and a plural: `test.each` over counts `1`, `3`, `5`, `21` in Russian catches a missing `_few` or
`_many` form. Never mock `react-i18next` or render keys (`cimode`, a `t` that echoes its key):
those tests pass with a missing key, a wrong plural form and a dropped variable.

## The setup module's own test

`pickLanguage`, the stored choice and the language side effects are app logic, tested beside
`src/app/i18n.ts`. Nothing here depends on message text:

```ts,verify,test
// file: src/app/i18n.test.ts
import { afterEach, expect, test } from "vitest";
import * as z from "zod";
import { createI18n, pickLanguage } from "@/app/i18n";

afterEach(() => localStorage.clear());

test.each([
  [["ru", "en-US"], "ru"],
  [[null, "de-AT", "ru-RU"], "ru"],
  [["en-GB"], "en"],
  [["<img src=x>", 42, "fr"], "en"],
  [[], "en"],
])("pickLanguage(%j) is %s", (candidates, language) => {
  expect(pickLanguage(candidates)).toBe(language);
});

test("the first language waits for every namespace and is not stored as a choice", async () => {
  const { i18n, ready } = createI18n("ru");
  await ready;

  for (const namespace of [i18n.options.ns ?? []].flat()) {
    expect(i18n.hasLoadedNamespace(namespace)).toBe(true);
  }
  expect(document.documentElement).toHaveAttribute("lang", "ru");
  expect(localStorage.getItem("app.language")).toBeNull();
});

test("a switch sets the page language, zod's messages and the stored choice", async () => {
  const { i18n } = createI18n("en", {});

  await i18n.changeLanguage("ru");

  expect(document.documentElement).toHaveAttribute("lang", "ru");
  expect(document.documentElement).toHaveAttribute("dir", "ltr");
  expect(localStorage.getItem("app.language")).toBe("ru");
  expect(z.string().min(2).safeParse("a").error?.issues[0]?.message).toBe(
    "Слишком маленькое значение: ожидалось, что string будет иметь >=2 символа",
  );
});
```

The second test loads the real files through the lazy backend, which keeps `src/app/i18n.ts`
inside the coverage gate. `localStorage` survives between tests in a file, so this file clears it.

## What covers a missing key

| Mistake | Caught by |
| --- | --- |
| key in code, not in `en` | `tsc` (typed keys), `status`, `extract --ci` |
| key in `en`, empty or absent in `ru` | `status` |
| variable missing in the call | `tsc` |
| variable dropped in a translation | `lint` (`checkTranslationPlaceholders`) |
| plural forms missing or out of order | `extract --ci` |
| a screen that renders the wrong key | the route test asserting the visible text |

No test asserts a key or loops over JSON files to compare languages: the gates already do, on every
file, in `pnpm check`. The one file loop is the guard below, which no gate covers.

## No nested `$t()` with options

On i18next 27.2.2 with `escapeValue: false`, a message such as `Hi $t(name, {"who": "{{who}}"})` lets
the value of `who` rewrite the nested call's options: `t("greet", { who: 'x", "lng": "ru' })`
renders the Russian `name`. React still escapes the result, so the harm is text from another
language or namespace, chosen by whoever controls the value. Messages here never nest: the value
goes through a second `t()` call and a plain variable (`t("greet", { name: t("name", { who }) })`
with `"greet": "Hi {{name}}"`), which renders the same input as text. A translator can still write
a nested call into any file, so a test fails on one:

```ts,verify,test
// file: src/app/locales.test.ts
import { expect, test } from "vitest";

// Releases after i18next 27.2.2 escape these values; delete this test once one is pinned.
const messageFiles = import.meta.glob<string>("./locales/*/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
});

test("no message file nests a $t() call with options", () => {
  const nesting = Object.entries(messageFiles).filter(([, text]) => /\$t\([^)]*,\s*\{/.test(text));

  expect(nesting.map(([path]) => path)).toEqual([]);
});
```
