---
name: frontend-project-structure
description: "Use when creating a file or folder under src of a React SPA, moving code, deciding where a component, hook, helper, Context or zustand store goes, or fixing a boundaries.grit diagnostic such as A feature never imports another feature, or Import from another folder with the @/ alias, not ../ — features and shared layers, @/ imports, barrel files, kebab-case names, createAppRouter Wrap providers. Not for route options (tanstack-router-spa), biome.json (frontend-tooling) or workspace packages (frontend-shared-packages)."
metadata:
  version: "0.1.0"
---

# Project structure

Assumes TypeScript 7.0, React 19.3, TanStack Router 1.170, Biome 2.6, zustand 5.1.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, use its own modules, helpers and scripts, and say so when it has no equivalent instead of adding one unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If `pnpm-lock.yaml` pins another major version than the line above, follow the project and say which rules may not apply.

Component API and composition patterns belong to `vercel-composition-patterns`. If that skill is available, load it before designing a component's props or splitting one into parts. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules.

## Important

- In a scaffold-shaped app, place every file by the table below and never add another top-level folder under `src/` (`components/`, `hooks/`, `utils/`, `lib/`, `types/`). In an app with its own layout, follow that layout and report where it differs.
- A feature never imports another feature. Compose both in the route, or move the domain-free part to `src/shared/`; domain types both need come from `@/api/generated/api`.
- `@/...` for another folder, `./x` for the same folder, never `../`: a `../` path breaks on every move and hides a layer crossing.
- No barrels and no re-export files: import the exact file. A barrel shared by a route's loader and its component pulls the component into the entry chunk, and barrels make import cycles.
- State lives on the first rung that fits ("Where state lives"). Never copy server data or search params into `useState`, a Context or a store: the copy goes stale on the next refetch or back navigation.

## References

- `references/client-state.md` — the state ladder with a test per rung, the Context pattern, a verified zustand store with its test, zustand 5 gotchas. Open before adding a Context or a store.
- `references/app-composition.md` — `main.tsx` line by line, `createAppRouter`'s `Wrap` and `InnerWrap`, adding an app-wide provider, what lives in `src/app/`. Open before touching `main.tsx` or `src/app/router.tsx`; its "Combining add-ons" section before adding a second add-on (`keycloak-spa-auth`, `frontend-i18n`, `frontend-realtime`).

## Where it goes

| What it is | Where it lives |
| --- | --- |
| A new screen or URL | `src/routes/<segment>/index.tsx` and its siblings (`orders/index.tsx`, `orders/$orderId.tsx`); names and contents are `tanstack-router-spa`'s |
| The page component of a route | an unexported function in the route file |
| A component, hook, pure helper or hand-written query options about one domain noun | `src/features/<domain>/<thing>.tsx`, `use-<name>.ts`, `<name>.ts` (`pagination.ts`) |
| A zustand store for one domain | `src/features/<domain>/<domain>-store.ts` |
| A Base UI wrapper or app-wide UI piece (button, field, toast, route error) | `src/shared/ui/<name>.tsx`; contents are `tailwind-base-ui`'s |
| A domain-free function, constant or hook used by two consumers | `src/shared/lib/<name>.ts`, `src/shared/hooks/use-<name>.ts` |
| An app-wide Context object and its `use<X>()` hook | `src/shared/hooks/` if domain-free, else the owning feature; the value and provider in `src/app/` |
| Generated client, types, zod schemas, MSW handlers | `src/api/generated/`, written by `pnpm api:generate`, never edited |
| `apiFetch`, `ApiError`, other hand-written HTTP code | `src/api/` |
| Router, QueryClient, app-wide providers, env, error wiring | `src/app/` |
| Translation files (translations add-on; contents are `frontend-i18n`'s) | `src/app/locales/<language>/<namespace>.json` |
| Global CSS and design tokens | `src/styles.css` |
| A file served unhashed (`favicon.svg`, `robots.txt`) | `public/` |
| A unit, component or route test | beside its file: `user-table.test.tsx`, `src/routes/users/index.test.tsx` |
| Test harness, MSW `server`, `build<Entity>` factories | `src/test/` (`render-route.tsx`, `server.ts`, `factories/<entity>.ts`) |
| The route tree | `src/routeTree.gen.ts`, generated, committed, never edited |

## Import rules

```text
routes -> features -> shared | api
app    -> anything (composition root)
test   <- tests only
```

`shared/` may import `api/`. `biome-plugins/boundaries.grit` reports each crossing as a `plugin` error that fails `pnpm check`:

| Diagnostic | Fix |
| --- | --- |
| `Import from another folder with the @/ alias, not ../` | rewrite to `@/<folder>/<file>`, or `./<file>` if it is the same folder |
| `A feature never imports another feature: compose both in the route, or move the domain-free part to @/shared.` | see "Two features need the same thing" |
| `features/, shared/ and api/ never import routes/ or app/.` | take the value as a prop or argument |
| `shared/ and api/ never import a feature.` | leave it in the feature, or move only its domain-free part down |
| `Only tests import @/test/.` | only `*.test.ts(x)` files and `src/test/` may |

Route params, search and loader data reach a feature as props from the page component; the one exception is `tanstack-router-spa`'s `getRouteApi`. A feature never imports a route file.

The plugin does not see `import()`; the rules still apply. Never silence it with `biome-ignore`: move the code. The Biome config that loads it is `frontend-tooling`'s.

## Features

A feature is one domain noun that owns API resources or screens: `users`, `orders`, `billing`. Create `src/features/<noun>/` with its first screen; code about a noun that already has a folder extends it. A screen that shows two nouns is not a new feature: its route composes both. A screen with no noun (an About page) stays in its route file, and a piece another screen reuses goes to `shared/ui`.

A feature folder is flat: no `components/`, `hooks/` or `types/` sub-folders, no `index.ts`.

### Two features need the same thing

| Need | Do |
| --- | --- |
| Feature B displays data that A loads | the route reads it and passes it to B as props |
| Both need an API type | import it from `@/api/generated/api` |
| B needs A's domain rule | the route computes it with A's code and passes the result to B; if this keeps happening, merge A and B |

## Files

- kebab-case everywhere outside `src/routes/`: `user-table.tsx` exports `UserTable`, `use-user-filter.ts` exports `useUserFilter`. Biome's `useFilenamingConvention` reports `The filename should be in kebab-case.`; route files keep the router's tokens (`$userId.tsx`, `__root.tsx`).
- One exported component per file, named after the file; a `shared/ui` wrapper may export the parts of its one Base UI component (`dialog.tsx`: `Dialog`, `DialogTrigger`, `DialogPopup`). Unexported helpers it alone uses may share the file.
- Any re-export reports `Avoid barrel files.`; a cycle reports `This import is part of a cycle.`: move the shared piece into its own file.
- A route file exports only `Route`; why, and what goes in it, is `tanstack-router-spa`'s.

## Where state lives

Take the first rung that fits:

1. URL search params: a reload or shared link must restore it.
2. The Query cache: it came from the server.
3. `useState` in the lowest owner: one subtree reads it.
4. An app-wide Context: a value created once in `src/app/`, read by many distant components, not server data, changing rarely (the realtime client, a user preference); every reader re-renders on each change.
5. zustand: distant components read it and it changes many times a second (canvas selection, drag).

The session is not a Context: it lives in the router context and features get props. Form values are `frontend-forms`'s. A compound component's own Context (provider rendered by its root, file beside it) is component API and `vercel-composition-patterns`'s. Tests per rung, the Context pattern and a verified store: `references/client-state.md`.

## App composition

`src/main.tsx` imports `@/app/zod-config` first and renders only `<RouterProvider router={createAppRouter()} />`. An add-on that must be ready before the first render calls `ready.then(render, startFailed)`, several `Promise.all([...]).then(render, startFailed)`; `startFailed` reports the error and renders one static message, never a blank page.

`createAppRouter` builds the QueryClient and mounts every app-wide provider in the router's `Wrap` option (`InnerWrap` if it calls router hooks), and nowhere else: `main.tsx` and every `renderRoute` test call it, so a provider in a route or `main.tsx` is missing from tests or from the app, and a module-level client leaks between tests.

## Growth

- Split a feature folder into sub-folders by sub-domain past about 15 files. Split it into two features when two clusters of files never import each other, or past about 30 files.
- Promote code to `shared/` in the change that adds its second consumer, and only when it carries no domain knowledge: JSX goes to `shared/ui`, a hook to `shared/hooks`, anything else to `shared/lib`. Move its test with it.
- A table, form or list implementation growing in a route file moves to the feature.
- No `packages/` folder until a second deployable needs the same UI kit or API client (`frontend-shared-packages`).

## Prior-version corrections

| Older examples write | Correct now |
| --- | --- |
| ESLint `import/no-restricted-paths` zones or `dependency-cruiser` for layers | `biome-plugins/boundaries.grit` |
| `features/<x>/index.ts` as the feature's public API | import the exact file |
| `routes/<x>/-components/` for screen UI | the feature folder |
| zustand `useStore(selector, shallow)` | `useStore(useShallow(selector))` (zustand 5) |

## Red Flags — STOP

| About to… | Do this instead |
| --- | --- |
| import `@/routes/...`, `Route` or `@/app/env` into a feature | props from the route |
| `new QueryClient()` in a module, or a provider in `main.tsx` or a route | `createAppRouter` and its `Wrap` |
| copy Query data into `useState`, Context or a store | read it with `useSuspenseQuery` where it is needed |
| keep page, filter or sort in `useState` | search params via `validateSearch` |
| add `biome-ignore` to a boundary diagnostic | move the code to the layer that may import it |
