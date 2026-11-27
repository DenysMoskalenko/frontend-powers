---
name: frontend-code-style
description: "Use when writing, refactoring or reviewing any .ts or .tsx file in a React SPA, alongside the domain skill: TypeScript 7 errors TS2375, TS2379, TS1294, TS1484, TS4114 or TS18048, replacing enum or forwardRef, React 19 APIs (ref as a prop, use), the React Compiler and useMemo, Error subclasses, reportError, console or lint findings, default exports, dates and money. Not for tsconfig or Biome settings (frontend-tooling), file placement (frontend-project-structure) or render-performance rules (vercel-react-best-practices)."
metadata:
  version: "0.1.1"
---

# Frontend Code Style

Assumes TypeScript 7.0, React 19.3, babel-plugin-react-compiler 1.0, Biome 2.6.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another major of a package than the line above, or an older minor, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

Render-performance and re-render rules belong to `vercel-react-best-practices`, component API design to `vercel-composition-patterns`, and native web-platform APIs to `modern-web-guidance`. If one of these skills is available, load it before changing that kind of code. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules. Where a third-party rule and this stack disagree, `references/third-party-precedence.md` decides.

## Important

- Browser code uses only what the browser floor, `build.target` in `vite.config.ts`, has. Check a Web API, built-in, HTML attribute or CSS feature by its exact member in MDN's compatibility data (`URL.parse`, not `URL`): `lib: es2024` stops only newer built-ins and the build lowers only syntax. Below the floor, write the older equivalent (`new URL` in `try`/`catch`, `getReader()` on a stream) or feature-detect with a working path; a hint browsers ignore (`fetchPriority`, `field-sizing`) is fine when the page works without it.
- Where `vite.config.ts` runs `reactCompilerPreset()`, the React Compiler compiles dev, build and `pnpm test` (not the coverage run): write no new `useMemo`, `useCallback` or `memo` except for a value a non-React consumer keys on by identity (a subscription, an external store selector). A Biome `useReactCompiler` finding means the component ships uncompiled: fix the code. `push`, `sort` or `splice` on a prop or state gets no finding and compiles into stale output: copy first (`toSorted()`, spread). Without the compiler, keep existing memoization; new memoization is `vercel-react-best-practices`'s.
- An error you catch and cannot handle goes to the platform `reportError(error)`, never `console` (a lint error). An empty `catch` or `.catch(() => undefined)` only where the fallback is the handling (a blocked storage read, the unawaited loader prefetch, a beacon whose loss is expected), with a one-line reason comment. Never render `error.message`; copy shown for an `ApiError` names its `requestId`, also when it is another error's `cause`.
- Named exports only (`*.config.ts` excepted). Stateful objects come from `createX(deps)` factories (`createQueryClient(notify)`, `createAppRouter`); module-level state is only configuration set once in `main.tsx` (`configureApi`), a zustand store placed as `frontend-project-structure` shows, or a cache of immutable values (an `Intl` formatter per locale).

## References

- `references/typescript-errors.md` — a pasted `TSxxxx` code: the flag behind it and the fix, with verified rewrites for each strictness flag.
- `references/types-and-errors.md` — writing a domain type, an exhaustive switch, a lookup table, an error class, a `catch`, the copy shown for a failure, a newer HTML attribute `@types/react` lacks, or date and money display.
- `references/react-19.md` — writing a component, a ref, a context, an effect or a lazy import, or deciding about memoization and the `"use no memo"` escape hatch.
- `references/third-party-precedence.md` — a third-party skill's rule that names another framework, server rendering, an inline script, a runtime-style library, `Temporal` or manual memoization.

## What TypeScript 7 Strictness Forces

| Flag | Write | Error when broken |
|---|---|---|
| `exactOptionalPropertyTypes` | `prop?: T \| undefined` on anything callers forward; build with `...(x !== undefined && { x })` | TS2375, TS2379, TS2412 |
| `noUncheckedIndexedAccess` | narrow `arr[0]`, `record[key]`, `.at()` with `if` or `??` | TS18048, TS2532, TS2322 |
| `verbatimModuleSyntax` | `import type { X }` or `import { type X, y }` | TS1484 |
| `erasableSyntaxOnly` | a union or `as const` object, fields assigned in the constructor body, a module: no `enum`, parameter properties or `namespace` | TS1294 |
| `noImplicitOverride` | `override` on a member that shadows a base member (`name` in an `Error` subclass) | TS4114 |

Never silence one with `!`, `as`, `@ts-expect-error` or a looser flag.

## Types

- `unknown` at boundaries, narrowed with `instanceof`, `typeof`, `in` or a zod parse (where zod runs is `tanstack-query-api`'s). `as` only for `as const`, a brand constructor, test data, and a library value typed `unknown` whose filter guarantees its type (`useMutationState` variables).
- Server shapes come from `@/api/generated/api`, derived with `Pick`, `Omit` and indexed access. Keep the wire's `null`; use `undefined` for your own optionals.
- A fixed set is a string-literal union, or an `as const` object plus a same-named type when code needs the values.
- A `switch` over a union ends `default: return value satisfies never;`. That check is compile-time only: over a union from the server, which can gain a variant before the app ships, `default` writes `value satisfies never;`, then returns a fallback or throws. A table keyed by a union is `{ ... } satisfies Record<Status, string>`.
- `interface` for object shapes and props, `type` for the rest.

## Errors

- An own error class sets `override name = "XError"`, assigns fields in the constructor body, and passes `super(message, { cause })`. Throw only `Error` instances.
- `catch (error)` handles what it recognizes (`error instanceof ApiError && error.status === 409`) and rethrows the rest, adding context as `new XError("what failed", { cause: error })`.
- A promise is awaited, returned, or ends in `.catch(reportError)` or one of the fallback catches under Important (Biome `noFloatingPromises`).
- `reportError` (a platform global) raises a `window` `error` event, the one place a tracker listens; add no other sink. A loader or render error is rethrown (React reports it through `rootErrorHandlers`). A screen that shows its own copy for a failed mutation sets `meta: { silent: true }` (`tanstack-query-api`), or the QueryClient's toast repeats it.

## React 19

- Every Context has a `null` default, is rendered as `<Ctx value={v}>` and read with `use(Ctx)` (a house rule: `useContext` is not deprecated) through a `useX()` that throws without its provider; where a Context is warranted is `frontend-project-structure`'s.
- A lazy component keeps its named export: `lazy(() => import("./chart").then((m) => ({ default: m.Chart })))`.
- Fix `useExhaustiveDependencies` findings; do not suppress them.

## Naming

- Module-level configuration constants in SCREAMING_CASE.

## Dates and Money

- ISO 8601 strings on the wire; `new Date(iso)` only to format or compare an instant.
- A calendar date (`YYYY-MM-DD`, `format: date`) is midnight UTC to `new Date`, so local-time formatting shows the day before west of UTC: show it with `formatDate`, which formats in UTC, and compare two as strings.
- Format through module-level `Intl` instances in `src/shared/lib/format-date.ts`: the template ships `formatDateTime`; add `formatDate` and `formatMoney` from `references/types-and-errors.md` when the app first shows a calendar date or money.
- Money is integer minor units or a decimal string passed to `format` as a string, never a float, which loses digits past 2^53.
- No `Temporal`: the browser floor lacks it. `lib` is `es2024`: `Set#union`, iterator helpers and `Promise.try` do not type-check.

## Prior-version Corrections

| Older examples write | Correct now |
|---|---|
| `enum Status {}`, `namespace X {}`, `constructor(private x: T)` | union or `as const` object, a module, field plus assignment (TS1294) |
| `forwardRef((props, ref) => ...)` | `function C({ ref, ...props })` |
| `<Ctx.Provider value={v}>` | `<Ctx value={v}>` |
| `useRef<T>()` | `useRef<T>(null)` or `useRef<T \| undefined>(undefined)` |
| `JSX.Element` | `ReactNode` or `React.JSX.Element` |
| `const C: React.FC<Props>`, `C.defaultProps = {}` | `function C({ size = "md" }: Props)` |
| `handlerRef.current = handler` in an effect | `useEffectEvent(handler)` |
| `useMemo`, `useCallback`, `memo` on every value | nothing where `vite.config.ts` runs the compiler, which memoizes |
| `moment`, `dayjs` | `Intl.*Format` and `Date` |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| Write `as User` on `response.json()` or `JSON.parse` | `unknown` and narrow, or the generated client function |
| Call `URL.parse`, iterate a `ReadableStream` with `for await`, or use another API newer than `build.target` in browser code | `new URL` in `try`/`catch`, `getReader()`, or a feature test with a working path |
| Format a `YYYY-MM-DD` value with a local-time formatter, `toLocaleDateString()` or `getDate()` | `formatDate` |
| `catch {}`, `.catch(() => {})` with no reason, or `void` on a promise that can reject | Handle, rethrow with `{ cause }`, or `.catch(reportError)`; a fallback catch says why in one line |
| `reportError(error)` and then `throw error` | One: report what you stop, rethrow what you pass on |
| `reportError` in a form's or mutation's error branch that shows the error | Show it, with the `requestId`; only unshown failures are reported |
| Add `let client` or another mutable value at module level, other than a formatter cache | A `createX(deps)` factory called from `src/app/`; a store only as `frontend-project-structure` shows |
| Add `"use no memo"` or a `biome-ignore` for a `useReactCompiler` finding | Fix the pattern it names |
| `useActionState`, `useOptimistic` or `<form action>` around an API call | The generated mutation; actions bypass the mutation cache |
