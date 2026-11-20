---
name: frontend-code-style
description: "Use when writing, refactoring or reviewing any .ts or .tsx file in a React SPA, alongside the domain skill: TypeScript 7 errors TS2375, TS2379, TS1294, TS1484, TS4114 or TS18048, replacing enum or forwardRef, React 19 APIs (ref as a prop, use), the React Compiler and useMemo, Error subclasses, reportError, console or lint findings, default exports, dates and money. Not for tsconfig or Biome settings (frontend-tooling), file placement (frontend-project-structure) or render-performance rules (vercel-react-best-practices)."
metadata:
  version: "0.1.0"
---

# Frontend Code Style

Assumes TypeScript 7.0, React 19.3, babel-plugin-react-compiler 1.0, Biome 2.6.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, use its own modules, helpers and scripts, and say so when it has no equivalent instead of adding one unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If `pnpm-lock.yaml` pins another major version than the line above, follow the project and say which rules may not apply.

Render-performance and re-render rules belong to `vercel-react-best-practices`, component API design to `vercel-composition-patterns`, and native web-platform APIs to `modern-web-guidance`. If one of these skills is available, load it before changing that kind of code. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules. Where a third-party rule and this stack disagree, `references/third-party-precedence.md` decides.

## Important

- A property callers may fill from a maybe-`undefined` value is `prop?: T | undefined`; objects built from maybe-absent values use `...(x !== undefined && { x })`; `x &&` fits only an object, since it drops `false`, `0` and `""`. `exactOptionalPropertyTypes` rejects anything else.
- The React Compiler runs in `vite` and `vite build`, not under Vitest: write no new `useMemo`, `useCallback` or `memo` except for a value a non-React consumer keys on by identity (a subscription, an external store selector), and keep code correct uncompiled. A Biome `useReactCompiler` finding means the component ships uncompiled: fix the code.
- An error you catch and cannot handle goes to the platform `reportError(error)`, never `console` (a lint error). An empty `catch` or `.catch(() => undefined)` only where the fallback is the handling, with a one-line reason comment: a blocked or corrupt storage read, the unawaited loader prefetch, a best-effort beacon whose loss is expected (an analytics ping that ad blockers or a lost connection drop). Never render `error.message`.
- Outside values (`response.json()`, storage, `postMessage`) are `unknown` and narrowed; no `any`, `!`, or `as` on them.
- Named exports only. Stateful objects come from `createX(deps)` factories, as `createQueryClient(notify)` and `createAppRouter` do; module-level state is only configuration set once in `main.tsx` (`configureApi`), a zustand store placed as `frontend-project-structure` shows, or a cache of immutable values built from their key (an `Intl` formatter per locale or currency).

## References

- `references/typescript-errors.md` — a pasted `TSxxxx` code: the flag behind it and the fix, with verified rewrites for each strictness flag.
- `references/types-and-errors.md` — writing a domain type, an exhaustive switch, a lookup table, an error class, a `catch`, a newer HTML attribute `@types/react` lacks, or date and money display.
- `references/react-19.md` — writing a component, a ref, a context or a lazy import, or deciding about memoization and the compiler escape hatch.
- `references/third-party-precedence.md` — a third-party skill's rule that names another framework, server rendering, an inline script, a runtime-style library, `Temporal` or manual memoization.

## What TypeScript 7 Strictness Forces

| Flag | Write | Error when broken |
|---|---|---|
| `exactOptionalPropertyTypes` | `prop?: T \| undefined` on anything callers forward; conditional spread when building | TS2375, TS2379, TS2412 |
| `noUncheckedIndexedAccess` | `arr[0]`, `record[key]`, `.at()` are `T \| undefined`: narrow with `if` or `??` | TS18048, TS2532, TS2322 |
| `verbatimModuleSyntax` | `import type { X }` or `import { type X, y }` | TS1484 |
| `erasableSyntaxOnly` | a union or `as const` object, not `enum`; fields assigned in the constructor body, not parameter properties; a module, not `namespace` | TS1294 |
| `noImplicitOverride` | `override` on members that shadow a base member, `name` in an `Error` subclass included | TS4114 |

Never silence one with `!`, `as`, `@ts-expect-error` or a looser flag.

## Types

- `unknown` at boundaries, narrowed with `instanceof`, `typeof`, `in` or a zod parse (where zod runs is `tanstack-query-api`'s). `as` only for `as const`, a brand constructor, test data, and a library value typed `unknown` whose type its filter guarantees (`useMutationState` variables).
- Server shapes come from `@/api/generated/api`, derived with `Pick`, `Omit` and indexed access. Keep the wire's `null`; use `undefined` for your own optionals.
- A fixed set is a string-literal union, or an `as const` object plus a same-named type when code needs the values.
- A `switch` over a discriminated union ends `default: return value satisfies never;`. A table keyed by a union is `{ ... } satisfies Record<Status, string>`.
- `interface` for object shapes and props, `type` for the rest.

## Errors

- An own error class sets `override name = "XError"`, assigns fields in the constructor body, and passes `super(message, { cause })`. Throw only `Error` instances.
- `catch (error)` handles what it recognizes (`error instanceof ApiError && error.status === 409`) and rethrows the rest, adding context as `new XError("what failed", { cause: error })`.
- A promise is awaited, returned, or ends in `.catch(reportError)` or one of the fallback catches under Important (Biome `noFloatingPromises`).
- `reportError` (a platform global) raises a `window` `error` event, where a tracker listens; add no other sink or logger. React reports what its error boundaries catch through `rootErrorHandlers` in `main.tsx`, so a loader or render error is rethrown, not reported first.
- App code reports only a failure nobody is shown: a fire-and-forget promise, a listener, a failed start-up. An error shown as a route error screen, a form message or a toast is not reported by app code. Copy shown for an `ApiError` names its `requestId` when present.

## Modules and Dependency Injection

- Named exports only (`*.config.ts` excepted). `lazy(() => import("./chart").then((m) => ({ default: m.Chart })))`.
- Collaborators arrive as parameters or props; immutable module values are fine.
- Side-effect imports live in `main.tsx`, with `@/app/zod-config` first.

## React 19

- Every Context has a `null` default and a `useX()` that throws without its provider; where a Context is warranted is `frontend-project-structure`'s.
- An effect must stay correct when its dependencies get new identities every render, as they do under uncompiled Vitest. Fix `useExhaustiveDependencies` findings; do not suppress them.

## React Compiler

- The compiler silently skips a component it cannot compile. Biome `useReactCompiler` reports most causes (a ref read or written during render, an assignment to a prop or state field, a conditional hook), but not `push`, `sort` or `splice` on a prop or state, which compile into stale output: copy first (`toSorted()`, spread).
- Escape hatch: `"use no memo";` as a component's first statement, only for a third-party hook whose mutable result the compiled component misses, with a `TODO` comment naming it.

## Naming

- Components, types and error classes PascalCase; hooks `useX`; factories `createX`; handler props `onX`.
- Module-level configuration constants in SCREAMING_CASE.

## Dates and Money

- ISO 8601 strings on the wire; `new Date(iso)` only to format or compare an instant.
- Format through module-level `Intl.DateTimeFormat` or `Intl.NumberFormat` instances (`formatDateTime` in `src/shared/lib/format-date.ts`, `formatMoney` beside it in `format-money.ts`).
- Money is integer minor units or a decimal string. Pass a decimal string to `format` as a string, narrowed to `` `${number}` `` first (a plain `string` fails with TS2769); a float loses digits past 2^53.
- No `Temporal` (no Safari). `lib` is `es2024`: `Set#union`, iterator helpers and `Promise.try` do not type-check.

## Prior-version Corrections

| Older examples write | Correct now |
|---|---|
| `enum Status {}`, `namespace X {}`, `constructor(private x: T)` | union or `as const` object, a module, field plus assignment (TS1294) |
| `forwardRef((props, ref) => ...)` | `function C({ ref, ...props })` |
| `<Ctx.Provider value={v}>`, `useContext(Ctx)` | `<Ctx value={v}>`, `use(Ctx)` |
| `useRef<T>()` | `useRef<T>(null)` or `useRef<T \| undefined>(undefined)` |
| `JSX.Element` | `ReactNode` or `React.JSX.Element` |
| `const C: React.FC<Props>`, `C.defaultProps = {}` | `function C({ size = "md" }: Props)` |
| `handlerRef.current = handler` in an effect | `useEffectEvent(handler)` |
| `useMemo`, `useCallback`, `memo` on every value | nothing; the compiler memoizes |
| `moment`, `dayjs` | `Intl.*Format` and `Date` |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| Write `as User` on `response.json()` or `JSON.parse` | `unknown` and narrow, or the generated client function |
| `catch {}`, `.catch(() => {})` with no reason, or `void` on a promise that can reject | Handle, rethrow with `{ cause }`, or `.catch(reportError)`; a fallback catch says why in one line |
| `reportError(error)` and then `throw error` | One: report what you stop, rethrow what you pass on |
| `reportError` in a form's or mutation's error branch that shows the error | Show it, with the `requestId`; only unshown failures are reported |
| Add `let client` or another mutable value at module level, other than a formatter cache | A `createX(deps)` factory called from `src/app/`; a store only as `frontend-project-structure` shows |
| Add `"use no memo"` or a `biome-ignore` for a `useReactCompiler` finding | Fix the pattern it names |
| `useActionState`, `useOptimistic` or `<form action>` around an API call | The generated mutation; actions bypass the mutation cache |
| `new Intl.NumberFormat(...)` inside a component | A module-level formatter |
| `parseFloat(amount)` or float arithmetic on money | Minor units or the decimal string |
