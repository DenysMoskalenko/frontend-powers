# Complete form examples

## Contents

- Edit form: default values from query data, error mapping, leave guard
- Edit route and its route test
- A form schema that is not the request body: extra field, cross-field rule, transform
- One-field form: `FormData` and a mutation
- Validation timing, pinned by a test

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
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { useRef } from "react";
import type * as z from "zod";
import { ApiError } from "@/api/api-error";
import { apiFetch } from "@/api/fetcher";
import { type CreateUser, getListUsersQueryKey, type UserResponse } from "@/api/generated/api";
import { CreateUserBody } from "@/api/generated/api.zod";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

// Stand-in until the spec has `PATCH /users/{id}`; then use `getUpdateUserMutationOptions`.
const updateUser = (id: string, data: CreateUser) =>
  apiFetch<UserResponse>(`/users/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

/** `fieldInfo`: the form's rendered fields, keyed by name (`email`, `items[0].name`). */
function submitErrors(error: unknown, fieldInfo: object) {
  if (error instanceof ApiError && error.status === 409) {
    return { form: "Another user already has this email.", fields: {} };
  }
  if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
    const fields = error.fieldErrors;
    // setErrorMap drops errors for fields the form does not render.
    return Object.keys(fields).every((name) => name in fieldInfo)
      ? { fields }
      : { form: "The changes were not saved. Check the form and try again.", fields };
  }
  const requestId =
    error instanceof ApiError && error.requestId ? ` Request id: ${error.requestId}` : "";
  return { form: `The changes were not saved. Try again.${requestId}`, fields: {} };
}

const firstError = (errors: readonly (string | { message: string } | undefined)[]) =>
  errors.map((error) => (typeof error === "string" ? error : error?.message)).find(Boolean);

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
  const formRef = useRef<HTMLFormElement>(null);
  // After a failed submit, focus the first invalid field once it renders, so its error is read out.
  const focusFirstError = () =>
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(),
    );
  const defaultValues: z.input<typeof CreateUserBody> = { name: user.name, email: user.email };
  const form = useForm({
    defaultValues,
    validators: { onSubmit: CreateUserBody },
    onSubmit: async ({ value, formApi }) => {
      try {
        await saveUser.mutateAsync(value);
      } catch (error) {
        formApi.setErrorMap({ onSubmit: submitErrors(error, formApi.fieldInfo) });
        focusFirstError();
        return;
      }
      formApi.reset();
      await onSaved();
    },
    onSubmitInvalid: focusFirstError,
  });
  useBlocker({
    shouldBlockFn: () => !form.state.isDefaultValue && !window.confirm("Discard your changes?"),
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
            label="Name"
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
            label="Email"
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
            {submitting ? "Saving…" : "Save"}
          </Button>
        )}
      </form.Subscribe>
    </form>
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
keeps the page out of `users/$userId.tsx`, which renders no `<Outlet />`. Its loader treats the id as
the detail loader does: malformed or unknown is `notFound()`.

```tsx,verify
// file: src/routes/users/$userId_/edit.tsx
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { ApiError } from "@/api/api-error";
import { getGetUserQueryOptions, getGetUserSuspenseQueryOptions } from "@/api/generated/api";
import { GetUserParams } from "@/api/generated/api.zod";
import { EditUserForm } from "@/features/users/edit-user-form";

export const Route = createFileRoute("/users/$userId_/edit")({
  loader: async ({ context, params }) => {
    if (!GetUserParams.safeParse({ id: params.userId }).success) throw notFound();
    try {
      await context.queryClient.query({
        ...getGetUserQueryOptions(params.userId),
        staleTime: "static",
      });
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
    <>
      <title>Edit user</title>
      <h1 className="font-semibold text-2xl">Edit user</h1>
      <EditUserForm
        key={user.id}
        user={user}
        onSaved={() => navigate({ to: "/users/$userId", params: { userId } })}
      />
    </>
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

const id = "0193a1b2-0000-7000-8000-000000000002";

const patchAnswer = (status: number, body: object) =>
  http.patch(`${TEST_API_ORIGIN}/users/:id`, () => HttpResponse.json(body, { status }));

test("saving an edited user sends the form and opens the saved user", async () => {
  let stored: UserResponse = buildUser({ id, name: "Ada", email: "ada@example.com" });
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
  const { user } = renderRoute(`/users/${id}/edit`);

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
    getGetUserMockHandler(buildUser({ id, name: "Ada", email: "ada@example.com" })),
    patchAnswer(422, {
      detail: [{ loc: ["body", "email"], msg: "domain is not accepted", type: "value_error" }],
    }),
  );
  const { user } = renderRoute(`/users/${id}/edit`);

  await user.type(await screen.findByRole("textbox", { name: "Name" }), " Lovelace");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("textbox", { name: "Email" })).toHaveAccessibleDescription(
    "domain is not accepted",
  );
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Email" })).toHaveFocus());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a field error for a field the form does not render becomes a form error", async () => {
  server.use(
    getGetUserMockHandler(buildUser({ id, name: "Ada", email: "ada@example.com" })),
    patchAnswer(422, {
      error: "validation failed",
      details: { role: [{ code: "required", message: null, params: {} }] },
    }),
  );
  const { user } = renderRoute(`/users/${id}/edit`);

  await user.type(await screen.findByRole("textbox", { name: "Name" }), " Lovelace");
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(await screen.findByRole("alert")).toHaveTextContent("Check the form and try again.");
});

test("an unexpected failure names the request id", async () => {
  server.use(
    getGetUserMockHandler(buildUser({ id, name: "Ada", email: "ada@example.com" })),
    patchAnswer(500, { error: "internal server error", request_id: "req-7" }),
  );
  const { user } = renderRoute(`/users/${id}/edit`);

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
form's output into exactly the request body.

```tsx,verify
// file: src/features/users/invite-user-form.tsx
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import * as z from "zod";
import { ApiError } from "@/api/api-error";
import {
  getCreateUserMutationOptions,
  getListUsersQueryKey,
  type UserResponse,
} from "@/api/generated/api";
import { CreateUserBody, createUserBodyNameMax } from "@/api/generated/api.zod";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

const InviteUserInput = CreateUserBody.extend({
  // trim() before min(): a trim after min(1) lets "   " pass and sends "".
  name: z.string().trim().min(1).max(createUserBodyNameMax),
  confirmEmail: z.string(),
})
  .refine((form) => form.email === form.confirmEmail, {
    path: ["confirmEmail"],
    message: "The emails do not match.",
  })
  .transform((form) => ({ name: form.name, email: form.email }));

/** `fieldInfo`: the form's rendered fields, keyed by name (`email`, `items[0].name`). */
function submitErrors(error: unknown, fieldInfo: object) {
  if (error instanceof ApiError && error.status === 409) {
    return { form: "A user with this email already exists.", fields: {} };
  }
  if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
    const fields = error.fieldErrors;
    // setErrorMap drops errors for fields the form does not render.
    return Object.keys(fields).every((name) => name in fieldInfo)
      ? { fields }
      : { form: "The invitation has an error this form cannot show.", fields };
  }
  const requestId =
    error instanceof ApiError && error.requestId ? ` Request id: ${error.requestId}` : "";
  return { form: `The invitation was not sent. Try again.${requestId}`, fields: {} };
}

const firstError = (errors: readonly (string | { message: string } | undefined)[]) =>
  errors.map((error) => (typeof error === "string" ? error : error?.message)).find(Boolean);

export function InviteUserForm({
  onInvited,
}: {
  onInvited: (user: UserResponse) => Promise<void>;
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
  const formRef = useRef<HTMLFormElement>(null);
  // After a failed submit, focus the first invalid field once it renders, so its error is read out.
  const focusFirstError = () =>
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(),
    );
  const form = useForm({
    defaultValues: { name: "", email: "", confirmEmail: "" },
    validators: { onSubmit: InviteUserInput },
    onSubmit: async ({ value, formApi }) => {
      let user: UserResponse;
      try {
        // `value` is the raw input; parse again for the transformed request body.
        user = await createUser.mutateAsync({ data: InviteUserInput.parse(value) });
      } catch (error) {
        formApi.setErrorMap({ onSubmit: submitErrors(error, formApi.fieldInfo) });
        focusFirstError();
        return;
      }
      formApi.reset();
      await onInvited(user);
    },
    onSubmitInvalid: focusFirstError,
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
        {(error) => (typeof error === "string" ? <p role="alert">{error}</p> : null)}
      </form.Subscribe>
      <form.Field name="name">
        {(field) => (
          <TextField
            label="Name"
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
            label="Email"
            type="email"
            value={field.state.value}
            error={firstError(field.state.meta.errors)}
            onValueChange={field.handleChange}
            onBlur={field.handleBlur}
          />
        )}
      </form.Field>
      <form.Field name="confirmEmail">
        {(field) => (
          <TextField
            label="Repeat email"
            type="email"
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
            Invite
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
```

The `refine` issue's `path` puts its message on that field; a refine without `path` lands nowhere
the user sees.

## One-field form

No form library: read `FormData` on submit, validate with the generated schema's field, focus the
field when it is invalid, call the mutation. Without `meta: { silent: true }` a failed save reaches
the global toast, which is enough for one field.

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
      apiFetch<UserResponse>(`/users/${user.id}`, {
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

## Validation timing, pinned by a test

With only `validators.onSubmit`, nothing is checked until the first submit. After it, a field's
error disappears on that field's next change or blur, whether or not the new value is valid; focus
moves to the first invalid field, so leaving it clears its error too. A resubmit runs the schema
again only when no field still shows an error; while one does, the submit stops early, so a field
cleared by editing stays unmarked even if it is still invalid. Nothing is sent either way: the test
has no POST handler, and an unhandled request fails it.

```tsx,verify,test
import { screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderRoute } from "@/test/render-route";

test("submit-only validation: edits clear errors, a resubmit rechecks once none is shown", async () => {
  const { user } = renderRoute("/users/new");
  const name = await screen.findByRole("textbox", { name: "Name" });
  const email = screen.getByRole("textbox", { name: "Email" });
  const submit = screen.getByRole("button", { name: "Create user" });

  await user.type(email, "not-an-email");
  expect(email).not.toHaveAttribute("aria-invalid");

  await user.click(submit);
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(email).toHaveAttribute("aria-invalid", "true");
  await waitFor(() => expect(name).toHaveFocus());

  await user.type(name, "a{Backspace}");
  expect(name).not.toHaveAttribute("aria-invalid");

  await user.click(submit);
  expect(name).not.toHaveAttribute("aria-invalid");
  expect(email).toHaveAttribute("aria-invalid", "true");

  await user.type(email, "x");
  await user.click(submit);
  expect(name).toHaveAttribute("aria-invalid", "true");
  expect(email).toHaveAttribute("aria-invalid", "true");
});
```
