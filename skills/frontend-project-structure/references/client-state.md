# Client state: the ladder in detail, Context, and a zustand store

Contents

- [The ladder](#the-ladder)
- [One Context, mounted in the provider slot](#one-context-mounted-in-the-provider-slot)
- [A zustand store](#a-zustand-store)
- [Testing a store](#testing-a-store)
- [zustand 5 gotchas](#zustand-5-gotchas)

## The ladder

Take the first rung whose test the state passes.

| Rung | Test | Examples | Mechanics owned by |
| --- | --- | --- | --- |
| URL search params | A reload, a shared link or the back button must restore it | page, sort, filters, active tab, selected row id, open dialog that has its own URL | `tanstack-router-spa` (`validateSearch`) |
| Query cache | A request returns it | lists, details, the current user, feature flags from an endpoint | `tanstack-query-api` |
| A store beside the channel hook | Pushed many times a second and no endpoint returns it | presence, cursors, typing indicators; read with `useSyncExternalStore`, entries expire; on the zustand rung when several routes read it | `frontend-realtime` |
| `useState` | One component and its children read it, and losing it on unmount is fine | open/closed, hover, a local step counter; a form's values are TanStack Form's (`frontend-forms`) | this table: put it in the lowest component that owns it, lift to the nearest common parent when a sibling needs it |
| An app-wide Context | Created once in `src/app/`, read by many distant components, not server data, and changes rarely | the realtime client, a user preference such as compact tables | this file |
| zustand store | One domain's client state that distant components or several routes read, and that changes more than rarely | a cart before checkout, a wizard's draft across its routes, a canvas editor's selection and zoom, drag state | this file |

A cart or a wizard draft that must survive a reload belongs to the server (the Query cache) or to
the store's `persist` middleware, parsed as the gotchas below say. Never copy a rung's data into a
lower one: Query data copied into `useState`, Context or a store goes
stale on the next refetch, and search params copied into `useState` stop following the back button.
Read it where it lives and derive the rest during render.

The Context rung is for app-wide values. A compound component's own Context (its provider rendered
by the component's root, the file beside it) is component API, and `vercel-composition-patterns`'s.

## One Context, mounted in the provider slot

The Context object and its hook live in the lowest layer that reads them, because `features/` and
`shared/` cannot import `@/app/`: `shared/hooks/` when it is domain-free, the owning
`features/<domain>/` folder when one domain owns it. The value is created in `src/app/` and the
provider is mounted inside `Wrap` in `createAppRouter`, so the app and every `renderRoute` test get
it. React 19 renders a Context as its own provider and reads it with `use`.

```ts,verify
// file: src/shared/hooks/use-preferences.ts
import { createContext, use } from "react";

export interface Preferences {
  compactTables: boolean;
  setCompactTables: (compact: boolean) => void;
}

export const PreferencesContext = createContext<Preferences | null>(null);

export function usePreferences() {
  const preferences = use(PreferencesContext);
  if (preferences === null) throw new Error("usePreferences needs PreferencesContext above it");
  return preferences;
}
```

A value the user changes needs state, and state needs a component: it lives in `src/app/`, the
only layer that may own app-wide state, and renders the Context. The hook's file in `shared/` or
`features/` never exports such a component.

```tsx,verify
// file: src/app/preferences-provider.tsx
import { type ReactNode, useState } from "react";
import { PreferencesContext } from "@/shared/hooks/use-preferences";

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [compactTables, setCompactTables] = useState(false);
  return (
    <PreferencesContext value={{ compactTables, setCompactTables }}>{children}</PreferencesContext>
  );
}
```

```tsx
// src/app/router.tsx, inside Wrap
<QueryClientProvider client={queryClient}>
  <PreferencesProvider>
    <ToastProvider manager={toastManager}>{children}</ToastProvider>
  </PreferencesProvider>
</QueryClientProvider>
```

A value that is fixed for the app's lifetime (a client built in `createAppRouter`) needs no
component: `Wrap` renders `<XContext value={x}>` itself, as it does for the realtime client.

A value that changes often re-renders every reader, and a Context in `src/app/` cannot hold one
domain's state without the app layer owning it: both are the signal to move it to a store. The
session is not a Context: it lives in the router context, and features get what they need as props.

## A zustand store

zustand is an add-on: add it with `pnpm add zustand` when the first state passes the last rung's
test; it is the only client-state library this stack adds. One store per feature, in `src/features/<domain>/<domain>-store.ts`. Keep only client state in
it. Actions are plain exported functions over `setState`, so components and tests call them without
selecting them first.

```ts,verify
// file: src/features/board/board-store.ts
import { create } from "zustand";

interface BoardState {
  selectedIds: ReadonlySet<string>;
  zoom: number;
}

export const initialBoardState: BoardState = { selectedIds: new Set(), zoom: 1 };

export const useBoardStore = create<BoardState>()(() => initialBoardState);

export function selectCard(id: string, { additive }: { additive: boolean }) {
  useBoardStore.setState(({ selectedIds }) => ({
    selectedIds: additive ? new Set(selectedIds).add(id) : new Set([id]),
  }));
}

export function setZoom(zoom: number) {
  useBoardStore.setState({ zoom: Math.min(4, Math.max(0.25, zoom)) });
}
```

A component selects the one value it renders, so it re-renders only when that value changes:

```tsx,verify
// file: src/features/board/zoom-controls.tsx
import { Button } from "@/shared/ui/button";
import { setZoom, useBoardStore } from "./board-store";

export function ZoomControls() {
  const zoom = useBoardStore((state) => state.zoom);

  return (
    <div className="flex items-center gap-2">
      <Button onClick={() => setZoom(zoom / 1.25)}>Zoom out</Button>
      <output>{Math.round(zoom * 100)}%</output>
      <Button onClick={() => setZoom(zoom * 1.25)}>Zoom in</Button>
    </div>
  );
}
```

## Testing a store

The store is a module singleton: it outlives the router that `renderRoute` builds fresh for each
test, so every test file that touches it resets it.

```ts,verify,test
// file: src/features/board/board-store.test.ts
import { afterEach, expect, test } from "vitest";
import { initialBoardState, selectCard, setZoom, useBoardStore } from "./board-store";

afterEach(() => useBoardStore.setState(initialBoardState, true));

test("a plain click replaces the selection and a modified click adds to it", () => {
  selectCard("a", { additive: false });
  selectCard("b", { additive: true });
  expect([...useBoardStore.getState().selectedIds]).toEqual(["a", "b"]);

  selectCard("c", { additive: false });
  expect([...useBoardStore.getState().selectedIds]).toEqual(["c"]);
});

test("zoom stays between 25 % and 400 %", () => {
  setZoom(10);
  expect(useBoardStore.getState().zoom).toBe(4);

  setZoom(0.01);
  expect(useBoardStore.getState().zoom).toBe(0.25);
});
```

## zustand 5 gotchas

- A selector that returns a new object or array on every call (`(state) => ({ zoom: state.zoom })`)
  logs `The result of getSnapshot should be cached to avoid an infinite loop` and then throws
  `Maximum update depth exceeded`. Select one value per call, or wrap the selector in `useShallow`
  from `zustand/react/shallow`.
- The hook's equality-function second argument is gone in zustand 5; use `useShallow`.
- `persist` middleware reads back from `localStorage`, which is untrusted input: parse it with a zod
  schema in the `merge` option.
