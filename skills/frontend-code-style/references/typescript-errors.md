# TypeScript 7 Errors and Their Fixes

## Contents

- Error code table
- `exactOptionalPropertyTypes`
- `noUncheckedIndexedAccess`
- `verbatimModuleSyntax`
- `erasableSyntaxOnly`
- `noImplicitOverride`

Messages are quoted from `tsc` 7.0 on the scaffold's `tsconfig.json`. Fix the code; the flags stay
on. A configuration error (TS5102, TS5108 on `baseUrl`, `moduleResolution: "node"` or `outFile`)
belongs to `frontend-tooling`. TS2379 on `queryClient.query(getXSuspenseQueryOptions())` is the
loader-options split that `tanstack-query-api` documents.

## Error code table

| Code | Message starts | Cause | Fix |
|---|---|---|---|
| TS2375 | Type '{ label: string \| undefined; }' is not assignable to type 'Opts' with 'exactOptionalPropertyTypes: true' | an object literal assigns a maybe-`undefined` value to `label?: string` | declare `label?: string \| undefined`, or spread conditionally |
| TS2379 | Argument of type '...' is not assignable to parameter of type '...' with 'exactOptionalPropertyTypes: true' | the same, as a call argument or JSX prop | same |
| TS2412 | Type 'string \| undefined' is not assignable to type 'string' with 'exactOptionalPropertyTypes: true' | `opts.label = maybe` | assign only when defined, or widen the property |
| TS18048 | 'rec.x' is possibly 'undefined' | index access under `noUncheckedIndexedAccess` | narrow first |
| TS2532 | Object is possibly 'undefined' | the same, on an unnamed expression | narrow first |
| TS2322 | Type 'number \| undefined' is not assignable to type 'number' | `const n: number = arr[0]` | narrow, or `?? fallback` when a default is correct |
| TS1484 | 'RouterHistory' is a type and must be imported using a type-only import when 'verbatimModuleSyntax' is enabled | value import of a type | `import type` or an inline `type` modifier |
| TS1294 | This syntax is not allowed when 'erasableSyntaxOnly' is enabled | `enum`, `namespace`, a constructor parameter property | see below |
| TS4114 | This member must have an 'override' modifier because it overrides a member in the base class 'Error' | `name = "X"` in an `Error` subclass | `override name = "X"` |
| TS2882 | Cannot find module or type declarations for side-effect import of './x' | side-effect import of a missing file (on by default in TS 7) | fix the path |
| TS2554 | Expected 1 arguments, but got 0 | `useRef<T>()` | `useRef<T>(null)` or `useRef<T \| undefined>(undefined)` |
| TS2503 | Cannot find namespace 'JSX' | global `JSX.Element` | `ReactNode` or `React.JSX.Element` |
| TS2339 | Property 'defaultProps' does not exist on type 'FC' | `C.defaultProps = {}` | destructuring defaults |
| TS1360 | Type '...' does not satisfy the expected type 'never' | a union gained a variant the `switch` does not handle | add the `case` |

## `exactOptionalPropertyTypes`

`label?: string` means absent or a string; `undefined` is a third state. Widen the property when
callers forward a value that may be `undefined` (props passed through, options built from other
options); keep it narrow when it is only ever omitted or set. Build objects from maybe-absent
values with a conditional spread: `...(x !== undefined && { x })` in general, `...(x && { x })`
only when `x` is an object, because `&&` also drops `false`, `0` and `""`.

```ts,verify
import type { RouterHistory } from "@tanstack/react-router";

interface SearchOptions {
  /** Forwarded from an input that may be empty, so `undefined` is accepted. */
  query?: string | undefined;
  /** Only ever omitted or set. */
  limit?: number;
}

export function toSearchParams({ query, limit = 20 }: SearchOptions) {
  return new URLSearchParams({ limit: String(limit), ...(query !== undefined && { query }) });
}

export function fromInput(raw: string | undefined) {
  return toSearchParams({ query: raw });
}

export function routerOptions(history: RouterHistory | undefined) {
  return { defaultPreload: "intent" as const, ...(history && { history }) };
}
```

## `noUncheckedIndexedAccess`

Index access on an array or a record, and `.at()`, return `T | undefined`. Narrow and fail
loudly, or supply a fallback only where the fallback is correct. Never `!`.

```ts,verify
const statusLabels: Record<string, string> = { active: "Active", disabled: "Disabled" };

export function firstLine(text: string) {
  const [first] = text.split("\n");
  if (first === undefined) throw new Error("split always returns one element");
  return first;
}

export function statusLabel(status: string) {
  return statusLabels[status] ?? status;
}

export function lastOrNothing(items: readonly number[]) {
  return items.at(-1);
}
```

## `verbatimModuleSyntax`

A type imported without `type` stays in the emitted JavaScript and fails at runtime when the
module exports no value of that name. Biome `useImportType` rewrites it.

```ts
import type { UserResponse } from "@/api/generated/api";
import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
```

## `erasableSyntaxOnly`

Only syntax that type stripping can erase is allowed, so the same file runs under Node 26 and the
bundler.

```ts,ignore
enum OrderStatus { Draft, Paid }
namespace Money { export const zero = 0; }
class Poller { constructor(private readonly intervalMs: number) {} }
```

```ts,verify
export const OrderStatus = { Draft: "draft", Paid: "paid", Shipped: "shipped" } as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export type Channel = "email" | "sms";

export class Poller {
  readonly #intervalMs: number;

  constructor(intervalMs: number) {
    this.#intervalMs = intervalMs;
  }

  start(tick: () => void) {
    const id = setInterval(tick, this.#intervalMs);
    return () => clearInterval(id);
  }
}
```

A `namespace` becomes its own module with named exports. `const enum` and `import x = require()`
fail the same way.

## `noImplicitOverride`

Every member that shadows a base member says `override`: `override name = "QuotaExceededError"` in
an `Error` subclass, `override render()` in a class component.
