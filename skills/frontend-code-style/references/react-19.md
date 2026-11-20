# React 19 and the React Compiler

## Contents

- Refs as props
- Context and `use`
- Refs, ref callbacks and `useRef`
- Lazy components with named exports
- Effects that stay correct uncompiled
- The compiler: what it skips and the escape hatch

Verified against React 19.3 and `@types/react` 19.3. Composition and component API shape belong to
`vercel-composition-patterns`; render performance to `vercel-react-best-practices`.

## Refs as props

`ref` arrives with the other props. `forwardRef` still works but is unnecessary in React 19, and
Biome `noReactForwardRef` reports it.

```tsx,verify
import type { ComponentProps } from "react";

interface SearchInputProps extends ComponentProps<"input"> {
  label: string;
}

export function SearchInput({ label, ref, type = "search", ...props }: SearchInputProps) {
  return (
    <label className="flex flex-col gap-1">
      {label}
      <input ref={ref} type={type} {...props} />
    </label>
  );
}
```

Defaults go in the destructuring: React 19 ignores `defaultProps` on a function component, and
`React.FC` types no longer declare it (TS2339).

## Context and `use`

```ts,verify
import { createContext, use } from "react";

export type Density = "comfortable" | "compact";

export const DensityContext = createContext<Density | null>(null);

export function useDensity() {
  const density = use(DensityContext);
  if (density === null) throw new Error("useDensity needs DensityContext above it");
  return density;
}
```

The Context is its own provider: `<DensityContext value={density}>{children}</DensityContext>`.
The hook's file exports no provider component: when a Context is warranted, where its value lives
and where that element is mounted (for an app-wide value, `src/app/` and the router's `Wrap`) are
`frontend-project-structure`'s.
`<Ctx.Provider>` still works and is the old spelling. `use` may sit inside a condition or loop,
unlike other hooks. Do not pass `use` a promise created during render: it suspends forever. Server
data comes from the Query cache (`tanstack-query-api`). Every Context has a `null` default and a
`useX()` that throws without its provider, a compound component's own Context included.

## Refs, ref callbacks and `useRef`

```tsx,verify
import { useEffect, useRef } from "react";

export function LogTail({ lines }: { lines: readonly { id: string; text: string }[] }) {
  const end = useRef<HTMLDivElement>(null);
  const lineCount = lines.length;

  useEffect(() => {
    if (lineCount > 0) end.current?.scrollIntoView();
  }, [lineCount]);

  return (
    <div>
      {lines.map((line) => (
        <p key={line.id}>{line.text}</p>
      ))}
      <div ref={end} />
    </div>
  );
}

export function Measured({ onWidth }: { onWidth: (width: number) => void }) {
  return (
    <div
      ref={(node) => {
        if (!node) return;
        const observer = new ResizeObserver(([entry]) => onWidth(entry?.contentRect.width ?? 0));
        observer.observe(node);
        return () => observer.disconnect();
      }}
    />
  );
}
```

`useRef` needs its initial value (TS2554 without one): `useRef<HTMLDivElement>(null)` for a DOM
node, `useRef<number | undefined>(undefined)` for a mutable value. A ref callback may return its
cleanup, which React calls instead of calling the ref with `null`; the parameter is still typed
`T | null`, so keep the guard. `ref.current` is read and written in effects and handlers only; in
render it makes the compiler skip the component.

## Lazy components with named exports

```tsx,verify
import { lazy, Suspense } from "react";

const Button = lazy(() => import("@/shared/ui/button").then((m) => ({ default: m.Button })));

export function LazyAction() {
  return (
    <Suspense fallback={<p>Loading…</p>}>
      <Button>Run</Button>
    </Suspense>
  );
}
```

Routes split by themselves (`autoCodeSplitting`, owned by `tanstack-router-spa`); `lazy` is for a
heavy widget inside a page.

## Effects that stay correct uncompiled

The compiler is off under Vitest, so every object and function created in render gets a new
identity on every test render. An effect must stay correct when that happens:

- Narrow dependencies are `vercel-react-best-practices`' rule (`rerender-dependencies`); here an
  object built in render is a new dependency on every uncompiled render, so the effect reruns.
- A callback the effect calls but must not re-subscribe for goes through `useEffectEvent` (stable
  in React 19.2); how to use it is `vercel-react-best-practices`'s.
- A value whose identity a non-React consumer keys on (a subscription handle, an external store
  selector) is the one place for `useMemo` or `useCallback`.

## The compiler: what it skips and the escape hatch

Configuration lives in `vite.config.ts` (`frontend-tooling`). The compiler runs with its default
`panicThreshold: "none"`: a component it cannot compile is left as written, without a build error.
Biome `useReactCompiler` reports the patterns that cause that:

```tsx,ignore
export function Counter({ items }: { items: string[] }) {
  const renders = useRef(0);
  renders.current += 1; // "This render reads or writes a ref."
  items[0] = "extra"; // "This component mutates a value that React treats as immutable."
  if (items.length === 0) return null;
  const [open, setOpen] = useState(false); // hook after an early return
  return <p>{renders.current}</p>;
}
```

Fix the pattern: move ref access into an effect or handler, copy before changing
(`items.toSorted()`, spread), call hooks unconditionally. Biome does not see a mutating method:
`items.push()` or `items.sort()` on a prop or state compiles without a finding and renders stale
output, so copy first there too.

The opt-out is the `"use no memo"` directive as the first statement of a function. Use it only
when a compiled component misbehaves because a third-party hook returns a mutable object that
changes without a new identity, and say so:

```tsx
export function DataGrid({ rows }: GridProps) {
  // TODO: remove when the table hook returns new objects on change; compiled, the grid never re-renders.
  "use no memo";
  ...
}
```

Biome still reports `useReactCompiler` findings inside an opted-out component, so the directive
is never the fix for a finding.
