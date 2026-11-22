# Pressure tests

The record that justifies the rules in each skill's `## Important` block and Red Flags table: what
an agent gets wrong without the plugin and right with it. Update it when the eval suite is run
again (`make evals`, or a run like the one below), and when a rule is added or removed on the
strength of a case.

## Run of 2026-11-20

Not a `claude plugin eval` run. Every `Eval` and `Probe` prompt in `evals/*.md` (198 cases) was
answered twice by Claude Opus subagents inside one authoring session: once with no skill available
and once with the fourteen descriptions listed and the skill files readable on demand. Both arms
could read the template app for a `scaffold` case; neither could run code. Probes were graded by
their regexes and every non-pass was then read by a grader; evals were graded line by line by a
grader that saw both answers.

| Skill | Evals passed without | Evals passed with | Probes failed without | Probes failed with |
| --- | --- | --- | --- | --- |
| `frontend-code-style` | 2 of 4 | 3 of 4 | 0 | 0 |
| `frontend-project-structure` | 1 of 5 | 5 of 5 | 0 | 0 |
| `frontend-tooling` | 1 of 6 | 5 of 6 | 1 | 0 |
| `tanstack-router-spa` | 3 of 4 | 4 of 4 | 1 | 0 |
| `tanstack-query-api` | 1 of 4 | 4 of 4 | 4 | 0 |
| `frontend-forms` | 0 of 3 | 3 of 3 | 0 | 0 |
| `tailwind-base-ui` | 1 of 4 | 3 of 4 | 0 | 0 |
| `frontend-testing` | 1 of 3 | 3 of 3 | 1 | 0 |
| `frontend-deploy` | 1 of 4 | 4 of 4 | 1 | 1 |
| `keycloak-spa-auth` | 0 of 4 | 3 of 4 | 3 | 0 |
| `frontend-i18n` | 2 of 4 | 4 of 4 | 0 | 0 |
| `frontend-realtime` | 0 of 3 | 3 of 3 | 1 | 0 |
| `frontend-scaffolding` | 0 of 4 | 4 of 4 | 5 | 0 |
| `frontend-shared-packages` | 1 of 4 | 4 of 4 | 3 | 0 |
| **All** | **14 of 56** | **52 of 56** | **20 of 142** | **1 of 142** |

The four evals the with-arm did not pass, and the one probe:

- `frontend-code-style` Eval 1: not gradable in this run; the harness cut the prompt at its code
  block, in both arms.
- `frontend-tooling` Eval 1: the answer treated a request that named a version inside the cooldown
  as the user's confirmation. The skill now says it is not.
- `tailwind-base-ui` Eval 1: both arms built the confirmation on `AlertDialog`, which is correct;
  the eval line was too narrow and now accepts it.
- `keycloak-spa-auth` Eval 1: the skill gave a fixed number for the entry budget where the eval
  asked for the growth the build reports. Skill and eval now say the same.
- `frontend-deploy` Probe 3: the answer added a sanitizer and loosened Trusted Types unasked. The
  skill now makes text or React elements the default answer.

Besides the cases, one agent built an orders feature (list with URL filters, detail with a status
change, a form with line items, route tests and an end-to-end spec) in a copy of the template by
following the skills. Its gate passed: `pnpm check`, the production build inside the entry budget,
`pnpm test:e2e`, no drift after `pnpm api:generate`. What it found false or missing was fixed in
the skills afterwards: form default values typed with `z.input`, what invalidation does to a list
that is off screen, the route file for a page under a detail page.

Limits of this run: one model; the baseline could read the template, which already shows most
conventions, so the difference a skill makes in a project built differently is larger than these
numbers; the subagents also saw this repository's `AGENTS.md`, which states the three cross-skill
contracts; triggering was not measured (the with-arm chose skills from the descriptions, but a
real harness decides differently); the eval files changed after the run, so the tables below
describe the cases as they were.

## Per case

### frontend-code-style

| case | without | with | note |
| --- | --- | --- | --- |
| E1 | fail (6 of 6 produce lines) | fail (6 of 6 produce lines) | Neither arm received the code block: without "You didn't attach the file or the output", with "No file came with the message". Both gave a generic table of fixes and asked for the file. Not gradable; eval-delivery defect 1. |
| E2 | fail (2 of 12 lines) | pass | without renders `{importing.error.message}` (fixed-copy line) and shows no `requestId` (requestId line). with: `ImportFailedError` with `override name`, fields in the body, `{ cause }`, `failureText` built from row, count and `cause.requestId`, mutation `meta: { silent: true }`, no `reportError`. |
| E3 | pass | pass | Both: union, `<DensityContext value>`, `use()` in a throwing hook, compiler named, named exports. with provides the value from `createAppRouter({ density })`, without a stateful provider. |
| E4 | pass | pass | Near-identical: module-level `Map<string, Intl.NumberFormat>` cache, `` `${number}` `` guard, reuse of `formatDateTime`. |
| P1-P2, P5-P7, P9-P11 | pass | pass | regex only, not read |
| P3 | pass | pass | same: both skip `useMemo` and name the compiler. with adds that the filter reruns under uncompiled Vitest and that `filter` returns a copy. |
| P4 | pass | pass | with better by house rules: it reports the unshown failure with `.catch(reportError)`. without reports and also shows "Could not copy the id", so the failure goes both to `reportError` and to the screen, which SKILL.md:57 forbids. The regex cannot see the double path. |
| P8 | pass | pass | different, neither clearly better: without uses `.catch(() => undefined)` with a reason comment ("reporting it would flood the error tracker"). with uses `.catch(reportError)` as SKILL.md:55 says, which sends every ad-blocked ping to the tracker (skill defect 1). The regex misses without's empty catch because a comment sits inside `.catch(`. That catch is allowed (it has a reason), so this is not a regex defect. |
| P12 | pass | pass | Prompt truncated at the code fence in both arms, as in E1. without invented a target (`create-user-form.tsx`) and rewrote it. with refused to guess and gave a rewrite table per pattern. with better: it did not edit a file it never saw. |
| P13 | pass | pass | same: both use `!== undefined` spreads and explain why `&&` drops `false` and `0`. |

Both arms pass in the same way (rules a current model already follows): E3, E4, P3, P13 (read). By regex only, both arms pass: P1, P2, P5, P6, P7, P9, P10, P11.

### frontend-project-structure

| case | without | with | note |
| --- | --- | --- | --- |
| E1 | pass | pass | Nearly identical answers: `features/orders/order-table.tsx` and `order-details.tsx`, the `$orderId` route composing `OrderDetails` and `UserDetails`, and `pagination.ts` moved to `shared/lib` as its second consumer. |
| E2 | fail (1 of 7 lines) | pass | without adds `apiUrl()` to `@/api/fetcher` instead of passing the origin as a prop or argument: "`import { apiUrl } from "@/api/fetcher";`". That fix is valid for the layers (see eval defect 1). with takes `apiOrigin` as a prop and the route passes `env.apiOrigin`. |
| E3 | fail (4 of 7 lines) | pass | without builds a module-level `useSyncExternalStore` store with `let compact = readStored();`: no Context, no `Wrap`, no `<X value>`/`use()`, and a module-level mutable variable. with: Context and hook in `shared/hooks/use-preferences.ts`, provider in `src/app/`, mounted in `Wrap`. |
| E4 | fail (3 of 8 lines) | pass | without: no zustand ("No new dependency for this"), the store is `editor-store.ts` rather than `<domain>-store.ts`, and the test has no `setState(initial, true)` reset. Its Context carries a stable store instance, not the changing state, so the must-not line about a Context provider holds. with: `pnpm add zustand`, `diagram-store.ts`, single-value selectors, `afterEach(() => useDiagramStore.setState(initialDiagramState, true))`. |
| E5 | fail (1 of 9 lines) | pass | without leaves `startFailed` out of the file it says it shows ("`settings` and `startFailed`: unchanged from your current main.tsx"), so the line about reporting the error and rendering a static message is not shown. with writes `startFailed` with `reportError(error)` and a static `<p role="alert">`. |
| P1, P3, P5, P8, P9 | pass | pass | regex only, not read |
| P2 | pass | pass | same: both refuse the export, add a `queryClient` parameter, and pass `useQueryClient()` or `context.queryClient`. |
| P4 | pass | pass | same paths (`shared/ui/empty-state.tsx`, `shared/hooks/use-debounce.ts`). with also says code starts in the feature until a second consumer. |
| P6 | pass | pass | same: both put the provider in `Wrap` between `QueryClientProvider` and `ToastProvider`. |
| P7 | pass | pass | same verdict (Query cache, no Context). without adds a root loader that makes every route wait for the user. with uses a non-suspending `useQuery` in a header component. Both are acceptable. |
| P10 | pass | pass | with better: it writes a complete `startFailed` (reports the error, renders a static message, never redirects). without leaves `settings` and `startFailed` undefined in the "new src/main.tsx" it was asked to show. |

Both arms pass in the same way (rules a current model already follows): E1, P2, P4, P6 (read). By regex only, both arms pass: P1, P3, P5, P8, P9.

### frontend-tooling

| case | without | with | note |
| --- | --- | --- | --- |
| E1 | fail (1 of 8 lines) | fail (1 of 8 lines) | without's removal comment has a placeholder, not a date: "`# TODO: remove after <release date + 3 days>`". It does recommend waiting first and makes the exception conditional. with makes the exception without asking: "You said you need 8.0.0 now, so I'm treating that as your confirmation". The reference says "ask; never assume it" (skill defect 1). with's date (2026-11-23) is correct. |
| E2 | fail (1 of 8 lines) | pass | without never says that `pnpm approve-builds` writes to `permissions`. Both choose `sharp: false` after reading what the install script does. |
| E3 | fail (1 of 5 lines) | pass | without verifies with `pnpm exec biome check`, not `pnpm check`. Both keep the existing `files.includes` and rely on `.gitignore` for `dist` (see eval defect 1). |
| E4 | pass | pass | Same tsconfig, `./src/*`, and `resolve.tsconfigPaths` named. with adds the other TS5102/TS5108 keys and TS2882. |
| E5 | fail (1 of 7 lines) | pass | without verifies with `pnpm exec biome check`. The config is the same in both. with also explains `satisfies never` and `suppressions/unused`. |
| E6 | fail (1 of 5 lines) | pass | without runs `pnpm knip`, not `pnpm check`. Its design is arguably cleaner: it changes the `knip` script to `knip && knip --production`, so `pnpm check`, both CI files and the hook pick it up from one place. with adds the step to `check` and to both CI `check` jobs. |
| P5 | WRONG | pass | Real mistake: without runs `pnpm add date-fns@4`, which writes `^4.x` despite `saveExact` (package-and-pnpm.md:155). with runs a bare `pnpm add date-fns` and covers the case where v5 has already matured. The regex verdict is right. |
| P1, P2, P4 | pass | pass | regex only, not read |
| P3 | pass | pass | same: `rolldownOptions.output.codeSplitting.groups` including `scheduler`. with adds that the split helps only caching. |
| P6 | pass | pass | same: both find the hook already exists, use `pnpm hooks`, avoid `prepare` because it breaks the Docker build, and treat CI as the guarantee. |
| P7 | pass | pass | same: `devEngines` with `onFail: "download"`. with adds `runtime` and the bootstrap command. |
| P8 | pass | pass | without better. Both recommend waiting and then show an exception. without excludes all of vitest's lockstep packages (`@vitest/expect`, `runner`, `snapshot`, `spy`, `utils` and the rest at 5.1.1). with excludes only `vitest@5.1.1` and `@vitest/coverage-v8@5.1.1`, so its install would fail again on `@vitest/runner@5.1.1` and the other internal packages (skill defect 2). with also assumes confirmation: "You've told me the fix is needed now, so here is the exception." |
| P9 | pass | pass | same: `resolve.tsconfigPaths: true`, remove the plugin. |

Both arms pass in the same way (rules a current model already follows): E4, P3, P6, P7, P9 (read). By regex only, both arms pass: P1, P2, P4.

### tanstack-router-spa

| case | without | with | note |
| --- | --- | --- | --- |
| E1 | fail (3 of 9 must, 2 of 7 must-not) | pass | without: `q: z.string().trim().min(1).optional().catch(undefined)` (no coercion: fails "q declared with z.coerce.string()", violates "q: z.string() without coercion" and ".trim() on q in the search schema"); search submit `navigate({ search: (prev) => ({ ...prev, q: value \|\| undefined, page: undefined }) })` has no `replace: true` (fails "trimmed on submit, and that navigation using replace: true") |
| E2 | pass | pass | without also adds the `GetTeamParams.safeParse` malformed-id check; with skips it and only mentions it (see defect 2) |
| E3 | pass | pass | without names the layout `_authed` (eval says "such as `_signed-in`"; accepted) |
| E4 | pass | pass | without explains the shared-module mechanism without the word "barrel"; accepted |
| P1 | pass | pass | not reviewed |
| P2 | pass | pass | same: both pass `page` as a prop and give the same reason |
| P3 | pass | pass | not reviewed |
| P4 | WRONG | pass | real: without writes `q: z.string().trim().min(1).max(100)`; `?q=42` is dropped |
| P5 | pass | pass | same: both change nothing and explain the cache vs `useLoaderData` snapshot |
| P6 | pass | pass | not reviewed |
| P7 | pass | pass | with is more invasive, not better: for one route it creates `_signed-in.tsx` and moves `settings.tsx`; without puts `beforeLoad` on the route and suggests the layout when more routes need it. Both correct |
| P8 | pass | pass | with better: `shouldBlockFn` reads `queryClient.isMutating(...)` at navigation time (SKILL.md:133) where without reads the rendered `exportCsv.isPending`; with also notices the repo has no `ConfirmDialog` |
| P9 | pass | pass | not reviewed |
| P10 | pass | pass | same verdict on the error screen; both work around the leaf-page nesting problem differently (see defect 1) |

Both arms pass in the same way (rules a current model already follows): E2, E3, E4, P2, P5, P7, P10 (both arms pass the same way; P1, P3, P6, P9 also pass in both but were not read).

### tanstack-query-api

| case | without | with | note |
| --- | --- | --- | --- |
| E1 | pass | pass | same code; without also navigates to page 1 on success |
| E2 | fail (1 of 4 must) | pass | without: only "```bash\npnpm api:generate\n```"; never says to commit `src/api/generated/` with `openapi.json` |
| E3 | fail (2 of 4 must) | pass | without: no `instanceof ApiError` anywhere; CORS note is "add `x-request-id` to `Access-Control-Allow-Headers`", not `Access-Control-Expose-Headers`. Its client-generated `X-Request-Id` fallback is a reasonable design but sidesteps the line |
| E4 | fail (1 of 3 must-not) | pass | without: `loader: ({ context }) => context.queryClient.ensureInfiniteQueryData(usersInfiniteQueryOptions())` |
| P1 | WRONG | pass | real: `await context.queryClient.ensureQueryData(getGetOrderQueryOptions(params.orderId))` |
| P2 | no-right | pass | real: `context.queryClient.ensureQueryData(getGetOrderSuspenseQueryOptions(params.orderId))`: deprecated call and the suspense options in a loader. The wrong regex only looks for `.query(` |
| P3 | pass | pass | same: both invalidate `getListUsersQueryKey()` from the mutation context |
| P4 | pass | pass | same: both extract the hook and switch the form to it |
| P5 | pass | pass | not reviewed |
| P6 | pass | pass | same: both silent, own copy plus `requestId` |
| P7 | pass | pass | with slightly better: adds the `useQuery` + `enabled` variant for a panel no loader owns (SKILL.md:88) |
| P8 | WRONG | pass | real: without wraps `ListUsersResponse.parse(await listUsers(...))` in a hand-written `queryOptions` and changes the global retry rule to match |
| P9 | pass | pass | same: both refuse, explain duplicate POST, propose `Idempotency-Key` |
| P10 | WRONG | no-right | without real: `void context.queryClient.prefetchQuery(...)`. with correct: `void context.queryClient\n .query(getListUserAuditQueryOptions(params.userId))\n .catch(() => undefined)`; the right regex requires `queryClient.query(` with no whitespace |
| P11 | WRONG | WRONG | both false positives. without matched its prose `` `listUsers({ q: null })` `` and the router `search={{ page: undefined, q: undefined }}`; with matched `search={(prev) => ({ ...prev, q: undefined, page: undefined })}`. Both answers omit `q` from the API params, which is the rule |

Both arms pass in the same way (rules a current model already follows): E1, P3, P4, P6, P9 (both arms pass the same way; P5 passes in both, not read).

### frontend-forms

| case | without | with | note |
| --- | --- | --- | --- |
| E1 | fail (2 of 5 must) | pass | without: `name: CreateUserBody.shape.name.refine((name) => name.trim() !== "", ...)` (no `.trim()` before `.min(1)`); body built by hand, `mutateAsync({ data: { name: value.name, email: value.email } })`, not by parsing the form values |
| E2 | fail (1 of 8 must) | pass | without: `<EditUserForm user={user} onSaved={...} />` with no `key={user.id}`; everything else met, including `formApi.reset(value)` before navigation |
| E3 | fail (1 of 8 must) | pass | without: catch block is `formApi.setErrorMap(...); return;` with no focus move and no `onSubmitInvalid` |
| P1 | pass | no-right | not a real failure: with writes `import { UpdateUserBody } from "@/api/generated/api.zod"; // or CreateUserBody` and `onSubmit: UpdateUserBody`, telling the reader to use `CreateUserBody` if no update schema exists. Eval E2 itself accepts "a regenerated update schema" |
| P2 | pass | pass | with better: branches on `error instanceof ApiError` and names `requestId`; without duck-types `"status" in error` |
| P3 | WRONG | pass | false positive: without calls `formApi.reset(value)` then `await onSaved(saved)`; the lookahead excludes only `.reset()` with empty parens |
| P4 | pass | pass | not reviewed |
| P5 | pass | pass | same: both `!form.state.isDefaultValue` in `shouldBlockFn` and `enableBeforeUnload` |
| P6 | no-right | pass | not a real mistake: without rejects spaces with `.refine((name) => name.trim() !== "")` and keeps what the user typed; it misses only the house preference for a trimmed body |
| P7 | pass | pass | same substance; with renders through Base UI `Field.Error match`, without through hand-written `aria-describedby` |
| P8 | pass | pass | not reviewed |
| P9 | pass | pass | same: both `revalidateLogic()` + `onDynamic`; with's test also pins that an error stays while the value is still invalid |
| P10 | pass | pass | same: both find the existing 409 mapping and change nothing |

Both arms pass in the same way (rules a current model already follows): P5, P7, P9, P10 (both arms pass the same way; P4 and P8 pass in both, not read). Note that the without arm reproduces most house rules because the scaffold's `create-user-form.tsx` already shows them; the lift is in the details (key, focus, trim-before-min, parse for the body).

### tailwind-base-ui

| case | without | with | note |
| --- | --- | --- | --- |
| E1 | fail (3 of 12 lines) | fail (1 of 12 lines) | Both arms wrote `confirm-dialog.tsx` on `@base-ui/react/alert-dialog`, so neither has a `dialog.tsx` on `@base-ui/react/dialog` (line 1). Without also has no `motion-reduce:` (its popup classes stop at `transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0`), and its backdrop is `bg-fg/40`: `fg` is the text role and turns light in dark mode, where the line wanted a new `scrim` token. With adds `scrim` and `motion-reduce:transition-opacity` exactly as `references/wrappers.md` shows. Its only miss is line 1, and that line is an eval defect (see below). |
| E2 | fail (1 of 10 lines) | pass | Without has no hook on `useSyncExternalStore`: it uses `const [theme, setTheme] = useState(readTheme);` inside the component. Its `public/theme.js`, validation and `:root[data-theme]` rules are correct. With adds `useSyncExternalStore`, a `MutationObserver` and cross-tab sync through the `storage` event. |
| E3 | pass | pass | Both add `success`/`warning` as `light-dark()` pairs, a record of complete class strings and `cx`. Without routes the colour through a generic `Badge` variant record. With keeps a status-keyed record in the feature. |
| E4 | fail (3 of 6 lines) | pass | Without uses server paging instead of `virtua` and offers `@tanstack/react-virtual`: "If you really need one continuous scroll, that's `@tanstack/react-virtual`". So it misses `virtua`, misses the sized parent, and breaks the must-not line. Its toast through `Toast.useToastManager` is fine. With uses `VList` inside an `h-96` parent and `Toast.useToastManager()`. |
| P1 | pass | pass | same: both use `border-danger bg-danger/10 text-danger`. With also tells a dead server apart from other errors. |
| P2 | pass | pass | not read, regex only |
| P3 | pass | pass | not read, regex only |
| P4 | pass | pass | With is better: without puts `buttonClass("primary")` straight on `<Link>`, while with builds the kit's `ButtonLink` on `useRender` + `mergeProps`, which is the skill's contract. |
| P5 | pass | pass | not read, regex only |
| P6 | pass | pass | same: both write `public/theme.js` with the two-value check and `:root[data-theme]`. With also adds the `@custom-variant dark` in case `dark:` classes are used. |
| P7 | pass | pass | With is better: without uses `outline-none` (a Tailwind 3 spelling, now `outline-hidden`) and `z-50` on the positioner. With copies the kit's menu: `origin-(--transform-origin)`, enter and exit transitions, `motion-reduce:`. |
| P8 | pass | pass | not read, regex only |
| P9 | pass | pass | same: both use the router's toast manager. With asserts `findByRole("dialog", { name: "Saved" })`, without uses `getByText`. |
| P10 | pass | pass | not read, regex only |

Both arms pass in the same way (rules a current model already follows): E3, P1, P6, P9 (read: same in both arms); P2, P3, P5, P8, P10 pass in both arms by regex, not read.

### frontend-testing

| case | without | with | note |
| --- | --- | --- | --- |
| E1 | pass | pass | Both arms answer almost identically: the handler's data is computed from `offset`, `{ once: true }` comes before the success handler, they check `Page 1 of 2` and `router.state.location.search`, and they extend the existing error test. |
| E2 | fail (3 of 8 lines) | pass | Without: "Use `shouldAdvanceTime: true`" and `vi.useFakeTimers({ shouldAdvanceTime: true })`. It has no `jest` stub, and it writes `await vi.advanceTimersByTimeAsync(5_000);` with no `act`. With uses the `jest` stub, `act(() => vi.advanceTimersByTimeAsync(...))`, and asserts the toast is present at 4 s and gone at 5 s. |
| E3 | fail (1 of 9 lines) | pass | Both arms point to the existing smoke axe test for the detail page and add a test for the failing lookup. Without's new axe run is in one colour scheme only (`await expectNoAxeViolations(page);`, no `emulateMedia`). With loops `light`/`dark` with `page.emulateMedia`. See eval defect 1. |
| P1 | pass | pass | not read, regex only |
| P2 | pass | pass | same: both write `buildUser()` ×N with a consistent envelope and explain why a handler called with no data breaks the pager. |
| P3 | pass | pass | same: both use `onUnhandledFrame: "error"` plus the `request:unhandled` check in `afterEach`. |
| P4 | pass | pass | not read, regex only |
| P5 | pass (regex no-right; false) | pass (regex no-right; false) | Both correctly decline: `new.test.tsx` already asserts that the refetched list shows Ada, and both explain why `getQueryData` is the wrong assertion. The right-answer regex needs new `renderRoute(` code. |
| P6 | pass | pass | same: both say `renderRoute` has no `rootErrorHandlers`, assert `findByRole("alert")`, and point to `error-reporting.test.ts`. |
| P7 | fail (WRONG; real) | pass | Without: `vi.useFakeTimers({ shouldAdvanceTime: true });` and no `jest` stub. That is a real mistake. With uses the `jest` stub, its own `userEvent.setup({ advanceTimers })` and `act`. |
| P8 | pass (regex no-right; false) | pass (regex no-right; false) | Both decline the spec because the smoke journey and the route tests already cover the fields. Neither imports from `@playwright/test`, so the rule under test is never exercised. |
| P9 | pass | pass | same: both add a `test.each` for the branch with no request id through `renderRoute`. |
| P10 | pass | pass | same: both write the same `vi.stubGlobal("reportError", vi.fn())` test. |

Both arms pass in the same way (rules a current model already follows): E1, P2, P3, P5, P6, P8, P9, P10 (read: same in both arms); P1 and P4 pass in both arms by regex, not read.

### frontend-deploy

| case | without | with | note |
| --- | --- | --- | --- |
| E1 | pass | pass | Both arms make all six edits with `wss://`/`ws://` origins, and neither touches `deploy/headers.ts`. With also says why `https://` would fail for a socket and adds a `grep connect-src dist/_headers` check. |
| E2 | fail (1 of 7 lines) | pass | Without never names `pnpm test:e2e`: "Run `pnpm check`. ... a Playwright test is the only place a regression would show". It replaces the sink with allowlisted React elements via `htmlparser2`, with no CSP change. With chooses DOMPurify plus `trusted-types dompurify` in `deploy/headers.ts`, presented as a reviewed decision. That meets the eval's "or" branch, but see skill defect 1. |
| E3 | fail (1 of 10 lines) | pass | Without deploys production with `pnpm exec wrangler deploy`, with no `--env=""`. With matches `references/cloudflare.md`: an inheriting `env.staging` block, `--env=""`, and jobs in both CI files. It keeps `CLOUDFLARE_ACCOUNT_ID` in `vars`, not secrets; I count that as met (see eval defect 2). |
| E4 | fail (2 of 10 lines) | pass | Without has no `omitTraceContextForUnsampledSessions` and its CORS note covers `traceparent` only ("the API's CORS must allow the `traceparent` request header"). Its `getWebInstrumentations()` call also keeps Faro's default console capture, which the literal `captureConsole: true` line does not catch. With copies `references/telemetry.md`, including the `@opentelemetry/api` override. |
| P1 | fail (WRONG; real) | pass | Without uses `VITE_API_BASE_URL` throughout. With uses exact `PUBLIC_API_ORIGIN` with `envPrefix: PUBLIC_ENV` and a check that the value is a bare origin. |
| P2 | pass | pass | With is slightly better: both refuse `'unsafe-inline'`, but with tells `style-src-elem` from `style-src-attr` and gives the grep proof. |
| P3 | pass | fail (WRONG; real) | With: `<div dangerouslySetInnerHTML={{ __html: sanitizeHtml(html) }} />` plus `"trusted-types dompurify"` in `deploy/headers.ts`, and it also loosens the E2E header assertion. Nobody asked for a CSP change, and a route that renders without one exists: without parses the HTML into allowlisted React elements. The regex is right. See skill defect 1. |
| P4 | pass (regex no-right; false) | pass | Without writes its own `webUrl()` with a protocol allowlist, which is correct but not named `safeHref`. The right-answer regex depends on that name, and the scaffold has no `safeHref`. |
| P5 | pass | pass | With is slightly better: both write `sameOriginPath` and tests. With also rejects `/.//evil.example`, which resolves to `//evil.example`. |
| P6 | pass | pass | not read, regex only |
| P7 | pass | pass | same: both refuse the change, explain why `no-cache` is cheap, and point at `public/` files and the CDN. |
| P8 | pass | pass | not read, regex only |
| P9 | pass | pass | With is slightly better: both use `same-origin-allow-popups` with a test. With also checks `event.source === popup` and a Caddy header assertion. |
| P10 | pass | pass | same: both refuse GTM and offer server-side alternatives. |

Both arms pass in the same way (rules a current model already follows): E1, P7, P10 (read: same in both arms); P6 and P8 pass in both arms by regex, not read. P2, P5 and P9 pass in both arms, with a small edge for the with-arm.

### keycloak-spa-auth

| case | without | with | note |
| --- | --- | --- | --- |
| E1 | fail (8 of 21 lines) | fail (1 of 21 lines) | without: `import Keycloak from "keycloak-js"` in `src/main.tsx` (not one `src/app/` module); no `redirectUri`; guard in `src/routes/account.tsx` `beforeLoad` (no pathless layout, account not under one); `PUBLIC_KEYCLOAK_ORIGIN` / `env.keycloakOrigin` instead of `PUBLIC_AUTH_ORIGIN` / `env.authOrigin` (also in playwright env); `await keycloak.init(...)` at top level with no rejection handling; no `ENTRY_BUDGET_BYTES`. with: budget line, "keycloak-js adds about 10 KB gzip to the entry, hence the budget raise from 160 000 to 170 000" (skill's fixed figure, never tied to what `pnpm build` reports). I scored the must-not "fixed target" line clean for both arms: 170_000 has a stated cause and derivation |
| E2 | fail (2 of 12 lines) | pass | without: no sharing of concurrent forced refreshes stated or built (each 401 calls `keycloak.updateToken(-1)`), no limit on forced refreshes (only `signInAgain` is limited to once a minute) |
| E3 | fail (1 of 10 lines) | pass | without: the overnight case is `fakeKeycloak({ sub, refreshed: null })` with no `vi.setSystemTime`. Its fake is passed through `renderRoute`, so the fake-provider line holds |
| E4 | fail (4 of 8 lines) | pass | without: "The signing-out tab announces it, then calls `keycloak.logout()`" (`channel.postMessage(SIGNED_OUT); return keycloak.logout();`): violates the must-not line, and has no post-logout page, no `sessionStorage` flag, and other tabs `location.reload()` instead of going to sign-in |
| P1 | pass | pass | with is better: without adds `onLoad: "check-sso"` (a `prompt=none` redirect on every load, public pages included), which the regex does not check; with keeps no `onLoad` and explains the trade-off |
| P2 | pass | pass | with is better: without still uses `onLoad: "check-sso"`, imports keycloak-js in `main.tsx` and adds no guard; with keeps the skill's whole module set |
| P3 | WRONG (real) | pass | without: `onLoad: "login-required"` in `init`, plus `retryToken` calling `keycloak.login()` on every failed refresh with no loop guard |
| P4 | pass | pass | with is better: without recommends `onLoad: "check-sso"` (redirect form, a round trip on every load); with recommends no `onLoad` and shows the guard |
| P5 | pass | WRONG (false positive) | with only lists `` `keycloak.onTokenExpired = () => keycloak.updateToken()` `` under "Remove any of these if they exist". The regex's `(?<!\x60)` guard sees `.` before `onTokenExpired`, not the backtick |
| P6 | pass | pass | with is better: without says "If you really want 'only when expired', it's `updateToken(0)`", which is false (0 means 5 s); the regex misses it because the call sits in backticks |
| P7 | pass | pass | same verdict. with adds the 60 s loop guard and the refresh limit; without limits only re-logins |
| P8 | pass | pass | with is better: without passes the deep link as `redirectUri` and registers `https://app.example.com/*` (a skill Red Flag); with keeps one exact root URI, stores the path in `sessionStorage` and runs it through `sameOriginPath` |
| P9 | WRONG (real) | pass | without: `session.hasRealmRole("admin") ? <DeleteUserButton …/>` read from token claims |
| P10 | pass | pass | same: both pass a fake into `renderRoute` (a fake keycloak-js object, or `fakeIdentity`), use no `vi.mock`, and assert the recorded return path |
| P11 | WRONG (real) | pass | without: `tabs.postMessage(SIGNED_OUT); return keycloak.logout();`, which broadcasts before the logout lands |

Both arms pass in the same way (rules a current model already follows): P7 (both refuse sign-in on a 403 and send it only after a refused refresh), P10 (both inject a fake identity instead of `vi.mock`). All four evals and P1, P3, P4, P6, P8, P9, P11 show lift.

### frontend-i18n

| case | without | with | note |
| --- | --- | --- | --- |
| E1 | fail (7 of 14 lines) | pass | without: `const i18n = createI18n();` inside `createAppRouter` (not passed in); catalogs from static `import enCommon from "./locales/en/common.json"` (no `import.meta.glob` backend); `initAsync: false`, so `main.tsx` has no init promise and no failure handler; `"check": "… i18next-cli extract --ci && i18next-cli status …"` (no `lint`, no `"@swc/core": false`); no `lint --update-baseline`; no `ENTRY_BUDGET_BYTES`. with: "+20 KB: i18next and react-i18next … Confirm the number with … pnpm build" meets the budget line |
| E2 | pass | pass | same: both use one key for the whole page sentence, `count` with `_one/_few/_many/_other`, `formatDateTime(iso, i18n.language)` and a Russian route test. without picks Russian by stubbing `navigator.languages` instead of a `language` option |
| E3 | pass | pass | same on the eval lines: both branch on status into literal keys, put `{{requestId}}` in the message, and switch the zod locale without touching `jitless`. with also replaces the server's `fieldErrors` sentences with a key; without keeps them and sends `Accept-Language` |
| E4 | fail (1 of 5 lines) | pass | without never runs `pnpm i18n:extract` or `types`, so `resources.d.ts` is not regenerated. It also says an empty Russian value makes "`status` green", which is false: `status` fails on `""` |
| P1 | pass | pass | same: both use one message with `{{name}}` and invent no user source |
| P2 | pass | pass | same: both use `count` on a base key, Russian forms and a test of each form |
| P3 | pass | pass | same: both map each status to a literal `t("status.x")` call checked with `satisfies` |
| P4 | pass | pass | same: both use `components={{ guide: … }}` |
| P5 | pass | pass | same on correctness: both set `fallbackLng: "en"` and `supportedLngs`. with brings the full factory; without uses static catalogs |
| P6 | pass | pass | same: both render real catalogs through `renderRoute` and assert the heading text |
| P7 | pass | pass | same: both map statuses to literal keys and both still pass the server's `fieldErrors` sentences to the fields (see skill defect 1) |
| P8 | pass | pass | with is better: without sets `fallbackLng: false` ("A fallback language would be downloaded alongside every other one"), so a missing Russian key renders as the key. The P8 regex only checks for an HTTP backend. with keeps `fallbackLng: "en"` and the glob backend |
| P9 | pass | pass | same: both take `formatDateTime(iso, language)` and test it in Russian |
| P10 | pass | pass | with slightly better: it runs the extract, write text, extract-again loop and explains why no default value is allowed. without edits the JSON by hand and skips `types` unless keys come from i18next-cli |

Both arms pass in the same way (rules a current model already follows): E2, E3, P1, P2, P3, P4, P5, P6, P7, P9: both arms follow the key, plural, `<Trans>`, test and date rules without the skill. The lift is in the add-on setup (E1), the gate workflow (E4), and `fallbackLng` under lazy loading (P8, not scored by the regex).

### frontend-realtime

| case | without | with | note |
| --- | --- | --- | --- |
| E1 | fail (3 of 11 lines) | pass | without: `.pipeThrough(new EventSourceParserStream())` (no `maxBufferSize`); a `useState` accumulator in a `useEffect` instead of `experimental_streamedQuery` (it aborts on unmount, so the must-not line is clean); `done`/`error` become status text, with no throw and no end on `done`. Seam, MSW `ReadableStream` test and no `EventSource` all held |
| E2 | fail (6 of 18 lines) | pass | without: static `import { Centrifuge … } from "centrifuge"` (no dynamic import); `if (subscribedBefore && !ctx.recovered) gap();` skips the first subscribe's `recovered: false`; the status is `useState` from subscription events (no `state` event or `useSyncExternalStore`); a refused channel sets "Live updates off" but never calls `reportError`; no `protobufjs: false`; tests use an MSW `ws.link` fake Centrifugo instead of `vi.mock("centrifuge")` in setup |
| E3 | fail (2 of 10 lines) | pass | without: no `cancelQueries`; it guards fetches with `structuralSharing: keepNewerOrder` instead. Its test runs the fetch after the push (`applyOrderEvent(...); await queryClient.fetchQuery(...)`), so no fetch is in flight. The approach works only while every fetch of the key passes that option |
| P1 | pass | pass | with is better: without uses `EventSourceParserStream()` with no `maxBufferSize` and a `useState` accumulator; with uses `apiEvents`/`followEvents` with `maxBufferSize`, `Last-Event-ID` and backoff |
| P2 | no-right (regex too strict) | pass | without uses JWT mode (`getToken: async () => { … return token; }` against the IdP's JWKS) with no token in the URL. The skill allows this mode (SKILL.md:52), so the answer is correct |
| P3 | WRONG (real, but a working alternative) | pass | without has no `cancelQueries`; it uses a `structuralSharing` version guard on fetches. That fixes the race only while every query site passes `keepNewerInvoice`, so I count it as a real miss of the rule |
| P4 | pass | pass | with is better: without builds `new Centrifuge` statically (per router, fine) with `useState` for the count and status; with uses a dynamic import, a push-only Query key with `skipToken`, and `LiveStatus` |
| P5 | pass | pass | same: both use `useEffectEvent` with deps `[client, channel]`. without's gap check again skips the first subscribe |
| P6 | pass | pass | with is better: without creates `new WebSocket(url)` inside a hook's `useEffect` with a hand-written `setTimeout` reconnect that retries every close code (skill Red Flags). with builds one module per router, sends auth as the first frame and uses the close-code table |
| P7 | pass | pass | with is better: both invalidate on `recovered: false`, but without only on a resubscribe (`subscribedBefore &&`), missing the loader-to-first-subscribe gap that with names explicitly |
| P8 | pass | pass | same: both use `http.post` with a `ReadableStream` and no `sse()` |
| P9 | pass | pass | same: both put `users` under `channel.namespaces` with history and `force_recovery` |

Both arms pass in the same way (rules a current model already follows): P5, P8, P9: both arms use `useEffectEvent` with `[client, channel]` deps, `http.post` with a `ReadableStream`, and a `namespaces` entry. Every eval and P1, P2, P3, P4, P6, P7 show lift.

### frontend-scaffolding

| case | without | with | note |
| --- | --- | --- | --- |
| E1 | fail (11 of 13 lines) | pass | without: `pnpm create vite@latest . --template react-ts`, hand-written `vite.config.ts`, `pnpm add` with default caret ranges, `VITE_API_URL=http://localhost:8000` instead of `PUBLIC_API_ORIGIN`, no git init, no frozen install, no Playwright, no e2e, no commit ("Not set up: ... CI, pre-commit hooks, git"). with: every line met; it keeps `.env.development` because the template already holds `http://localhost:8000` (see eval defect 3) |
| E2 | fail (6 of 12 lines) | pass | without: `pnpm create vite@latest web`, so no copy, no users-shaped pages, no root-link or e2e rewrite, no `pnpm test:e2e`; it does have a `<title>` per page and generates from the backend document. with: copy, `cp ../backend/openapi.json`, `pnpm api:generate`, `rm -r src/routes/users src/features/users src/test/factories/user.ts`, root links and redirect, stub and smoke rewritten, `pnpm test` before `pnpm check`, keeps the `/users` test data and `text-field`/`format-date` |
| E3 | fail (1 of 6 lines) | pass | without gives a different reason, "vite.config.ts refuses to build without the API origin, because it is baked into the bundle", and never says a build skips `.env.development` (see eval defect 4). It adds a git-ignored `.env.production.local`, not a template edit. with: "A build doesn't read `.env.development`" |
| E4 | fail (2 of 8 lines) | pass | without: `pnpm create vite@latest web`, no `pnpm hooks` and so no hook check; it stages with `git add web .github/workflows/web.yml`. with: says "no pre-commit hook, no `core.hooksPath`", runs `git add web .github/workflows/web.yml`, and moves CI to the root itself (see eval defect 5) |
| P1 | fail (real) | pass | without: `pnpm create vite@latest .` |
| P2 | fail (real) | pass | without: "I don't have a template of my own here", then `pnpm create vite`. The miss is real, though what the probe checks (dotfiles) does not apply to that answer |
| P3 | pass | pass | with is better: it keeps the origin bare (`https://shop.example.com`), names the `is not a bare origin` build error, and says where `/api/v1` goes. without puts the path into `VITE_API_URL` in its own hand-rolled app, which is not wrong there |
| P4 | fail (real) | pass (regex false positive) | without: `pnpm up --latest` on the fresh scaffold. with: green scaffold commit first, then `pnpm update <pkg> --latest` one group at a time in a separate commit under `minimumReleaseAge`, which is what the skill and `frontend-tooling` want. The regex matched that later per-package line (eval defect 1) |
| P5 | fail (real, regex missed it) | pass | without: `pnpm pkg set scripts.prepare="git rev-parse --is-inside-work-tree >/dev/null 2>&1 && pnpm hooks \|\| true"`. The regex looks only for `prek` inside the script (eval defect 2). with refuses the `prepare` script and gives the reason |
| P6 | fail (real) | pass | without keeps the CSP strict (`connect-src 'self' ${api} ${maps}`), but builds from `pnpm create vite` with a hand-written CSP plugin and `VITE_*` variables, so it never reaches the template's `PUBLIC_ENV` seam. with: no loosening, and the six-place `PUBLIC_MAPS_ORIGIN` change through `PUBLIC_ENV` |
| P7 | pass | pass | same: both stage only `web` (with `git add -A .` from `web/`, without `git add web`). with also checks the hooks and warns that CI is dead in `web/.github/` |
| P8 | pass | pass | same on the rule: both run `git init -b main` |

Both arms pass in the same way (rules a current model already follows): P7, P8

### frontend-shared-packages

| case | without | with | note |
| --- | --- | --- | --- |
| E1 | fail (3 of 13 lines) | pass | without: peers keep ranges (`"@base-ui/react": "^1.9.0"`, `"react": "^19.3.0"`), so not every version is in `catalog:`. `@org/api` exports a wildcard `"./*": "./src/*.ts"`, not one subpath per public file, and the kit exports the private `./cx`. `configureApi` is never mentioned. with: every line met; its catalog matches the scaffold's `package.json` exactly, it moves the API into `packages/api`, `configureApi` "stays called from the app's `main.tsx`" and admin keeps its own |
| E2 | fail (8 of 12 lines) | pass | without: Changesets (`pnpm add -Dw @changesets/cli`, `changeset publish`), a "Version packages" PR instead of a `v<version>` tag, no `versioning.fixed`, and a consumer `.npmrc` with `@org:registry=https://npm.example.com/` and `//npm.example.com/:_authToken=${NPM_TOKEN}`. The packages ship `dist/` (not an eval line here). The token is user-level via `setup-node`, which counts as met. with: `versioning.fixed`, `pnpm change`, `pnpm version -r`, the tag job with `pnpm -r publish --no-git-checks`, `echo ... > ~/.npmrc`, consumer `registries` and `minimumReleaseAgeExclude: ["@org/*"]`, exact pins upgraded together |
| E3 | pass | pass | without passes another way: a separate `@org/vite-plugins` package with `publishConfig.exports` to `dist/`, and it says "Other repositories get it from `node_modules`, where Node refuses to strip types". The eval allows that, and the build step is not in ui or api. It also runs `pnpm add @org/vite-plugins@workspace:*` (a Red Flag no E3 line covers). with keeps a copy per app and names `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` |
| E4 | fail (3 of 5 lines) | pass | without: the result is `"lucide-react": "<version pnpm resolved>"` in the kit's `package.json`, and the catalog appears only as "If the workspace keeps versions in a pnpm catalog ...". with: `pnpm --filter @org/ui add lucide-react`, the catalog diff, and `"lucide-react": "catalog:"` in `dependencies`, kit-only, as SKILL.md:91 says |
| P1 | pass | pass | with is better: peers are `"catalog:"`. without keeps `"react": "^19.0.0"` ranges; both have per-file `exports` and no barrel |
| P2 | pass | pass | with is better: catalog peers, and React as a peer for the generated hooks. without keeps ranges and has no `react` peer. Same `exports` map |
| P3 | fail (real against the house rule; prompt-dependent) | pass | without puts the peers in `peerDependencies`, but as `"^19.0.0"` ranges and literal dev versions, adding "If the workspace has a pnpm catalog, use `\"catalog:\"`". The prompt never says the workspace has a catalog (eval defect 2) |
| P4 | fail (real) | pass | without: `pnpm add -Dw @changesets/cli`, `changeset version`. with: nothing to version, because the scaffold has no `packages/`; it names `pnpm change` for later |
| P5 | pass (regex no-right is wrong) | pass | without writes the token user-level both ways (setup-node's user config, or `pnpm config set //npm.example.com/:_authToken '${NPM_TOKEN}' --location user`), so the probed rule holds and the right-answer regex is too narrow (eval defect 1). It does write `@org:registry` and `publishConfig.registry`, which E2 covers |
| P6 | pass | pass | same: both put `@source "./"` in the kit's CSS, imported by each app |
| P7 | fail (real against the house rule; prompt-dependent) | pass | without: `pnpm --filter ./apps/admin add "@org/ui@workspace:*"`. That is ordinary pnpm. It goes wrong only under `catalogMode: strict` (`references/workspace-files.md:155-157`), which the empty-fixture prompt does not mention (eval defect 2) |
| P8 | pass | pass | with is better: it notices the scaffold has nothing to publish and gives the tag job for later. without adds `pnpm --filter "./packages/*" run build` before publishing, a build step the regex cannot see |
| P9 | pass | pass | same: both move the helper into the kit and refuse the `@/` import |
| P10 | pass | pass | with is better: Biome, knip and `biome-plugins` stay at the root. without `git mv`s `biome.json`, `biome-plugins` and `knip.json` into `apps/web/`, against the "Moves to the root" table |
| P11 | pass | pass | same: both refuse a workspace for one app and keep `src/shared/ui` |

Both arms pass in the same way (rules a current model already follows): P6, P9, P11

## Review of 22 November 2026

No billed run. Thirteen reviewers each read the plugin through one lens; about sixty findings were
accepted and none was a blocker.

| Lens | Result |
|---|---|
| Toolchain, build and test picks | every pick held; pnpm 12.22 (security) and jsdom 31 adopted; the compiler-coverage and typescript-eslint reasons corrected |
| Routing, data, API client, forms | every pick held; orval `exactOptional` adopted; the valibot, response-validation and form-action reasons corrected |
| React, UI library, styling, structure | every pick held; the boundary plugin now sees `import()` and `./../`; the `Temporal` and `motion` records corrected |
| Deploy, security headers, auth | every pick held; the stale-chunk handler no longer cancels the event; RFC 10017 quoted as it reads |
| i18n, realtime, workspace | every pick held; socket kept across navigation, SSE idle timeout; the Storybook reason corrected |
| Attacker's review | path parameters encoded, Faro URLs reduced to origin and path, the origin check tightened, sign-out kept out of URLs |
| All add-ons in one app | gate green with every add-on; end-to-end sign-in and realtime recipes completed; one setup-level MSW handler allowed |
| Existing project | the scope paragraph rewritten for absent packages; an adoption order for existing apps |
| Skill architecture | fourteen skills stay (co-loading below) |
| Rule evidence, three reviewers | counts below; probes proposed for the next billed run |
| Release engineer | every gate and install path works; stale version copies now fail validation |

### Co-loading

From the 198 with-plugin answers of the 2026-11-20 run.

| Measure | Value |
|---|---|
| skills read per task | median 3, mean 3.26, maximum 9; 59 % of tasks read three or fewer |
| `frontend-code-style` | read in 145 of 198 tasks (73 %) |
| strongest pair: code-style given project-structure | 83 of 88 (0.94); merged it is 3,332 words and adds 9.8 % tokens to tasks that read code-style alone (62 of them) |
| router and query | read together in 37 of 90 tasks that touch either |
| tooling and scaffolding | together in 5 of 64 |
| forms and query | together in 15 of 76 |
| any two add-ons | together in 3 of 198 |
| every merge candidate | over the 2,000-word cap, and +4 % to +26 % tokens per task |

Verdict: no pair is read together in more than 55 % of the tasks that touch it, so fourteen stays.

### Evidence for the top-priority rules

Every `## Important` bullet and Red Flags row as they stood before this round's moves, classified by
the reviewers from the 2026-11-20 run. "No evidence" means untested, or no lift on a run whose
baseline could read the template.

| Skill | Rules | Recorded failure | House convention | No evidence | General practice or duplicate |
|---|---|---|---|---|---|
| `frontend-code-style` | 14 | 4 | 1 | 4 | 5 |
| `frontend-project-structure` | 10 | 2 | 1 | 5 | 2 |
| `frontend-tooling` | 5 | 3 | 1 | 1 | 0 |
| `frontend-scaffolding` | 5 | 3 | 0 | 2 | 0 |
| `frontend-shared-packages` | 15 | 7 | 0 | 5 | 3 |
| `tanstack-router-spa` | 11 | 2 | 4 | 3 | 2 |
| `tanstack-query-api` | 13 | 6 | 2 | 3 | 2 |
| `frontend-forms` | 12 | 1 | 1 | 7 | 3 |
| `tailwind-base-ui` | 13 | 2 | 3 | 5 | 3 |
| `frontend-testing` | 13 | 1 | 2 | 8 | 2 |
| `frontend-deploy` | 14 | 3 | 3 | 2 | 6 |
| `keycloak-spa-auth` | 12 | 5 | 1 | 1 | 5 |
| `frontend-i18n` | 12 | 4 | 0 | 3 | 5 |
| `frontend-realtime` | 12 | 2 | 1 | 2 | 7 |
| **All** | **161** | **45** | **20** | **51** | **45** |

No rule is cut for lack of evidence until the next billed run has measured it. That run uses
`Fixture: empty` (the recorded baseline could read the template) and runs on Opus and on the
smallest supported model, each with and without the plugin. Probes to run:

| Skill | Probe (prompt, wrong answer) |
|---|---|
| `frontend-code-style` | "save the profile, report any failure and let the route error screen show it"; `reportError\([^)]*\);?\s*\n\s*throw` |
| `frontend-code-style` | "add a rename form that PATCHes the user and shows the new name at once"; `useActionState\|useOptimistic\|<form[^>]*\baction=\{` |
| `frontend-code-style` | P12 rerun with the code block delivered (the prompt was cut in both arms) |
| `frontend-project-structure` | P4 rerun (placement) |
| `frontend-scaffolding` | "Scaffold our new frontend here" with a `package.json` present; `cp\s+-R[^\n]*assets/app/\.\s+\.` |
| `frontend-scaffolding` | "after scaffolding, coverage is 79 %; make `pnpm check` pass"; a lowered threshold |
| `frontend-shared-packages` | "admin needs `noUnusedParameters`; turn it on there"; the option in one app's `tsconfig.json` |
| `frontend-shared-packages` | "make CI run only for changed packages"; a gate only on `--filter "...[origin/main]"` |
| `tanstack-router-spa` | P2 rerun (`import { Route }` in a feature) |
| `tanstack-router-spa` | "render 'User not found' for a 404 on /users/$userId" |
| `tanstack-query-api` | P5 rerun (four-argument mutation callbacks) |
| `tanstack-query-api` | Should-load trigger 8 as a probe; `parseFloat\(\|Number\(\w+\.price` |
| `tanstack-query-api` | "add a Delete button on /users/$userId that returns to /users"; list invalidation without removing the detail query |
| `tanstack-query-api` | a hand-written `` `/x/${id}` `` path without `encodeURIComponent` |
| `frontend-forms` | E1's schema line rerun (hand-written `z.object` for a create form) |
| `tailwind-base-ui` | P7 rerun (whole class names, `bg-(--x)`) |
| `frontend-testing` | P1 rerun (`renderRoute`, never `vi.mock` of own modules) |
| `frontend-i18n` | `import i18n` in a component (no probe yet) |
| `keycloak-spa-auth` | direct access grants for Playwright (no probe yet) |

## Smaller-model run of 22 November 2026

Every earlier run used the largest model. This one used Sonnet, with the plugin only: nine
in-session agents answered all 216 requests (58 evals, 158 probes) from shuffled batches with
anonymous ids, so no agent knew which skill a request was written for. Each loaded skills from
the list of names and descriptions alone. Three graders on the largest model read the answers.
No baseline arm was run, so this measures robustness, not lift.

| Measure | Result |
|---|---|
| requests answered with their own skill loaded | 215 of 216 |
| skills loaded per request | median 2 |
| probes passing by regex | 148 of 158 |
| probes really failed after a grader read the 10 others | 0 |
| evals passed | 51 of 58 |

The one request answered without its own skill was a coverage-threshold question filed under
`frontend-scaffolding`; the model loaded `frontend-testing` and `frontend-tooling`, which own
it, and the probe moved to `frontend-testing`. All ten probe misses were regexes matching a
correct answer that quoted the wrong pattern as a warning; those regexes, and every other probe
that lacked the inline-code guard, were corrected.

| Failed eval | Cause | What changed |
|---|---|---|
| `tanstack-query-api` E2 | wording: nothing said what counts as first-paint data, or when a deferred request starts | `tanstack-router-spa` states the rule; query Probe 10 tests the order |
| `tailwind-base-ui` E1 | wording: the dialog's trigger part read as one option among several | the wrapper contract states the rule and its reason |
| `frontend-realtime` E1 | two places disagreed: a test example answered with a text response, the rule requires a stream in split chunks | the example follows the rule |
| `frontend-realtime` E2 | wording: the end-to-end socket mock did not read as a fixture option | the sentence says so |
| `frontend-tooling` E6 | model slip: `pnpm check` not run after the change | none |
| `frontend-scaffolding` E4 | model slip: two of three hook checks left out | none |
| `frontend-testing` E3 | model slip | none |

Answers that followed a skill into something no eval line caught also led to changes: an HTML
string is rendered as text and a parser package is the user's decision (`frontend-deploy`); the
forms example with a repeated email field is named for what it is; ids in tests come from the
factory; an existing wrapper that accepts `className` keeps it.
