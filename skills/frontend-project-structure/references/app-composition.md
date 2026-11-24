# App composition: `main.tsx` and `createAppRouter`

Contents

- [`src/main.tsx`, line by line](#srcmaintsx-line-by-line)
- [`createAppRouter` and the provider slot](#createapprouter-and-the-provider-slot)
- [Adding an app-wide provider](#adding-an-app-wide-provider)
- [Combining add-ons](#combining-add-ons)
- [What else lives in `src/app/`](#what-else-lives-in-srcapp)

## `src/main.tsx`, line by line

The scaffold's entry, quoted:

```tsx
import "@/app/zod-config";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { configureApi } from "@/api/fetcher";
import { env } from "@/app/env";
import { reloadOnStaleChunk, rootErrorHandlers } from "@/app/error-reporting";
import { createAppRouter } from "@/app/router";
import "@/styles.css";

configureApi({ baseUrl: env.apiOrigin });
const router = createAppRouter();
reloadOnStaleChunk(router);

const container = document.getElementById("root");
if (!container) throw new Error("index.html has no #root");
createRoot(container, rootErrorHandlers).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
```

| Line | Why it is there, in this order |
| --- | --- |
| `import "@/app/zod-config"` first | It runs `z.config({ jitless: true })`: without it zod probes `new Function` once per page load, when the first object schema is built, and the CSP's Trusted Types policy reports the probe. The build bundles the module into zod's own chunk (`vite.config.ts`), so it runs before any schema whatever the chunking; the dev server runs modules in source order, so it stays the first import. A side-effect import is a group boundary for Biome's import sorter; never move an import above it. |
| `configureApi({ baseUrl })` | Sets the API origin before the first loader runs. The auth add-on extends this call with `getToken` and `retryToken` (`keycloak-spa-auth`). |
| `createAppRouter()` | One router for the page, built before anything needs it. |
| `reloadOnStaleChunk(router)` | Registers the `vite:preloadError` handler before the first render. It reloads only while a navigation is pending, so it reads the router; a failed import outside a navigation rejects to its importer. |
| `createRoot(container, rootErrorHandlers)` | Routes React's caught, uncaught and recoverable errors to `reportError` (`frontend-code-style` owns the funnel). |
| `<RouterProvider router={router} />` | The only thing rendered. No provider wraps it here: providers go in `Wrap`. |

An add-on that must finish before the first render (signing in, the first language) renders in
`ready.then(render).catch(startFailed)` and passes its result into `createAppRouter`: a second
argument to `then` would not catch a throw inside `render`, and the page would stay blank. Each
sequence is its add-on skill's, and several combine as "Combining add-ons" shows.

## `createAppRouter` and the provider slot

`src/app/router.tsx` is the composition root: it builds a fresh QueryClient and toast manager per
router and mounts every app-wide provider in the router's `Wrap` option. `main.tsx` calls it once;
`renderRoute` calls it once per test with a memory history, so a provider mounted anywhere else is
missing from every route test. Router options (`defaultPreload`, `context`, `scrollRestoration`) are
`tanstack-router-spa`'s; `createQueryClient` defaults are `tanstack-query-api`'s.

```tsx
// src/app/router.tsx (excerpt)
Wrap: ({ children }) => (
  // Base UI's inline <style> tags would break the CSP's `style-src 'self'`.
  <CSPProvider disableStyleElements>
    <QueryClientProvider client={queryClient}>
      <ToastProvider manager={toastManager}>{children}</ToastProvider>
    </QueryClientProvider>
  </CSPProvider>
),
```

| Slot | Holds |
| --- | --- |
| `Wrap` | Providers that do not use router hooks: CSP, Query, toasts, i18n, the realtime client's Context, a preference's provider component. Wraps the whole router, outside its context. |
| `InnerWrap` | A provider that calls router hooks (`useRouter`, `useRouterState`). Rendered inside the router context. |
| `context` | Values loaders and `beforeLoad` read (`queryClient`, a session). Typed in `__root.tsx`; `tanstack-router-spa` owns it. |

## Adding an app-wide provider

1. Create its client or value inside `createAppRouter`, next to `queryClient`, so each router (and
   each test) gets its own. If `main.tsx` must create it first (the auth session, which goes in `context`, not a Context), add it as a
   parameter of `createAppRouter` beside `history`. A value the user changes is state: a provider
   component in `src/app/` holds it with `useState` and renders the Context.
2. Mount the provider inside `Wrap`. Nest it inside `QueryClientProvider` when it uses Query, and
   inside `CSPProvider` always.
3. If loaders need it too, add it to `context` and to the `createRootRouteWithContext<...>` type
   (`tanstack-router-spa`).
4. Put the Context object and its `use<X>()` hook where readers can import it: `shared/hooks/` or
   the owning feature, never `src/app/`, which `features/` and `shared/` cannot import.

Nothing outside `src/app/` calls `new QueryClient()`, creates a toast manager or mounts an app-wide
provider: a module-level client is shared by every test and survives between routers, and a
provider mounted in a route or in `main.tsx` exists in one of app and tests but not the other.

## Combining add-ons

`keycloak-spa-auth`, `frontend-i18n` and `frontend-realtime` each show `src/main.tsx`,
`src/app/router.tsx`, `src/app/env.ts` and `src/test/render-route.tsx` as complete files for the bare
scaffold. In an app that already has another add-on or its own changes, merge the additions each
add-on lists into the existing file; never replace it. The rules that make the files merge:

| Point | Rule |
| --- | --- |
| `createAppRouter` | One object parameter, one key per add-on: `createAppRouter({ session, i18n, history })`. `history` stays optional; only tests pass it. |
| `Wrap` order | `CSPProvider > I18nextProvider > QueryClientProvider > RealtimeContext > ToastProvider`: the CSP provider outermost, the toasts innermost so they render inside every other provider. |
| Start-up | Each waiting add-on contributes a promise: `ready.then(render).catch(startFailed)` for one, `Promise.all([...]).then(...).catch(startFailed)` for several. The router is built once the session exists (`startKeycloak(...).then(start)`), and its first load starts there only when the user is signed in: signed out, a guarded page leaves for sign-in, and leaving while the message files load aborts them (WebKit rejects the imports, so `ready` fails). `startFailed` reports the error and renders `<p role="alert">The app could not start. Reload the page to try again.</p>`, the same name and copy in every add-on, never a blank page. Faro telemetry (`frontend-deploy`) never waits: it starts before the others, its failure is reported, and `start` hands it the session's opaque user id. |
| `renderRoute` | `renderRoute(path, { session, language })`, each option defaulted (a signed-in fake identity, `"en"`), returns `{ user, router, i18n }`. Existing `renderRoute("/users")` calls keep working. |
| `env.ts`, `src/vite-env.d.ts`, `src/test/setup.ts` | Each add-on's lines side by side. A request the root layout makes on every page gets its one neutral handler in the setup's `beforeEach` (`frontend-testing`). |
| Order | Every list the add-ons extend names them in one order, whichever arrived first: the API, then auth, then realtime, then Faro. That is `PUBLIC_ENV`, `ImportMetaEnv`, `env`, `.env.development`, the CI placeholders and services, the `Dockerfile` `ARG`s and the end-to-end files. |
| `src/routes/__root.tsx` | Each add-on's context key and header control. In the nav (`items-center`), the links come first, then the controls in this order: language select, theme toggle, any other control, sign-in or sign-out button last. Only the first control carries `ms-auto`, whichever add-ons are present; a strip that is not a control (a notification feed) goes after the `nav`, inside the `header`. The layout is the root's `shellComponent`: it reads the session from `useRouter().options.context` and must not suspend. With `frontend-i18n`, the text another add-on brings (Sign in, Sign out, the no-access screen, the live status) goes through `t()`, since the lint baseline records only text that was there when i18n arrived. |
| `e2e/fixtures.ts`, `playwright.config.ts` | `mergeTests` of the template's fixtures and each add-on's own `e2e/<add-on>.ts`; the config imports and lists each add-on's setup, teardown, servers and build env; each server chosen by its own `E2E_<NAME>_ORIGIN`, never by `CI`. `frontend-testing`'s Playwright reference has both files for sign-in plus realtime. |
| the CI `e2e` job | One job with every add-on's service, on one network with the job; the same reference has it for GitHub and GitLab. |

With all three add-ons and Faro, the four composed files are below: two apps that added the add-ons in opposite orders ended with these files, `tsc`, Biome, every test and the end-to-end suite green in both browsers. With fewer, leave out the missing add-ons' lines; without the session, `main.tsx` builds the router at the top and starts its first load at once (`frontend-i18n`). `createAppRouter` keeps the template's search parser and focus subscription whatever the add-ons. The toast titles are the `i18n.t` calls `frontend-i18n` gives, once `common.json` has `notices.*`; without i18n they stay the template's `NOTICES`. Each add-on raises `ENTRY_BUDGET_BYTES` by the growth `pnpm build` reports when it arrives, over budget or not, so the sum is the same in any order: with all four the entry measured 180,559 B gzip against the template's 149,474.

```tsx
// src/main.tsx
import "@/app/zod-config";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { configureApi } from "@/api/fetcher";
import { env } from "@/app/env";
import { reloadOnStaleChunk, rootErrorHandlers } from "@/app/error-reporting";
import { createI18n, pickLanguage, storedLanguage } from "@/app/i18n";
import { startKeycloak } from "@/app/keycloak";
import { createAppRouter } from "@/app/router";
import { createSession, type IdentityProvider } from "@/app/session";
import { startTelemetry } from "@/app/telemetry";
import "@/styles.css";

const telemetry = env.faroUrl ? startTelemetry(env.faroUrl) : undefined;
telemetry?.catch(reportError);

const { i18n, ready } = createI18n(pickLanguage([storedLanguage(), ...navigator.languages]));
const container = document.getElementById("root");
if (!container) throw new Error("index.html has no #root");
const root = createRoot(container, rootErrorHandlers);

/** Once the session exists: the router, and its first load beside the message files. */
function start(provider: IdentityProvider) {
  const session = createSession(provider);
  const userId = session.userId();
  // The opaque subject id only, never a name or an email; a failed start was reported above.
  if (userId)
    void telemetry?.then(
      (faro) => faro.api.setUser({ id: userId }),
      () => {},
    );
  configureApi({ baseUrl: env.apiOrigin, getToken: session.token, retryToken: session.retryToken });
  const router = createAppRouter({ session, i18n });
  reloadOnStaleChunk(router);
  // Signed in, the first page's requests start now, beside the message files. Signed out, a guarded
  // page leaves for sign-in, and leaving aborts the message files (WebKit rejects their imports).
  if (userId) router.load().catch(reportError);
  return router;
}

function render(router: ReturnType<typeof createAppRouter>) {
  root.render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}

// Never a redirect from here: it would loop while Keycloak keeps refusing the code.
function startFailed(error: unknown) {
  reportError(error);
  // English on purpose: the messages may not have loaded.
  // i18next-instrument-ignore-next-line
  root.render(<p role="alert">The app could not start. Reload the page to try again.</p>);
}

// The first screen renders in its language, never as keys. `catch` also catches a throw in render.
Promise.all([
  startKeycloak({ url: env.authOrigin, realm: "app", clientId: "app-spa" }).then(start),
  ready,
])
  .then(([router]) => render(router))
  .catch(startFailed);
```

```tsx
// src/app/router.tsx
import { CSPProvider } from "@base-ui/react/csp-provider";
import { Toast } from "@base-ui/react/toast";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createRouter,
  parseSearchWith,
  type RouterHistory,
  stringifySearchWith,
} from "@tanstack/react-router";
import type { i18n as I18n } from "i18next";
import { I18nextProvider } from "react-i18next";
import { ApiError } from "@/api/api-error";
import { apiToken } from "@/api/fetcher";
import { createRealtime } from "@/api/realtime";
import { env } from "@/app/env";
import type { Session } from "@/app/session";
import { routeTree } from "@/routeTree.gen";
import { RealtimeContext } from "@/shared/hooks/use-channel";
import { RouteError } from "@/shared/ui/route-error";
import { ToastProvider } from "@/shared/ui/toast";
import { createQueryClient } from "./query-client";

// The default parser rewrites `?q=1.50` to 1.5 and ids past 2^53 to another number: a top-level
// value is a number only when it prints back as typed, so free text and long ids stay text.
const exactJson = (value: string): unknown => {
  const parsed: unknown = JSON.parse(value);
  if (typeof parsed === "number" && String(parsed) !== value) throw new Error("not exact");
  return parsed;
};

/** The whole app: route tree, QueryClient, providers. `main.tsx` and every route test build it. */
export function createAppRouter({
  session,
  i18n,
  history,
}: {
  session: Session;
  i18n: I18n;
  history?: RouterHistory;
}) {
  const toastManager = Toast.createToastManager();
  const queryClient = createQueryClient((reason, error) =>
    toastManager.add({
      // One toast per reason: a repeated failure updates it, with its latest request id.
      id: reason,
      title: reason === "refresh" ? i18n.t("notices.refresh") : i18n.t("notices.mutation"),
      description:
        error instanceof ApiError &&
        error.requestId &&
        i18n.t("notices.requestId", { requestId: error.requestId }),
      // A failure is announced at once and stays until dismissed: a 5 s polite toast is easy to miss.
      priority: "high",
      timeout: 0,
    }),
  );
  // The token goes in connect data, which a Centrifugo connect proxy checks; never in the URL.
  const realtime = createRealtime({
    url: `${env.realtimeOrigin}/connection/websocket`,
    getData: async () => ({ token: await apiToken() }),
  });
  const router = createRouter({
    routeTree,
    context: { queryClient, session },
    ...(history && { history }),
    parseSearch: parseSearchWith(exactJson),
    stringifySearch: stringifySearchWith(JSON.stringify, exactJson),
    defaultPreload: "intent",
    // Query owns freshness: the router always runs loaders and waits for them; they read the cache.
    defaultPreloadStaleTime: 0,
    defaultStaleReloadMode: "blocking",
    scrollRestoration: true,
    // Each route catches its own error, so the root layout and its navigation stay on screen.
    defaultErrorComponent: RouteError,
    // The provider slot: app-wide providers (i18n, a realtime client) go here, once for app and tests.
    // biome-ignore lint/correctness/noComponentHookFactories: built once per router, which keeps it.
    Wrap: ({ children }) => (
      // Base UI's inline <style> tags would break the CSP's `style-src 'self'`.
      <CSPProvider disableStyleElements>
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={queryClient}>
            <RealtimeContext value={realtime}>
              <ToastProvider manager={toastManager}>{children}</ToastProvider>
            </RealtimeContext>
          </QueryClientProvider>
        </I18nextProvider>
      </CSPProvider>
    ),
  });
  // A screen reader hears nothing after a client-side navigation unless focus moves to the new page.
  // Not on the first render or a search-only change; `preventScroll` leaves scroll restoration alone.
  router.subscribe("onRendered", ({ fromLocation, pathChanged }) => {
    const heading = fromLocation && pathChanged && document.querySelector<HTMLElement>("main h1");
    if (!heading) return;
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  });
  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof createAppRouter>;
  }
}
```

```tsx
// src/routes/__root.tsx
import type { QueryClient } from "@tanstack/react-query";
import {
  createRootRouteWithContext,
  Link,
  useLocation,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LANGUAGES } from "@/app/i18n";
import type { Session } from "@/app/session";
import { Button } from "@/shared/ui/button";
import { LanguageSelect } from "@/shared/ui/language-select";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient; session: Session }>()({
  // The shell stays mounted around the root's content, pending or not. The router renders nothing
  // until a match is pending or ready: the empty `beforeLoad` makes the root pending on a first load
  // only, so the layout and the bar show at once while the page loads, and a later navigation keeps
  // the previous page under the bar. `pendingMinMs` would hold a fast first load back.
  shellComponent: RootLayout,
  beforeLoad: () => {},
  pendingComponent: () => null,
  pendingMs: 0,
  pendingMinMs: 0,
  notFoundComponent: PageNotFound,
});

function RootLayout({ children }: { children: ReactNode }) {
  // The shell renders before the root match has its context; the router's own context is set.
  const { session } = useRouter().options.context;
  const href = useLocation({ select: (location) => location.href });
  const { t } = useTranslation();
  return (
    <>
      <NavigationProgress />
      <header className="border-line border-b">
        <nav aria-label="Main" className="mx-auto flex max-w-3xl items-center gap-4 p-4">
          <Link to="/users" activeOptions={{ exact: true }}>
            Users
          </Link>
          <Link to="/users/new">New user</Link>
          <LanguageSelect languages={LANGUAGES} className="ms-auto" />
          {session.userId() ? (
            <Button onClick={() => void session.signOut()}>{t("auth.signOut")}</Button>
          ) : (
            <Button onClick={() => void session.signIn(href)}>{t("auth.signIn")}</Button>
          )}
        </nav>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">{children}</main>
    </>
  );
}

/** While a navigation waits for its loaders; `.navigation-progress` stays invisible for the first 200 ms. */
function NavigationProgress() {
  const pending = useRouterState({ select: (state) => state.status === "pending" });
  return pending ? (
    <div role="progressbar" aria-label="Loading page" className="navigation-progress" />
  ) : null;
}

function PageNotFound() {
  return (
    <>
      <title>Page not found</title>
      <h1 className="font-semibold text-2xl">Page not found</h1>
      <Link to="/users">Back to users</Link>
    </>
  );
}
```

```tsx
// src/test/render-route.tsx
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Resource, ResourceKey } from "i18next";
import { configureApi } from "@/api/fetcher";
import { createI18n, type Language } from "@/app/i18n";
import { createAppRouter } from "@/app/router";
import { createSession, type Session } from "@/app/session";
import { fakeIdentity } from "./identity";

/** The API origin route tests run against; MSW answers it. */
export const TEST_API_ORIGIN = "https://api.test";

// The app's own message files, every language in memory: the instance is ready before the render.
const messageFiles = import.meta.glob<ResourceKey>("/src/app/locales/*/*.json", {
  eager: true,
  import: "default",
});
const resources: Resource = {};
for (const [path, messages] of Object.entries(messageFiles)) {
  const [language = "", file = ""] = path.split("/").slice(-2);
  resources[language] = { ...resources[language], [file.replace(".json", "")]: messages };
}

/**
 * Renders the whole app at `path`: the real route tree, a fresh QueryClient, the app's providers,
 * real messages in `language` and a signed-in session unless the test passes another. Only the
 * network, the identity provider and the realtime socket are fake.
 */
export function renderRoute(
  path: string,
  {
    session = createSession(fakeIdentity()),
    language = "en",
  }: { session?: Session; language?: Language } = {},
) {
  configureApi({
    baseUrl: TEST_API_ORIGIN,
    getToken: session.token,
    retryToken: session.retryToken,
  });
  const { i18n } = createI18n(language, resources);
  const router = createAppRouter({
    session,
    i18n,
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  const { queryClient } = router.options.context;
  // The app's defaults minus retries: a failed request shows its error at once, not after backoff.
  queryClient.setDefaultOptions({
    ...queryClient.getDefaultOptions(),
    queries: { ...queryClient.getDefaultOptions().queries, retry: false },
  });
  const user = userEvent.setup();
  render(<RouterProvider router={router} />);
  return { user, router, i18n };
}
```

## What else lives in `src/app/`

| File | Holds | Read by |
| --- | --- | --- |
| `router.tsx` | `createAppRouter` (with the search parser and the focus move after a navigation), the `Register` declaration | `main.tsx`, `src/test/render-route.tsx` |
| `query-client.ts` | `createQueryClient(notify)`, Query's `Register` | `router.tsx` |
| `error-reporting.ts` | `rootErrorHandlers`, `reloadOnStaleChunk(router)` | `main.tsx` |
| `env.ts` | `env`, the only reader of `import.meta.env` (`process.env` is a lint error in browser code) | `main.tsx`; pass values down, since `features/` and `shared/` cannot import it |
| `zod-config.ts` | `z.config({ jitless: true })` | `main.tsx`, first import |

Add-on setup modules (`i18n.ts`, the session, `telemetry.ts`) also live here; their contents belong
to their skills.
