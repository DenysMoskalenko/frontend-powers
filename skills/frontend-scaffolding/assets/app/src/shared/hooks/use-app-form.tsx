import { createFormHook, createFormHookContexts, useStore } from "@tanstack/react-form";
import { type ComponentProps, useRef } from "react";
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

function BoundTextField(
  props: Omit<
    ComponentProps<typeof TextField>,
    "name" | "value" | "error" | "onValueChange" | "onBlur"
  >,
) {
  const field = useFieldContext<string>();
  const value = useStore(field.store, (state) => state.value);
  // Schema issues and server errors both carry `message`; a translated app maps `code` here.
  const error = useStore(field.store, (state) =>
    state.meta.errors
      .map((issue: { message?: string } | undefined) => issue?.message)
      .find(Boolean),
  );
  return (
    <TextField
      {...props}
      name={field.name}
      value={value}
      error={error}
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
