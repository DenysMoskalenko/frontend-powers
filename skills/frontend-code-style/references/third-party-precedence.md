# Third-Party Rules on This Stack

## Contents

- How to read this table
- Third-party precedence table: `vercel-react-best-practices`
- Third-party precedence table: other skills

## How to read this table

The third-party skills are written for a wider audience, and several rules assume a server
renderer, a different data library, inline scripts or runtime style injection. This stack is a
client-rendered single-page app with TanStack Router and Query, the React Compiler, Biome, and a CSP
of `script-src 'self'; style-src 'self'` with Trusted Types enforced. Where a row below matches, its
last column wins over the third-party rule. A rule not listed applies as written unless it conflicts
with one of those constraints (no inline style or script, no Trusted Types policy, no server
rendering, the React Compiler, Biome's rules): then the constraint wins, and you say which rule you
did not follow and why. A new conflict is added here, not in the skill that met it.

## Third-party precedence table: `vercel-react-best-practices`

| Rule | Why it does not apply as written | What to do here |
|---|---|---|
| `async-api-routes`, `server-auth-actions` | Next.js API routes and Server Actions do not exist | Start independent work early inside a route `loader` or `queryFn`; authorization lives in the backend, route guards are UX only |
| `async-suspense-boundaries` | async Server Components do not exist; a promise created during a client render re-suspends forever | Suspense around `useSuspenseQuery` consumers or the route's `pendingComponent`; promises come from the Query cache |
| `async-dependencies` | adds the `better-all` package | Chain promises, or sequence `await queryClient.query(...)` calls in the loader; no new dependency |
| `bundle-barrel-imports` | `optimizePackageImports` is a Next.js option | Own code has no barrels (`frontend-project-structure`); named imports from packages are fine, Rolldown tree-shakes them |
| `bundle-dynamic-imports`, `bundle-defer-third-party` | `next/dynamic` with `ssr: false`, "after hydration" | Routes split through `autoCodeSplitting`; a heavy widget uses `React.lazy` and `Suspense`; no CDN scripts, since `script-src 'self'` blocks them |
| `bundle-conditional`, `bundle-preload` | `typeof window !== "undefined"` guards for SSR | Drop the guards; route preloading is the router's `defaultPreload: "intent"` |
| `server-cache-react`, `server-cache-lru`, `server-dedup-props`, `server-serialization`, `server-hoist-static-io`, `server-parallel-fetching`, `server-after-nonblocking` | RSC and SSR only | Not applicable; never call `React.cache()` in client code; deduplication is the Query cache |
| `server-no-shared-module-state` | the risk is cross-request leakage on a server | In the browser the risk is state leaking between tests; build state in `createX` factories |
| `client-swr-dedup`, `client-event-listeners` | use SWR and `useSWRSubscription` | Do not add SWR: TanStack Query through the orval client owns deduplication and caching; a shared listener is a module registry read through `useSyncExternalStore` |
| `rerender-defer-reads` | `useSearchParams` is a Next.js hook | `Route.useSearch({ select })` for a narrow subscription |
| `rerender-memo`, `rerender-memo-with-default-value`, `rerender-simple-expression-in-memo`, `rendering-hoist-jsx`, the `useMemo` half of `rerender-split-combined-hooks`, the memo parts of `rerender-use-deferred-value`, `js-hoist-regexp`, `js-tosorted-immutable` and `rerender-functional-setstate` | assume hand memoization; their correct examples add `useMemo` or `useCallback` | The React Compiler memoizes: write no new `useMemo`, `useCallback` or `memo` |
| `advanced-event-handler-refs` | its first example writes a ref inside an effect | `useEffectEvent`, as its own alternative shows |
| `advanced-init-once` | a module flag checked inside `useEffect` | Once-per-load setup runs in `main.tsx` before `createRoot`, or in the router's `Wrap` |
| `rendering-hydration-no-flicker` | inline `<script dangerouslySetInnerHTML>` before hydration | There is no hydration and the CSP blocks inline scripts: theme through `color-scheme` and `light-dark()`; a stored choice is an external script (`tailwind-base-ui`) |
| `rendering-hydration-suppress-warning` | SSR only | Not applicable |
| `rendering-script-defer-async` | `next/script` | Vite emits deferred module scripts; third-party scripts are excluded by the CSP |
| `rendering-resource-hints` | aimed at server components | Static hints go in `index.html`; Vite emits `modulepreload` for chunks |
| `client-localstorage-schema` | `catch {}` with no reason; `JSON.parse` returned untyped | Catch a blocked or full storage with a one-line reason and a fallback; parse to `unknown` and narrow, as this skill's `readPageSize` does |
| `rendering-usetransition-loading` | hand-rolls fetch and `setResults` in a transition | Server data shows pending state through Query (`isFetching`, `placeholderData`); `useTransition` is for local UI |

## Third-party precedence table: other skills

| Skill and rule | Why it does not apply as written | What to do here |
|---|---|---|
| `vercel-composition-patterns`, several examples | written for React Native (`TextInput`, `onPress`) | Read as the DOM equivalents; `ref` as a prop and `use(Context)` agree with this stack |
| `vercel-composition-patterns`, compound components (`architecture-compound-components`, `state-context-interface`) | parts destructure `use(Ctx)` of a `null`-default Context, TS2339 under `strict` | A compound component's own Context is component API and allowed, its provider rendered by the component's root in a file beside it; parts read it through a `useX()` that throws without the provider |
| `vercel-composition-patterns`, `state-decouple-implementation` | names zustand as a store | Server state is the Query cache and URL state the router's search params; zustand only for client state with no other home |
| `web-design-guidelines`, deep-linked state "with nuqs or similar" | a different URL-state library | `validateSearch` with a zod schema (`tanstack-router-spa`) |
| `web-design-guidelines`, warn before leaving | `beforeunload` or "a router guard" | The router's `useBlocker`, wired by `frontend-forms` |
| `web-design-guidelines`, `priority` on above-fold images | a `next/image` prop | `fetchpriority="high"` on the `<img>` |
| `web-design-guidelines`, hydration safety | SSR only | Not applicable, except that a `value` needs an `onChange` |
| `web-design-guidelines`, language from `Accept-Language` | needs a server | `pickLanguage([storedLanguage(), ...navigator.languages])` (`frontend-i18n`); no detector package |
| `pick-ui-library`, `ask-sonner`; `animate` and `emil-design-eng` where they defer to them | Sonner, input-otp, NumberFlow and Vaul append a `<style>`, blocked by `style-src 'self'`; Virtuoso, clsx, cva and next-themes are rejected picks | The measured table in `tailwind-base-ui` decides: Base UI Toast (`Toast.useToastManager().add()` under the scaffold's `ToastProvider`), Base UI OTP field and Drawer, virtua, `cx()`, `light-dark()` tokens |
| `emil-design-eng`, `useSpring` from `framer-motion` | the package is now `motion` | Import `useSpring` from `motion/react` when a design needs the spring; never `AnimatePresence mode="popLayout"`, which injects styles |
| `mobile-native`, Next.js `viewport` export | Next.js only | `theme-color` and viewport metas in `index.html` |
| `modern-web-guidance`, `build.target: "esnext"` for top-level await | the browser floor is fixed and already runs top-level `await` | Keep the scaffold's `build.target` (`frontend-tooling`) |
| `modern-web-guidance`, fallbacks for "Newly available" features | it asks for the project's browser policy | The policy is the scaffold's `build.target` (`chrome119`, `edge119`, `firefox128`, `safari17.4`); Lightning CSS lowers `light-dark()` and nesting. Skip a fallback the build compiles or the floor supports |
| `modern-web-guidance`, `color-scheme` on a component (`pre`, `.dark`) | the build resolves the `light-dark()` tokens through `color-scheme` on `:root` only | `color-scheme` on `:root` selectors only; a permanently dark surface gets its own role tokens (`tailwind-base-ui`) |
| `modern-web-guidance`, `Temporal` and its CDN polyfill | `script-src 'self'` blocks the CDN import; `lib` is `es2024` | ISO strings, `Date` and `Intl`; time-zone arithmetic the backend can do stays on the backend |
| `modern-web-guidance`, native `<dialog>`, `popover` menus, selects and toasts, invoker commands and their polyfills | overlays, menus, selects and toasts are Base UI parts wrapped in `src/shared/ui`, which already handle focus, the top layer and dismissal | Use the `shared/ui` wrapper (`tailwind-base-ui`); apply the guide's behaviour points (no scroll chaining behind a modal, focus return) as checks on it; no polyfill package |
| `modern-web-guidance`, spreading new HTML attributes `as any` | Biome `noExplicitAny`; invoker commands (`command`, `commandfor`) and `interestfor` are above the `build.target` floor | No invoker commands or `interestfor`. An attribute the floor allows but `@types/react` lacks is declared once in a `declare module "react"` augmentation in `src/react-html.d.ts`, as this skill shows; `popover` is already typed |
| `modern-web-guidance`, form constraints, `setCustomValidity`, validate on blur, a no-JS fallback | the zod request schema is the one validator; an SPA has no no-JS submit | `<form noValidate>` and the schema on submit (`frontend-forms`); keep `type`, `autocomplete`, `inputmode` and focus on the first invalid field |
| `modern-web-guidance`, inline critical CSS, no `@import` in CSS, `onload` stylesheet deferral | inline CSS and `on*` handlers are blocked; Vite inlines `@import` at build | Keep `@import "tailwindcss";` in `styles.css`; CSS ships as one hashed file |
| `modern-web-guidance`, nonce or hash CSP, a named Trusted Types policy | the shipped CSP allows no inline script and `trusted-types 'none'` allows no policy | No inline scripts and no `innerHTML`, so no DOMPurify fallback: HTML from users renders as text. A Trusted Types policy only as `frontend-deploy`'s reviewed exception |
| `modern-web-guidance`, `window` or `HTMLElement` guards | SSR only | Drop `typeof window === "undefined"` guards; keep feature detection (`"scheduler" in window`) for an API above the browser floor |
