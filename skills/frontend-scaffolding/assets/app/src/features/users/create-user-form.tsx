import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
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
    shouldBlockFn: () => !form.state.isDefaultValue && !window.confirm("Discard the new user?"),
    enableBeforeUnload: () => !form.state.isDefaultValue,
  });

  return (
    <form.AppForm>
      <form.Form
        failed="The user was not created."
        className="max-w-md"
        data-testid="users-create-form"
      >
        <form.FormError />
        <form.AppField name="name">
          {(field) => <field.TextField label="Name" data-testid="users-create-name" />}
        </form.AppField>
        <form.AppField name="email">
          {(field) => (
            <field.TextField label="Email" type="email" data-testid="users-create-email" />
          )}
        </form.AppField>
        <form.SubmitButton pending="Creating…" data-testid="users-create-submit">
          Create user
        </form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}
