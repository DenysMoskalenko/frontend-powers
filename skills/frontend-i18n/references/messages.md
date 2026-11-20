# Writing messages, formatting values, text from elsewhere

Contents

- [Calls](#calls)
- [Plurals, ordinals, context](#plurals-ordinals-context)
- [`<Trans>`](#trans)
- [Dates and numbers outside messages](#dates-and-numbers-outside-messages)
- [A component, end to end](#a-component-end-to-end)
- [A language switcher](#a-language-switcher)
- [Server errors](#server-errors)
- [Validation messages](#validation-messages)
- [Base UI and the browser](#base-ui-and-the-browser)

## Calls

```tsx
const { t, i18n } = useTranslation("users"); // the feature's namespace; no argument = "common"
t("list.pageOf", { page, pages }); // one key per sentence, values inside it
t("common:nav.users"); // another namespace, by prefix
```

- Call `t` during render. A module-level `const LABEL = t("x")` is computed once, in whatever
  language was active then.
- A key is a string literal at the call. The extractor, `status` and the types read literals; a
  key built at runtime is invisible to all three and a missing one renders as the key. Map a
  runtime value with an explicit table of literal calls:

```tsx
const statusText = {
  active: t("status.active"),
  suspended: t("status.suspended"),
} satisfies Record<UserStatus, string>;
```

- One key per sentence: never `t("a") + name`, never `{t("label")}: {value}`. Word order,
  punctuation and spacing change per language; `lint` reports the `+` form.
- Inside a message, format with i18next's built-in `Intl` formatters so the translator places the
  value: `{{count, number}}`, `{{date, datetime(dateStyle: medium)}}`,
  `{{amount, currency(currency: EUR)}}`, `{{n, relativetime(day)}}`, `{{names, list}}`. They use
  the active language. Not used: a custom
  `interpolation.format` function (removed), a postProcessor for formatting.

## Plurals, ordinals, context

| Code | Keys in `en` | Keys in `ru` |
| --- | --- | --- |
| `t("summary.total", { count })` | `total_one`, `total_other` | `total_one`, `total_few`, `total_many`, `total_other` |
| `t("list.rank", { count, ordinal: true })` | `rank_ordinal_one`, `_two`, `_few`, `_other` (`1st`, `2nd`, `3rd`, `4th`) | `rank_ordinal_other` |
| `t("list.invited", { context: role })` with `role: "admin" \| "member"` | `invited`, `invited_admin`, `invited_member` | same |

The extractor writes the forms each language needs (it also expands a context typed as a union),
in CLDR order; `extract --ci` fails when they are out of order or missing. Never choose the
form in code (`count === 1 ? ... : ...`) and never call a suffixed key.

## `<Trans>`

For markup inside a sentence, name each element in `components`; the translator moves the tags
with the words:

```json
{ "summary": { "invite": "Missing someone? <create>Create a user</create>." } }
```

```tsx
<p className="*:underline">
  <Trans t={t} i18nKey="summary.invite" components={{ create: <Link to="/users/new" /> }} />
</p>
```

`t={t}` carries the namespace (or pass `ns="users"`). A link inside running text needs an
underline, or the scaffold's axe test fails with `link-in-text-block` (its links underline on hover
only); a `className` on `<Link>` outside `src/shared/ui` fails Biome's
`noTailwindRestyledComponents`, so the paragraph underlines its children. Facts at
react-i18next 18:

- A component name that is an HTML void element (`link`, `br`, `img`, `input`, `hr`, `meta`) is
  parsed as self-closing: `"Read <link>the guide</link>"` renders `<a href="/x"></a>the guide`.
  Name it after its meaning: `<guide>`, `<create>`, `<bold>`.
- `Trans` decodes entities after parsing whatever `escapeValue` says, values render as text, and
  `shouldUnescape` is ignored with a `DEPRECATED_OPTION` warning: remove it.
- `Trans` re-renders on a language change by itself; it no longer needs a parent re-render.
- Index-numbered tags (`<0>`, `<1>`) with `components={[<strong />]}` still work; named ones
  survive reordering and are what `lint`'s placeholder check compares across languages.

## Dates and numbers outside messages

A value standing alone (a table cell, a chart axis) is formatted in code with the active language.
The scaffold's formatter takes it as a parameter, so `tsc` lists every caller that still lacks it
(`TS2554: Expected 2 arguments, but got 1.`):

```ts,verify
// file: src/shared/lib/format-date.ts
// One formatter per language, built on first use and kept: building one is the expensive part.
const dateTimeFormats = new Map<string, Intl.DateTimeFormat>();

/** Formats an ISO 8601 timestamp from the API in the active language (`i18n.language`). */
export function formatDateTime(iso: string, language: string) {
  let format = dateTimeFormats.get(language);
  if (!format) {
    format = new Intl.DateTimeFormat(language, { dateStyle: "medium", timeStyle: "short" });
    dateTimeFormats.set(language, format);
  }
  return format.format(new Date(iso));
}
```

The language is an argument, not read inside from a global: the React Compiler memoizes the call
on its arguments, and `useTranslation()` returns a new `i18n` object on every language change, so
the cell re-renders in the new language. Money and numbers follow the same shape (a `Map` keyed by
language and currency); the formatting rules themselves are `frontend-code-style`'s. Until a
component's strings move to keys, the formatter change alone is this (they wait in the lint
baseline):

```tsx,verify
// file: src/features/users/user-table.tsx
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type { UserResponse } from "@/api/generated/api";
import { formatDateTime } from "@/shared/lib/format-date";

export function UserTable({ users }: { users: readonly UserResponse[] }) {
  const { i18n } = useTranslation();
  if (users.length === 0) return <p>No users yet.</p>;
  return (
    <table aria-label="Users" className="w-full text-left">
      <thead className="text-muted text-sm">
        <tr>
          <th className="py-2">Name</th>
          <th>Email</th>
          <th>Created</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr key={user.id} className="border-line border-t">
            <td className="py-2">
              <Link to="/users/$userId" params={{ userId: user.id }}>
                {user.name}
              </Link>
            </td>
            <td>{user.email}</td>
            <td>{formatDateTime(user.created_at, i18n.language)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

## A component, end to end

Strings from the feature's namespace, the date in the active language:

```tsx,verify
// file: src/features/users/user-details.tsx
import { useTranslation } from "react-i18next";
import type { UserResponse } from "@/api/generated/api";
import { formatDateTime } from "@/shared/lib/format-date";

export function UserDetails({ user }: { user: UserResponse }) {
  const { t, i18n } = useTranslation("users");
  return (
    <dl className="grid grid-cols-label gap-x-6 gap-y-2">
      <dt className="text-muted">{t("details.email")}</dt>
      <dd>{user.email}</dd>
      <dt className="text-muted">{t("details.created")}</dt>
      <dd>{formatDateTime(user.created_at, i18n.language)}</dd>
    </dl>
  );
}
```

User content (a name, an email) is never a key. A page title is text like any other, and `lint`
reports an untranslated `<title>`. The scaffold's `src/routes/users/new.tsx`, translated:

```tsx,verify
import { createFileRoute } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { CreateUserForm } from "@/features/users/create-user-form";

export const Route = createFileRoute("/users/new")({
  component: NewUserPage,
});

function NewUserPage() {
  const { t } = useTranslation("users");
  const navigate = Route.useNavigate();

  return (
    <>
      <title>{t("create.title")}</title>
      <h1 className="font-semibold text-2xl">{t("create.title")}</h1>
      <CreateUserForm
        onCreated={(user) => navigate({ to: "/users/$userId", params: { userId: user.id } })}
      />
    </>
  );
}
```

## A language switcher

Each language named in itself, through `Intl.DisplayNames`, so no key is needed per language.
`changeLanguage` loads the new files, then re-renders; `createI18n` stores the choice.

```tsx,verify
// file: src/shared/ui/language-select.tsx
import { useTranslation } from "react-i18next";

// Each language named in itself ("English", "русский"), so a reader finds their own.
const ownNames = new Map<string, string | undefined>();
function ownName(language: string) {
  if (!ownNames.has(language)) {
    ownNames.set(language, new Intl.DisplayNames([language], { type: "language" }).of(language));
  }
  return ownNames.get(language) ?? language;
}

export function LanguageSelect({
  languages,
  className,
}: {
  languages: readonly string[];
  className?: string | undefined;
}) {
  const { t, i18n } = useTranslation();
  return (
    <select
      aria-label={t("language")}
      className={className}
      value={i18n.language}
      onChange={(event) => {
        i18n.changeLanguage(event.currentTarget.value).catch(reportError);
      }}
    >
      {languages.map((language) => (
        <option key={language} value={language} lang={language}>
          {ownName(language)}
        </option>
      ))}
    </select>
  );
}
```

`src/shared/ui` cannot import `@/app/i18n`, so the root layout passes the list. The scaffold's
`src/routes/__root.tsx` with the switcher and nothing else changed (its text waits in the lint
baseline):

```tsx,verify
// file: src/routes/__root.tsx
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet } from "@tanstack/react-router";
import { LANGUAGES } from "@/app/i18n";
import { LanguageSelect } from "@/shared/ui/language-select";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  component: RootLayout,
  notFoundComponent: PageNotFound,
});

function RootLayout() {
  return (
    <>
      <header className="border-line border-b">
        <nav aria-label="Main" className="mx-auto flex max-w-3xl gap-4 p-4">
          <Link to="/users" activeOptions={{ exact: true }}>
            Users
          </Link>
          <Link to="/users/new">New user</Link>
          <LanguageSelect languages={LANGUAGES} className="ms-auto" />
        </nav>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <Outlet />
      </main>
    </>
  );
}

function PageNotFound() {
  return (
    <>
      <title>Page not found</title>
      <h1 className="font-semibold text-2xl">Page not found</h1>
      <Link to="/users">Back to users</Link>
    </>
  );
}
```

A styled Base UI select wrapper is `tailwind-base-ui`'s.

## Server errors

`ApiError.message` is the server's developer text in the server's language: never render it. The
copy for an `ApiError` is written where the scaffold writes it, branched on `status` and
`fieldErrors`, and each branch becomes a literal call; the request id is a variable of the message.
`fieldErrors` holds the backend's sentences, in its language and with no per-field code, so `fields`
passes them through as sent; translating them is a backend contract change, raised with the user.
The scaffold's `src/features/users/create-user-form.tsx`, translated (`tanstack-query-api`'s
`userErrorMessage` changes the same way):

```tsx,verify
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import type { TFunction } from "i18next";
import { useRef } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "@/api/api-error";
import {
  getCreateUserMutationOptions,
  getListUsersQueryKey,
  type UserResponse,
} from "@/api/generated/api";
import { CreateUserBody } from "@/api/generated/api.zod";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

const emptyUser = { email: "", name: "" };

/** `fieldInfo`: the form's rendered fields, keyed by name (`email`, `items[0].name`). */
function submitErrors(error: unknown, fieldInfo: object, t: TFunction<"users">) {
  if (error instanceof ApiError && error.status === 409) {
    return { form: t("create.emailTaken"), fields: {} };
  }
  if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
    const fields = error.fieldErrors;
    // setErrorMap drops errors for fields the form does not render.
    return Object.keys(fields).every((name) => name in fieldInfo)
      ? { fields }
      : { form: t("create.rejected"), fields };
  }
  const form =
    error instanceof ApiError && error.requestId
      ? t("create.failedWithId", { requestId: error.requestId })
      : t("create.failed");
  return { form, fields: {} };
}

// Schema issues arrive as objects, server field errors as strings.
const firstError = (errors: readonly (string | { message: string } | undefined)[]) =>
  errors.map((error) => (typeof error === "string" ? error : error?.message)).find(Boolean);

export function CreateUserForm({
  onCreated,
}: {
  onCreated: (user: UserResponse) => Promise<void>;
}) {
  const { t } = useTranslation("users");
  const createUser = useMutation(
    getCreateUserMutationOptions({
      mutation: {
        // This form shows every error of its own submit.
        meta: { silent: true },
        // Returned, so the submit stays pending until every user list and detail is refetched.
        onSuccess: (_user, _variables, _onMutateResult, { client }) =>
          client.invalidateQueries({ queryKey: getListUsersQueryKey() }),
      },
    }),
  );
  const formRef = useRef<HTMLFormElement>(null);
  // After a failed submit, focus the first invalid field once it renders, so its error is read out.
  const focusFirstError = () =>
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(),
    );
  const form = useForm({
    defaultValues: emptyUser,
    validators: { onSubmit: CreateUserBody },
    onSubmit: async ({ value, formApi }) => {
      let user: UserResponse;
      try {
        user = await createUser.mutateAsync({ data: value });
      } catch (error) {
        formApi.setErrorMap({ onSubmit: submitErrors(error, formApi.fieldInfo, t) });
        focusFirstError();
        return;
      }
      formApi.reset();
      await onCreated(user);
    },
    onSubmitInvalid: focusFirstError,
  });
  useBlocker({
    // Read at navigation time: a rendered snapshot would still be dirty right after reset().
    shouldBlockFn: () => !form.state.isDefaultValue && !window.confirm(t("create.discard")),
    enableBeforeUnload: () => !form.state.isDefaultValue,
  });

  return (
    <form
      ref={formRef}
      noValidate
      className="flex max-w-md flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit();
      }}
    >
      <form.Subscribe selector={(state) => state.errorMap.onSubmit}>
        {(error) =>
          typeof error === "string" ? (
            <p role="alert" className="text-danger">
              {error}
            </p>
          ) : null
        }
      </form.Subscribe>
      <form.Field name="name">
        {(field) => (
          <TextField
            label={t("create.name")}
            name={field.name}
            value={field.state.value}
            error={firstError(field.state.meta.errors)}
            onValueChange={field.handleChange}
            onBlur={field.handleBlur}
          />
        )}
      </form.Field>
      <form.Field name="email">
        {(field) => (
          <TextField
            label={t("create.email")}
            type="email"
            name={field.name}
            value={field.state.value}
            error={firstError(field.state.meta.errors)}
            onValueChange={field.handleChange}
            onBlur={field.handleBlur}
          />
        )}
      </form.Field>
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(submitting) => (
          <Button type="submit" variant="primary" disabled={submitting}>
            {submitting ? t("create.submitting") : t("create.submit")}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
```

`submitErrors` takes the component's `t`, so the extractor sees every key. The English file holds
`"failedWithId": "The user was not created. Try again. Request id: {{requestId}}"`; one key per
variant, never the id appended to another message. `ApiError.code` is the RFC 9457 problem `type`,
a URI, and `undefined` for other backends: branch on the full URI
(`case "https://api.example.com/problems/email-taken":`), never on a short name the client does not
produce. The button's ternary and the `window.confirm` text are literal calls too, though no gate
checks them.

## Validation messages

Schema issues from `api.zod.ts` and route `validateSearch` schemas carry zod's own English
messages. `createI18n` switches zod's locale with the language (`z.config(ru())`), so a field
error under a Russian UI reads `Слишком маленькое значение: ожидалось, что string будет иметь >=2
символа`. Add each new language's locale to `ZOD_MESSAGES`. A message the product writes itself
(a `.refine` in a hand-written schema) uses a key: build that schema inside the component with
`t`, or keep the key in `message` and translate it where `firstError` reads it.

## Base UI and the browser

| Source | What it uses | Do |
| --- | --- | --- |
| Base UI `NumberField`, `Slider`, `Progress`, `Meter`, `Combobox` filtering | the browser's locale when `locale` is not passed | pass `locale={i18n.language}` |
| Base UI direction-aware parts (popup positioning, `Slider`, `ScrollArea`, arrow keys in `Tabs`, `Toolbar`, `Menu`) | `ltr` unless a `DirectionProvider` says otherwise, whatever `<html dir>` is | for a right-to-left language, a provider in `Wrap` that reads `useTranslation()` and renders `<DirectionProvider direction={i18n.dir()}>` |
| Labels you pass to Base UI (`Toast.Close`'s "Dismiss", an `aria-label`) | whatever you wrote | keys, like any other text |
| Native validation bubbles, `<input type="date">` pickers, `confirm()` buttons | the browser's UI language | prefer the app's own messages; a `frontend-forms` form sets `noValidate` |
