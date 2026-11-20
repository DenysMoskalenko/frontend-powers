# frontend-code-style

### Triggering

**Should load**

1. "tsc fails with TS2379 '... with exactOptionalPropertyTypes: true' when I pass `error={props.error}` into TextField. How do I fix it without turning the flag off?"
2. "Our `enum Role { Admin, Member }` stopped compiling: TS1294 This syntax is not allowed when 'erasableSyntaxOnly' is enabled. What do I write instead?"
3. "Biome reports lint/nursery/useReactCompiler 'This render reads or writes a ref' in my component. What should change?"
4. "Replace the forwardRef in our SearchInput wrapper, React 19 marks it deprecated."
5. "Biome says noConsole on my console.error in the clipboard copy handler. Where should that error go instead?"
6. "I added `class QuotaExceededError extends Error { name = 'QuotaExceededError' }` and tsc says TS4114. Fix it."
7. "The order total comes from the API as the string "1234.50" plus a currency code. Show it formatted next to the created_at date."
8. "Review this .tsx file before I push: it has a default export, a React.FC with defaultProps, and useMemo around a filter."

**Should not load**

1. "Turn on noPropertyAccessFromIndexSignature in tsconfig.json and add the matching Biome rule." -> `frontend-tooling`
2. "Where does a new `orders` feature folder go, and may it import from `features/users`?" -> `frontend-project-structure`
3. "Add a Cache-Control header so index.html is never cached in the Caddyfile." -> `frontend-deploy`
4. "Pick a font pairing and a colour direction for the dashboard." -> `frontend-design`
5. "Explain when React re-renders a child whose props did not change." -> `vercel-react-best-practices`
6. "Compare compound components and render props for a design-system library, before any code." -> `vercel-composition-patterns`
7. "Which Biome rules does our biome.json turn off for the e2e folder?" -> `frontend-tooling`
8. "Does Safari support light dismiss on the popover attribute, and what is the fallback?" -> `modern-web-guidance`

### Eval 1 - TypeScript 7 errors in an existing component

**Prompt**: "`pnpm check` fails on this file. Make it pass.

```tsx
import { forwardRef } from 'react';
import { TextField } from '@/shared/ui/text-field';
import { UserResponse } from '@/api/generated/api';

enum Size { Small, Large }

interface Props { users: UserResponse[]; hint?: string; size?: Size }

function describe(field: { label: string; hint?: string }) {
  return field.hint ? `${field.label} (${field.hint})` : field.label;
}

export default forwardRef<HTMLInputElement, Props>((props, ref) => {
  const first = props.users[0];
  return <TextField ref={ref} label={describe({ label: first.name, hint: props.hint })} />;
});
```

tsc reports TS1294, TS1484, TS18048 and TS2379."

**Fixture**: scaffold

**Must produce**:

- `Size` rewritten as a string-literal union or an `as const` object with a same-named type.
- `import type { UserResponse }` (or an inline `type` modifier).
- `ref` taken from the props instead of `forwardRef`.
- A named export instead of `export default`.
- `describe`'s parameter typed `hint?: string | undefined` (or the call built with `...(props.hint !== undefined && { hint: props.hint })`) to satisfy `exactOptionalPropertyTypes`.
- `props.users[0]` narrowed with a check before `.name` is read.

**Must not produce**:

- A non-null assertion such as `props.users[0]!` or `first!.name`.
- `// @ts-expect-error`, `// @ts-ignore` or an `as` cast to silence an error.
- A change to `tsconfig.json` that turns a strictness flag off.
- `const enum` or `namespace` as the replacement.

### Eval 2 - errors in a bulk import

**Prompt**: "Write `importUsers(rows: CreateUser[])` in the users feature: it calls the generated `createUser` for each row, skips rows whose email is already taken (the API answers 409), and stops on anything else with an error that says which row failed. Add an Import button that runs it and tells the user how many users were created."

**Fixture**: scaffold

**Must produce**:

- A `catch` that narrows with `error instanceof ApiError && error.status === 409` and rethrows anything else.
- A rethrow that carries the original error as `{ cause: error }`.
- The button's unexpected failures sent to `reportError`, to a mutation's error handling, or to the route's error boundary, through one path only.
- User-facing text written as fixed copy, not built from `error.message`.
- Failure copy the import shows for an `ApiError` names its `requestId` when present.

**Must not produce**:

- `console.log`, `console.error` or `console.warn`.
- An empty `catch {}` or `.catch(() => {})` that drops the failure.
- `reportError(error)` followed by `throw error` for the same error.
- `throw` of a string or a plain object.
- `catch (error: any)` or `as ApiError` without an `instanceof` check.
- An Error subclass that declares `name` without `override` or assigns fields through constructor parameter properties.
- `reportError` called for a failure the screen already shows as a toast or message.

### Eval 3 - a context value and a large list

**Prompt**: "Add a density setting, comfortable or compact, provided once for the whole app, with a hook to read it, and make UserTable use it for row padding. The table can show 500 rows, so make sure it stays fast."

**Fixture**: scaffold

**Must produce**:

- Density typed as a string-literal union.
- The provider rendered as `<DensityContext value={...}>`.
- The value read with `use(DensityContext)` inside a `useDensity` hook that throws when the provider is missing.
- No hand memoization, with the React Compiler named as the reason.
- Named exports only.

**Must not produce**:

- `DensityContext.Provider` or `useContext(`.
- `useMemo`, `useCallback` or `React.memo` added to the table or the provider.
- `enum Density`.
- `React.FC` or `export default`.

### Eval 4 - money and dates from the API

**Prompt**: "Orders come from the API as `{ total: "1234.50", currency: "EUR", created_at: "2026-11-19T10:00:00Z" }`. Write the helper that formats the total and the date for the order row."

**Fixture**: scaffold

**Must produce**:

- `Intl.NumberFormat` and `Intl.DateTimeFormat` instances created at module level, not per call or per render.
- The decimal string passed to `format` as a string, narrowed to a numeric-string type first.
- `created_at` kept as an ISO string and turned into a `Date` only to format it.

**Must not produce**:

- `parseFloat(total)`, `Number(total)` or `+total` before formatting.
- `Temporal`, `moment` or `dayjs`.
- `new Intl.NumberFormat(` inside the formatting function's body without a cache.

### Probe 1 - enum for a fixed set

**Prompt**: "Add an OrderStatus type with the values draft, paid and shipped, and a label for each one, in the orders feature."

**Fixture**: scaffold

**Wrong answer**: `(?:^|\n)\s*(?:export\s+)?(?:declare\s+)?(?:const\s+)?enum\s+\w+\s*\{`

**Right answer**: `satisfies\s+Record<|:\s*Record<\s*OrderStatus`

### Probe 2 - forwardRef

**Prompt**: "Write a SearchInput component in src/shared/ui that wraps a native input and lets the parent focus it through a ref."

**Fixture**: scaffold

**Wrong answer**: `(?:=|\breturn|export\s+default)\s*(?:React\.)?forwardRef\s*[<(]`

### Probe 3 - hand memoization

**Prompt**: "UserTable gets a filter string prop. Filter the users by name before rendering, and make sure the filtering does not rerun on every render."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\buse(?:Memo|Callback)\s*\()|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\bmemo\s*\()`

### Probe 4 - console in app code

**Prompt**: "Add a Copy id button to UserDetails that copies the user id to the clipboard and logs the error if copying fails."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\bconsole\.(?:log|error|warn|info)\s*\()`

**Right answer**: `reportError`

### Probe 5 - default export for a lazy component

**Prompt**: "Create a heavy UserChart component in the users feature and load it lazily on the user page."

**Fixture**: scaffold

**Wrong answer**: `(?:^|\n)\s*export\s+default\s`

### Probe 6 - non-null assertion after an index

**Prompt**: "tsc says TS18048: 'users[0]' is possibly 'undefined' in `const name = users[0].name;`. Fix it."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\w\]!)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\w!\.\w)`

### Probe 7 - Context.Provider and useContext

**Prompt**: "Add a UnitsContext (metric or imperial) with a provider component and a hook that returns the current units."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:<\w+\.Provider[\s>])|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:=|return)\s*useContext\s*\()`

### Probe 8 - swallowed error without a reason

**Prompt**: "The analytics ping in the users page sometimes fails. Make sure a failure never breaks the page."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?<!\/\/[^\n]*\n(?:[^\n]*\n)?[^\n]*)(?:\.catch\(\s*\(\s*\w*\s*\)\s*=>\s*(?:\{\s*\}|undefined|null)\s*\))(?![^\n]*\/\/)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?<!\/\/[^\n]*\n(?:[^\n]*\n)?[^\n]*)(?:catch\s*(?:\(\s*\w+\s*\))?\s*\{\s*\})(?![^\n]*\/\/)`

### Probe 9 - parameter property

**Prompt**: "Write a RetryPolicy class whose constructor takes maxAttempts and baseDelayMs as private readonly fields."

**Fixture**: scaffold

**Wrong answer**: `constructor\s*\([^)]*\b(?:private|public|protected|readonly)\s+\w+\s*:[^)]*\)\s*\{`

### Probe 10 - flag off instead of the type fixed

**Prompt**: "tsc: TS2375 Type '{ hint: string | undefined; }' is not assignable to type 'Props' with 'exactOptionalPropertyTypes: true'. Make the error go away."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\/\/\s*@ts-(?:ignore|expect-error))|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:"exactOptionalPropertyTypes"\s*:\s*false)`

### Probe 11 - non-null assertion silenced

**Prompt**: "Biome reports noNonNullAssertion on `document.getElementById("root")!` in src/main.tsx. Make the warning go away."

**Fixture**: empty

**Wrong answer**: `[(=]\s*(?:document\.)?getElementById\([^)]*\)!|(?:^|\n)\s*\/\/\s*biome-ignore\s+lint\/style\/noNonNullAssertion|getElementById\([^)]*\)\s+as\s+HTML`

**Right answer**: `if\s*\(\s*!\s*\w+\s*\)`

### Probe 12 - compiler finding suppressed

**Prompt**: "Biome reports lint/nursery/useReactCompiler 'This render reads or writes a ref' in this component. Make the lint pass.

```tsx
import { useEffect, useRef, useState } from "react";

export function SearchBox({ onSearch }: { onSearch: (q: string) => void }) {
  const [q, setQ] = useState("");
  const onSearchRef = useRef(onSearch);
  onSearchRef.current = onSearch;

  useEffect(() => {
    const id = setTimeout(() => onSearchRef.current(q), 300);
    return () => clearTimeout(id);
  }, [q]);

  return <input value={q} onChange={(event) => setQ(event.target.value)} />;
}
```"

**Fixture**: scaffold

**Wrong answer**: `(?:^|\n)\s*["']use no memo["'];?|(?:^|\n)\s*\/\/\s*biome-ignore\s+lint\/nursery\/useReactCompiler`

### Probe 13 - conditional spread that drops false and 0

**Prompt**: "Write `toListParams(active: boolean | undefined, offset: number | undefined)` returning `{ active?: boolean; offset?: number }` for the API call, leaving out the filters that are not set."

**Fixture**: empty

**Wrong answer**: `[{,]\s*\.\.\.\(\s*(?:active|offset)\s*&&`

**Right answer**: `!==\s*undefined`
