# Field patterns beyond text inputs

## Contents

- Bound parts: one per value type
- The cost of `createFormHook`
- Every field kind in one form: text, number, select, date, checkbox
- File fields
- Array fields
- Dependent fields

Every block here type-checks and lints at TanStack Form 1.33.5, and the tests run in jsdom. The
forms use the bound parts below, so `src/shared/hooks/use-app-form.tsx` here is the scaffold's file
plus the parts a field kind needs.

## Bound parts: one per value type

A field kind the hook has no part for gets one in `src/shared/hooks/use-app-form.tsx`, registered in
`fieldComponents`; forms never wire a field by hand. Each part reads one value type and is named for
its control: `TextField` (string: text, email, password, date), `NumberField` (number),
`SelectField` (string), `CheckboxField` (boolean), `FileField` (`File | null`). Every part clears its
own server error on change, as the scaffold's `TextField` does, and `useBoundField` holds that once.
`onFieldErrors` on `Form` lets a form in steps open the step that holds the first error.

```tsx,verify
// file: src/shared/hooks/use-app-form.tsx
import { createFormHook, createFormHookContexts, useStore } from "@tanstack/react-form";
import { type ComponentProps, useRef, useState } from "react";
import { ApiError, type FieldError } from "@/api/api-error";
import { submitErrors } from "@/shared/lib/submit-errors";
import { Button } from "@/shared/ui/button";
import { CheckboxField } from "@/shared/ui/checkbox-field";
import { cx } from "@/shared/ui/cx";
import { SelectField } from "@/shared/ui/select-field";
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

/** What every bound part needs. `Value` is asserted, not checked: one bound part per value type. */
function useBoundField<Value>() {
  const field = useFieldContext<Value>();
  const value = useStore(field.store, (state) => state.value);
  const error = useStore(field.store, (state) =>
    state.meta.errors
      .map((issue: { message?: string } | undefined) => issue?.message)
      .find(Boolean),
  );
  const change = (next: Value) => {
    field.setErrorMap({ onServer: undefined });
    field.handleChange(next);
  };
  return { name: field.name, value, error, change, onBlur: field.handleBlur };
}

type BoundProps<Props> = Omit<Props, "name" | "value" | "error" | "onValueChange" | "onBlur">;

/** A number; an empty input holds `NaN`, which a `z.number()` schema rejects. */
function BoundNumberField(props: BoundProps<ComponentProps<typeof TextField>>) {
  const { value, change, ...field } = useBoundField<number>();
  // "0." and "-0" are steps towards "0.5" and "-0.5": shown as typed while they mean the stored value.
  const [typed, setTyped] = useState("");
  const typedValue = typed === "" ? Number.NaN : Number(typed);
  const shown = Object.is(typedValue, value) ? typed : Number.isNaN(value) ? "" : String(value);
  return (
    <TextField
      {...props}
      {...field}
      type="number"
      value={shown}
      onValueChange={(next) => {
        setTyped(next);
        change(next === "" ? Number.NaN : Number(next));
      }}
    />
  );
}

function BoundSelectField(props: BoundProps<ComponentProps<typeof SelectField<string>>>) {
  const { value, change, ...field } = useBoundField<string>();
  return (
    <SelectField {...props} {...field} value={value} onValueChange={(next) => change(next ?? "")} />
  );
}

function BoundCheckboxField(
  props: Omit<BoundProps<ComponentProps<typeof CheckboxField>>, "checked" | "onCheckedChange">,
) {
  const { value, change, ...field } = useBoundField<boolean>();
  return <CheckboxField {...props} {...field} checked={value} onCheckedChange={change} />;
}

/** One file; the input stays uncontrolled, a browser forbids setting its value. */
function BoundFileField(props: BoundProps<ComponentProps<typeof TextField>>) {
  const { name, error, change, onBlur } = useBoundField<File | null>();
  return (
    <TextField
      {...props}
      name={name}
      error={error}
      onBlur={onBlur}
      type="file"
      onChange={(event) => change(event.currentTarget.files?.[0] ?? null)}
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
  fieldComponents: {
    TextField: BoundTextField,
    NumberField: BoundNumberField,
    SelectField: BoundSelectField,
    CheckboxField: BoundCheckboxField,
    FileField: BoundFileField,
  },
  formComponents: { Form, FormError, SubmitButton },
});
```

`NumberField` keeps the value a number: an empty input holds `NaN`, which `z.number()` rejects with a
field error, and a `NaN` default still counts as the default for `isDefaultValue`. It shows the text
as typed while that text means the stored number: rendering `String(value)` back on every keystroke
turns the step "0." into "0", so typing `0.05` stores 5 and `-0.5` stores 0.5. A value set from
outside, such as a reset, still shows.

```tsx,verify,test
// file: src/shared/hooks/number-field.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { useAppForm } from "@/shared/hooks/use-app-form";

function PriceForm({ onSubmit }: { onSubmit: (price: number) => void }) {
  const form = useAppForm({
    defaultValues: { price: Number.NaN },
    onSubmit: ({ value }) => onSubmit(value.price),
  });
  return (
    <form.AppForm>
      <form.Form failed="Not saved.">
        <form.AppField name="price">
          {(field) => <field.NumberField label="Price" step="any" />}
        </form.AppField>
        <form.SubmitButton pending="Saving">Save</form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}

test.each(["0.05", "-0.5", "10.25"])("typing %s stores that number", async (typed) => {
  const user = userEvent.setup();
  const submitted: number[] = [];
  render(<PriceForm onSubmit={(price) => submitted.push(price)} />);

  await user.type(screen.getByRole("spinbutton", { name: "Price" }), typed);
  await user.click(screen.getByRole("button", { name: "Save" }));

  expect(screen.getByRole("spinbutton", { name: "Price" })).toHaveValue(Number(typed));
  expect(submitted).toEqual([Number(typed)]);
});
``` `SelectField`
renders `tailwind-base-ui`'s `src/shared/ui/select-field.tsx` wrapper; the checkbox needs a wrapper of
the same shape, which `tailwind-base-ui` styles:

```tsx,verify
// file: src/shared/ui/checkbox-field.tsx
import { Checkbox } from "@base-ui/react/checkbox";
import { Field } from "@base-ui/react/field";
import { cx } from "./cx";

interface CheckboxFieldProps extends Omit<Checkbox.Root.Props, "className"> {
  label: string;
  /** A server or form-library error; marks the field invalid. */
  error?: string | undefined;
  /** Layout only (margin, width, placement). */
  className?: string | undefined;
}

export function CheckboxField({ label, error, className, ...props }: CheckboxFieldProps) {
  return (
    <Field.Root invalid={error !== undefined} className={cx("flex flex-col gap-1", className)}>
      <Field.Label className="flex items-center gap-2 text-sm">
        <Checkbox.Root
          {...props}
          className="flex size-4 items-center justify-center rounded border border-control bg-surface data-checked:bg-accent data-invalid:border-danger"
        >
          <Checkbox.Indicator className="size-2 rounded-sm bg-accent-fg" />
        </Checkbox.Root>
        {label}
      </Field.Label>
      <Field.Error match={error !== undefined} className="text-danger text-sm">
        {error}
      </Field.Error>
    </Field.Root>
  );
}
```

`tailwind-base-ui`'s wrapper, verbatim, so this skill's blocks compile on their own:

```tsx,verify
// file: src/shared/ui/select-field.tsx
import { Field } from "@base-ui/react/field";
import { Select } from "@base-ui/react/select";
import { cx } from "./cx";

interface SelectFieldProps<Value extends string>
  extends Omit<Select.Root.Props<Value>, "items" | "multiple" | "children"> {
  label: string;
  items: { value: Value; label: string }[];
  placeholder?: string | undefined;
  /** A server or form-library error; marks the field invalid. */
  error?: string | undefined;
  /** Layout only (margin, width, placement). */
  className?: string | undefined;
  /** Lands on the trigger, the element a user clicks. */
  "data-testid"?: string | undefined;
}

export function SelectField<Value extends string>({
  label,
  items,
  placeholder,
  error,
  className,
  "data-testid": testId,
  ...props
}: SelectFieldProps<Value>) {
  return (
    <Field.Root invalid={error !== undefined} className={cx("flex flex-col gap-1", className)}>
      {/* The trigger is a button: a div label avoids a native label's click and hover forwarding. */}
      <Field.Label nativeLabel={false} render={<div />} className="font-medium text-sm">
        {label}
      </Field.Label>
      <Select.Root {...props} items={items}>
        <Select.Trigger
          data-testid={testId}
          className="flex h-9 items-center justify-between gap-2 rounded-md border border-control bg-surface px-3 text-sm data-invalid:border-danger"
        >
          <Select.Value placeholder={placeholder} className="data-placeholder:text-muted" />
          <Select.Icon className="text-muted">
            <svg aria-hidden viewBox="0 0 16 16" fill="currentColor" className="size-4">
              <path d="M11 10H5l3 3.5zm0-4H5l3-3.5z" />
            </svg>
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner alignItemWithTrigger={false} sideOffset={6} className="outline-hidden">
            <Select.Popup className="min-w-(--anchor-width) origin-(--transform-origin) rounded-lg border border-line bg-surface p-1 text-fg shadow-md outline-hidden transition-[opacity,scale] duration-100 data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-opacity">
              <Select.List className="max-h-(--available-height) overflow-y-auto">
                {items.map((item) => (
                  <Select.Item
                    key={item.value}
                    value={item.value}
                    className="flex h-8 cursor-default select-none items-center rounded-md px-2 text-sm outline-hidden data-disabled:opacity-50 data-selected:font-medium data-highlighted:bg-accent data-highlighted:text-accent-fg"
                  >
                    <Select.ItemText>{item.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
      <Field.Error match={error !== undefined} className="text-danger text-sm">
        {error}
      </Field.Error>
    </Field.Root>
  );
}
```

## The cost of `createFormHook`

A bound part gets its field through `useFieldContext<Value>()`, which asserts the value type instead
of checking it. Field names are checked; which part renders which field is not:

```tsx,verify
// file: src/features/events/event-fields.tsx
import { useAppForm } from "@/shared/hooks/use-app-form";

export function SeatsForm() {
  const form = useAppForm({ defaultValues: { title: "", seats: 1 } });

  return (
    <form.AppForm>
      <form.AppField name="title">{(field) => <field.TextField label="Title" />}</form.AppField>
      <form.AppField name="seats">{(field) => <field.NumberField label="Seats" />}</form.AppField>
      {/* @ts-expect-error: a field name is checked against the form's values */}
      <form.AppField name="seat">{(field) => <field.NumberField label="Seats" />}</form.AppField>
    </form.AppForm>
  );
}
```

```tsx,ignore
// Compiles: the input shows "1" and the form sends the string "12" for a number field.
<form.AppField name="seats">{(field) => <field.TextField label="Seats" />}</form.AppField>
```

So: one bound part per value type, named for it, and the field's type decides the part. A schema
rejects the strings a text part feeds a number field, so a route test that submits valid values once
catches a wrong part.

## Every field kind in one form

A date input's value is the string `YYYY-MM-DD` and goes into the body as it is, through `TextField
type="date"`; never through `new Date()`, which turns it into midnight UTC, a day earlier west of
UTC. Formatting a date for display is `formatDate`, which `frontend-code-style`'s reference adds
to `src/shared/lib/format-date.ts`; the scaffold does not ship it.

```tsx,verify
// file: src/features/events/create-event-form.tsx
import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import { useBlocker } from "@tanstack/react-router";
import * as z from "zod";
import { apiFetch } from "@/api/fetcher";
import { useAppForm } from "@/shared/hooks/use-app-form";

// Stand-in for the generated schema and operation until the spec has `POST /events`.
const CreateEventBody = z.object({
  title: z.string().min(1).max(100),
  seats: z.number().int().min(1),
  visibility: z.enum(["public", "private"]),
  startsOn: z.iso.date(),
  remind: z.boolean(),
});
type CreateEvent = z.output<typeof CreateEventBody>;
const createEvent = (data: CreateEvent) =>
  apiFetch<{ id: string }>("/events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

const visibilities = [
  { value: "public", label: "Public" },
  { value: "private", label: "Private" },
];

const emptyEvent: z.input<typeof CreateEventBody> = {
  title: "",
  seats: Number.NaN,
  visibility: "public",
  startsOn: "",
  remind: false,
};

export function CreateEventForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const create = useMutation({ mutationFn: createEvent, meta: { silent: true } });
  const form = useAppForm({
    defaultValues: emptyEvent,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: CreateEventBody },
    onSubmit: async ({ value, formApi }) => {
      // The date input's `YYYY-MM-DD` goes as it is: `new Date()` would shift it a day west of UTC.
      await create.mutateAsync(value);
      formApi.reset();
      await onCreated();
    },
  });
  useBlocker({
    shouldBlockFn: () => !form.state.isDefaultValue && !window.confirm("Discard the new event?"),
    enableBeforeUnload: () => !form.state.isDefaultValue,
  });

  return (
    <form.AppForm>
      <form.Form failed="The event was not created." className="max-w-md">
        <form.FormError />
        <form.AppField name="title">{(field) => <field.TextField label="Title" />}</form.AppField>
        <form.AppField name="seats">
          {(field) => <field.NumberField label="Seats" min={1} step={1} />}
        </form.AppField>
        <form.AppField name="visibility">
          {(field) => <field.SelectField label="Visibility" items={visibilities} />}
        </form.AppField>
        <form.AppField name="startsOn">
          {(field) => <field.TextField label="Starts on" type="date" />}
        </form.AppField>
        <form.AppField name="remind">
          {(field) => <field.CheckboxField label="Remind attendees the day before" />}
        </form.AppField>
        <form.SubmitButton pending="Creating…">Create event</form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}
```

```tsx,verify
// file: src/routes/events/new.tsx
import { createFileRoute } from "@tanstack/react-router";
import { CreateEventForm } from "@/features/events/create-event-form";

export const Route = createFileRoute("/events/new")({
  component: NewEventPage,
});

function NewEventPage() {
  const navigate = Route.useNavigate();

  return (
    <div className="flex flex-col gap-4">
      <title>New event</title>
      <h1 className="font-semibold text-2xl">New event</h1>
      <CreateEventForm onCreated={() => navigate({ to: "/users" })} />
    </div>
  );
}
```

```tsx,verify,test
// file: src/routes/events/new.test.tsx
import { screen, waitFor } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
import { getListUsersMockHandler } from "@/api/generated/api.msw";
import { renderRoute, TEST_API_ORIGIN } from "@/test/render-route";
import { server } from "@/test/server";

test("each field kind sends its own value type; the date goes as typed", async () => {
  const posted: unknown[] = [];
  server.use(
    http.post(`${TEST_API_ORIGIN}/events`, async ({ request }) => {
      posted.push(await request.json());
      return HttpResponse.json({ id: "e1" }, { status: 201 });
    }),
    getListUsersMockHandler({ items: [], total: 0, limit: 20, offset: 0 }),
  );
  const { user } = renderRoute("/events/new");

  await user.type(await screen.findByRole("textbox", { name: "Title" }), "Launch");
  await user.type(screen.getByRole("spinbutton", { name: "Seats" }), "40");
  await user.click(screen.getByRole("combobox", { name: "Visibility" }));
  await user.click(await screen.findByRole("option", { name: "Private" }));
  await user.type(screen.getByLabelText("Starts on"), "2026-03-01");
  await user.click(screen.getByRole("checkbox", { name: "Remind attendees the day before" }));
  await user.click(screen.getByRole("button", { name: "Create event" }));

  await screen.findByRole("heading", { name: "Users" });
  expect(posted).toEqual([
    { title: "Launch", seats: 40, visibility: "private", startsOn: "2026-03-01", remind: true },
  ]);
});

test("an empty number field is an error, not 0", async () => {
  const { user } = renderRoute("/events/new");
  await user.type(await screen.findByRole("textbox", { name: "Title" }), "Launch");
  await user.click(screen.getByRole("button", { name: "Create event" }));

  const seats = screen.getByRole("spinbutton", { name: "Seats" });
  expect(seats).toHaveValue(null);
  expect(seats).toHaveAttribute("aria-invalid", "true");
});

test("an untouched form leaves without asking", async () => {
  const confirm = vi.spyOn(window, "confirm");
  server.use(getListUsersMockHandler({ items: [], total: 0, limit: 20, offset: 0 }));
  const { user } = renderRoute("/events/new");
  await user.click(await screen.findByRole("link", { name: "Users" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Users" })).toBeInTheDocument());
  expect(confirm).not.toHaveBeenCalled();
});
```

## File fields

A file input cannot be controlled: `FileField` sets `File | null` from `onChange` and never passes
`value`. Check type and size on the client in the schema, so a wrong file is a field error before
anything is sent; the server's limit is still the one that counts. How the file is sent, its
progress and cancelling are `tanstack-query-api`'s (`references/files.md`).

```tsx,verify
// file: src/features/users/avatar-form.tsx
import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import * as z from "zod";
import { apiFetch } from "@/api/fetcher";
import { useAppForm } from "@/shared/hooks/use-app-form";

const maxAvatarBytes = 2 * 1024 * 1024;
const avatarTypes = ["image/png", "image/jpeg"];

const AvatarInput = z.object({
  avatar: z
    .custom<File | null>((value) => value instanceof File, "Choose an image.")
    .refine((file) => !file || avatarTypes.includes(file.type), "Choose a PNG or JPEG image.")
    .refine((file) => !file || file.size <= maxAvatarBytes, "Choose an image of 2 MB or less."),
});

const noAvatar: z.input<typeof AvatarInput> = { avatar: null };

// Stand-in until the spec has `PUT /users/{id}/avatar`; then use the generated operation.
const uploadAvatar = (userId: string, avatar: File) => {
  const body = new FormData();
  body.append("avatar", avatar);
  return apiFetch<unknown>(`/users/${encodeURIComponent(userId)}/avatar`, { method: "PUT", body });
};

export function AvatarForm({ userId, onSaved }: { userId: string; onSaved: () => Promise<void> }) {
  const upload = useMutation({
    mutationFn: (avatar: File) => uploadAvatar(userId, avatar),
    meta: { silent: true },
  });
  const form = useAppForm({
    defaultValues: noAvatar,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: AvatarInput },
    onSubmit: async ({ value, formApi }) => {
      if (!value.avatar) return;
      await upload.mutateAsync(value.avatar);
      formApi.reset();
      await onSaved();
    },
  });

  return (
    <form.AppForm>
      <form.Form failed="The avatar was not saved." className="max-w-md">
        <form.FormError />
        <form.AppField name="avatar">
          {(field) => <field.FileField label="Avatar" accept={avatarTypes.join(",")} />}
        </form.AppField>
        <form.SubmitButton pending="Uploading…">Save avatar</form.SubmitButton>
      </form.Form>
    </form.AppForm>
  );
}
```

```tsx,verify
// file: src/routes/users/$userId_/avatar.tsx
import { createFileRoute } from "@tanstack/react-router";
import { AvatarForm } from "@/features/users/avatar-form";

export const Route = createFileRoute("/users/$userId_/avatar")({
  component: UserAvatarPage,
});

function UserAvatarPage() {
  const { userId } = Route.useParams();
  const navigate = Route.useNavigate();

  return (
    <div className="flex flex-col gap-4">
      <title>Avatar</title>
      <h1 className="font-semibold text-2xl">Avatar</h1>
      <AvatarForm
        userId={userId}
        onSaved={() => navigate({ to: "/users/$userId", params: { userId } })}
      />
    </div>
  );
}
```

```tsx,verify,test
// file: src/routes/users/$userId_/avatar.test.tsx
import { screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { renderRoute } from "@/test/render-route";

const pick = (bytes: number, type: string) => new File([new Uint8Array(bytes)], "me.png", { type });

test("a file over the limit is a field error and nothing is sent", async () => {
  const { user } = renderRoute("/users/0193a1b2-0000-7000-8000-000000000002/avatar");
  const avatar = await screen.findByLabelText("Avatar");

  await user.upload(avatar, pick(3 * 1024 * 1024, "image/png"));
  await user.click(screen.getByRole("button", { name: "Save avatar" }));

  expect(avatar).toHaveAccessibleDescription("Choose an image of 2 MB or less.");
});

test("no file chosen is a field error", async () => {
  const { user } = renderRoute("/users/0193a1b2-0000-7000-8000-000000000002/avatar");
  const avatar = await screen.findByLabelText("Avatar");

  await user.click(screen.getByRole("button", { name: "Save avatar" }));

  expect(avatar).toHaveAccessibleDescription("Choose an image.");
});
```

## Array fields

`mode="array"` on the array's field re-renders it when items are added or removed. Each item is its
own `form.AppField` named with the index path, `tags[0]`. `ApiError.fieldErrors` uses the same names,
so a server error for the second tag arrives as `tags[1]` and lands under that input as it is.

```tsx,verify
// file: src/features/users/tag-list-form.tsx
import { revalidateLogic } from "@tanstack/react-form";
import { useMutation } from "@tanstack/react-query";
import * as z from "zod";
import { apiFetch } from "@/api/fetcher";
import { useAppForm } from "@/shared/hooks/use-app-form";
import { Button } from "@/shared/ui/button";

// Stand-ins until the spec has `PUT /users/{id}/tags`; then use the generated operation and schema.
const TagsBody = z.object({ tags: z.array(z.string().trim().min(1)) });
const saveTags = (userId: string, data: z.infer<typeof TagsBody>) =>
  apiFetch<unknown>(`/users/${encodeURIComponent(userId)}/tags`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });

const noTags: z.input<typeof TagsBody> = { tags: [] };

export function TagListForm({ userId, onSaved }: { userId: string; onSaved: () => Promise<void> }) {
  const save = useMutation({
    mutationFn: (data: z.infer<typeof TagsBody>) => saveTags(userId, data),
    meta: { silent: true },
  });
  const form = useAppForm({
    defaultValues: noTags,
    validationLogic: revalidateLogic(),
    validators: { onDynamic: TagsBody },
    onSubmit: async ({ value, formApi }) => {
      await save.mutateAsync(TagsBody.parse(value));
      formApi.reset();
      await onSaved();
    },
  });

  return (
    <form.AppForm>
      <form.Form failed="The tags were not saved." className="max-w-md">
        <form.FormError />
        <form.AppField name="tags" mode="array">
          {(tags) => (
            <fieldset className="flex flex-col gap-2">
              <legend>Tags</legend>
              {tags.state.value.map((_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the index is the field's identity
                <div key={index} className="flex items-end gap-2">
                  <form.AppField name={`tags[${index}]`}>
                    {(tag) => <tag.TextField label={`Tag ${index + 1}`} />}
                  </form.AppField>
                  <Button onClick={() => tags.removeValue(index)}>Remove</Button>
                </div>
              ))}
              <Button onClick={() => tags.pushValue("")}>Add tag</Button>
            </fieldset>
          )}
        </form.AppField>
        <form.SubmitButton pending="Saving…">Save tags</form.SubmitButton>
      </form.Form>
    </form.AppForm>
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

With `keycloak-spa-auth` installed, the routes in `users/$userId_/` sit under `src/routes/_signed-in/` with the `/_signed-in` prefix in their id, and their tests sit beside them.

FastAPI reports the second item as `loc: ["body", "tags", 1]`; `toApiError` names it `tags[1]` and
drops pydantic's `Value error, ` prefix:

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
          detail: [
            {
              loc: ["body", "tags", 1],
              msg: "Value error, Tags have no spaces.",
              type: "value_error",
            },
          ],
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
import { useAppForm } from "@/shared/hooks/use-app-form";

export function AddressFields() {
  const form = useAppForm({ defaultValues: { country: "", city: "" } });

  return (
    <form.AppForm>
      <form.AppField name="country" listeners={{ onChange: () => form.setFieldValue("city", "") }}>
        {(field) => <field.TextField label="Country" />}
      </form.AppField>
      <form.AppField name="city">{(field) => <field.TextField label="City" />}</form.AppField>
    </form.AppForm>
  );
}
```

A field-level validator returns `{ message }`, like a schema issue: the bound parts show an error's
`message`, so a bare string would mark nothing.

```tsx,verify
// file: src/features/users/password-fields.tsx
import { useAppForm } from "@/shared/hooks/use-app-form";

export function PasswordFields() {
  const form = useAppForm({ defaultValues: { password: "", repeat: "" } });

  return (
    <form.AppForm>
      <form.AppField name="password">
        {(field) => <field.TextField label="Password" type="password" />}
      </form.AppField>
      <form.AppField
        name="repeat"
        validators={{
          onChangeListenTo: ["password"],
          // `{ message }`, as a schema issue: the bound parts show an error's `message`.
          onChange: ({ value, fieldApi }) =>
            value === fieldApi.form.getFieldValue("password")
              ? undefined
              : { message: "Does not match." },
        }}
      >
        {(field) => <field.TextField label="Repeat password" type="password" />}
      </form.AppField>
    </form.AppForm>
  );
}
```
