---
name: frontend-forms
description: "Use when building or fixing a create or edit form: TanStack Form useAppForm, createFormHook bound fields, revalidateLogic, a zod schema from api.zod.ts as validator, mutateAsync in onSubmit, a 422's or 409's fieldErrors, a form in steps, a dirty-form leave guard, number, select, date, file or array fields, a one-field FormData form. Not for mutation options or invalidation (tanstack-query-api), field wrapper styling (tailwind-base-ui), form tests (frontend-testing), or autocomplete tokens (modern-web-guidance)."
metadata:
  version: "0.1.1"
---

# Forms with TanStack Form, zod and Base UI Field

Assumes @tanstack/react-form 1.33, zod 4.6, @base-ui/react 1.9, @tanstack/react-query 5.108, @tanstack/react-router 1.170.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another major of a package than the line above, or an older minor, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

Form UX (labels, error copy, unsaved-changes wording) belongs to `web-design-guidelines`; input types and autofill tokens belong to `modern-web-guidance`. If either skill is available, load it before designing a form's fields and copy. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules.

## Important

- Build every form with `useAppForm` from `@/shared/hooks/use-app-form`: `validationLogic: revalidateLogic()`, `validators: { onDynamic: CreateXBody }` from `src/api/generated/api.zod.ts`, `defaultValues` typed `z.input<typeof CreateXBody>` (untyped, an optional key fails with TS2322). Never copy `submitErrors`, `firstError` or `focusFirstError` into a form: `form.Form` maps every failure and focuses the first invalid field.
- `onSubmit` awaits `mutation.mutateAsync(...)` and does not catch: the rejection is the failed submit that `form.Form` shows. The mutation has `meta: { silent: true }`; call `formApi.reset()` before navigating.
- A bound part reads its value with `useFieldContext<Value>()`, an assertion: `field.TextField` on a number field compiles. Keep one bound part per value type, named for it, and add a missing kind to the hook (`references/field-patterns.md`).
- An edit form renders with `key={entity.id}`: `defaultValues` are copied only while no field is touched.
- A form schema with an extra field or a transform is not the request body: send `Schema.parse(value)`, because `onSubmit` receives the raw input.

## References

- `references/form-examples.md`: edit form with route and tests, a form schema with an extra field, cross-field rule or transform, an optional body key, custom zod messages, a one-field `FormData` form, a form in steps, the validation-timing table and tests. Open for any form other than a plain create form.
- `references/field-patterns.md`: the hook with number, select, checkbox and file parts, the type cost of `createFormHook`, a form with every field kind, file, array and dependent fields. Open when a form has more than text inputs.

## The standard form

The scaffold's `src/features/users/create-user-form.tsx`:

```tsx
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

return (
  <form.AppForm>
    <form.Form failed="The user was not created.">
      <form.FormError />
      <form.AppField name="email">
        {(field) => <field.TextField label="Email" type="email" />}
      </form.AppField>
      <form.SubmitButton pending="Creating…">Create user</form.SubmitButton>
    </form.Form>
  </form.AppForm>
);
```

- `form.Form` (`<form noValidate>`) clears the last attempt's server errors, submits, maps a failure with `submitErrors` from `src/shared/lib/submit-errors.ts`, reports what is not `ApiError`, `TypeError` or `DOMException`, and focuses the first invalid field. `failed` is the form's own sentence for a failed submit.
- A field rendered without a bound part calls `field.setErrorMap({ onServer: undefined })` on change, or a stale server error stays. A field-level validator returns `{ message }`, which the bound parts show.
- An optional text field defaults to `""` and is left out of the body when empty, or the API stores `""`: `data: { ...rest, ...(note && { note }) }` (`references/form-examples.md`).

## The schema

Write a form schema only when the form is not the request body:

| The form has | Do |
|---|---|
| a field the API does not take (repeat email) | `CreateXBody.extend({ confirmEmail: z.string() })` |
| a rule across fields | `.refine(check, { path: ["confirmEmail"], message })`; without `path` the message reaches no field |
| a value to normalise (trim) | override that field with `z.string().trim().min(1).max(createXBodyNameMax)`, reusing orval's exported limit constants |
| any of those | end with `.transform((form) => ({ ...only the body fields }))` and send `Schema.parse(value)` |

Put `.trim()` before `.min()`: zod 4 runs checks in order, so `z.string().min(1).trim()` accepts `"   "`. Product copy for schema messages goes through one `customError` in `src/app/zod-config.ts` (`references/form-examples.md`).

## Validation timing

Errors appear on the first submit and then follow every change: an error stays until its value is valid. A server field error stays while other fields change and goes when its own field changes; a new submit clears every server error and asks the server again (table and tests: `references/form-examples.md`).

- `revalidateLogic({ mode: "blur" })` when a format the user cannot judge alone (a code, an IBAN) should be flagged on leaving the field; `modeAfterSubmission: "blur"` when the schema is too heavy for every keystroke.
- A field's `validators.onChangeAsync` with `onChangeAsyncDebounceMs` only when the product asks for a live server check; the submit's 409 stays the check that counts.
- Never the schema in `onChange`: the first keystroke marks every field invalid, untouched ones included.
- Never build UI on `isSubmitSuccessful` or `isSubmitted`: an `onSubmit` that catches its own failure counts as successful there. Act on success inside `onSubmit`, after `mutateAsync` resolves.

## Server errors

`ApiError.fieldErrors` maps a field path (`address.city`, `items[0].name`) to `{ message, code? }[]`. `form.Form` puts each on its field when that field is mounted now or, in a form in steps (`onFieldErrors`), was mounted before; the rest, a field the user switched off included, become one form message, "The server gave a reason this form cannot show.", with the request id.

- A field shows `message`. This is the one place the backend's own sentence reaches the user, as the fallback when the app has no text for the `code`; in an app with more than one language, translating by `code` is `frontend-i18n`'s.
- A conflict (409) whose details name a field the form renders lands on that field; otherwise, and for a backend that sends a fixed 409 body, it is the form message "It conflicts with data saved earlier." Never hard-code a 409 to one field.
- A submit while the browser is offline fails at once with "Try again." and is never sent later: mutations run with `networkMode: "always"` (`tanstack-query-api`).
- A form in steps or with collapsed sections passes `onFieldErrors` to `form.Form` and opens the step that holds the first field with an error, derived from the field name (`references/form-examples.md`).

## After success and the leave guard

```tsx
useBlocker({
  // Read at navigation time: a rendered snapshot would still be dirty right after reset().
  shouldBlockFn: () => !form.state.isDefaultValue && !window.confirm("Discard the new user?"),
  enableBeforeUnload: () => !form.state.isDefaultValue,
});
```

- `isDefaultValue`, not `isDirty`: `isDirty` stays `true` after the user types the original value back.
- `useBlocker` options and custom confirm dialogs are `tanstack-router-spa`'s.

## Edit forms

The edit page is `src/routes/users/$userId_/edit.tsx`, not nested in the detail page, with the detail loader (`tanstack-router-spa`). Its component reads the entity with `useSuspenseQuery` and passes it to the form, which builds `defaultValues` from it.

## Dates and files

- A date input is `field.TextField type="date"`; its `YYYY-MM-DD` value is sent as it is, never through `new Date()`. Showing a date is `formatDate`, which `frontend-code-style`'s reference adds to `src/shared/lib/format-date.ts` (the scaffold does not ship it).
- `field.FileField`'s type and size are checked in the schema, so a wrong file is a field error before anything is sent. Sending, progress and cancelling are `tanstack-query-api`'s (`references/files.md`).

## One-field forms

A rename, a tag, a confirm-by-typing box: no form library. On submit read `new FormData(event.currentTarget)`, validate with the schema's field (`CreateUserBody.shape.name.safeParse(...)`), keep the error in one `useState`, call `mutation.mutate` (`references/form-examples.md`). A search box or filters are URL search params (`tanstack-router-spa`).

## Prior-version idioms

| Older examples write | Correct now |
|---|---|
| `react-hook-form` with `zodResolver`, or `formik` with `validationSchema` | `useAppForm` with `validators: { onDynamic: CreateXBody }` |
| `useForm` with `form.Field` wired to `TextField` by hand, and copies of `submitErrors`, `firstError`, `focusFirstError` | `useAppForm` with `field.TextField`, `form.Form`, `form.FormError`, `form.SubmitButton` |
| `validators: { onSubmit: CreateXBody }` alone | `revalidateLogic()` with `onDynamic`: an error stays until its value is valid |
| `FieldErrors` as `Record<string, string>` | `Record<string, FieldError[]>`, each `{ message, code? }` |
| `@tanstack/zod-form-adapter`, `validatorAdapter: zodValidator()` | removed in TanStack Form 1: pass the zod schema directly (Standard Schema) |
| `form.useStore(selector)`, `form.Provider` | `useStore(form.store, selector)` or `form.Subscribe`; `form.AppForm` is the only provider |
| React 19 `<form action>` with `useActionState` for a server write | `onSubmit` + `mutateAsync`: an action adds a second owner of values and errors |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| `const isDirty = useStore(form.store, (s) => s.isDirty)` then `shouldBlockFn: () => isDirty` | `shouldBlockFn: () => !form.state.isDefaultValue && ...`: a rendered snapshot is still dirty right after `reset()` |
| `value={String(value)}` on a number input | `field.NumberField`: rendering the number back on every keystroke turns `0.05` into 5 |
| `field.state.meta.errors.join(", ")` | a bound part: schema issues are `{ message }` objects |
| `{error.message}` or `form: error.message` after a failed save | `form.Form` with its `failed` sentence: `ApiError.message` is for developers |
| Wrap the form in Base UI `<Form>` | `form.Form`; TanStack Form owns the state |
