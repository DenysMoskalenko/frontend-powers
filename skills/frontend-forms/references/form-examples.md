# Complete form examples

## Contents

- Edit form: default values from query data, server errors, leave guard
- Edit route and its route test
- A form schema that is not the request body: extra field, cross-field rule, transform
- An optional body key
- Custom schema messages
- One-field form: `FormData` and a mutation
- A form in steps: opening the step that holds the error
- Validation timing: what the user sees, pinned by tests

The scaffold's `src/features/users/create-user-form.tsx` and `src/routes/users/new.test.tsx` are the
create-form pair; the examples here use the same names and shapes. The scaffold's `openapi.json` has
no update operation, so the edit and rename examples send `PATCH /users/{id}` through a local
`apiFetch` helper. That helper is a stand-in, not the pattern for writes: against a real backend,
spread the generated `getUpdateUserMutationOptions` into `useMutation` and validate with the
generated `UpdateUserBody`; nothing else changes.

## Edit form

`key={user.id}` on the form in the route matters: the form copies `defaultValues` only while no field
is touched, so without a remount a form that moves from one user to another keeps the first user's
edits.

```tsx,verify
// file: src/features/users/edit-user-form.tsx
import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import type * as z from "zod";
import { apiFetch } from "@/api/fetcher";
import { type CreateUser, getListUsersQueryKey, type UserResponse } from "@/api/generated/api";
import { CreateUserBody } from "@/api/generated/api.zod";
import { useAppForm } from "@/shared/hooks/use-app-form";

// Stand-in until the spec has `PATCH /users/{id}`; then use `getUpdateUserMutationOptions`.
const updateUser = (id: string, data: CreateUser) =>
  apiFetch<UserResponse>(`/users/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

export function EditUserForm({
  user,
  onSaved,
}: {
  user: UserResponse;
  onSaved: () => Promise<void>;
}) {
  const saveUser = useMutation({
    mutationFn: (data: CreateUser) => updateUser(user.id, data),
    meta: { silent: true },
    onSuccess: (_user, _data, _onMutateResult, { client }) =>
      client.invalidateQueries({ queryKey: getListUsersQueryKey() }),
  });
  const defaultValues: z.input<typeof CreateUserBody> = { name: user.name, email: user.email };
  const form = useAppForm({
    defaultValues,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: CreateUserBody },
    onSubmit: async ({ value, formApi }) => {
      await saveUser.mutateAsync(value);
      formApi.reset();
      await onSaved();
    },
  });
  useBlocker({
    shouldBlockFn: () => !form.state.isDefaultValue && !window.confirm("Discard your changes?"),
    enableBeforeUnload: () => !form.state.isDefaultValue,
  });

  return (
    <form.AppForm>
      <form.Form
        failed="The changes were not saved."
        className="max-w-md"
        data-testid="users-edit-form"
      >
        <form.FormError />
        <form.AppField name="name">
          {(field) => <field.TextField label="Name" data-testid="users-edit-name" />}
        </form.AppField>
        <form.AppField name="email">
          {(field) => <field.TextField label="Email" type="email" data-testid="users-edit-email" />}
        </form.AppField>
        <form.SubmitButton pending="Saving…" data-testid="users-edit-submit">
          Save
        </form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}
```

What happens to the values when the user query refetches (invalidation, window focus), verified at
1.33:

| Form state when new `defaultValues` arrive | Result |
|---|---|
| no field touched (focused-and-left or edited) | values replaced by the new data |
| a field touched | values kept; the new data becomes the baseline `isDefaultValue` compares against and `reset()` returns to |
| after `formApi.reset()` | untouched again, so the next refetch replaces the values |

`isDirty` stays `true` once a field changed, even when the user types the old value back;
`isDefaultValue` compares the values. That is why the leave guard reads `isDefaultValue`.

## Edit route and its test

The edit page lives in `users/$userId_/`: the trailing underscore keeps the URL `/users/<id>/edit` and
keeps the page out of `users/$userId.tsx`, which renders no `<Outlet />`. Its loader is the detail
loader's (`tanstack-router-spa`).

```tsx,verify
// file: src/routes/users/$userId_/edit.tsx
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ApiError } from "@/api/api-error";
import { getGetUserQueryOptions, getGetUserSuspenseQueryOptions } from "@/api/generated/api";
import { GetUserParams } from "@/api/generated/api.zod";
import { EditUserForm } from "@/features/users/edit-user-form";
import { loadQuery } from "@/shared/lib/load-query";

export const Route = createFileRoute("/users/$userId_/edit")({
  loader: async ({ context, params }) => {
    if (!GetUserParams.safeParse({ id: params.userId }).success) throw notFound();
    try {
      await loadQuery(context.queryClient, getGetUserQueryOptions(params.userId));
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) throw notFound();
      throw error;
    }
  },
  component: EditUserPage,
  notFoundComponent: UserNotFound,
});

function EditUserPage() {
  const { userId } = Route.useParams();
  const navigate = Route.useNavigate();
  const { data: user } = useSuspenseQuery(getGetUserSuspenseQueryOptions(userId));

  return (
    <div data-testid="users-edit-page" className="flex flex-col gap-4">
      <title>Edit user</title>
      <h1 className="font-semibold text-2xl">Edit user</h1>
      <EditUserForm
        key={user.id}
        user={user}
        onSaved={() => navigate({ to: "/users/$userId", params: { userId } })}
      />
    </div>
  );
}

function UserNotFound() {
  return (
    <>
      <title>User not found</title>
      <h1 className="font-semibold text-2xl">User not found</h1>
      <Link to="/users">Back to users</Link>
    </>
  );
}
```

With `keycloak-spa-auth` installed, this file is `src/routes/_signed-in/users/$userId_/edit.tsx` with the id `/_signed-in/users/$userId_/edit`, and its test sits beside it.

The first test also proves the reset-before-navigate rule: jsdom's `window.confirm` returns
`undefined`, so a guard that still saw a dirty form would block the navigation and the heading would
never appear.

```tsx,verify,test
// file: src/routes/users/$userId_/edit.test.tsx
import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import type { UserResponse } from "@/api/generated/api";
import { getGetUserMockHandler } from "@/api/generated/api.msw";
import { buildUser } from "@/test/factories/user";
import { renderRoute, TEST_API_ORIGIN } from "@/test/render-route";
import { server } from "@/test/server";

const ada = buildUser({ name: "Ada", email: "ada@example.com" });

const patchAnswer = (status: number, body: object) =>
  http.patch(`${TEST_API_ORIGIN}/users/:id`, () => HttpResponse.json(body, { status }));

test("saving an edited user sends the form and opens the saved user", async () => {
  let stored: UserResponse = ada;
  const patched: unknown[] = [];
  server.use(
    getGetUserMockHandler(() => stored),
    http.patch(`${TEST_API_ORIGIN}/users/:id`, async ({ request }) => {
      const body = (await request.json()) as Partial<UserResponse>;
      patched.push(body);
      stored = { ...stored, ...body };
      return HttpResponse.json(stored);
    }),
  );
  const { user } = renderRoute(`/users/${ada.id}/edit`);

  const name = await screen.findByRole("textbox", { name: "Name" });
  expect(name).toHaveValue("Ada");
  await user.clear(name);
  await user.type(name, "Ada Lovelace");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  expect(patched).toEqual([{ name: "Ada Lovelace", email: "ada@example.com" }]);
});

test("a malformed id shows the not-found page without a request", async () => {
  renderRoute("/users/not-a-uuid/edit");

  expect(await screen.findByRole("heading", { name: "User not found" })).toBeInTheDocument();
});

test("a FastAPI 422 shows its message under the field it names", async () => {
  server.use(
    getGetUserMockHandler(ada),
    patchAnswer(422, {
      detail: [{ loc: ["body", "email"], msg: "domain is not accepted", type: "value_error" }],
    }),
  );
  const { user } = renderRoute(`/users/${ada.id}/edit`);

  await user.type(await screen.findByRole("textbox", { name: "Name" }), " Lovelace");
  await user.click(screen.getByRole("button", { name: "Save" }));

  const email = screen.getByRole("textbox", { name: "Email" });
  await waitFor(() => expect(email).toHaveAccessibleDescription("domain is not accepted"));
  await waitFor(() => expect(email).toHaveFocus());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a field error for a field the form does not render becomes a form error", async () => {
  server.use(
    getGetUserMockHandler(ada),
    patchAnswer(422, {
      error: "validation failed",
      details: { role: [{ code: "required", message: null, params: {} }] },
    }),
  );
  const { user } = renderRoute(`/users/${ada.id}/edit`);

  await user.type(await screen.findByRole("textbox", { name: "Name" }), " Lovelace");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The changes were not saved. The server gave a reason this form cannot show.",
  );
});

test("an unexpected failure names the request id", async () => {
  server.use(
    getGetUserMockHandler(ada),
    patchAnswer(500, { error: "internal server error", request_id: "req-7" }),
  );
  const { user } = renderRoute(`/users/${ada.id}/edit`);

  await user.type(await screen.findByRole("textbox", { name: "Name" }), " Lovelace");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The changes were not saved. Try again. Request id: req-7",
  );
});
```

## A form schema that is not the request body

Write a form schema only when the form differs from the request: a field the API does not take, a
rule across fields, or a transform. Build it from the generated one and reuse orval's exported limits
(`createUserBodyNameMax`), so the server's rules stay in one place. The transform at the end turns the
form's output into exactly the request body. The repeat-email field is this example's requirement,
not part of the pattern: a form gets only the extra fields its own request asks for.

```tsx,verify
// file: src/features/users/repeat-email-user-form.tsx
import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import * as z from "zod";
import {
  getCreateUserMutationOptions,
  getListUsersQueryKey,
  type UserResponse,
} from "@/api/generated/api";
import { CreateUserBody, createUserBodyNameMax } from "@/api/generated/api.zod";
import { useAppForm } from "@/shared/hooks/use-app-form";

const RepeatEmailUserInput = CreateUserBody.extend({
  // trim() before min(): a trim after min(1) lets "   " pass and sends "".
  name: z.string().trim().min(1).max(createUserBodyNameMax),
  confirmEmail: z.string(),
})
  .refine((form) => form.email === form.confirmEmail, {
    path: ["confirmEmail"],
    message: "The emails do not match.",
  })
  .transform((form) => ({ name: form.name, email: form.email }));

const emptyInput: z.input<typeof RepeatEmailUserInput> = { name: "", email: "", confirmEmail: "" };

export function RepeatEmailUserForm({
  onCreated,
}: {
  onCreated: (user: UserResponse) => Promise<void>;
}) {
  const createUser = useMutation(
    getCreateUserMutationOptions({
      mutation: {
        meta: { silent: true },
        onSuccess: (_user, _variables, _onMutateResult, { client }) =>
          client.invalidateQueries({ queryKey: getListUsersQueryKey() }),
      },
    }),
  );
  const form = useAppForm({
    defaultValues: emptyInput,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: RepeatEmailUserInput },
    onSubmit: async ({ value, formApi }) => {
      // `value` is the raw input; parse again for the transformed request body.
      const user = await createUser.mutateAsync({ data: RepeatEmailUserInput.parse(value) });
      formApi.reset();
      await onCreated(user);
    },
  });

  return (
    <form.AppForm>
      <form.Form failed="The user was not created." className="max-w-md">
        <form.FormError />
        <form.AppField name="name">{(field) => <field.TextField label="Name" />}</form.AppField>
        <form.AppField name="email">
          {(field) => <field.TextField label="Email" type="email" />}
        </form.AppField>
        <form.AppField name="confirmEmail">
          {(field) => <field.TextField label="Repeat email" type="email" />}
        </form.AppField>
        <form.SubmitButton pending="Creating…">Create user</form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}
```

The `refine` issue's `path` puts its message on that field; a refine without `path` lands nowhere
the user sees.

## An optional body key

orval's `override.zod.exactOptional: true` emits `.exactOptional()`, so an optional key infers
`note?: string` in both the schema's input and orval's `CreateX` type. Two lines differ from the
standard form: the defaults are typed (untyped, `note: ""` makes the key required and `onSubmit`
fails with TS2322), and an empty text field is left out of the body, or the API stores `""` for "no
note". In the form: `defaultValues: emptyOrder` and `mutateAsync({ data: toOrderBody(value) })`.

```ts,verify
// file: src/features/orders/order-body.ts
import * as z from "zod";

// Stand-in until the spec has `POST /orders`: what orval emits for it into `api.zod.ts`.
export const CreateOrderBody = z.object({
  title: z.string().min(1).max(100),
  note: z.string().max(500).exactOptional(),
});

export const emptyOrder: z.input<typeof CreateOrderBody> = { title: "", note: "" };

export const toOrderBody = ({
  note,
  ...rest
}: z.input<typeof CreateOrderBody>): z.output<typeof CreateOrderBody> => ({
  ...rest,
  ...(note && { note }),
});
```

## Custom schema messages

Schema messages are zod's defaults; the copy is the product's. Its one seam is a `customError` in
`src/app/zod-config.ts`, `z.config({ jitless: true, customError })`: it wins over a zod locale, gets
the issue (`code: "too_small"`, `minimum`; `code: "invalid_format"`, `format: "email"`) and returns a
message, or `undefined` for the default. It writes English at validation time, so a translated app
has none: `frontend-i18n` picks each field error's text in the bound field at render time, by issue
kind and backend `code`, and an error on screen follows a language switch.

## One-field form

No form library: read `FormData` on submit, validate with the generated schema's field, focus the
field when it is invalid, call the mutation. Without `meta: { silent: true }` a failed save reaches
the scaffold's global toast (the `MutationCache` notice in `createQueryClient`), which is enough for
one field; a project without that notice renders a message when `rename.isError`.

```tsx,verify
// file: src/features/users/rename-user-form.tsx
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { apiFetch } from "@/api/fetcher";
import { getListUsersQueryKey, type UserResponse } from "@/api/generated/api";
import { CreateUserBody } from "@/api/generated/api.zod";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

export function RenameUserForm({ user }: { user: UserResponse }) {
  const [error, setError] = useState<string>();
  const rename = useMutation({
    // Stand-in until the spec has `PATCH /users/{id}`; then use `getUpdateUserMutationOptions`.
    mutationFn: (name: string) =>
      apiFetch<UserResponse>(`/users/${encodeURIComponent(user.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      }),
    onSuccess: (_user, _name, _onMutateResult, { client }) =>
      client.invalidateQueries({ queryKey: getListUsersQueryKey() }),
  });

  return (
    <form
      noValidate
      className="flex items-end gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const name = CreateUserBody.shape.name.safeParse(new FormData(form).get("name"));
        setError(name.success ? undefined : name.error.issues[0]?.message);
        if (name.success) {
          rename.mutate(name.data);
          return;
        }
        // Focus the field once it renders as invalid, so its error is read out.
        requestAnimationFrame(() =>
          form.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(),
        );
      }}
    >
      <TextField label="Name" name="name" defaultValue={user.name} error={error} />
      <Button type="submit" variant="primary" disabled={rename.isPending}>
        Rename
      </Button>
    </form>
  );
}
```

## A form in steps

A step that is not shown renders none of its fields, so their errors have nowhere to appear. Give
each step's fields to a map keyed by the top-level field name, and let `onFieldErrors` open the
earliest step with an error; `Form` focuses the field once that step renders. A server error for a
field the form has never mounted (a step the user has not opened yet) is still a form-level
"cannot show" message: that only happens when the form can be submitted before every step was seen.

```tsx,verify
// file: src/features/users/invite-user-form.tsx
import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import type * as z from "zod";
import {
  getCreateUserMutationOptions,
  getListUsersQueryKey,
  type UserResponse,
} from "@/api/generated/api";
import { CreateUserBody } from "@/api/generated/api.zod";
import { useAppForm } from "@/shared/hooks/use-app-form";
import { Button } from "@/shared/ui/button";

const emptyUser: z.input<typeof CreateUserBody> = { email: "", name: "" };

const steps = ["Name", "Email"] as const;
// Keyed by the top-level name, so `address.city` or `items[0].name` finds its step too.
const stepOfField: Record<string, number> = { name: 0, email: 1 };
const stepOf = (field: string) => stepOfField[field.split(/[.[]/, 1)[0] ?? ""] ?? steps.length;

export function InviteUserForm({
  onCreated,
}: {
  onCreated: (user: UserResponse) => Promise<void>;
}) {
  const [step, setStep] = useState(0);
  const createUser = useMutation(
    getCreateUserMutationOptions({
      mutation: {
        meta: { silent: true },
        onSuccess: (_user, _variables, _onMutateResult, { client }) =>
          client.invalidateQueries({ queryKey: getListUsersQueryKey() }),
      },
    }),
  );
  const form = useAppForm({
    defaultValues: emptyUser,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: CreateUserBody },
    onSubmit: async ({ value, formApi }) => {
      const user = await createUser.mutateAsync({ data: value });
      formApi.reset();
      await onCreated(user);
    },
  });
  const last = step === steps.length - 1;

  return (
    <form.AppForm>
      <form.Form
        failed="The user was not invited."
        onFieldErrors={(fields) => setStep((current) => Math.min(current, ...fields.map(stepOf)))}
        className="max-w-md"
      >
        <h2 className="font-medium">
          Step {step + 1} of {steps.length}: {steps[step]}
        </h2>
        <form.FormError />
        {step === 0 && (
          <form.AppField name="name">{(field) => <field.TextField label="Name" />}</form.AppField>
        )}
        {step === 1 && (
          <form.AppField name="email">
            {(field) => <field.TextField label="Email" type="email" />}
          </form.AppField>
        )}
        <div className="flex gap-2">
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Back</Button>}
          {last ? (
            <form.SubmitButton pending="Inviting…">Invite user</form.SubmitButton>
          ) : (
            <Button onClick={() => setStep(step + 1)}>Next</Button>
          )}
        </div>
      </form.Form>
    </form.AppForm>
  );
}
```

```tsx,verify
// file: src/routes/users/invite.tsx
import { createFileRoute } from "@tanstack/react-router";
import { InviteUserForm } from "@/features/users/invite-user-form";

export const Route = createFileRoute("/users/invite")({
  component: InviteUserPage,
});

function InviteUserPage() {
  const navigate = Route.useNavigate();

  return (
    <div className="flex flex-col gap-4">
      <title>Invite user</title>
      <h1 className="font-semibold text-2xl">Invite user</h1>
      <InviteUserForm
        onCreated={(user) => navigate({ to: "/users/$userId", params: { userId: user.id } })}
      />
    </div>
  );
}
```

```tsx,verify,test
// file: src/routes/users/invite.test.tsx
import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { renderRoute, TEST_API_ORIGIN } from "@/test/render-route";
import { server } from "@/test/server";

test("a schema error on an earlier step opens that step and focuses the field", async () => {
  const { user } = renderRoute("/users/invite");
  await user.click(await screen.findByRole("button", { name: "Next" }));
  await user.type(screen.getByRole("textbox", { name: "Email" }), "ada@example.com");
  await user.click(screen.getByRole("button", { name: "Invite user" }));

  const name = await screen.findByRole("textbox", { name: "Name" });
  expect(name).toHaveAttribute("aria-invalid", "true");
  await waitFor(() => expect(name).toHaveFocus());
});

test("a server error on an earlier step opens that step and shows it", async () => {
  server.use(
    http.post(`${TEST_API_ORIGIN}/users`, () =>
      HttpResponse.json(
        {
          error: "validation failed",
          details: { name: [{ code: "reserved", message: "This name is reserved." }] },
        },
        { status: 422 },
      ),
    ),
  );
  const { user } = renderRoute("/users/invite");
  await user.type(await screen.findByRole("textbox", { name: "Name" }), "admin");
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.type(screen.getByRole("textbox", { name: "Email" }), "ada@example.com");
  await user.click(screen.getByRole("button", { name: "Invite user" }));

  const name = await screen.findByRole("textbox", { name: "Name" });
  expect(name).toHaveAccessibleDescription("This name is reserved.");
  await waitFor(() => expect(name).toHaveFocus());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
```

## Validation timing

The house default, `revalidateLogic()` with the schema in `validators.onDynamic`, measured at
1.33.5:

| Moment | What the user sees |
|---|---|
| typing before the first submit | nothing |
| first submit | every invalid field marked, focus on the first; nothing is sent |
| any change after that | that field re-checked: its error comes and goes with the value |
| a failed request | its field errors under their fields, the rest as one form message |
| another field changes | a server field error stays |
| its own field changes | that server field error goes, and the schema decides again |
| any change after a form message | the form message goes |
| submit again | every server error cleared first, then the schema, then the request again |

```tsx,verify,test
import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { renderRoute, TEST_API_ORIGIN } from "@/test/render-route";
import { server } from "@/test/server";

test("errors wait for the first submit, then follow every change", async () => {
  const { user } = renderRoute("/users/new");
  const name = await screen.findByRole("textbox", { name: "Name" });
  const email = screen.getByRole("textbox", { name: "Email" });

  await user.type(email, "ada");
  expect(email).not.toHaveAttribute("aria-invalid");

  await user.click(screen.getByRole("button", { name: "Create user" }));
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(email).toHaveAttribute("aria-invalid", "true");
  await waitFor(() => expect(name).toHaveFocus());

  await user.type(name, "A");
  expect(name).not.toHaveAttribute("aria-invalid");
  await user.clear(name);
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(email).toHaveAttribute("aria-invalid", "true");
});

test("a server error stays until its own field changes; a resubmit asks again", async () => {
  let posts = 0;
  server.use(
    http.post(`${TEST_API_ORIGIN}/users`, () => {
      posts += 1;
      return HttpResponse.json(
        {
          error: "validation failed",
          details: { email: [{ code: "email", message: "Not deliverable." }] },
        },
        { status: 422 },
      );
    }),
  );
  const { user } = renderRoute("/users/new");
  const name = await screen.findByRole("textbox", { name: "Name" });
  const email = screen.getByRole("textbox", { name: "Email" });
  const submit = screen.getByRole("button", { name: "Create user" });
  await user.type(name, "Ada");
  await user.type(email, "ada@example.com");
  await user.click(submit);
  await waitFor(() => expect(email).toHaveAccessibleDescription("Not deliverable."));

  await user.type(name, " Lovelace");
  expect(email).toHaveAccessibleDescription("Not deliverable.");
  await user.click(submit);
  await waitFor(() => expect(posts).toBe(2));

  await user.type(email, "m");
  expect(email).not.toHaveAttribute("aria-invalid");
});
```
