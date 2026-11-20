# frontend-forms

### Triggering

**Should load**

1. "the create user form shows nothing when the API answers 422, how do I get the backend's messages under the inputs?"
2. "build an edit page for a user: inputs prefilled from the API, a Save button, back to the detail page after saving"
3. "after a successful save the app stays on the form, the leave-confirm keeps blocking the navigation to the detail page"
4. "`zodValidator` from @tanstack/zod-form-adapter can't be resolved, how do I use the orval zod schema as the TanStack Form validator?"
5. "useForm field errors render as [object Object] under the input"
6. "add a 'repeat email' input to the create user form that must match the email"
7. "I call formApi.setErrorMap({ onSubmit: { form: 'Email taken' } }) and nothing appears"
8. "the project form needs a list of tags with Add and Remove buttons"

**Should not load**

1. "after createUser succeeds the users list still shows old rows, invalidate it properly" -> `tanstack-query-api`
2. "give the TextField's invalid state a red border and add a description slot to the wrapper" -> `tailwind-base-ui`
3. "write a route test for /users/new that checks the exact POST body" -> `frontend-testing`
4. "which autocomplete tokens and input types should the sign-up fields use so password managers work?" -> `modern-web-guidance`
5. "review the labels and error copy of our sign-up form" -> `web-design-guidelines`
6. "add a search box to /users that filters by name through ?q= in the URL" -> `tanstack-router-spa`
7. "should the project form component live under src/routes or src/features?" -> `frontend-project-structure`

### Eval 1 - form schema that is not the request body

**Prompt**: "On the create user form, ask for the email twice and reject a name that is only spaces. The API must still receive just name and email."

**Fixture**: scaffold

**Must produce**:

- a form schema built from `CreateUserBody` (imported from `@/api/generated/api.zod`) with `.extend(...)`, not a new hand-written object
- a `.refine` whose options carry `path` naming the repeat-email field
- `.trim()` placed before `.min(1)` on the name
- the request body produced by parsing the form values (`Schema.parse(value)` or a `.transform`) so the repeat-email field is not sent
- `validators: { onSubmit: <form schema> }` kept as the only validator

**Must not produce**:

- `z.email()`, `z.string().email()` or a hand-written `z.object({ email: ..., name: ... })` repeating the generated rules
- `.min(1).trim()` on the name
- `confirmEmail` (or the repeat field) in the object passed to `mutateAsync`
- `validators: { onChange: ... }`
- `react-hook-form` or `zodResolver`

### Eval 2 - edit form

**Prompt**: "Add a page at /users/$userId/edit to change a user's name and email. The backend now accepts PATCH /users/{id} with the same body as create; the generated client does not have it yet. Save should go back to the user's page."

**Fixture**: scaffold

**Must produce**:

- the route file `src/routes/users/$userId_/edit.tsx` with `createFileRoute("/users/$userId_/edit")`, leaving `src/routes/users/$userId.tsx` as it is
- a route loader filling the cache that throws `notFound()` for an id the generated `GetUserParams` rejects and for a 404, with a `notFoundComponent`
- `useForm` whose `defaultValues` come from the user returned by `useSuspenseQuery(getGetUserSuspenseQueryOptions(...))`
- `validators: { onSubmit: CreateUserBody }` (or a regenerated update schema)
- the PATCH sent through `useMutation` with `meta: { silent: true }`, awaited with `mutateAsync` inside `onSubmit`, using `apiFetch` or a regenerated operation rather than raw `fetch`
- failures mapped with `formApi.setErrorMap({ onSubmit: ... })`, every form-level-only case carrying `fields: {}`
- `formApi.reset()` before the navigation back to the user's page
- focus moved to the first invalid field after a failed submit, both as `onSubmitInvalid` and after `setErrorMap`
- `useBlocker` whose callbacks read `form.state.isDefaultValue`
- the form rendered with `key={user.id}` or an equivalent remount per user

**Must not produce**:

- a `useEffect` that calls `form.reset` or `setFieldValue` when the query data arrives
- `error.message` rendered or passed to a toast
- `fetch(` called from the component or the feature file
- a `shouldBlockFn` reading a value captured at render (`isDirty` from `useStore` or a prop)
- a flat dot route file such as `$userId_.edit.tsx`, or `$userId.tsx` moved or turned into a layout
- `react-hook-form`

### Eval 3 - server errors that toast instead of showing on the form

**Prompt**: "The new invite user form's onSubmit is `try { const user = await inviteUser.mutateAsync({ data: value }); navigate({ to: '/users/$userId', params: { userId: user.id } }); } catch (error) { toast((error as Error).message); }`. A 422 shows a generic toast and the field messages never appear, and an email that is already invited shows a technical message. Fix it."

**Fixture**: scaffold

**Must produce**:

- `meta: { silent: true }` on the mutation options
- `formApi.setErrorMap({ onSubmit: { fields: error.fieldErrors } })` for an `ApiError` with field errors
- a 409 mapped to a form-level message written in the UI, with `fields: {}`
- a generic form-level message for any other failure, naming `error.requestId` when present
- a form-level message when `fieldErrors` names a field the form does not render, checked with `name in formApi.fieldInfo`
- focus moved to the first invalid field after the failed submit
- `formApi.reset()` before the navigation
- field errors read through a normaliser that accepts both strings and `{ message }` objects

**Must not produce**:

- `error.message` in the UI
- parsing the response body or `error.body` in the component
- a new error class or a branch on generated error types
- `setErrorMap({ onSubmit: { form: ... } })` without `fields`
- `reportError` called for a failure the form shows

### Probe 1 - zod adapter

**Prompt**: "Our edit user form (TanStack Form 1 useForm, defaultValues from the user) has no validation. orval generated CreateUserBody in src/api/generated/api.zod.ts and the PATCH body has the same shape. Add zod validation."

**Fixture**: empty

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:from\s+["\x27]@tanstack\/zod-form-adapter["\x27])|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:validatorAdapter\s*:)`

**Right answer**: `onSubmit:\s*(?:CreateUserBody|UpdateUserBody)\b`

### Probe 2 - form-level error without fields

**Prompt**: "On the edit user form (PATCH /users/{id}, TanStack Form 1, errors set with formApi.setErrorMap), a 409 means the email belongs to someone else: show 'This email belongs to another user.' at the top of the form."

**Fixture**: empty

**Wrong answer**: `\.setErrorMap\(\s*\{\s*onSubmit:\s*\{\s*form:\s*(?:"[^"]*"|\x27[^\x27]*\x27|\x60[^\x60]*\x60|[\w.]+(?:\([^)]*\))?)\s*,?\s*\}`

**Right answer**: `fields:\s*\{\s*\}`

### Probe 3 - navigation before reset

**Prompt**: "After the edit user form saves, go to the user's detail page. The form has a leave guard."

**Fixture**: scaffold

**Wrong answer**: `mutateAsync\((?:(?!\.reset\()[^\x60])*?\b(?:navigate|on[A-Z]\w*)\(`

**Right answer**: `\.reset\(`

### Probe 4 - rendering the backend message

**Prompt**: "Show the error from the API at the top of the edit user form (TanStack Form 1, mutation through TanStack Query 5) when saving fails."

**Fixture**: empty

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\{\s*[\w.]*(?:[eE]rror|\berr)\??\.message\s*\})|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:form:\s*(?:\(\s*\w+\s+as\s+\w+\s*\)|[\w.]*(?:[eE]rror|\berr))\??\.message)`

### Probe 5 - leave guard on a snapshot

**Prompt**: "Ask for confirmation when the user leaves the edit user form with unsaved changes."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:shouldBlockFn:\s*\(\)\s*=>[^}\n/]*\bisDirty\b)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:useStore\(\s*form\.store\s*,[^;]*\bisDirty\b)`

**Right answer**: `isDefaultValue`

### Probe 6 - trim after min

**Prompt**: "In the invite form schema, a name made only of spaces must be rejected."

**Fixture**: scaffold

**Wrong answer**: `\w+\s*:\s*z\.string\(\)\.min\(1[^)]*\)(?:\.max\([^)]*\))?\.trim\(\)`

**Right answer**: `\.trim\(\)\.min\(1\)|\.refine\(\s*\(?\w+\)?\s*=>\s*\w+\.trim\(\)\s*(?:!==\s*""|\.length)`

### Probe 7 - errors joined as strings

**Prompt**: "In our TanStack Form 1 project form validated with a zod schema, show every validation error of the title field under its input."

**Fixture**: empty

**Wrong answer**: `(?:\{|=>|=|\()\s*[\w.]*\berrors\.join\(|>\s*\{\s*field\.state\.meta\.errors(?:\[0\])?\s*\}`

### Probe 8 - React 19 action for a server write

**Prompt**: "Rewrite the create user form with React 19 form actions."

**Fixture**: scaffold

**Wrong answer**: `=\s*useActionState\(|<form[^>]*\saction=\{\s*[A-Za-z_]`

### Probe 9 - schema on change

**Prompt**: "Once the user has submitted the create user form with errors, re-check the fields while they type."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:onChange:\s*\w*(?:Body|[sS]chema)\b)`

**Right answer**: `revalidateLogic\(`

### Probe 10 - uniqueness checked per keystroke

**Prompt**: "On the create user form, make sure the user learns that an email is already taken."

**Fixture**: scaffold

**Wrong answer**: `on(?:Change|Blur)Async\s*:`

**Right answer**: `409`

### Probe 11 - optional body field

**Prompt**: "orval generated `CreateOrderBody` in src/api/generated/api.zod.ts with an optional `note` (`zod.string().max(500).optional()`) and the type `CreateOrder` with `note?: string`; tsconfig has exactOptionalPropertyTypes. Write the create order form's default values and its onSubmit with TanStack Form 1 and `createOrder.mutateAsync({ data })`."

**Fixture**: empty

**Wrong answer**: `(?:const|let)\s+\w+\s*:\s*CreateOrder\s*=\s*\{|\bdata:\s*value\s*[,}]|mutateAsync\(\s*\{\s*data:\s*value\s*\}`

**Right answer**: `z\.input<\s*typeof\s+CreateOrderBody\s*>`
