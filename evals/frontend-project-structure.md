# frontend-project-structure

### Triggering

**Should load**

1. "biome says `A feature never imports another feature: compose both in the route, or move the domain-free part to @/shared.` on src/features/orders/order-row.tsx, how do I fix it?"
2. "where should a useDebounce hook go in this app? two features need it"
3. "I'm adding an invoices section, list and detail screens. which folders and files do I create?"
4. "lint fails with `Import from another folder with the @/ alias, not ../` after I moved some files around"
5. "can I add an index.ts to features/users so routes import everything from one place?"
6. "we need a store for the diagram editor's selection and zoom, shared by the canvas, the toolbar and the side panel. where does it live?"
7. "I need an app-wide provider for user preferences. where do I mount it so the tests get it too?"
8. "`features/, shared/ and api/ never import routes/ or app/.` when I import env from a feature component"
9. "we have an older React app (react-router, providers in main.tsx, ../ imports everywhere) and want to bring it onto the frontend-powers standard. where do we start?"

**Should not load**

1. "add a `status` search param with a zod enum to /users and keep it in the URL when paging" -> `tanstack-router-spa`
2. "turn on noImportCycles and the GritQL plugin in biome.json for a new project" -> `frontend-tooling`
3. "the admin app should reuse our Button and the generated API client; set up the pnpm workspace" -> `frontend-shared-packages`
4. "our Dialog has isConfirm, isDanger and isWide boolean props; redesign its API as compound parts" -> `vercel-composition-patterns`
5. "change the default staleTime and retry policy in createQueryClient" -> `tanstack-query-api`
6. "add a `danger` variant to the Button wrapper in shared/ui" -> `tailwind-base-ui`
7. "this TS error says the parameter implicitly has an any type in user-table.tsx" -> `frontend-code-style`

### Eval 1 - a new feature beside users

**Prompt**: "Add an orders area: a /orders list and an /orders/$orderId detail page that also shows the ordering user's name and email, reusing how users are displayed. Assume `openapi.json` already has the orders endpoints and the client is regenerated."

**Fixture**: scaffold

**Must produce**:

- new files under `src/features/orders/` with kebab-case names
- route files under `src/routes/orders/` that compose the orders component and the users display component side by side, or pass user data to the orders component as props
- every import of another folder written with `@/`
- order and user types imported from `@/api/generated/api`

**Must not produce**:

- a file under `src/features/orders/` that imports from `@/features/users/`
- an `index.ts` or any `export ... from` re-export file
- a `../` import
- a new top-level folder such as `src/components/` or `src/types/`
- a PascalCase file name such as `OrderList.tsx`

### Eval 2 - fixing pasted boundary diagnostics

**Prompt**: "pnpm check fails with these, fix them properly: (1) src/features/users/user-avatar.tsx: `features/, shared/ and api/ never import routes/ or app/.` on `import { env } from \"@/app/env\"`; (2) src/shared/lib/user-label.ts: `shared/ and api/ never import a feature.` on `import { toListParams } from \"@/features/users/pagination\"`; (3) src/features/users/user-card.tsx: `Import from another folder with the @/ alias, not ../` on `import { cx } from \"../../shared/ui/cx\"`."

**Fixture**: scaffold

**Must produce**:

- `user-avatar.tsx` gets the origin (or the URL built from it) as a prop or argument, or from an `@/api/` helper that reads the base URL `configureApi` set, instead of importing `@/app/env`
- `user-label.ts` moved into `src/features/users/` or rewritten without the feature import, since a helper that needs feature code is not domain-free
- the third import rewritten to `@/shared/ui/cx`

**Must not produce**:

- `biome-ignore` on any of the three lines
- an edit to `biome-plugins/boundaries.grit` or `biome.json` that weakens the rule
- `env` or the router copied into `src/shared/`
- a `../` path anywhere in the fix

### Eval 3 - an app-wide preference

**Prompt**: "Add a 'compact tables' preference the user toggles in the header; UserTable should read it."

**Fixture**: scaffold

**Must produce**:

- the Context object and its hook in `src/shared/hooks/` or `src/features/users/`, not in `src/app/`
- the provider mounted inside `Wrap` in `createAppRouter` in `src/app/router.tsx`
- the toggle rendered in the root layout of `src/routes/__root.tsx`, from `shared/ui` or the users feature
- the Context rendered as `<XContext value={...}>` and read with `use(...)`

**Must not produce**:

- a provider wrapping `<RouterProvider>` in `src/main.tsx`
- a zustand store or another state library for this preference
- `UserTable` importing from `@/app/`
- a module-level mutable variable holding the preference

### Eval 4 - a high-frequency editor store

**Prompt**: "We're building a diagram editor under /diagrams/$id. The canvas, the toolbar and the inspector all need the current selection and zoom, which change on every pointer move. Set up the state."

**Fixture**: scaffold

**Must produce**:

- `zustand` added as a dependency
- the store in `src/features/<domain>/<domain>-store.ts`
- components that select single values, or use `useShallow` for an object
- a test that resets the store with `setState(initial, true)` between tests

**Must not produce**:

- a selector returning a new object literal without `useShallow`
- the diagram's server data copied into the store
- the store file under `src/shared/` or `src/app/`
- a Context provider for state that changes on every pointer move

### Eval 5 - a second add-on

**Prompt**: "Our app already has the Keycloak add-on: `createAppRouter({ session, history })`, `main.tsx` renders after `startKeycloak(...)`, and `renderRoute(path, { session })`. Combine the i18next add-on with it (`createI18n(language)` in src/app/i18n.ts returns `{ i18n, ready }`; English and Russian messages under src/app/locales) in createAppRouter's Wrap, main.tsx and renderRoute, the first screen rendered in the user's language. Show every file you change."

**Fixture**: scaffold

**Must produce**:

- `createAppRouter` taking `session` and `i18n` in one object parameter, `history` still optional
- `I18nextProvider` inside `CSPProvider` and outside `QueryClientProvider` in `Wrap`
- `main.tsx` rendering after `Promise.all([...])` of the sign-in and the language load, with one failure handler
- the failure handler reporting the error and rendering a static message
- `renderRoute` keeping its `session` option and adding a `language` option

**Must not produce**:

- a `createAppRouter` or `renderRoute` that drops `session`
- two separate `.then` chains that each render
- a failure path that leaves the page blank, such as `.catch(reportError)` alone
- a provider wrapping `<RouterProvider>` in `src/main.tsx`

### Eval 6 - adopting the standard in an existing app

**Prompt**: "This app was not built from your template. Bring it onto the standard. Here is what it has: `package.json` with react 19, @tanstack/react-router, @tanstack/react-query, vitest and @testing-library/react, no zod, no msw, no @tanstack/react-form, no babel-plugin-react-compiler; `tsconfig.json` without `paths`; `src/main.tsx` wraps `<RouterProvider>` in `QueryClientProvider` with a module-level `queryClient`; `src/components/`, `src/hooks/` and `src/pages/` folders; route tests stub `fetch` per URL. Give me the plan."

**Fixture**: empty

**Must produce**:

- a numbered or ordered list of steps, each changing one concern and leaving lint, tests and build green
- a first step that works from what the project has (the listed packages and folders), not from the template
- providers and the QueryClient moved into the router factory's `Wrap` before any folder move
- zod, MSW or TanStack Form introduced as their own steps, or kept out, not as part of another step
- folder moves into `features/` and `shared/` late, one feature per step
- the existing per-URL `fetch` stub kept or replaced in its own step, not dropped silently

**Must not produce**:

- one change or merge request that adds the alias, moves folders and swaps libraries together
- a rewrite from the template, or copying `assets/app/` over the project
- renamed environment variables, scripts or exported names as a side effect of a step
- memoization removed before the React Compiler is added

### Probe 1 - cross-feature import

**Prompt**: "In src/features/orders/order-summary.tsx, show the customer with the existing UserDetails component from the users feature. Show the whole file."

**Fixture**: scaffold

**Wrong answer**: `from\s+["\x27]@\/features\/users\/[^"\x27]+["\x27][^\x60]*?export\s+function\s+Order`

### Probe 2 - module-level QueryClient

**Prompt**: "The logout helper in src/shared/lib needs to clear the Query cache. Export the app's QueryClient so it can import it."

**Fixture**: scaffold

**Wrong answer**: `(?:^|\n)\s*export\s+const\s+\w+\s*=\s*new\s+QueryClient\(`

### Probe 3 - feature barrel

**Prompt**: "Give the users feature a single entry point so routes can import UserTable, UserDetails and CreateUserForm from one module."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:export\s+(?:\*|\{[^}]*\})\s+from\s+["'](?:\./|@/features/))`

### Probe 4 - top-level type folder

**Prompt**: "Create a reusable EmptyState component and a useDebounce hook for the app. Give the file paths."

**Fixture**: scaffold

**Wrong answer**: `src\/(?:components|hooks|utils|types|lib)\/[\w-]+\.tsx?`

### Probe 5 - PascalCase file name

**Prompt**: "Add an OrderStatusBadge component to the orders feature of our React app and show its file path."

**Fixture**: empty

**Wrong answer**: `features/orders/[A-Z]\w*\.tsx`

### Probe 6 - provider in main.tsx

**Prompt**: "Wrap the whole app in a new PreferencesProvider. Show the change."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:<\w+Provider[^>]*>\s*<RouterProvider)`

### Probe 7 - server data in a Context

**Prompt**: "The header and the user page both show the signed-in user's name from GET /users/{id}. Put the user somewhere both can read it."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:createContext|useState)<\s*(?:UserResponse|User)\b[^>]*>\s*\()|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\bcreate<[^>]*User[^>]*>\s*\(\s*\))`

**Right answer**: `useSuspenseQuery\(\s*getGetUserSuspenseQueryOptions\(`

### Probe 8 - feature imports app

**Prompt**: "UserAvatar in src/features/users/user-avatar.tsx needs the API origin to build `${origin}/users/${id}/avatar`. Write the file."

**Fixture**: scaffold

**Wrong answer**: `from\s+["']@\/app\/[^\x60]*?export\s+(?:function|const)\s+UserAvatar\b`

### Probe 9 - zustand object selector

**Prompt**: "The toolbar needs both zoom and selectedIds from useBoardStore in src/features/board/board-store.ts. Write the Toolbar component."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:=|return)\s*useBoardStore\(\s*\(?\s*\w+\s*\)?\s*=>\s*\(\s*\{)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:=\s*useBoardStore\(\s*\))`

### Probe 10 - a second waiting add-on

**Prompt**: "Our src/main.tsx renders after `startKeycloak(settings).then(render, startFailed)` (the Keycloak add-on). Combine the i18next add-on with it: `createI18n(language)` in src/app/i18n.ts returns `{ i18n, ready }`, and the first screen must render in its language. Show the new src/main.tsx."

**Fixture**: scaffold

**Wrong answer**: `(?:^|\n)\s*(?:await\s+)?ready\s*\.then\(|\.catch\(\s*reportError\s*\)\s*;?\s*(?:\n|$)`

**Right answer**: `Promise\.all\(\s*\[`
