---
name: frontend-project-structure
description: "Use when creating a file or folder under src, moving code, adopting this standard in an existing app, deciding where a component, hook, helper, Context or zustand store goes, or fixing a boundaries.grit diagnostic such as A feature never imports another feature, or Import from another folder with the @/ alias, not ../ — feature and shared layers, barrels, kebab-case names, createAppRouter Wrap providers. Not for route options (tanstack-router-spa), biome.json (frontend-tooling) or workspace packages (frontend-shared-packages)."
metadata:
  version: "0.1.1"
---

# Project structure

Assumes TypeScript 7.0, React 19.3, TanStack Router 1.170, Biome 2.6, zustand 5.1.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another major of a package than the line above, or an older minor, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

Component API and composition patterns belong to `vercel-composition-patterns`. If that skill is available, load it before designing a component's props or splitting one into parts. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules. Image loading, `srcset` and formats belong to `modern-web-guidance` on the same terms.

## Important

- In a scaffold-shaped app, place every file by the table below and never add another top-level folder under `src/` (`components/`, `hooks/`, `utils/`, `lib/`, `types/`). In an app with its own layout, follow that layout and report where it differs.
- Layer crossings, `../` paths and barrels fail `pnpm check` (`boundaries.grit`, `noBarrelFile`) and the fix is to move the code, never `biome-ignore`. In an app without the `@/` alias or the plugin, keep its import style; adopting them is its own change (`references/adopting.md`).
- The QueryClient and every app-wide provider are built in `createAppRouter` (`Wrap`), never in `main.tsx`, a route or a module: `main.tsx` and every `renderRoute` test call it, so anything else is missing from one of them. An add-on start-up chains `ready.then(render).catch(startFailed)` (a second argument to `then` misses a throw in `render`): report, then render one static message.
- State lives on the first rung that fits ("Where state lives"). Never copy server data or search params into `useState`, a Context or a store: the copy goes stale on the next refetch or back navigation.

## References

- `references/client-state.md` — the state ladder with a test per rung, the Context pattern, a verified zustand store with its test, zustand 5 gotchas. Open before adding a Context or a store.
- `references/app-composition.md` — `main.tsx` line by line, `Wrap` and `InnerWrap`, adding an app-wide provider, what lives in `src/app/`. Open before touching `main.tsx` or `src/app/router.tsx`, and its "Combining add-ons" before adding a second add-on or a header control to `__root.tsx`.
- `references/adopting.md` — bringing an existing app onto this standard: what to check first, and the order of single-concern changes.

## Where it goes

| What it is | Where it lives |
| --- | --- |
| The app shell (header, nav, footer) | `src/routes/__root.tsx`; its controls from `shared/ui` or the owning feature |
| A new screen or URL | `src/routes/<segment>/index.tsx` and its siblings (`orders/index.tsx`, `orders/$orderId.tsx`); names and contents are `tanstack-router-spa`'s |
| The page component of a route | an unexported function in the route file |
| A component, hook, pure helper or hand-written query options about one domain noun | `src/features/<domain>/<thing>.tsx`, `use-<name>.ts`, `<name>.ts` (`pagination.ts`) |
| A zustand store for one domain | `src/features/<domain>/<domain>-store.ts` |
| A Base UI wrapper or app-wide UI piece (button, field, toast, route error) | `src/shared/ui/<name>.tsx`; contents are `tailwind-base-ui`'s |
| A domain-free function, constant or hook used by two consumers | `src/shared/lib/<name>.ts` (`load-query.ts`, `submit-errors.ts`, `format-date.ts`), `src/shared/hooks/use-<name>.ts` (`use-app-form.tsx`) |
| An app-wide Context object and its `use<X>()` hook | `src/shared/hooks/` if domain-free, else the owning feature; the value and provider in `src/app/` |
| Generated client, types, zod schemas, MSW handlers | `src/api/generated/`, written by `pnpm api:generate`, never edited |
| `apiFetch`, `ApiError`, other hand-written HTTP code | `src/api/` |
| Router, QueryClient, app-wide providers, env, error wiring | `src/app/` |
| Translation files (translations add-on; contents are `frontend-i18n`'s) | `src/app/locales/<language>/<namespace>.json` |
| Global CSS and design tokens | `src/styles.css` |
| An image a component shows | beside it, imported (`import logoUrl from "./logo.png"`): hashed under `/assets/`, cached for a year; `width` and `height` on every `<img>`; a hand-made SVG is a file or a component, never a `data:` URL (the CSP blocks it) |
| A file that needs a stable URL (`favicon.svg`, `robots.txt`) | `public/`: its own name, revalidated on every load |
| A unit, component or route test | beside its file: `user-table.test.tsx`, `src/routes/users/index.test.tsx` |
| A test that needs a DOM but has no JSX | `<name>.dom.test.ts`; any other `*.test.ts` runs in Node without a DOM (`frontend-testing`) |
| Test harness, MSW `server`, `build<Entity>` factories | `src/test/` (`render-route.tsx`, `server.ts`, `factories/<entity>.ts`) |
| The route tree | `src/routeTree.gen.ts`, generated, committed, never edited |

## Import rules

```text
routes -> features -> shared | api
app    -> anything (composition root)
test   <- tests only
```

`shared/` may import `api/`. `@/...` for another folder, `./x` for the same folder, never `../`, which breaks on every move and hides a crossing. `biome-plugins/boundaries.grit` (loaded by `frontend-tooling`'s Biome config) fails `pnpm check` on each crossing, static or `import()`. Fixes: a feature or `shared/` file takes a value from `app/` or a route as a prop or argument; a `shared/` or `api/` file leaves feature code in the feature or moves only its domain-free part down; app code that needs a `@/test/` helper moves it into `shared/`. For two features, see below.

Route params, search and loader data reach a feature as props from the page component (the one exception is `tanstack-router-spa`'s `getRouteApi`); a feature never imports a route file.

## Features

A feature is one domain noun that owns API resources or screens (`users`, `orders`), created with its first screen. A screen that shows two nouns is not a new feature: its route composes both. A screen with no noun (an About page) stays in its route file; a piece another screen reuses goes to `shared/ui`.

A feature folder is flat: no `components/`, `hooks/` or `types/` sub-folders, no `index.ts`. Screen UI goes in the feature too, not in the router's `-components/` folders: they work, but this house keeps one place per noun.

### Two features need the same thing

| Need | Do |
| --- | --- |
| Feature B displays data that A loads | the route reads it and passes it to B as props |
| Both need an API type | import it from `@/api/generated/api` |
| B renders a component of A (a user badge in the orders table) | the route renders A's component into a slot prop of B (`children`, or `renderCustomer={(id) => <UserBadge userId={id} />}`); a piece with no domain logic moves to `shared/ui` |
| B needs A's domain rule | the route computes it with A's code and passes the result to B; if this keeps happening, merge A and B |

## Files

- kebab-case outside `src/routes/` (`user-table.tsx` exports `UserTable`; Biome: `The filename should be in kebab-case.`); route files keep the router's tokens (`$userId.tsx`, `__root.tsx`).
- One exported component per file, named after the file, plus unexported helpers it alone uses; a `shared/ui` wrapper may export the parts of its one Base UI component (`dialog.tsx`: `Dialog`, `DialogTrigger`).
- `Avoid barrel files.`: import the exact file; a barrel shared by a route's loader and its component pulls the component into the entry chunk. `This import is part of a cycle.`: move the shared piece into its own file.
- A route file exports only `Route`; why, and what goes in it, is `tanstack-router-spa`'s.

## Where state lives

Take the first rung that fits:

1. URL search params: a reload or shared link must restore it.
2. The Query cache: a request returns it. Pushed signals no endpoint returns (presence, typing) live in a store owned by the realtime module (`frontend-realtime`).
3. `useState` in the lowest owner: one subtree reads it. Form values are `frontend-forms`'s.
4. An app-wide Context: created once in `src/app/`, read by distant components, changing rarely (the realtime client, a user preference).
5. A zustand store in the owning feature: one domain's client state that distant components or several routes read and that changes more often (a cart, a wizard's draft across routes, canvas selection).

The session is not a Context: it lives in the router context and features get props. A compound component's own Context is `vercel-composition-patterns`'s. Tests per rung, the Context pattern and a verified store: `references/client-state.md`.

## Growth

- Past about 15 files, split a feature folder into sub-folders by sub-domain; into two features when two clusters never import each other, or past about 30 files.
- Promote code to `shared/` in the change that adds its second consumer, and only when it carries no domain knowledge: JSX goes to `shared/ui`, a hook to `shared/hooks`, anything else to `shared/lib`. Move its test with it.
- A table, form or list implementation growing in a route file moves to the feature.

## Prior-version corrections

| Older examples write | Correct now |
| --- | --- |
| ESLint `import/no-restricted-paths` zones or `dependency-cruiser` for layers | `biome-plugins/boundaries.grit` |
| `features/<x>/index.ts` as the feature's public API | import the exact file |
| zustand `useStore(selector, shallow)` | `useStore(useShallow(selector))` (zustand 5) |

## Red Flags — STOP

| About to… | Do this instead |
| --- | --- |
| import `@/routes/...`, `Route` or `@/app/env` into a feature | props from the route: the feature stays testable and reusable without the router |
| move folders, add the alias or swap a library in an existing app as part of a feature task | the feature in the app's current style; adoption is a separate, ordered change (`references/adopting.md`) |
