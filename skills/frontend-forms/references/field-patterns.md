# Field patterns beyond text inputs

## Contents

- Array fields
- Dependent fields: clearing one field when another changes, re-validating on another field
- File inputs
- Re-validating on change after the first submit
- Async validation

Every block here type-checks and lints at TanStack Form 1.33; the behaviour described under each was
run in jsdom at that version. The tag form is complete but for the leave guard. The other blocks show
the fields only: a real form adds the request schema, the submit, the focus on the first invalid field
and the leave guard as in SKILL.md.

## Array fields

`mode="array"` on the array's field re-renders it when items are added or removed. Each item is its
own `form.Field` named with the index path, `tags[0]`. `ApiError.fieldErrors` uses the same names, so
a server error for the second tag arrives as `tags[1]` and lands under that input as it is.

```tsx,verify
// file: src/features/users/tag-list-form.tsx
import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import * as z from "zod";
import { ApiError } from "@/api/api-error";
import { apiFetch } from "@/api/fetcher";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

// Stand-ins until the spec has `PUT /users/{id}/tags`; then use the generated operation and schema.
const TagsBody = z.object({ tags: z.array(z.string().trim().min(1)) });
const saveTags = (userId: string, data: z.infer<typeof TagsBody>) =>
  apiFetch<unknown>(`/users/${userId}/tags`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

/** `fieldInfo`: the form's rendered fields, keyed by name (`email`, `items[0].name`). */
function submitErrors(error: unknown, fieldInfo: object) {
  if (error instanceof ApiError && Object.keys(error.fieldErrors).length > 0) {
    const fields = error.fieldErrors;
    // setErrorMap drops errors for fields the form does not render.
    return Object.keys(fields).every((name) => name in fieldInfo)
      ? { fields }
      : { form: "The tags have an error this form cannot show.", fields };
  }
  const requestId =
    error instanceof ApiError && error.requestId ? ` Request id: ${error.requestId}` : "";
  return { form: `The tags were not saved. Try again.${requestId}`, fields: {} };
}

const firstError = (errors: readonly (string | { message: string } | undefined)[]) =>
  errors.map((error) => (typeof error === "string" ? error : error?.message)).find(Boolean);

export function TagListForm({ userId, onSaved }: { userId: string; onSaved: () => Promise<void> }) {
  const save = useMutation({
    mutationFn: (data: z.infer<typeof TagsBody>) => saveTags(userId, data),
    meta: { silent: true },
  });
  const formRef = useRef<HTMLFormElement>(null);
  // After a failed submit, focus the first invalid field once it renders, so its error is read out.
  const focusFirstError = () =>
    requestAnimationFrame(() =>
      formRef.current?.querySelector<HTMLElement>("[aria-invalid='true']")?.focus(),
    );
  const form = useForm({
    defaultValues: { tags: [] as string[] },
    validators: { onSubmit: TagsBody },
    onSubmit: async ({ value, formApi }) => {
      try {
        await save.mutateAsync(value);
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
      <form.Field name="tags" mode="array">
        {(tags) => (
          <fieldset className="flex flex-col gap-2">
            <legend>Tags</legend>
            {tags.state.value.map((_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the index is the field's identity
              <div key={index} className="flex items-end gap-2">
                <form.Field name={`tags[${index}]`}>
                  {(tag) => (
                    <TextField
                      label={`Tag ${index + 1}`}
                      value={tag.state.value}
                      error={firstError(tag.state.meta.errors)}
                      onValueChange={tag.handleChange}
                      onBlur={tag.handleBlur}
                    />
                  )}
                </form.Field>
                <Button onClick={() => tags.removeValue(index)}>Remove</Button>
              </div>
            ))}
            <Button onClick={() => tags.pushValue("")}>Add tag</Button>
          </fieldset>
        )}
      </form.Field>
      <Button type="submit" variant="primary">
        Save tags
      </Button>
    </form>
  );
}
```

```tsx,verify
// file: src/routes/users/$userId_/tags.tsx
import { createFileRoute } from "@tanstack/react-router";
import { TagListForm } from "@/features/users/tag-list-form";

export const Route = createFileRoute("/users/$userId_/tags")({
  component: UserTagsPage,
});

function UserTagsPage() {
  const { userId } = Route.useParams();
  const navigate = Route.useNavigate();

  return (
    <>
      <title>Tags</title>
      <h1 className="font-semibold text-2xl">Tags</h1>
      <TagListForm
        userId={userId}
        onSaved={() => navigate({ to: "/users/$userId", params: { userId } })}
      />
    </>
  );
}
```

FastAPI reports the second item as `loc: ["body", "tags", 1]`; `toApiError` names it `tags[1]`:

```tsx,verify,test
// file: src/routes/users/$userId_/tags.test.tsx
import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { renderRoute, TEST_API_ORIGIN } from "@/test/render-route";
import { server } from "@/test/server";

test("a server error for one tag shows under that tag", async () => {
  server.use(
    http.put(`${TEST_API_ORIGIN}/users/:id/tags`, () =>
      HttpResponse.json(
        {
          detail: [{ loc: ["body", "tags", 1], msg: "Tags have no spaces.", type: "value_error" }],
        },
        { status: 422 },
      ),
    ),
  );
  const { user } = renderRoute("/users/0193a1b2-0000-7000-8000-000000000002/tags");

  await user.click(await screen.findByRole("button", { name: "Add tag" }));
  await user.click(screen.getByRole("button", { name: "Add tag" }));
  await user.type(screen.getByRole("textbox", { name: "Tag 1" }), "admin");
  await user.type(screen.getByRole("textbox", { name: "Tag 2" }), "on call");
  await user.click(screen.getByRole("button", { name: "Save tags" }));

  const second = screen.getByRole("textbox", { name: "Tag 2" });
  await waitFor(() => expect(second).toHaveAccessibleDescription("Tags have no spaces."));
  await waitFor(() => expect(second).toHaveFocus());
  expect(screen.getByRole("textbox", { name: "Tag 1" })).not.toHaveAttribute("aria-invalid");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
```

Also on an array field: `insertValue(index, value)`, `replaceValue`, `swapValues`, `moveValue`.

## Dependent fields

| Need | API |
|---|---|
| Change another field when this one changes (clear the city when the country changes) | `listeners={{ onChange: () => form.setFieldValue("city", "") }}` on the source field |
| Re-run this field's validator when another field changes (repeat password) | `validators={{ onChangeListenTo: ["password"], onChange: ... }}` on the dependent field |
| A rule across fields that only matters on submit | a `refine` with `path` on the form schema |

```tsx,verify
// file: src/features/users/address-fields.tsx
import { useForm } from "@tanstack/react-form";
import { TextField } from "@/shared/ui/text-field";

export function AddressFields() {
  const form = useForm({ defaultValues: { country: "", city: "" } });

  return (
    <>
      <form.Field name="country" listeners={{ onChange: () => form.setFieldValue("city", "") }}>
        {(field) => (
          <TextField label="Country" value={field.state.value} onValueChange={field.handleChange} />
        )}
      </form.Field>
      <form.Field name="city">
        {(field) => (
          <TextField label="City" value={field.state.value} onValueChange={field.handleChange} />
        )}
      </form.Field>
    </>
  );
}
```

```tsx,verify
// file: src/features/users/password-fields.tsx
import { useForm } from "@tanstack/react-form";
import { TextField } from "@/shared/ui/text-field";

export function PasswordFields() {
  const form = useForm({ defaultValues: { password: "", repeat: "" } });

  return (
    <>
      <form.Field name="password">
        {(field) => (
          <TextField
            label="Password"
            type="password"
            value={field.state.value}
            onValueChange={field.handleChange}
          />
        )}
      </form.Field>
      <form.Field
        name="repeat"
        validators={{
          onChangeListenTo: ["password"],
          onChange: ({ value, fieldApi }) =>
            value === fieldApi.form.getFieldValue("password") ? undefined : "Does not match.",
        }}
      >
        {(field) => (
          <TextField
            label="Repeat password"
            type="password"
            value={field.state.value}
            error={field.state.meta.errors[0]}
            onValueChange={field.handleChange}
          />
        )}
      </form.Field>
    </>
  );
}
```

## File inputs

A file input cannot be controlled: never pass `value`. Hold `File | null` in the form and set it from
`onChange`. `Field.Control type="file"` keeps the label association. Base UI parts are styled only
inside a `src/shared/ui` wrapper, so a file field used twice becomes one (`tailwind-base-ui`). The
upload request is the generated multipart operation, which builds the `FormData` body
(`tanstack-query-api`).

```tsx,verify
// file: src/features/users/avatar-form.tsx
import { Field } from "@base-ui/react/field";
import { useForm } from "@tanstack/react-form";

export function AvatarForm() {
  const form = useForm({ defaultValues: { avatar: null as File | null } });

  return (
    <form.Field name="avatar">
      {(field) => (
        <Field.Root>
          <Field.Label>Avatar</Field.Label>
          <Field.Control
            type="file"
            accept="image/png, image/jpeg"
            onChange={(event) => field.handleChange(event.currentTarget.files?.[0] ?? null)}
          />
        </Field.Root>
      )}
    </form.Field>
  );
}
```

## Re-validating on change after the first submit

The house default is submit-only. When a form should re-check every keystroke once the user has
submitted (a long form where errors that vanish on edit confuse), switch the schema to the dynamic
slot. Before the first submit nothing is checked; after it, each change re-runs the schema and an
error stays until the value is valid.

```ts,verify
// file: src/features/users/use-revalidating-user-form.ts
import { revalidateLogic, useForm } from "@tanstack/react-form";
import { CreateUserBody } from "@/api/generated/api.zod";

export function useRevalidatingUserForm() {
  return useForm({
    defaultValues: { name: "", email: "" },
    validationLogic: revalidateLogic(),
    validators: { onDynamic: CreateUserBody },
  });
}
```

`revalidateLogic({ mode, modeAfterSubmission })` defaults to `"submit"` and `"change"`. Server
errors still go to `setErrorMap({ onSubmit: ... })`.

## Async validation

Do not pre-check uniqueness with a request per keystroke: the 409 the submit returns is the check, and
it cannot race. When a product asks for a live check, a field takes `validators.onChangeAsync` (or
`onBlurAsync`) with `onChangeAsyncDebounceMs`, an async function returning the message or
`undefined`; `field.state.meta.isValidating` is `true` while it runs. Async validators run only after
the sync ones pass.
