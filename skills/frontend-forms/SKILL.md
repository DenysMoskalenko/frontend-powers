---
name: frontend-forms
description: "Use when building or fixing a create or edit form: TanStack Form useForm, form.Field, form.Subscribe, a zod schema from api.zod.ts as the validator, Base UI Field errors, submitting with mutateAsync, mapping a 422's fieldErrors with setErrorMap, a 409 as a form error, a dirty-form leave guard, array or file fields, or a one-field FormData form. Not for mutation options or invalidation (tanstack-query-api), field wrapper styling (tailwind-base-ui), form tests (frontend-testing), or autocomplete tokens (modern-web-guidance)."
metadata:
  version: "0.1.0"
---

# Forms with TanStack Form, zod and Base UI Field

Assumes @tanstack/react-form 1.33, zod 4.6, @base-ui/react 1.9, @tanstack/react-query 5.108, @tanstack/react-router 1.170.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another version of a package than the line above, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

Form UX (labels, error copy, unsaved-changes wording) belongs to `web-design-guidelines`; input types and autofill tokens belong to `modern-web-guidance`. If either skill is available, load it before designing a form's fields and copy. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules.

## Important

- Pass the request schema from `src/api/generated/api.zod.ts` straight to `validators: { onSubmit: CreateXBody }`, with `defaultValues` typed `z.input<typeof CreateXBody>`: it carries the backend's limits and needs no adapter. An untyped literal makes every key required, so an optional body key fails `onSubmit` with TS2322 (`Property 'note' is optional in type ... but required`).
- Submit with `await mutation.mutateAsync(...)` inside `onSubmit`, `meta: { silent: true }` on the mutation, and every failure turned into `formApi.setErrorMap({ onSubmit: { form, fields } })`, with `fields: {}` even when only `form` is set, or the message never renders; never render `error.message`.
- After a failed submit, focus the first `[aria-invalid='true']` field, both in `onSubmitInvalid` and after `setErrorMap`, so its error is read out.
- An edit form renders with `key={entity.id}`: `defaultValues` are copied only while no field is touched.
- A form schema with an extra field or a transform is not the request body: send `Schema.parse(value)`, because `onSubmit` receives the raw input.

## References

- `references/form-examples.md`: edit form with its route and tests, a form schema with an extra field, cross-field rule and transform, an optional body key, custom zod messages, a one-field `FormData` form, the validation-timing table and its test. Open for any form other than a plain create form, or to see what a user sees when.
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

- An optional text field defaults to `""` and is left out of the body when empty, or the API stores `""` for "no value": `const { note, ...rest } = value;` then `data: { ...rest, ...(note && { note }) }`.
- `focusFirstError` waits one `requestAnimationFrame`, until the mark renders, then focuses `[aria-invalid='true']` inside a `ref` on the `<form>`.
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

Put `.trim()` before `.min()`: zod 4 runs checks in order, so `z.string().min(1).trim()` accepts `"   "` and returns `""`. Schema messages are zod's defaults; the one seam for the product's copy is a `customError` in `src/app/zod-config.ts` (`references/form-examples.md`).

## Validation timing

The house default is `validators.onSubmit` only: nothing is checked before the first submit, and a marked field's error clears on its next change or blur (the full table is in `references/form-examples.md`). To re-check on every change after the first submit, use `validationLogic: revalidateLogic()` with `validators: { onDynamic: schema }` (`references/field-patterns.md`). Never the schema in `onChange`: the first keystroke marks every field invalid, untouched ones included.

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
- Without `silent`, a failed submit also toasts "The change was not saved". Mutation options, invalidation and `ApiError` are `tanstack-query-api`'s.
- Show `fieldErrors` as sent (FastAPI's `Value error, ` prefix is already stripped); in a translated app, what to translate is `frontend-i18n`'s.

## After success and the leave guard

```tsx
useBlocker({
  // Read at navigation time: a rendered snapshot would still be dirty right after reset().
  shouldBlockFn: () => !form.state.isDefaultValue && !window.confirm("Discard the new user?"),
  enableBeforeUnload: () => !form.state.isDefaultValue,
});
```

- Call `formApi.reset()` before navigating after success: the guard reads `isDefaultValue` at navigation time, and a dirty form blocks its own success navigation.
- `isDefaultValue`, not `isDirty`: `isDirty` stays `true` after the user types the original value back.
- `useBlocker` options and custom confirm dialogs are `tanstack-router-spa`'s.

## Edit forms

- The edit page is `src/routes/users/$userId_/edit.tsx`, not nested in the detail page; its loader checks the id and throws `notFound()` like every loader that takes one (`tanstack-router-spa`).
- The route component reads the entity with `useSuspenseQuery` and passes it to the form, which builds `defaultValues` from it.

## One-field forms

A rename, a tag, a confirm-by-typing box: no form library. On submit read `new FormData(event.currentTarget)`, validate with the schema's field (`CreateUserBody.shape.name.safeParse(...)`), keep the error in one `useState`, call `mutation.mutate` (`references/form-examples.md`). A failed save reaches the global toast only where `createQueryClient` has the `MutationCache` notice; without one, show a message when `mutation.isError`. A search box or filters are URL search params (`tanstack-router-spa`).

## Accessibility the wiring provides

`TextField` (`tailwind-base-ui`'s) turns `error` into `aria-invalid="true"` and the control's accessible description. Pass `string | undefined`: an empty string still marks the field invalid. Form route tests are `frontend-testing`'s.

## Prior-version idioms

| Older examples write | Correct now |
|---|---|
| `react-hook-form` with `zodResolver`, or `formik` with `validationSchema` | `useForm({ validators: { onSubmit: CreateXBody } })` from `@tanstack/react-form` |
| `@tanstack/zod-form-adapter`, `validatorAdapter: zodValidator()` | removed in TanStack Form 1: pass the zod schema directly (Standard Schema) |
| `form.useStore(selector)`, `form.Provider` | `useStore(form.store, selector)` or `form.Subscribe`; no provider |
| React 19 `<form action>` with `useActionState` for a server write | `onSubmit` + `mutateAsync`: TanStack Form owns values, submit state and errors, and an action adds a second owner that resets uncontrolled fields on success |
| `.optional()` on a body key in `api.zod.ts`, and `data: value` failing TS2375 | orval's `override.zod.exactOptional: true` emits `.exactOptional()` (`tanstack-query-api`) |
| `<input onChange={(e) => field.handleChange(e.target.value)}>` | `Field.Control onValueChange={field.handleChange}` through `TextField` |
| `Field.Error` without `match` for a library error | `match={error !== undefined}`; without it the error shows only for native validity |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| `const isDirty = useStore(form.store, (s) => s.isDirty)` then `shouldBlockFn: () => isDirty` | `shouldBlockFn: () => !form.state.isDefaultValue && ...`: a rendered snapshot is still dirty right after `reset()` |
| `field.state.meta.errors.join(", ")` | `firstError(field.state.meta.errors)`: schema issues are `{ message }` objects |
| Wrap the form in Base UI `<Form>` | a plain `<form noValidate>`; TanStack Form owns the state |
