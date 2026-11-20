# tanstack-query-api

### Triggering

**Should load**

1. "the backend added a sessions endpoint to its openapi doc, how do I get it into our client?"
2. "tsc: error TS2379 ... is not assignable to parameter of type 'QueryExecuteOptions<...>' with 'exactOptionalPropertyTypes: true' when I spread getListUsersSuspenseQueryOptions into queryClient.query in my loader"
3. "after I create a user and go back, the users list still shows the old rows until I hit reload"
4. "my editor strikes through ensureQueryData and prefetchQuery, what replaces them in TanStack Query 5?"
5. "when saving fails, show the ApiError request id in the toast instead of the raw backend text"
6. "make a newly added user show up in the list right away, before the POST finishes"
7. "why does orval.config.ts set includeHttpResponseReturnType false and shouldSplitQueryKey true?"
8. "the API returns price as \"12.50\", a string. should I turn it into a number when it arrives?"
9. "replace the Previous/Next pagination on /users with a Load more button"

**Should not load**

1. "add a `?q=` search filter to the /users route and validate it with zod in validateSearch" -> `tanstack-router-spa`
2. "show the 422 field errors from the backend under the matching inputs of the create-user form" -> `frontend-forms`
3. "write a route test for /users that stubs the list endpoint with MSW and asserts the table rows" -> `frontend-testing`
4. "on a 401 refresh the Keycloak token, and send the user to the login page when that fails" -> `keycloak-spa-auth`
5. "patch the cached users list when a Centrifugo message says a user was renamed" -> `frontend-realtime`
6. "the users table re-renders on every keystroke in the search box, make it cheaper" -> `vercel-react-best-practices`
7. "staging calls a different API origin, add it to the CSP connect-src" -> `frontend-deploy`

### Eval 1 - quick-add mutation that refreshes the list

**Prompt**: "Add a 'Quick add' button on the users list page that creates a user named 'New user' with a random example.com email through the API, and make the list show it afterwards."

**Fixture**: scaffold

**Must produce**:

- `useMutation(getCreateUserMutationOptions(...))` from `@/api/generated/api`
- an `onSuccess` that returns `client.invalidateQueries({ queryKey: getListUsersQueryKey() })`, taking `client` from the callback's fourth argument
- the button disabled while the mutation `isPending`
- errors left to the MutationCache toast, or shown with words chosen in the UI plus `requestId`

**Must not produce**:

- a direct `fetch` or `apiFetch("/users", ...)` call
- a hand-written key such as `queryKey: ["users"]`
- `useQueryClient()` used only to invalidate
- an `onSuccess` that calls `invalidateQueries` without returning or awaiting it
- `retry` set on the mutation
- `error.message` rendered to the user

### Eval 2 - a new endpoint on the user page

**Prompt**: "The backend is adding `GET /users/{id}/sessions` (operationId `list_user_sessions`) returning `{ items: Session[] }`, and I'll copy their updated OpenAPI document into openapi.json. Write the frontend side: show the user's sessions under the details on the user page."

**Fixture**: scaffold

**Must produce**:

- `pnpm format` and `pnpm api:generate` named as the steps after copying the document, with `src/api/generated/` committed together with `openapi.json`
- the loader filling the cache with `queryClient.query({ ...getListUserSessionsQueryOptions(...), staleTime: "static" })`
- the user and the sessions fetched in parallel in the loader (`Promise.all`)
- the component reading with `useSuspenseQuery(getListUserSessionsSuspenseQueryOptions(...))`

**Must not produce**:

- a hand edit of `src/api/generated/api.ts`
- `ensureQueryData`, `prefetchQuery` or `fetchQuery`
- a hand-written `queryFn` or `queryKey` for the sessions
- a `useEffect` that fetches
- a zod `.parse` of the response

### Eval 3 - an error users can quote

**Prompt**: "Support keeps asking which request failed. Whenever an API call fails in the app, users should see something they can paste into a ticket."

**Fixture**: scaffold

**Must produce**:

- `ApiError.requestId` shown to the user
- narrowing with `error instanceof ApiError`
- the existing `notify` that `createAppRouter` passes to `createQueryClient` (titles in `NOTICES`) and `RouteError` named as the places that already show it
- a note that a cross-origin backend must list `x-request-id` in `Access-Control-Expose-Headers` for the header fallback to work

**Must not produce**:

- `error.message` rendered to the user
- a new error class such as `HttpError` or `NetworkError`
- narrowing on the generated `ErrorBody` type
- a `console.error` call

### Eval 4 - load more instead of pages

**Prompt**: "Replace the Previous/Next pagination on /users with a 'Load more' button that appends the next 20 users."

**Fixture**: scaffold

**Must produce**:

- `infiniteQueryOptions` (or `useSuspenseInfiniteQuery`) around the generated `listUsers` with the query's `signal`
- `getNextPageParam` computing the next `offset` from `offset + limit < total`
- a key that starts with `getListUsersQueryKey(...)`, so the create-user invalidation still reaches it
- `fetchNextPage` behind the button, disabled while `isFetchingNextPage` or without `hasNextPage`

**Must not produce**:

- `useInfinite: true` added to `orval.config.ts`
- `fetchInfiniteQuery`, `prefetchInfiniteQuery` or `ensureInfiniteQueryData`
- a `useState` array that accumulates pages fetched in an effect

### Probe 1 - deprecated loader read

**Prompt**: "In our TanStack Router 1 + TanStack Query 5.107 app, orval generated getGetOrderQueryOptions(id) and getGetOrderSuspenseQueryOptions(id). Write the loader for /orders/$orderId so the order is in the Query cache before the page renders."

**Fixture**: empty

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\.(?:ensureQueryData|prefetchQuery|fetchQuery)\(\s*[\w{])`

**Right answer**: `queryClient\.query\(\s*\{\s*\.\.\.getGetOrderQueryOptions\(`

### Probe 2 - suspense options in a loader

**Prompt**: "In our TanStack Router 1 + TanStack Query 5.107 app, orval generated getGetOrderQueryOptions(id) and getGetOrderSuspenseQueryOptions(id). The order page component reads useSuspenseQuery(getGetOrderSuspenseQueryOptions(orderId)). Write its loader so loader and component share the same query options."

**Fixture**: empty

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\.query\(\s*(?:\{\s*\.\.\.)?get\w+SuspenseQueryOptions\()`

**Right answer**: `\.query\(\s*\{\s*\.\.\.getGetOrderQueryOptions\(`

### Probe 3 - hand-written key

**Prompt**: "After the bulk user import finishes, refresh everything about users that is cached."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:queryKey:\s*\[\s*["'`]\/?users)`

**Right answer**: `getListUsersQueryKey\(\s*\)`

### Probe 4 - invalidation not returned

**Prompt**: "In a new useCreateUserMutation hook, refresh the users list once the user is created."

**Fixture**: scaffold

**Wrong answer**: `onSuccess(?::\s*(?:async\s*)?\([^)]*\)\s*=>\s*|\s*\([^)]*\)\s*)\{\s*(?:void\s+)?[\w.]*invalidateQueries\(`

### Probe 5 - client from the callback context

**Prompt**: "Write a hook that wraps the generated create-user mutation and invalidates the users list on success."

**Fixture**: scaffold

**Wrong answer**: `const\s+\w+\s*=\s*useQueryClient\(\)`

### Probe 6 - backend message on screen

**Prompt**: "Show an error under the Save button of the rename dialog when the request fails."

**Fixture**: scaffold

**Wrong answer**: `\{\s*[\w.]*(?:[eE]rror|\berr)\??\.message\s*\}`

### Probe 7 - fetch outside the client

**Prompt**: "The user details panel needs the user's data; add the call that loads it by id."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\bfetch\(\s*[\x60"\x27][^\x60"\x27]*\/users)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:from\s+["\x27]axios["\x27])|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\baxios\.(?:get|post|create)\()|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\bapiFetch(?:<[^>]*>)?\(\s*[\x60"\x27]\/users)`

**Right answer**: `getGetUser(?:Suspense)?QueryOptions\(`

### Probe 8 - parsing an own-backend response

**Prompt**: "Make sure the users list the API returns has the right shape before we render it."

**Fixture**: scaffold

**Wrong answer**: `(?:=|=>|return|\()\s*(?:\w+\.)?(?:ListUsersResponse|GetUserResponse|CreateUserResponse)\.(?:parse|safeParse)\(`

### Probe 9 - retrying a write

**Prompt**: "Creating a user sometimes fails on flaky hotel wifi. Make the create-user call retry by itself."

**Fixture**: scaffold

**Wrong answer**: `(?:mutations?:\s*\{|useMutation\(\s*\{)[^}]*\bretry:\s*(?:[1-9]|true|\()`

### Probe 10 - deferred read in a loader

**Prompt**: "In the /users/$userId loader, also start loading the user's audit log, but don't make the page wait for it. orval generated getListUserAuditQueryOptions(userId)."

**Fixture**: scaffold

**Wrong answer**: `\.prefetchQuery\(|await\s+(?:context\.)?queryClient\.query\(\s*(?:\{\s*\.\.\.)?get\w*Audit\w*Options`

**Right answer**: `void\s+(?:context\.)?queryClient\s*\.query\([\s\S]*?\.catch\(\s*\(\)\s*=>\s*undefined\s*\)`

### Probe 11 - null query parameter

**Prompt**: "The backend added an optional, nullable `q` name filter to GET /users and the orval client is regenerated with it in `ListUsersParams`. Clear the name filter on /users by sending q as null to listUsers."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\b(?:listUsers|get\w*ListUsers\w*(?:QueryOptions|QueryKey))\(\s*\{[^}]*\bq:\s*(?:null|undefined)\b)`

### Probe 12 - stale list after a write

**Prompt**: "On the order detail page, 'Mark as shipped' saves the order and invalidates the order lists. When the user clicks Back, the list shows the old status for a moment before it updates. Make Back show the new status straight away."

**Fixture**: scaffold

**Wrong answer**: `refetchType:\s*["']all["']|staleTime:\s*0\b`

**Right answer**: `removeQueries\(\s*\{[^}]*type:\s*["']inactive["']|setQueriesData\(`
