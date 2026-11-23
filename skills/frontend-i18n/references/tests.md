# Tests with real messages

Contents

- [`renderRoute` with an instance](#renderroute-with-an-instance)
- [Route tests](#route-tests)
- [The setup module's own test](#the-setup-modules-own-test)
- [The first load](#the-first-load)
- [Field errors in two languages](#field-errors-in-two-languages)
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

`pickLanguage`, the stored choice, the language side effects and a failed message file are app
logic, tested beside `src/app/i18n.ts`; the file needs the DOM. A namespace with no file stands in
for a message chunk that fails to download: the backend's `read` throws for it, as a failed import
rejects.

```ts,verify,test
// file: src/app/i18n.dom.test.ts
import { expect, test, vi } from "vitest";
import { createI18n, pickLanguage } from "@/app/i18n";

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

test("a switch sets the page language and the stored choice", async () => {
  const { i18n } = createI18n("en", {});

  await i18n.changeLanguage("ru");

  expect(document.documentElement).toHaveAttribute("lang", "ru");
  expect(document.documentElement).toHaveAttribute("dir", "ltr");
  expect(localStorage.getItem("app.language")).toBe("ru");
});

test("a message file that fails at start rejects ready", async () => {
  const { i18n, ready } = createI18n("ru");
  void i18n.reloadResources("ru", "missing");

  await expect(ready).rejects.toThrow("The ru/missing messages did not load");
});

test("a switch to a language whose file fails is reported and keeps the current language", async () => {
  const reported = vi.fn();
  vi.stubGlobal("reportError", reported);
  const { i18n, ready } = createI18n("en");
  await ready;
  await i18n.reloadResources("ru", "missing");

  await i18n.changeLanguage("ru");

  await vi.waitFor(() => expect(i18n.language).toBe("en"));
  expect(reported).toHaveBeenCalledWith(
    expect.objectContaining({ message: "The ru/missing messages did not load" }),
  );
  expect(document.documentElement).toHaveAttribute("lang", "en");
  expect(localStorage.getItem("app.language")).toBeNull();
});
```

The tests without `resources` load the real files through the lazy backend, which keeps
`src/app/i18n.ts` inside the coverage gate. The two failure tests exercise i18next's own
`failedLoading` path, not a stand-in for it.

## The first load

`main.tsx` starts the router's first load before it renders. `RouterProvider` sees that load,
running or finished, and does not run the loaders again; the shell renders in every language
without waiting:

```tsx,verify,test
// file: src/app/start.test.tsx
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import { expect, test } from "vitest";
import { configureApi } from "@/api/fetcher";
import { getListUsersMockHandler } from "@/api/generated/api.msw";
import { createI18n, LANGUAGES } from "@/app/i18n";
import { createAppRouter } from "@/app/router";
import { buildUser } from "@/test/factories/user";
import { renderRoute, TEST_API_ORIGIN } from "@/test/render-route";
import { server } from "@/test/server";

test("a first load started before the render sends its request once", async () => {
  let requests = 0;
  server.use(
    getListUsersMockHandler(() => {
      requests += 1;
      return { items: [buildUser({ name: "Ada Lovelace" })], total: 1, limit: 20, offset: 0 };
    }),
  );
  configureApi({ baseUrl: TEST_API_ORIGIN });
  const { i18n } = createI18n("en", {});
  const router = createAppRouter({
    history: createMemoryHistory({ initialEntries: ["/users"] }),
    i18n,
  });

  const loading = router.load();
  render(<RouterProvider router={router} />);
  await loading;

  expect(await screen.findByRole("link", { name: "Ada Lovelace" })).toBeInTheDocument();
  expect(requests).toBe(1);
});

test.each(LANGUAGES)("the layout shows during a first load in %s", async (language) => {
  const { promise: answered, resolve: answer } = Promise.withResolvers<void>();
  server.use(
    getListUsersMockHandler(async () => {
      await answered;
      return { items: [], total: 0, limit: 20, offset: 0 };
    }),
  );

  renderRoute("/users", { language });

  expect(await screen.findByRole("navigation", { name: "Main" })).toBeInTheDocument();
  expect(screen.getByRole("combobox")).toHaveValue(language);
  expect(document.documentElement).toHaveAttribute("lang", language);
  answer();
  await waitForElementToBeRemoved(screen.getByRole("progressbar"));
});
```

With `keycloak-spa-auth`, the first test's `createAppRouter` also takes
`session: createSession(fakeIdentity())`.

## Field errors in two languages

The bound field is `src/shared` code, which cannot import `src/app/i18n.ts`: its test builds a bare
instance with messages of its own, so it checks the mapping, not the app's text:

```tsx,verify,test
// file: src/shared/hooks/use-app-form.test.tsx
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance } from "i18next";
import { I18nextProvider } from "react-i18next";
import { expect, test } from "vitest";
import * as z from "zod";
import { ApiError } from "@/api/api-error";
import { useAppForm } from "@/shared/hooks/use-app-form";

const resources = {
  en: {
    common: {
      fieldErrors: {
        taken: "This value is already taken.",
        tooShort_one: "Enter at least {{count}} character.",
        tooShort_other: "Enter at least {{count}} characters.",
      },
    },
  },
  ru: {
    common: {
      fieldErrors: {
        taken: "Это значение уже занято.",
        tooShort_one: "Введите не меньше {{count}} символа.",
        tooShort_few: "Введите не меньше {{count}} символов.",
        tooShort_many: "Введите не меньше {{count}} символов.",
        tooShort_other: "Введите не меньше {{count}} символа.",
      },
    },
  },
};

function NameForm({ save }: { save: (name: string) => Promise<void> }) {
  const form = useAppForm({
    defaultValues: { name: "" },
    validators: { onSubmit: z.object({ name: z.string().min(2) }) },
    onSubmit: ({ value }) => save(value.name),
  });
  return (
    <form.AppForm>
      <form.Form failed="Not saved.">
        <form.AppField name="name">{(field) => <field.TextField label="Name" />}</form.AppField>
        <form.SubmitButton pending="Saving">Save</form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}

function renderForm(save: (name: string) => Promise<void>) {
  const i18n = createInstance();
  void i18n.init({
    lng: "en",
    fallbackLng: "en",
    defaultNS: "common",
    resources,
    initAsync: false,
  });
  render(
    <I18nextProvider i18n={i18n}>
      <NameForm save={save} />
    </I18nextProvider>,
  );
  return { i18n, user: userEvent.setup() };
}

test("a schema error is the app's text in the active language, and follows a switch", async () => {
  const { i18n, user } = renderForm(async () => {});

  await user.click(screen.getByRole("button", { name: "Save" }));
  const name = screen.getByRole("textbox", { name: "Name" });
  expect(name).toHaveAccessibleDescription("Enter at least 2 characters.");

  await act(() => i18n.changeLanguage("ru"));

  expect(name).toHaveAccessibleDescription("Введите не меньше 2 символов.");
});

test.each([
  ["unique", "Это значение уже занято."],
  ["not_a_known_code", "name rejected by the server"],
])("a server error with code %s shows %j", async (code, text) => {
  const { i18n, user } = renderForm(async () => {
    throw new ApiError({
      status: 422,
      message: "Unprocessable",
      fieldErrors: { name: [{ code, message: "name rejected by the server" }] },
      body: null,
    });
  });
  await act(() => i18n.changeLanguage("ru"));
  const name = screen.getByRole("textbox", { name: "Name" });
  await user.type(name, "Ada");

  await user.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() => expect(name).toHaveAccessibleDescription(text));
});
```

## What covers a missing key

| Mistake | Caught by |
| --- | --- |
| key in code, not in `en` | `tsc` (typed keys), `extract --ci` |
| key in `en`, empty or absent in `ru` | `status`, before a release (the screen shows English until then) |
| variable missing in the call | `tsc` |
| variable dropped in a translation | `lint` (`checkTranslationPlaceholders`) |
| plural forms missing or out of order | `extract --ci` |
| a screen that renders the wrong key | the route test asserting the visible text |

No test asserts a key or loops over JSON files to compare languages: the gates already do, on every
file. The one file loop is the guard below, which no gate covers.

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
