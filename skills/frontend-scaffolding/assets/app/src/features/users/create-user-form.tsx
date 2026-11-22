import { useForm } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import { useRef } from "react";
import type * as z from "zod";
import { ApiError } from "@/api/api-error";
import {
  getCreateUserMutationOptions,
  getListUsersQueryKey,
  type UserResponse,
} from "@/api/generated/api";
import { CreateUserBody } from "@/api/generated/api.zod";
import { Button } from "@/shared/ui/button";
import { TextField } from "@/shared/ui/text-field";

const emptyUser: z.input<typeof CreateUserBody> = { email: "", name: "" };

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
      : { form: "The server rejected the user for a reason this form cannot show.", fields };
  }
  const requestId =
    error instanceof ApiError && error.requestId ? ` Request id: ${error.requestId}` : "";
  return { form: `The user was not created. Try again.${requestId}`, fields: {} };
}

// Schema issues arrive as objects, server field errors as strings.
const firstError = (errors: readonly (string | { message: string } | undefined)[]) =>
  errors.map((error) => (typeof error === "string" ? error : error?.message)).find(Boolean);

export function CreateUserForm({
  onCreated,
}: {
  onCreated: (user: UserResponse) => Promise<void>;
}) {
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
        formApi.setErrorMap({ onSubmit: submitErrors(error, formApi.fieldInfo) });
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
    shouldBlockFn: () => !form.state.isDefaultValue && !window.confirm("Discard the new user?"),
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
            {submitting ? "Creating…" : "Create user"}
          </Button>
        )}
      </form.Subscribe>
    </form>
  );
}
