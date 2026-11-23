# tanstack-router-spa

### Triggering

**Should load**

1. "add a page at /users/$userId/activity that loads the user's activity from the API"
2. "the page number on the users list should survive a reload and be shareable, put it in the URL"
3. "why does `?q=42` come back as a number in my search route? the zod schema throws it away"
4. "the build prints `[tanstack-router] These exports from src/routes/settings.tsx will not be code-split`, what does it want from me?"
5. "redirect signed-out users away from everything under /admin with beforeLoad"
6. "GET /users/{id} answering 404 shows the generic error page instead of 'User not found'"
7. "use a custom dialog with useBlocker instead of window.confirm when leaving the page"
8. "the Users nav link stays highlighted on /users/new, how do I make it exact?"
9. "after deleting a user and going back to /users the deleted row is still there for a moment, the loader uses staleTime static"
10. "the /reports page takes three seconds to load, should it get a pendingComponent or is the progress bar enough?"

**Should not load**

1. "add a delete button for a user that refreshes the users list afterwards" -> `tanstack-query-api`
2. "map the 422 field errors from POST /users onto the form fields" -> `frontend-forms`
3. "write a test for /users that checks the second page is requested from the API" -> `frontend-testing`
4. "after a 401 the app should send the user to the Keycloak login once, not in a loop" -> `keycloak-spa-auth`
5. "turn autoCodeSplitting off under Vitest and change routeFileIgnorePattern in vite.config.ts" -> `frontend-tooling`
6. "should the users table component live under routes or features?" -> `frontend-project-structure`
7. "the active nav link should use the accent colour token" -> `tailwind-base-ui`

### Eval 1 - search params for a filtered list

**Prompt**: "The backend now accepts `q` (free-text name search) and `sort` (`name` or `-created_at`) on GET /users, and the orval client is regenerated with them in `ListUsersParams`. Add a search box and a sort select to the /users page."

**Fixture**: scaffold

**Must produce**:

- the `searchSchema` in `src/routes/users/index.tsx` extended with `q` and `sort`, each `.optional().catch(undefined)`
- `q` declared with `z.coerce.string()`
- `sort` declared with `z.enum(...)`
- `loaderDeps` adding `q` and `sort` to the API params only when set (`...(search.q !== undefined && { q: search.q })`)
- the loader still calling `loadQuery(context.queryClient, getListUsersQueryOptions(deps))`
- the filter write going through `navigate({ search: (prev) => ({ ...prev, ... }) })` or `<Link search>` with `page: undefined`
- the pagination links and the loader's past-the-end redirect keeping `q` and `sort` with a search updater (`search: (prev) => ({ ...prev, page })`)
- the search box as an uncontrolled input with `defaultValue` from the URL's `q` and a `key` on it or its form
- the search text trimmed on submit, and that navigation using `replace: true`
- the current values read with `Route.useSearch`

**Must not produce**:

- `useState` holding `q`, `sort` or `page`
- `q: z.string()` without coercion
- `.trim()` on `q` in the search schema
- an input whose `value` is the URL's `q`, navigating on every change
- `.default(` in the search schema
- `zodValidator` or `@tanstack/zod-adapter`
- a read of `window.location.search` or `URLSearchParams`

### Eval 2 - a detail route with two resources

**Prompt**: "Add /teams/$teamId showing a team and its members. orval already generated `getGetTeamQueryOptions(id)`, `getGetTeamSuspenseQueryOptions(id)`, `getListTeamMembersQueryOptions(id)` and `getListTeamMembersSuspenseQueryOptions(id)`. An unknown team id (404) should show a 'Team not found' page with a link back to /users."

**Fixture**: scaffold

**Must produce**:

- a new file `src/routes/teams/$teamId.tsx` with `createFileRoute("/teams/$teamId")`
- a loader that starts both queries inside `Promise.all`, each `loadQuery(context.queryClient, getGetTeamQueryOptions(params.teamId))` or its members counterpart, with `loadQuery` from `@/shared/lib/load-query`
- an `ApiError` with status 404 turned into `throw notFound()`, other errors rethrown
- a malformed `teamId` turned into `notFound()` before any request when orval generated a `GetTeamParams` schema, or the answer saying it checked and found none
- a `notFoundComponent`
- the page and not-found components as unexported functions
- a `<title>` rendered by the page component and by the not-found component
- the component reading data with `useSuspenseQuery(get...SuspenseQueryOptions(teamId))`

**Must not produce**:

- `export function` for a component in the route file
- two `await` calls for the team and the members one after the other
- `Route.useLoaderData()`
- `staleTime: "static"` or `ensureQueryData` in the loader
- a `useEffect` that fetches
- a 404 rendered by checking the error inside the page component
- an `errorComponent` on the route
- an edit to `src/routeTree.gen.ts`

### Eval 3 - a signed-in guard

**Prompt**: "Only signed-in users may open /reports and /settings. The router context already has `session` with `session.isSignedIn(): boolean` (typed on the root route). Signed-out visitors go to `/`."

**Fixture**: scaffold

**Must produce**:

- a pathless layout route file such as `src/routes/_signed-in.tsx`
- its `beforeLoad` reading `context.session` and calling `throw redirect({ to: "/" })`
- the reports and settings routes moved under the layout's folder (`src/routes/_signed-in/reports.tsx`), keeping their URLs
- `createFileRoute` ids prefixed with the layout's name for the moved files (`/_signed-in/reports`)

**Must not produce**:

- a `useEffect` that calls `navigate` when signed out
- a wrapper component such as `<RequireAuth>` around page content
- the same check repeated in each route's `beforeLoad`
- an edit to `src/routeTree.gen.ts`
- a module-level session import inside the route instead of `context.session`

### Eval 4 - the entry budget fails after a new page

**Prompt**: "`pnpm build` fails with `entry + static imports: 168424 B gzip (budget 160000 B)` since I added src/routes/settings.tsx. It exports `SettingsPage` because a test imports it, and its loader and component both import from `@/features/settings`. Fix it."

**Fixture**: scaffold

**Must produce**:

- the `export` removed from `SettingsPage`, with the test rendering the route through the router instead of importing the component
- the loader's and the component's imports pointed at their own files instead of the `@/features/settings` barrel
- an explanation that `autoCodeSplitting` keeps exported components and barrel-shared modules in the entry chunk

**Must not produce**:

- a raised budget in `vite.config.ts`
- `createLazyFileRoute` or a `settings.lazy.tsx` file
- `React.lazy` around the page component
- manual chunks in the Vite config

### Eval 5 - a slow first load

**Prompt**: "Opening /reports directly takes about three seconds before the data arrives. What does the user see meanwhile, and should the route get a pendingComponent? Also tidy src/routes/__root.tsx while you are there."

**Fixture**: scaffold

**Must produce**:

- the header, the navigation and the "Loading page" progress bar show during a first load, because `__root.tsx` renders the layout as the root's `shellComponent` and makes the root pending on a first load with an empty `beforeLoad` and `pendingComponent: () => null`
- the root's `shellComponent`, `beforeLoad`, `pendingComponent`, `pendingMs: 0` and `pendingMinMs: 0` kept as they are
- a route's own `pendingComponent` shows only on a later navigation, so it is added only when a skeleton serves better than the previous page

**Must not produce**:

- a claim that a first load shows a blank page
- the root's empty `beforeLoad` removed as dead code
- the layout moved from `shellComponent` into the root's `component`
- `defaultPendingComponent` in `createAppRouter`

### Probe 1 - exported page component

**Prompt**: "Create a /about route with a simple About page component; I want to reuse the page component in a Storybook-like harness later."

**Fixture**: scaffold

**Wrong answer**: `createFileRoute\([^\x60]*?export\s+(?:function|const)\s+\w*Page\b|export\s+(?:function|const)\s+\w*Page\b[^\x60]*?createFileRoute\(`

### Probe 2 - route import in a feature

**Prompt**: "UserTable in src/features/users/user-table.tsx should highlight rows on the current page number from the URL. Read the page inside UserTable."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:from\s+["']@\/routes\/)`

**Right answer**: `getRouteApi\(|\bpage=\{|\.useSearch\(`

### Probe 3 - page in component state

**Prompt**: "Add pagination to a new /audit-log list page: Previous and Next buttons, 20 rows per page, using the generated list query."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:const|let)\s+\[\s*(?:page|pageIndex|currentPage|offset|cursor)\w*\s*,\s*set\w+\s*\]\s*=\s*useState)`

### Probe 4 - free-text search value

**Prompt**: "Add an optional `q` search param to /users for a name filter, validated with zod."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?<=(?:^|\n|[{,])\s*)\bq\s*:\s*z\s*\.\s*string\(\)`

**Right answer**: `z\.coerce\.string\(\)`

### Probe 5 - loader data instead of the cache

**Prompt**: "On /users/$userId, read the user the loader already fetched instead of fetching it again in the component."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:=\s*Route\.useLoaderData\()`

### Probe 6 - validator adapter

**Prompt**: "Add a `tab` search param (profile or activity) to /users/$userId, validated with zod, falling back to profile when the value is invalid."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:validateSearch:\s*zodValidator\()|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:from\s+["\x27]@tanstack\/zod-adapter["\x27])|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\bfallback\(\s*z\.)`

### Probe 7 - guard in an effect

**Prompt**: "Send users who are not signed in from /settings to the home page. `context.session.isSignedIn()` exists on the router context."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:useEffect\(\s*\(\)\s*=>\s*\{[^}]*navigate\()`

**Right answer**: `throw\s+redirect\(`

### Probe 8 - legacy blocker signature

**Prompt**: "While a CSV export is running on /reports, ask before the user navigates away, with our own ConfirmDialog instead of window.confirm."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:useBlocker\(\s*\{\s*(?:blockerFn|condition)\s*:)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:useBlocker\(\s*\(\)\s*=>)`

**Right answer**: `withResolver:\s*true`

### Probe 9 - split route files

**Prompt**: "The /users/new page pulls the form library into the main bundle. Lazy-load that route's component."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:createLazyFileRoute\(\s*["\x27])|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\b(?:React\.)?lazy\(\s*\(\)\s*=>\s*import\()`

### Probe 10 - redundant error component

**Prompt**: "Add a /users/$userId/activity route that loads the user's activity with the generated query options. A failed request must show an error screen with a retry button."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:errorComponent\s*:\s*RouteError\s*[,\n}])`

### Probe 11 - a child URL with its own page

**Prompt**: "Add a page of its own at /users/$userId/settings, not shown inside the user detail page, with a Settings heading. Leave the detail page as it is."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:createFileRoute\(\s*["\x27]\/users\/\$userId\/settings["\x27])|routes\/users\/\$userId_\.settings\.tsx|routes\/users\/\$userId\/index\.tsx`

**Right answer**: `\$userId_\/settings`

### Probe 12 - loader read that ignores invalidation

**Prompt**: "Add a /teams page whose loader puts the generated `getListTeamsQueryOptions()` into the Query cache before the page renders."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:staleTime:\s*["\x27]static["\x27])|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\bensureQueryData\()`

**Right answer**: `loadQuery\(`
