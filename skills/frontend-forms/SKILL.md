---
name: frontend-forms
description: "Use when building or fixing a create or edit form: TanStack Form useForm, form.Field, form.Subscribe, a zod schema from api.zod.ts as the validator, Base UI Field errors, submitting with mutateAsync, mapping a 422's fieldErrors with setErrorMap, a 409 as a form error, a dirty-form leave guard, array or file fields, or a one-field FormData form. Not for mutation options or invalidation (tanstack-query-api), field wrapper styling (tailwind-base-ui), form tests (frontend-testing), or autocomplete tokens (modern-web-guidance)."
metadata:
  version: "0.1.0"
---

# Forms with TanStack Form, zod and Base UI Field

Assumes @tanstack/react-form 1.33, zod 4.6, @base-ui/react 1.9, @tanstack/react-query 5.107, @tanstack/react-router 1.170.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, use its own modules, helpers and scripts, and say so when it has no equivalent instead of adding one unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If `pnpm-lock.yaml` pins another major version than the line above, follow the project and say which rules may not apply.

Form UX (labels, error copy, unsaved-changes wording) belongs to `web-design-guidelines`; input types and autofill tokens belong to `modern-web-guidance`. If either skill is available, load it before designing a form's fields and copy. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules.

## Important

- Pass the request schema from `src/api/generated/api.zod.ts` straight to `validators: { onSubmit: CreateXBody }`, with `defaultValues` typed `z.input<typeof CreateXBody>`: it carries the backend's limits and needs no adapter. Untyped or typed as orval's `CreateX`, an optional body key fails with TS2322 on `onSubmit` (`'input.note' ... 'string | undefined' is not assignable to type 'string'`) under `exactOptionalPropertyTypes`.
- Submit with `await mutation.mutateAsync(...)` inside `onSubmit`, `meta: { silent: true }` on the mutation, and every failure turned into `formApi.setErrorMap({ onSubmit: { form, fields } })`; never render `error.message`.
- A form-level-only error still needs `fields: {}`, or the message is stored as an object and never renders.
- Call `formApi.reset()` before navigating after success, and read `form.state.isDefaultValue` inside `useBlocker`'s callbacks: otherwise the form blocks its own success navigation.

## References

- `references/form-examples.md`: edit form with its route and tests, a form schema with an extra field, cross-field rule and transform, a one-field `FormData` form, a validation-timing test. Open for any form other than a plain create form.
- `references/field-patterns.md`: an array-field form with its route test, dependent and file fields, re-validating after the first submit, async validation. Open when a form has more than text inputs.

## The standard form

Every form with more than one field follows the scaffold's `src/features/users/create-user-form.tsx`:

```tsx
const emptyUser: z.input<typeof CreateUserBody> = { email: "", name: "" };

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
```

- The scaffold's `emptyUser` is untyped because every user field is required. An optional text field defaults to `""` and is left out of the body when empty: `const { note, ...rest } = value;` then `data: { ...rest, ...(note && { note }) }`; `data: value` is TS2375.
- Every form focuses its first invalid field after a failed submit, so the error is read out: `focusFirstError` runs as `onSubmitInvalid` and after `setErrorMap`, and in `requestAnimationFrame`, once the mark renders, focuses `[aria-invalid='true']` inside a `ref` on the `<form>`.
- `<form noValidate>`: the schema validates, not native bubbles. Its `onSubmit` calls `event.preventDefault()` and `void form.handleSubmit()`: it returns a promise.
- The form-level message: `<form.Subscribe selector={(state) => state.errorMap.onSubmit}>` renders a string as `<p role="alert">`. `form.state` is a getter for callbacks, not a subscription.
- Base UI's `Button` defaults to `type="button"`: the submit button needs `type="submit"`.
- `TextField onValueChange={field.handleChange}`: `Field.Control` passes the string first.
- The form lives in `src/features/<domain>/`; the route passes `onCreated` with the navigation (`frontend-project-structure`).

## The schema

Write a form schema only when the form is not the request body:

| The form has | Do |
|---|---|
| a field the API does not take (repeat email) | `CreateXBody.extend({ confirmEmail: z.string() })` |
| a rule across fields | `.refine(check, { path: ["confirmEmail"], message })`; without `path` the message reaches no field |
| a value to normalise (trim) | override that field with `z.string().trim().min(1).max(createXBodyNameMax)`, reusing orval's exported limit constants |
| any of those | end with `.transform((form) => ({ ...only the body fields }))` and send `Schema.parse(value)` |

Schema messages are zod's defaults; the copy is the product's. Its one seam is a `customError` in `src/app/zod-config.ts`, `z.config({ jitless: true, customError })`: it wins over a zod locale, gets the issue (`code: "too_small"`, `minimum`; `code: "invalid_format"`, `format: "email"`) and returns a message, or `undefined` for the default.

`onSubmit` receives the raw input, never the schema's output. Put `.trim()` before `.min()`: zod 4 runs checks in order, so `z.string().min(1).trim()` accepts `"   "` and returns `""`.

## Validation timing

House default: `validators.onSubmit` only. Measured at 1.33:

| Moment | What the user sees |
|---|---|
| typing before the first submit | nothing |
| submit | every invalid field marked; nothing is sent |
| next change or blur of a marked field | that field's error clears, valid or not |
| next submit while a field still shows an error | stops before the schema runs: fields cleared by editing stay unmarked, nothing is sent |
| next submit with no error shown | schema runs again, every invalid field marked |
| any field change after a form-level error | the form-level message clears |

To re-check on every change after the first submit, use `validationLogic: revalidateLogic()` with `validators: { onDynamic: schema }` (`references/field-patterns.md`). Never the schema in `onChange`: the first keystroke marks every field invalid, untouched ones included.

## Errors

```tsx
const firstError = (errors: readonly (string | { message: string } | undefined)[]) =>
  errors.map((error) => (typeof error === "string" ? error : error?.message)).find(Boolean);
```

Map the submit failure from `ApiError`, never the generated error types. The scaffold's mapping:

```ts
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
```

- Every form keeps the unknown-field check, `name in formApi.fieldInfo`: `setErrorMap` writes only to rendered fields and drops the rest. `fieldErrors` keys arrive as field names (`address.city`, `items[0].name`).
- The fallback names `requestId` when present. The form shows the failure, so it does not call `reportError` (`frontend-code-style`).
- `meta: { silent: true }` keeps the `MutationCache` toast quiet; without it a failed submit also toasts "The change was not saved". Mutation options, invalidation and `ApiError` are `tanstack-query-api`'s.
- In a translated app, `fieldErrors` are the backend's sentences in its language, with no per-field code: show them as sent. Translate what the client owns: schema messages through the zod locale, the form-level message chosen by `status` (or `code` where the backend sends one), as `frontend-i18n` shows. Translated field messages need a backend contract change (a stable code per field, or messages localised from `Accept-Language`): raise it with the user, never patch it in the form.

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

- The edit page is `src/routes/users/$userId_/edit.tsx`, not nested in the detail page; its loader checks the id and throws `notFound()` like every loader that takes one (`tanstack-router-spa`).
- The route component reads the entity with `useSuspenseQuery` and passes it to the form, which builds `defaultValues` from it.
- Render the form with `key={entity.id}`: new `defaultValues` are copied only while no field is touched, so a reused form would keep the previous entity's edits.

## One-field forms

A rename, a tag, a confirm-by-typing box: no form library. On submit read `new FormData(event.currentTarget)`, validate with the schema's field (`CreateUserBody.shape.name.safeParse(...)`), keep the error in one `useState`, call `mutation.mutate`, and let the global toast report a failed save (`references/form-examples.md`). A search box or filters are URL search params (`tanstack-router-spa`).

## Accessibility the wiring provides

`TextField` (`tailwind-base-ui`'s) turns `error` into `aria-invalid="true"` and the control's accessible description. Pass `string | undefined`: an empty string still marks the field invalid. Form route tests are `frontend-testing`'s.

## Prior-version idioms

| Older examples write | Correct now |
|---|---|
| `react-hook-form` with `zodResolver`, or `formik` with `validationSchema` | `useForm({ validators: { onSubmit: CreateXBody } })` from `@tanstack/react-form` |
| `@tanstack/zod-form-adapter`, `validatorAdapter: zodValidator()` | removed in TanStack Form 1: pass the zod schema directly (Standard Schema) |
| `form.useStore(selector)`, `form.Provider` | `useStore(form.store, selector)` or `form.Subscribe`; no provider |
| React 19 `<form action>` with `useActionState` for a server write | `onSubmit` + `mutateAsync`: an action bypasses the mutation cache, its `silent` meta and invalidation |
| `<input onChange={(e) => field.handleChange(e.target.value)}>` | `Field.Control onValueChange={field.handleChange}` through `TextField` |
| `Field.Error` without `match` for a library error | `match={error !== undefined}`; without it the error shows only for native validity |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| Hand-write `z.object({ email: z.string().email(), name: z.string().min(1) })` for a create form | import `CreateXBody` from `api.zod.ts`; extend it only for UI-only fields |
| `catch (error) { toast(error.message) }` in `onSubmit` | `setErrorMap({ onSubmit: { form, fields } })` with your own copy, `meta: { silent: true }` |
| `const isDirty = useStore(form.store, (s) => s.isDirty)` then `shouldBlockFn: () => isDirty` | `shouldBlockFn: () => !form.state.isDefaultValue && ...` |
| `field.state.meta.errors.join(", ")` | `firstError(field.state.meta.errors)`: schema issues are `{ message }` objects |
| `z.string().min(1).trim()` | `z.string().trim().min(1)` |
| Add `onChangeAsync` to check an email is free | let the submit's 409 answer; map it to a form or field error |
| `<input type="file" value={field.state.value}>` | uncontrolled, `onChange` sets `File \| null` |
| Wrap the form in Base UI `<Form>` | a plain `<form noValidate>`; TanStack Form owns the state |
