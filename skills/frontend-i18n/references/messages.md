# Writing messages, formatting values, text from elsewhere

Contents

- [Calls](#calls)
- [Plurals, ordinals, context](#plurals-ordinals-context)
- [`<Trans>`](#trans)
- [Dates and numbers outside messages](#dates-and-numbers-outside-messages)
- [A component, end to end](#a-component-end-to-end)
- [A language switcher](#a-language-switcher)
- [Server errors](#server-errors)
- [Field errors](#field-errors)
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
The scaffold's `formatDateTime(iso)` and `frontend-code-style`'s `formatDate(isoDate)` format in
English; this add-on replaces the file and adds the language as a second parameter, so `tsc` lists
every caller that still lacks it (`TS2554: Expected 2 arguments, but got 1.`). `formatDate` keeps
its two rules (only `YYYY-MM-DD`, formatted in UTC), which are `frontend-code-style`'s:

```ts,verify
// file: src/shared/lib/format-date.ts
// One formatter per language and kind, built on first use and kept: building one is the expensive part.
const formats = new Map<string, Intl.DateTimeFormat>();
function formatFor(language: string, kind: "dateTime" | "date") {
  const key = `${kind} ${language}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(
      language,
      kind === "dateTime"
        ? { dateStyle: "medium", timeStyle: "short" }
        : { dateStyle: "medium", timeZone: "UTC" },
    );
    formats.set(key, format);
  }
  return format;
}

/** Formats an ISO 8601 timestamp from the API in the active language (`i18n.language`). */
export function formatDateTime(iso: string, language: string) {
  return formatFor(language, "dateTime").format(new Date(iso));
}

/** Formats a calendar date from the API (`YYYY-MM-DD`) in the active language, the same day everywhere. */
export function formatDate(isoDate: string, language: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`not a calendar date: ${isoDate}`);
  return formatFor(language, "date").format(new Date(isoDate));
}
```

```ts,verify,test
// file: src/shared/lib/format-date.test.ts
import { expect, test } from "vitest";
import { formatDate } from "@/shared/lib/format-date";

test("a calendar date keeps its day in every language", () => {
  expect(formatDate("2026-03-01", "en")).toBe("Mar 1, 2026");
  expect(formatDate("2026-03-01", "ru")).toBe("1 мар. 2026 г.");
  expect(() => formatDate("2026-03-01T10:00:00Z", "en")).toThrow("not a calendar date");
});
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
    // A narrow screen scrolls the table, never the page.
    <div className="overflow-x-auto">
      <table aria-label="Users" className="w-full text-left">
        <thead className="text-muted text-sm">
          <tr>
            <th className="py-2 pr-4">Name</th>
            <th className="pr-4">Email</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {users.map((user) => (
            <tr key={user.id} data-testid={`users-row-${user.id}`} className="border-line border-t">
              <td className="py-2 pr-4">
                <Link to="/users/$userId" params={{ userId: user.id }}>
                  {user.name}
                </Link>
              </td>
              <td className="pr-4">{user.email}</td>
              <td className="whitespace-nowrap">
                {formatDateTime(user.created_at, i18n.language)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
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
reports an untranslated `<title>`. The scaffold's `src/routes/users/new.tsx`, translated (with
`keycloak-spa-auth` the file is `src/routes/_signed-in/users/new.tsx` and its id
`/_signed-in/users/new`; merge the translation into it):

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
    <div data-testid="users-new-page" className="flex flex-col gap-4">
      <title>{t("create.title")}</title>
      <h1 className="font-semibold text-2xl">{t("create.title")}</h1>
      <CreateUserForm
        onCreated={(user) => navigate({ to: "/users/$userId", params: { userId: user.id } })}
      />
    </div>
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
import { createRootRouteWithContext, Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { LANGUAGES } from "@/app/i18n";
import { LanguageSelect } from "@/shared/ui/language-select";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // The shell stays mounted around the root's content, pending or not. The router renders nothing
  // until a match is pending or ready: the empty `beforeLoad` makes the root pending on a first load
  // only, so the layout and the bar show at once while the page loads, and a later navigation keeps
  // the previous page under the bar. `pendingMinMs` would hold a fast first load back.
  shellComponent: RootLayout,
  beforeLoad: () => {},
  pendingComponent: () => null,
  pendingMs: 0,
  pendingMinMs: 0,
  notFoundComponent: PageNotFound,
});

function RootLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <NavigationProgress />
      <header className="border-line border-b">
        <nav aria-label="Main" className="mx-auto flex max-w-3xl gap-4 p-4">
          <Link to="/users" activeOptions={{ exact: true }}>
            Users
          </Link>
          <Link to="/users/new">New user</Link>
          <LanguageSelect languages={LANGUAGES} className="ms-auto" />
        </nav>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">{children}</main>
    </>
  );
}

/** While a navigation waits for its loaders; `.navigation-progress` stays invisible for the first 200 ms. */
function NavigationProgress() {
  const pending = useRouterState({ select: (state) => state.status === "pending" });
  return pending ? (
    <div role="progressbar" aria-label="Loading page" className="navigation-progress" />
  ) : null;
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

The layout is the router's shell: it renders while the first page still loads, outside every
Suspense boundary. Its text is translated like any other (the bar becomes
`aria-label={t("loadingPage")}` in a `NavigationProgress` that calls `useTranslation()`), and it
never waits for a namespace: `main.tsx` renders after every file has loaded and nothing suspends
(`useSuspense: false`). The scaffold's tests find the bar and the links by their English names,
which they keep once `en/common.json` holds the same words. A styled Base UI select wrapper is
`tailwind-base-ui`'s.

## Server errors

`ApiError.message` is the server's developer text in the server's language: never render it. A
failed submit's form-level sentence comes from `submitErrors` (`frontend-forms`), which appends
English. Translated, it takes `t` and each sentence is a key with `failed` (the form's own
sentence) and `requestId` as variables, one key per variant, never the id appended to another
message:

```ts,verify
import type { TFunction } from "i18next";
import { ApiError, type FieldErrors } from "@/api/api-error";

/** What a failed submit shows, in the active language: field errors where rendered, the rest as one message. */
export function submitErrors(
  error: unknown,
  rendered: readonly string[],
  failed: string,
  t: TFunction,
): { form?: string; fields: FieldErrors } {
  const requestId = error instanceof ApiError ? error.requestId : undefined;
  const fieldErrors = error instanceof ApiError ? Object.entries(error.fieldErrors) : [];
  const fields = Object.fromEntries(fieldErrors.filter(([name]) => rendered.includes(name)));
  const shown = Object.keys(fields).length;
  if (shown > 0 && shown === fieldErrors.length) return { fields };
  if (fieldErrors.length > 0) {
    return {
      form: requestId
        ? t("form.cannotShowWithId", { failed, requestId })
        : t("form.cannotShow", { failed }),
      fields,
    };
  }
  if (error instanceof ApiError && error.status === 409) {
    return {
      form: requestId
        ? t("form.conflictWithId", { failed, requestId })
        : t("form.conflict", { failed }),
      fields,
    };
  }
  return {
    form: requestId ? t("form.retryWithId", { failed, requestId }) : t("form.retry", { failed }),
    fields,
  };
}
```

The English file holds `"retryWithId": "{{failed}} Try again. Request id: {{requestId}}"`. `Form` in
`src/shared/hooks/use-app-form.tsx` passes its `t` (`useTranslation()`), and each form passes its
sentences as keys. The scaffold's `src/features/users/create-user-form.tsx`, translated:

```tsx,verify
import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import type * as z from "zod";
import {
  getCreateUserMutationOptions,
  getListUsersQueryKey,
  type UserResponse,
} from "@/api/generated/api";
import { CreateUserBody } from "@/api/generated/api.zod";
import { useAppForm } from "@/shared/hooks/use-app-form";

const emptyUser: z.input<typeof CreateUserBody> = { email: "", name: "" };

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
        // Marks every cached user list and detail invalidated; none is mounted here, so each
        // refetches in its route's loader on the next visit.
        onSuccess: (_user, _variables, _onMutateResult, { client }) =>
          client.invalidateQueries({ queryKey: getListUsersQueryKey() }),
      },
    }),
  );
  const form = useAppForm({
    defaultValues: emptyUser,
    // Errors appear on the first submit, then follow every change.
    validationLogic: revalidateLogic(),
    validators: { onDynamic: CreateUserBody },
    onSubmit: async ({ value, formApi }) => {
      const user = await createUser.mutateAsync({ data: value });
      formApi.reset();
      await onCreated(user);
    },
  });
  useBlocker({
    // Read at navigation time: a rendered snapshot would still be dirty right after reset().
    shouldBlockFn: () => !form.state.isDefaultValue && !window.confirm(t("create.discard")),
    enableBeforeUnload: () => !form.state.isDefaultValue,
  });

  return (
    <form.AppForm>
      <form.Form failed={t("create.failed")} className="max-w-md" data-testid="users-create-form">
        <form.FormError />
        <form.AppField name="name">
          {(field) => <field.TextField label={t("create.name")} data-testid="users-create-name" />}
        </form.AppField>
        <form.AppField name="email">
          {(field) => (
            <field.TextField
              label={t("create.email")}
              type="email"
              data-testid="users-create-email"
            />
          )}
        </form.AppField>
        <form.SubmitButton pending={t("create.submitting")} data-testid="users-create-submit">
          {t("create.submit")}
        </form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}
```

`data-testid` values are never translated. `ApiError.code` is the RFC 9457 problem `type`, a URI,
and `undefined` for other backends: branch on the full URI
(`case "https://api.example.com/problems/email-taken":`), never on a short name the client does not
produce. The `pending` text and the `window.confirm` text are literal calls too, though no gate
checks them.

## Field errors

A field shows one error: a schema issue, or a server `FieldError` (`{ message, code? }`, `code`
from axum's `code` or pydantic's `type`). The bound field picks the text at render time, so an
error on screen follows a language switch: a literal call per backend `code` and per schema issue
kind (`code`, `origin`, the bound), and the error's own `message` for anything else. An untranslated
server code therefore shows the backend's sentence, usually English: list the codes the backend
documents. zod's own wording stays for issues no form shows (search params, a parsed stream),
where it is developer text. The scaffold's `src/shared/hooks/use-app-form.tsx` with the lines this
add-on adds; the same `fieldErrorText` call goes into every bound part the app has (`frontend-forms`
adds a number, select, checkbox and file field):

```tsx,verify
// file: src/shared/hooks/use-app-form.tsx
import { createFormHook, createFormHookContexts, useStore } from "@tanstack/react-form";
import type { TFunction } from "i18next";
import { type ComponentProps, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, type FieldError } from "@/api/api-error";
import { submitErrors } from "@/shared/lib/submit-errors";
import { Button } from "@/shared/ui/button";
import { cx } from "@/shared/ui/cx";
import { TextField } from "@/shared/ui/text-field";

const { fieldContext, formContext, useFieldContext, useFormContext } = createFormHookContexts();

/** `<form>` that submits, shows a failed submit's errors and focuses the first invalid field. */
function Form({
  failed,
  onFieldErrors,
  className,
  ...props
}: Omit<ComponentProps<"form">, "onSubmit" | "noValidate" | "className"> & {
  /** The form's own sentence for a failed submit, such as "The user was not created." */
  failed: string;
  /** After a failed submit, the fields with an error: a form in steps opens the first one's step. */
  onFieldErrors?: ((fields: string[]) => void) | undefined;
  /** Layout only (margin, width, placement). */
  className?: string | undefined;
}) {
  const form = useFormContext();
  const ref = useRef<HTMLFormElement>(null);
  // After the errors render, so the screen reader reads the field and its error.
  const focusFirstError = () => {
    onFieldErrors?.(Object.keys(form.getAllErrors().fields));
    requestAnimationFrame(() =>
      ref.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(),
    );
  };
  // The context's form is untyped; every name comes from the form's own fields.
  const setServerErrors = (name: string, errors: FieldError[] | undefined) =>
    form.setFieldMeta(name as never, (meta) => ({
      ...meta,
      errorMap: { ...meta.errorMap, onServer: errors },
    }));
  const showFailure = (error: unknown) => {
    if (
      !(error instanceof ApiError || error instanceof TypeError || error instanceof DOMException)
    ) {
      reportError(error);
    }
    // A field removed for good keeps its fieldInfo but can show nothing; a form in steps opens its step.
    const showable = Object.keys(form.fieldInfo).filter(
      (name) => onFieldErrors || form.getFieldInfo(name as never).instance,
    );
    const { form: message, fields } = submitErrors(error, showable, failed);
    form.setErrorMap({ onServer: message });
    for (const [name, errors] of Object.entries(fields)) setServerErrors(name, errors);
    focusFirstError();
  };
  return (
    <form
      ref={ref}
      noValidate
      {...props}
      className={cx("flex flex-col gap-4", className)}
      onSubmit={(event) => {
        event.preventDefault();
        // Server errors describe the last attempt; a new one asks the server again.
        for (const name of Object.keys(form.fieldInfo)) setServerErrors(name, undefined);
        void form.handleSubmit().then(() => {
          if (!form.state.isValid) focusFirstError();
        }, showFailure);
      }}
    />
  );
}

/** The form-level message of a failed submit. */
function FormError() {
  const form = useFormContext();
  const error = useStore(form.store, (state) => state.errorMap.onServer);
  return typeof error === "string" ? (
    <p role="alert" className="text-danger">
      {error}
    </p>
  ) : null;
}

function SubmitButton({ pending, ...props }: ComponentProps<typeof Button> & { pending: string }) {
  const form = useFormContext();
  const submitting = useStore(form.store, (state) => state.isSubmitting);
  return (
    <Button
      type="submit"
      variant="primary"
      disabled={submitting}
      {...props}
      {...(submitting && { children: pending })}
    />
  );
}

/** A zod issue (`code`, `origin`, the bound) or a server `FieldError` (`code` from the backend). */
interface FieldIssue {
  message?: string;
  code?: string;
  origin?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  format?: string;
}

/** The error in the user's language; any other error, or a key with no text, keeps its own message. */
function fieldErrorText(issue: FieldIssue, t: TFunction) {
  const defaultValue = issue.message ?? "";
  switch (issue.code) {
    case "unique":
      return t("fieldErrors.taken", { defaultValue });
    case "too_small":
      return issue.origin === "string"
        ? t("fieldErrors.tooShort", { count: Number(issue.minimum), defaultValue })
        : defaultValue;
    case "too_big":
      return issue.origin === "string"
        ? t("fieldErrors.tooLong", { count: Number(issue.maximum), defaultValue })
        : defaultValue;
    case "invalid_format":
      return issue.format === "email" ? t("fieldErrors.email", { defaultValue }) : defaultValue;
    default:
      return defaultValue;
  }
}

function BoundTextField(
  props: Omit<
    ComponentProps<typeof TextField>,
    "name" | "value" | "error" | "onValueChange" | "onBlur"
  >,
) {
  const field = useFieldContext<string>();
  const { t } = useTranslation();
  const value = useStore(field.store, (state) => state.value);
  // Schema issues and server errors both carry `message`; the text is chosen at render.
  const issue: FieldIssue | undefined = useStore(field.store, (state) =>
    state.meta.errors.find((error: FieldIssue | undefined) => error?.message),
  );
  return (
    <TextField
      {...props}
      name={field.name}
      value={value}
      error={issue && fieldErrorText(issue, t)}
      onValueChange={(next) => {
        // A server error describes the value it was sent; any edit makes it stale.
        field.setErrorMap({ onServer: undefined });
        field.handleChange(next);
      }}
      onBlur={field.handleBlur}
    />
  );
}

/**
 * `useForm` with the app's bound parts: `form.AppField` children render `field.TextField`, and
 * `form.Form`, `form.FormError` and `form.SubmitButton` go inside `form.AppForm`.
 */
export const { useAppForm } = createFormHook({
  fieldContext,
  formContext,
  fieldComponents: { TextField: BoundTextField },
  formComponents: { Form, FormError, SubmitButton },
});
```

`defaultValue` here is the sentence the error already carries, not copy written in code, and
`strictKeyChecks` keeps the key checked. Once `submitErrors` takes `t`, `Form` calls it with
`useTranslation().t` as its fourth argument. The message files hold, per language, the plural forms
of the counted ones:

```json
{
  "fieldErrors": {
    "email": "Enter an email address such as name@example.com.",
    "taken": "This value is already taken.",
    "tooLong_one": "Enter at most {{count}} character.",
    "tooLong_other": "Enter at most {{count}} characters.",
    "tooShort_one": "Enter at least {{count}} character.",
    "tooShort_other": "Enter at least {{count}} characters."
  }
}
```

A message the product writes for one schema (a `.refine`) is a key too: build that schema inside
the component with `t`. `frontend-forms`' English `customError` in `src/app/zod-config.ts`, if the
app has one, goes: its cases move here as keys. The tests reference has the two-language test.

## Base UI and the browser

| Source | What it uses | Do |
| --- | --- | --- |
| Base UI `NumberField`, `Slider`, `Progress`, `Meter`, `Combobox` filtering | the browser's locale when `locale` is not passed | pass `locale={i18n.language}` |
| Base UI direction-aware parts (popup positioning, `Slider`, `ScrollArea`, arrow keys in `Tabs`, `Toolbar`, `Menu`) | `ltr` unless a `DirectionProvider` says otherwise, whatever `<html dir>` is | for a right-to-left language, a provider in `Wrap` that reads `useTranslation()` and renders `<DirectionProvider direction={i18n.dir()}>` |
| Labels you pass to Base UI (`Toast.Close`'s "Dismiss", an `aria-label`) | whatever you wrote | keys, like any other text |
| Labels Base UI writes itself: `Toast.Viewport`'s `aria-label="Notifications"`, `NumberField`'s "Increase" and "Decrease" buttons and `aria-roledescription="Number field"` | English, whatever the language; `lint` cannot see them | pass the attribute: `<Toast.Viewport aria-label={t("notifications")}>` in `src/shared/ui/toast.tsx`; a passed prop wins over Base UI's (checked at 1.9.0) |
| Native validation bubbles, `<input type="date">` pickers, `confirm()` buttons | the browser's UI language | prefer the app's own messages; a `frontend-forms` form sets `noValidate` |
