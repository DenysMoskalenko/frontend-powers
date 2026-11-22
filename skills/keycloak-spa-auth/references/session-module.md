# The session module and the scaffold changes

## Contents

- [The files and what each adds](#the-files-and-what-each-adds)
- [`src/app/session.ts`](#srcappsessionts)
- [`src/app/keycloak.ts`](#srcappkeycloakts)
- [keycloak-js 26.2 facts](#keycloak-js-262-facts)
- [`src/main.tsx` and `src/app/env.ts`](#srcmaintsx-and-srcappenvts)
- [The CSP: `deploy/headers.ts` and `vite.config.ts`](#the-csp-deployheadersts-and-viteconfigts)
- [`src/app/router.tsx`](#srcapproutertsx)
- [`src/routes/__root.tsx`](#srcroutes__roottsx)
- [The guard and a protected route](#the-guard-and-a-protected-route)
- [`src/shared/ui/route-error.tsx`](#srcshareduiroute-errortsx)
- [`src/shared/lib/safe-url.ts`](#srcsharedlibsafe-urlts)
- [The Keycloak client](#the-keycloak-client)
- [Bundle cost and what was run](#bundle-cost-and-what-was-run)

## The files and what each adds

Every block here is the complete file for the bare scaffold, type-checked, linted and run with the
scaffold's own tests in place; `pnpm add keycloak-js` first. In an app that already has another
add-on (`frontend-i18n`, `frontend-realtime`) or its own changes, merge the additions listed below
into the existing file and never replace it: `frontend-project-structure`'s app-composition
reference shows the combined files.

| File | New or changed | What this add-on adds |
|---|---|---|
| `src/app/session.ts` | new | the provider-independent policy; in `src/app/` because only the composition root, routes and tests read it |
| `src/app/keycloak.ts` | new | `startKeycloak`, the only importer of `keycloak-js` |
| `src/main.tsx` | changed | `startKeycloak(...).then(render, startFailed)`; `render` creates the session, moves the scaffold's `configureApi` call inside with `getToken` and `retryToken`, and passes `session` to `createAppRouter` |
| `src/app/env.ts` | changed | `authOrigin`; the rest of `PUBLIC_AUTH_ORIGIN` is `frontend-deploy`'s procedure |
| `deploy/headers.ts`, `headers.test.ts`, `vite.config.ts` | changed | the Keycloak origin in the CSP's `form-action`, for the sign-out form |
| `src/app/router.tsx` | changed | a required `session: Session` key in the parameter, `session` in `context` |
| `src/routes/__root.tsx` | changed | `session: Session` in the context type; Sign in or Sign out at the end of the nav |
| `src/routes/_signed-in.tsx` | new | the guard; protected routes move under `src/routes/_signed-in/` |
| `src/shared/ui/route-error.tsx` | changed | a 403 reads as no access, in the title and the heading |
| `src/shared/lib/safe-url.ts`, `safe-url.test.ts` | new, or present | `frontend-deploy`'s files, unchanged: `sameOriginPath` checks the return path |
| `src/test/identity.ts`, `src/test/render-route.tsx` | new, changed | the test seam: a `session` option, `configureApi` given its token functions (auth-tests reference) |
| `e2e/fixtures.ts`, `e2e/keycloak-realm.ts`, `e2e/sign-out.spec.ts`, `playwright.config.ts`, both CI files | changed, new | a real Keycloak for `pnpm test:e2e` (auth-tests reference) |

`features/` and `shared/` cannot import `src/app/`, so no component there reads the session: a route
reads `context.session` and passes what a feature needs as props.

## `src/app/session.ts`

The policy: when to refresh, when to retry, when to sign in again, and what other tabs hear. It knows
nothing about Keycloak, so route tests run it unchanged over a fake provider.

```ts,verify
// file: src/app/session.ts
/** What the app needs from the identity provider: `keycloak.ts` implements it, route tests fake it. */
export interface IdentityProvider {
  /** The signed-in user's `sub`, or `undefined` when signed out or the provider ended the session. */
  userId(): string | undefined;
  /**
   * An access token valid for `minValidity` more seconds, refreshed first when it is not; `-1`
   * forces a refresh. `undefined` when signed out or when the provider refused the refresh.
   */
  token(minValidity: number): Promise<string | undefined>;
  /** Leaves for the provider's sign-in page; the app reopens at `returnTo`, a router path. Never settles. */
  signIn(returnTo: string): Promise<never>;
  /** Ends the provider's session and reopens the app at its root. Never settles. */
  signOut(): Promise<never>;
  /** `true` on the page load that came back from `signOut`: the provider's session has ended. */
  readonly justSignedOut: boolean;
}

/** The session the router context, the guards and `configureApi` share. */
export interface Session {
  userId(): string | undefined;
  /** `configureApi`'s `getToken`. */
  token(): Promise<string | undefined>;
  /** `configureApi`'s `retryToken`: after a 401, a different token for one retry, or `undefined`. */
  retryToken(rejected: string | undefined): Promise<string | undefined>;
  signIn(returnTo: string): Promise<never>;
  signOut(): Promise<never>;
}

const MIN_VALIDITY_S = 30;
const FORCED_REFRESH_GAP_MS = 60_000;
const SIGN_IN_GRACE_MS = 60_000;
const SIGNED_OUT = "signed-out";

export function createSession(provider: IdentityProvider): Session {
  const startedAt = Date.now();
  let forcedAt = Number.NEGATIVE_INFINITY;
  let forcing: Promise<string | undefined> | undefined;
  let ended = false;

  // Only the fact travels between tabs; each tab holds its own tokens. Named after Vite's `base`, so
  // two apps under one origin do not sign each other out.
  const tabs = new BroadcastChannel(`session:${import.meta.env.BASE_URL}`);
  tabs.onmessage = (event) => {
    if (event.data === SIGNED_OUT && provider.userId()) void provider.signIn(currentPath());
  };
  // Sent from the page the logout came back to: a tab told earlier signs in again before the
  // logout lands, gets a code the logout then invalidates, and fails to start.
  if (provider.justSignedOut) tabs.postMessage(SIGNED_OUT);
  // A page the back-forward cache restores missed that message and still holds its tokens and data.
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) location.reload();
  });

  const end = () => {
    if (ended) return;
    ended = true;
    // Refused right after a sign-in means a server-side misconfiguration: the request's 401
    // shows the error page instead of sending the user around the sign-in loop again.
    if (Date.now() - startedAt > SIGN_IN_GRACE_MS) void provider.signIn(currentPath());
  };

  const token = async () => {
    if (!provider.userId()) return undefined;
    const current = await provider.token(MIN_VALIDITY_S);
    if (!current) end();
    return current;
  };

  return {
    userId: () => provider.userId(),
    token,
    async retryToken(rejected) {
      if (!provider.userId()) return undefined;
      const current = await token();
      // Another request already refreshed, or the session ended.
      if (current !== rejected) return current;
      if (!forcing) {
        // A token refreshed less than a minute ago was rejected too: the API, not the session, is wrong.
        if (Date.now() - forcedAt < FORCED_REFRESH_GAP_MS) return undefined;
        forcedAt = Date.now();
        forcing = provider.token(-1).finally(() => {
          forcing = undefined;
        });
      }
      const fresh = await forcing;
      if (!fresh) end();
      return fresh === rejected ? undefined : fresh;
    },
    signIn: (returnTo) => provider.signIn(returnTo),
    signOut: () => provider.signOut(),
  };
}

/** The current page as the router names it: the path below Vite's `base`, search and hash. */
function currentPath() {
  const path = location.pathname.slice(import.meta.env.BASE_URL.length - 1);
  return path + location.search + location.hash;
}
```

- `token()` is `configureApi`'s `getToken`: a token with 30 s left, refreshed first when needed.
- `retryToken(rejected)` is `configureApi`'s `retryToken`. Concurrent 401s share one forced
  refresh; a token refreshed less than a minute ago that the API rejects again is not refreshed a
  second time, so `apiFetch` throws the 401 and the route shows its error.
- Sign-in starts in four places only: the guard, for a signed-out visitor; the Sign in button;
  another tab's sign-out, in a tab that is still signed in; and `end()`, when the provider refuses a
  refresh. `end()` stays quiet for the first 60 s after the page started, which is the moment right
  after a sign-in: a refused session then is a server-side fault, and the user sees the error page
  instead of a redirect loop.
- A thrown 401 never signs in by itself: with a valid session it means the API rejects good tokens
  (audience, clock, key), which another sign-in cannot fix.
- Sign-out tells the other tabs only from the page Keycloak sends back, when the session has ended
  (`justSignedOut`). Posted before leaving, the other tabs reached Keycloak while the session still
  lived, and their code exchange then failed: reproduced against Keycloak 26.8.
- A page restored from the back-forward cache (`pageshow` with `persisted`) reloads: it may have
  missed the sign-out message, and it still holds the tokens and data it had when it was left.

## `src/app/keycloak.ts`

```ts,verify
// file: src/app/keycloak.ts
import Keycloak from "keycloak-js";
import { sameOriginPath } from "@/shared/lib/safe-url";
import type { IdentityProvider } from "./session";

interface KeycloakSettings {
  /** `env.authOrigin`; append a path only for a server that still serves under `/auth`. */
  url: string;
  realm: string;
  clientId: string;
}

// Prefixed with Vite's `base`: two apps under one origin share a tab's sessionStorage.
const RETURN_PATH_KEY = `${import.meta.env.BASE_URL}auth.return-path`;
const SIGNED_OUT_KEY = `${import.meta.env.BASE_URL}auth.signed-out`;

/**
 * Runs once before the first render. Completes a sign-in when the URL carries Keycloak's answer,
 * otherwise resolves signed out; it never navigates by itself. Rejects when Keycloak sent an error
 * back or refused the code.
 */
export async function startKeycloak(settings: KeycloakSettings): Promise<IdentityProvider> {
  // The one URI registered for sign-in and sign-out, the app's root under Vite's `base`. Without
  // `redirectUri` keycloak-js sends the current URL, which a deep link never matches.
  const appUrl = new URL(import.meta.env.BASE_URL, location.origin).href;
  const keycloak = new Keycloak(settings);
  const signedIn = await keycloak.init({
    pkceMethod: "S256",
    responseMode: "fragment",
    // Its session iframe needs third-party cookies, which Safari and Firefox block.
    checkLoginIframe: false,
    redirectUri: appUrl,
    // A form POST keeps the ID token, which spares the user Keycloak's confirmation page, out of
    // every URL; the CSP's form-action allows the Keycloak origin for it.
    logoutMethod: "POST",
  });
  const justSignedOut = take(SIGNED_OUT_KEY) !== null && !signedIn;
  if (signedIn) {
    // `.` resolves the router path below the app's root.
    const reopenAt = new URL(`.${sameOriginPath(take(RETURN_PATH_KEY))}`, appUrl);
    history.replaceState(history.state, "", reopenAt);
  }

  return {
    userId: () => keycloak.tokenParsed?.sub,
    async token(minValidity) {
      try {
        // Concurrent calls share one request; a 400 clears the tokens, a network error keeps them.
        await keycloak.updateToken(minValidity);
      } catch {
        // The API judges the token that is left, if any.
      }
      return keycloak.token;
    },
    async signIn(returnTo) {
      save(RETURN_PATH_KEY, returnTo);
      location.replace(await keycloak.createLoginUrl());
      return new Promise<never>(() => {});
    },
    async signOut() {
      // The page Keycloak sends back reads it and tells the other tabs.
      save(SIGNED_OUT_KEY, "1");
      await keycloak.logout();
      return new Promise<never>(() => {});
    },
    justSignedOut,
  };
}

function save(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked: the app reopens at its root, and other tabs learn at their next refresh.
  }
}

function take(key: string) {
  try {
    const value = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return value;
  } catch {
    // Storage blocked: nothing was saved either, so the app reopens at its root.
    return null;
  }
}
```

- The return path and the sign-out flag are the only entries the module writes, both in
  `sessionStorage` and both removed on the next start; tokens stay in the keycloak-js instance.
- `logout()` appends a hidden form carrying `id_token_hint`, `client_id` and
  `post_logout_redirect_uri` and submits it; no request URL carries the ID token.
- The return path is a router path, without Vite's `base`; `sameOriginPath` turns anything that
  is not a path of this origin into `/`, and the `.` prefix keeps the result below the app's root.

## keycloak-js 26.2 facts

Read in `keycloak-js` 26.2.5 `lib/keycloak.js` and `lib/keycloak.d.ts`; the behaviour rows marked
(run) are asserted by `src/app/keycloak.test.ts` against a fake token endpoint.

| Item | Fact |
|---|---|
| `new Keycloak({ url, realm, clientId })` | builds the endpoints from `url` and `realm` with no request; a string argument fetches a JSON file instead |
| import | `import Keycloak from "keycloak-js"`: ESM only, exports `.` and `./authz`; older examples import `keycloak-js/dist/keycloak` |
| `init()` twice | throws `A 'Keycloak' instance can only be initialized once.`: create one instance, outside React (StrictMode runs effects twice) |
| `init()` resolves | `true` only after it processed a valid callback in the URL (or `token`/`refreshToken` options); `false` otherwise. It rejects when the callback carries `error=` (with the plain object `{ error, error_description }`, not an `Error`) or the code exchange fails (run) |
| callback handling | reads `code`, `state`, `session_state`, `iss`, `error*` from the fragment, removes them with `history.replaceState`, and looks the `state` up in `localStorage` (`kc-callback-<state>`, one hour, removed on use; a cookie when storage is blocked). An unknown `state` is ignored and `init` resolves `false` |
| `onLoad` | `"login-required"` sets `loginRequired`, so every later `clearToken()` calls `login()` and leaves the page; `"check-sso"` without `silentCheckSsoRedirectUri` is a full-page `prompt=none` redirect on every load |
| `checkLoginIframe` | default `true`: a hidden Keycloak iframe polled every 5 s, plus a third-party-cookie probe iframe. With `false` and no `silentCheckSsoRedirectUri`, keycloak-js creates no iframe (run) |
| `pkceMethod` | default `"S256"`; `false` disables PKCE |
| `responseMode` | default `"fragment"`; `"query"` puts the code where server logs see it |
| `redirectUri` (init option) | the default for login and logout; without it the browser adapter sends `location.href` (only the Cordova adapters fall back to `http://localhost`) |
| `scope` | `openid` is always added |
| `createLoginUrl()` | async (it computes the PKCE challenge); stores state, nonce and verifier, and strips a hash from `redirectUri` into the stored state |
| `updateToken(minValidity)` | refreshes when the token expires within `minValidity` seconds; `0` or no argument means 5 (`minValidity \|\| 5`); `-1` always refreshes. Concurrent calls queue on one request (run). Throws `Unable to update token, no refresh token available.` when signed out |
| refresh failure | a 400 from the token endpoint clears every token before the rejection reaches the caller; a network error or 5xx keeps them (run) |
| `clearToken()` | `Promise<void>` since 26.2; fires `onAuthLogout`; with `loginRequired` it then calls `login()` |
| `isTokenExpired(s)` | throws `Not authenticated` without a token; corrects for `timeSkew`, computed from `iat` at each token set |
| `logoutMethod` (init option) | default `"GET"`: `logout()` replaces the page with the logout URL, `id_token_hint` in its query. `"POST"`: `logout()` submits a hidden form to `/protocol/openid-connect/logout` with `id_token_hint` (while the ID token is held), `client_id` and `post_logout_redirect_uri`, and `createLogoutUrl()` returns the bare endpoint (run) |
| refresh request | `POST <realm>/protocol/openid-connect/token` with `credentials: "include"`, so the realm's CORS must allow the app origin |
| events | `onReady`, `onAuthSuccess`, `onAuthError`, `onAuthRefreshSuccess`, `onAuthRefreshError`, `onAuthLogout`, `onTokenExpired` (a `setTimeout` at expiry), `onActionUpdate`. The session reads state on demand and assigns none |
| nonce, state | generated and checked by keycloak-js (`useNonce` default `true`); it does not verify token signatures |
| logging | silent unless `enableLogging: true` |
| DPoP | 26.2.5 adds `init({ dpopConfig })` and `keycloak.fetch`; unused until the backends validate DPoP proofs |

## `src/main.tsx` and `src/app/env.ts`

```tsx,verify
// file: src/main.tsx
import "@/app/zod-config";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { configureApi } from "@/api/fetcher";
import { env } from "@/app/env";
import { reloadOnStaleChunk, rootErrorHandlers } from "@/app/error-reporting";
import { startKeycloak } from "@/app/keycloak";
import { createAppRouter } from "@/app/router";
import { createSession, type IdentityProvider } from "@/app/session";
import "@/styles.css";

reloadOnStaleChunk();

const container = document.getElementById("root");
if (!container) throw new Error("index.html has no #root");
const root = createRoot(container, rootErrorHandlers);

function render(provider: IdentityProvider) {
  const session = createSession(provider);
  configureApi({ baseUrl: env.apiOrigin, getToken: session.token, retryToken: session.retryToken });
  root.render(
    <StrictMode>
      <RouterProvider router={createAppRouter({ session })} />
    </StrictMode>,
  );
}

// Never a redirect from here: it would loop while Keycloak keeps refusing the code.
function startFailed(error: unknown) {
  reportError(error);
  root.render(<p role="alert">The app could not start. Reload the page to try again.</p>);
}

startKeycloak({ url: env.authOrigin, realm: "app", clientId: "app-spa" }).then(render, startFailed);
```

- Nothing renders, and no loader runs, before the session exists: the first loader already needs
  to know who is signed in.
- `startKeycloak` rejects when Keycloak sent an error back (the user cancelled) or refused the code;
  `startFailed` is the start-up handler every add-on shares (`frontend-project-structure`).
- `realm` and `clientId` are names you create in Keycloak, the same in every environment, so they are
  constants here; only the origin differs per environment.

```ts,verify
// file: src/app/env.ts
/** The build's public configuration; vite.config.ts refused to build without valid values. */
export const env = {
  apiOrigin: import.meta.env.PUBLIC_API_ORIGIN,
  authOrigin: import.meta.env.PUBLIC_AUTH_ORIGIN,
};
```

`PUBLIC_AUTH_ORIGIN` goes through `frontend-deploy`'s procedure for a new origin; `env.ts` is one of
its steps.

## The CSP: `deploy/headers.ts` and `vite.config.ts`

The sign-out form posts to Keycloak, so `form-action` gains the Keycloak origin and nothing else:
`form-action 'self' <PUBLIC_AUTH_ORIGIN>`. The scaffold's `deploy/headers.ts` with a second,
optional list of origins, `formOrigins`:

```ts,verify
// file: deploy/headers.ts
// The one source of the response headers: `_headers` (Cloudflare), `headers.caddy` (the container)
// and `vite preview` are all rendered from `headerRules`, so they cannot drift.

type Scope = "all" | "assets";

/**
 * `connectOrigins`: every origin the browser calls (API, identity provider, realtime, telemetry).
 * `formOrigins`: every origin a page posts a form to (the identity provider's sign-out).
 */
function csp(connectOrigins: readonly string[], formOrigins: readonly string[]) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    ["connect-src 'self'", ...connectOrigins].join(" "),
    "object-src 'none'",
    "base-uri 'none'",
    ["form-action 'self'", ...formOrigins].join(" "),
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ].join("; ");
}

function headerRules(
  connectOrigins: readonly string[],
  formOrigins: readonly string[],
): Record<Scope, Record<string, string>> {
  return {
    all: {
      // Everything unhashed revalidates: index.html, the SPA fallback, files from public/.
      "Cache-Control": "no-cache",
      "Content-Security-Policy": csp(connectOrigins, formOrigins),
      "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "Cross-Origin-Opener-Policy": "same-origin",
      "Cross-Origin-Resource-Policy": "same-origin",
    },
    // Vite writes every content-hashed file, and only those, under /assets/.
    assets: { "Cache-Control": "public, max-age=31536000, immutable" },
  };
}

/** The headers one request path gets. */
export function headersFor(
  path: string,
  connectOrigins: readonly string[],
  formOrigins: readonly string[] = [],
) {
  const { all, assets } = headerRules(connectOrigins, formOrigins);
  return path.startsWith("/assets/") ? { ...all, ...assets } : all;
}

// Cloudflare joins a header that two matching rules set with a comma, so the `/assets/*` rule first
// detaches (`! Name`) what the `/*` rule set.
export function cloudflareHeaders(
  connectOrigins: readonly string[],
  formOrigins: readonly string[] = [],
) {
  const { all, assets } = headerRules(connectOrigins, formOrigins);
  const lines = (headers: Record<string, string>) =>
    Object.entries(headers).map(([name, value]) => `  ${name}: ${value}`);
  return [
    "/*",
    ...lines(all),
    "/assets/*",
    ...Object.keys(assets).map((name) => `  ! ${name}`),
    ...lines(assets),
    "",
  ].join("\n");
}

// Named snippets that deploy/Caddyfile imports; it applies `assets_headers` to found files only.
export function caddyHeaders(
  connectOrigins: readonly string[],
  formOrigins: readonly string[] = [],
) {
  return Object.entries(headerRules(connectOrigins, formOrigins))
    .flatMap(([scope, headers]) => [
      `(${scope}_headers) {`,
      ...Object.entries(headers).map(([name, value]) => `\t${name} ${JSON.stringify(value)}`),
      "}",
    ])
    .join("\n")
    .concat("\n");
}

// DNS labels or an IPv6 literal only: WHATWG hosts also allow `* ; , { } ' $`, which would widen the
// CSP or become a Caddy placeholder.
const ORIGIN = /^(https?|wss?):\/\/([a-z0-9-]+(\.[a-z0-9-]+)*|\[[0-9a-f:.]+\])(:\d+)?$/;

/** A value that may go into `connect-src` as is: scheme, host and port, nothing else. */
export const isBareOrigin = (value: string) =>
  ORIGIN.test(value) && URL.parse(value)?.origin === value;
```

`deploy/headers.test.ts` keeps its tests and gains one:

```ts,verify,test
// file: deploy/headers.test.ts
import { expect, test } from "vitest";
import { caddyHeaders, cloudflareHeaders, headersFor, isBareOrigin } from "./headers.ts";

const api = ["https://api.example.com"];

test("the CSP allows the app's own scripts and styles and the given origins only", () => {
  expect(headersFor("/", api)["Content-Security-Policy"]).toBe(
    "default-src 'self'; script-src 'self'; style-src 'self'; " +
      "connect-src 'self' https://api.example.com; object-src 'none'; base-uri 'none'; " +
      "form-action 'self'; frame-ancestors 'none'; " +
      "require-trusted-types-for 'script'; trusted-types 'none'",
  );
});

test("a form may post to the given origins only: the identity provider's sign-out", () => {
  const policy = headersFor("/", api, ["https://auth.example.com"])["Content-Security-Policy"];

  expect(policy).toContain("; form-action 'self' https://auth.example.com; ");
  expect(caddyHeaders(api, ["https://auth.example.com"])).toContain(
    "form-action 'self' https://auth.example.com;",
  );
});

test("only hashed assets are cached for a year", () => {
  expect(headersFor("/users/1", api)["Cache-Control"]).toBe("no-cache");
  expect(headersFor("/assets/index-abc.js", api)["Cache-Control"]).toBe(
    "public, max-age=31536000, immutable",
  );
});

test("Cloudflare's /assets/* rule detaches the Cache-Control that /* sets", () => {
  const lines = cloudflareHeaders(api).split("\n");
  const assets = lines.indexOf("/assets/*");

  expect(lines.slice(assets)).toEqual([
    "/assets/*",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ]);
});

test("the Caddy snippets carry the same headers, quoted", () => {
  expect(caddyHeaders(api)).toContain(
    '(assets_headers) {\n\tCache-Control "public, max-age=31536000, immutable"\n}',
  );
  expect(caddyHeaders(api)).toContain('\tX-Content-Type-Options "nosniff"\n');
});

test.each([
  "https://api.example.com",
  "http://localhost:5173",
  "wss://rt.example.com",
  "http://[::1]:8080",
  "https://xn--e1afmkfd.xn--p1ai",
])("%s is a bare origin", (value) => {
  expect(isBareOrigin(value)).toBe(true);
});

// Each would widen the CSP (a wildcard, a second source or directive) or become a Caddy placeholder.
test.each([
  "https://*",
  "https://*.example.com",
  "wss://*",
  "https://a;b",
  "https://a,b",
  "https://{http.request.header.x}",
  "https://$x",
  "https://a'b",
  "https://api.example.com/",
  "https://api.example.com 'unsafe-inline'",
  "data:",
])("%s is refused", (value) => {
  expect(isBareOrigin(value)).toBe(false);
});
```

`vite.config.ts`, after `frontend-deploy`'s procedure has added `PUBLIC_AUTH_ORIGIN` to
`PUBLIC_ENV`, gets the edits below. Each is placed by a line that the scaffold and
`frontend-deploy`'s telemetry add-on both leave in place, so the two add-ons apply in either order
and give the same file; that add-on's reference shows the file with both.

1. Directly above `const ENTRY_BUDGET_BYTES`:

```ts
// keycloak-js posts its sign-out form there, so the ID token stays out of every URL.
const FORM_ACTION_ENV = ["PUBLIC_AUTH_ORIGIN"];
```

2. The signature becomes
   `function securityHeaders(names: readonly string[], formNames: readonly string[]): Plugin {`,
   and `let formOrigins: string[] = [];` goes directly below `let origins: string[] = [];`.
3. In `configResolved`, the per-name check becomes a named function that returns a list. On the
   bare scaffold it is the `origins = names.map((name) => { ... });` callback: it becomes
   `const toOrigins = (name: string) => { ... };`, its `return value;` becomes `return [value];`,
   and `origins = names.flatMap(toOrigins);` follows it. The telemetry add-on makes the same
   change; once `toOrigins` exists, skip that part. Then, directly below
   `origins = names.flatMap(toOrigins);`, add `formOrigins = formNames.flatMap(toOrigins);`, so a
   form origin passes the same bare-origin check.
4. `generateBundle` and the preview middleware pass `formOrigins` as the last argument, in the
   form Biome gives them, and `plugins` calls `securityHeaders(PUBLIC_ENV, FORM_ACTION_ENV)`:

```ts
this.emitFile({
  type: "asset",
  fileName: "_headers",
  source: cloudflareHeaders(origins, formOrigins),
});
this.emitFile({
  type: "asset",
  fileName: "headers.caddy",
  source: caddyHeaders(origins, formOrigins),
});
```

```ts
for (const [name, value] of Object.entries(
  headersFor(request.url ?? "/", origins, formOrigins),
)) {
```

`pnpm build` then writes `form-action 'self' <the auth origin>` into `dist/_headers` and
`dist/headers.caddy`, and `vite preview` sends it; the end-to-end spec in the auth-tests reference
asserts the header.

## `src/app/router.tsx`

The scaffold's file with `session` added to the parameter and the context; nothing else changes.

```tsx,verify
// file: src/app/router.tsx
import { CSPProvider } from "@base-ui/react/csp-provider";
import { Toast } from "@base-ui/react/toast";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  createRouter,
  parseSearchWith,
  type RouterHistory,
  stringifySearchWith,
} from "@tanstack/react-router";
import { ApiError } from "@/api/api-error";
import type { Session } from "@/app/session";
import { routeTree } from "@/routeTree.gen";
import { RouteError } from "@/shared/ui/route-error";
import { ToastProvider } from "@/shared/ui/toast";
import { createQueryClient } from "./query-client";

const NOTICES = {
  refresh: "Could not refresh the data",
  mutation: "The change was not saved",
} as const;

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
  history,
}: {
  session: Session;
  history?: RouterHistory;
}) {
  const toastManager = Toast.createToastManager();
  const queryClient = createQueryClient((reason, error) =>
    toastManager.add({
      title: NOTICES[reason],
      description: error instanceof ApiError && error.requestId && `Request id: ${error.requestId}`,
    }),
  );
  const router = createRouter({
    routeTree,
    context: { queryClient, session },
    ...(history && { history }),
    parseSearch: parseSearchWith(exactJson),
    stringifySearch: stringifySearchWith(JSON.stringify, exactJson),
    defaultPreload: "intent",
    // Query owns freshness: the router always runs loaders, and they read the cache.
    defaultPreloadStaleTime: 0,
    scrollRestoration: true,
    // Each route catches its own error, so the root layout and its navigation stay on screen.
    defaultErrorComponent: RouteError,
    // The provider slot: app-wide providers (i18n, a realtime client) go here, once for app and tests.
    // biome-ignore lint/correctness/noComponentHookFactories: built once per router, which keeps it.
    Wrap: ({ children }) => (
      // Base UI's inline <style> tags would break the CSP's `style-src 'self'`.
      <CSPProvider disableStyleElements>
        <QueryClientProvider client={queryClient}>
          <ToastProvider manager={toastManager}>{children}</ToastProvider>
        </QueryClientProvider>
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

## `src/routes/__root.tsx`

```tsx,verify
// file: src/routes/__root.tsx
import type { QueryClient } from "@tanstack/react-query";
import { createRootRouteWithContext, Link, Outlet, useLocation } from "@tanstack/react-router";
import type { Session } from "@/app/session";
import { Button } from "@/shared/ui/button";

export const Route = createRootRouteWithContext<{ queryClient: QueryClient; session: Session }>()({
  component: RootLayout,
  notFoundComponent: PageNotFound,
});

function RootLayout() {
  const session = Route.useRouteContext({ select: (context) => context.session });
  const href = useLocation({ select: (location) => location.href });
  return (
    <>
      <header className="border-line border-b">
        <nav aria-label="Main" className="mx-auto flex max-w-3xl items-center gap-4 p-4">
          <Link to="/users" activeOptions={{ exact: true }}>
            Users
          </Link>
          <Link to="/users/new">New user</Link>
          {session.userId() ? (
            <Button className="ms-auto" onClick={() => void session.signOut()}>
              Sign out
            </Button>
          ) : (
            <Button className="ms-auto" onClick={() => void session.signIn(href)}>
              Sign in
            </Button>
          )}
        </nav>
      </header>
      <main className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
        <Outlet />
      </main>
    </>
  );
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

`session.userId()` is read during render: it changes only across a page load (sign-in and sign-out
leave the page), so no Context or subscription is needed.

## The guard and a protected route

```tsx,verify
// file: src/routes/_signed-in.tsx
import { createFileRoute } from "@tanstack/react-router";

/** Every route under `src/routes/_signed-in/` needs a session; the rest of the app is public. */
export const Route = createFileRoute("/_signed-in")({
  beforeLoad: ({ context, location, preload }) => {
    const userId = context.session.userId();
    if (userId) return { userId };
    // A hovered link only preloads; a navigation leaves for the sign-in page and never finishes.
    if (preload) throw new Error("Signed out");
    return context.session.signIn(location.href);
  },
});
```

- Returning the never-settling `signIn` keeps the current screen while the browser leaves; throwing
  would flash the error page first.
- `preload` is `true` when a hovered link (`defaultPreload: "intent"`) runs the guard; throwing there
  only cancels the preload. Without the check, hovering a protected link signs the user in.
- `location.href` is the router's path, search and hash (no origin, no `base`): the return path.

Protected routes move into `src/routes/_signed-in/`; their URLs do not change. `git mv` the file (its
test with it) and update the id in its `createFileRoute(...)` call, then run `pnpm test` or
`pnpm dev` once before `pnpm check`: `tsc` reads the committed `routeTree.gen.ts`, which only the
router plugin rewrites, and fails with `TS2345: Argument of type '"/_signed-in/users/"' is not
assignable to parameter of type 'keyof FileRoutesByPath | undefined'` until then. A complete route file another skill gives for `src/routes/users/…` then lives at
`src/routes/_signed-in/users/…` with the id `/_signed-in/users/…`; merge it into the moved file.

```tsx,verify
// file: src/routes/_signed-in/account.tsx
import { useSuspenseQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { getGetUserQueryOptions, getGetUserSuspenseQueryOptions } from "@/api/generated/api";
import { UserDetails } from "@/features/users/user-details";

export const Route = createFileRoute("/_signed-in/account")({
  loader: ({ context }) =>
    context.queryClient.query({ ...getGetUserQueryOptions(context.userId), staleTime: "static" }),
  component: AccountPage,
});

function AccountPage() {
  const userId = Route.useRouteContext({ select: (context) => context.userId });
  const { data: user } = useSuspenseQuery(getGetUserSuspenseQueryOptions(userId));

  return (
    <>
      <title>Account</title>
      <h1 className="font-semibold text-2xl">{user.name}</h1>
      <UserDetails user={user} />
    </>
  );
}
```

`context.userId` is a `string` here: the guard's return value is merged into every child's context.
Who may see a page beyond being signed in is a permission the API sends (a `/me` endpoint read
through `context.queryClient` in a `beforeLoad`), never a token claim, and it only hides UI: the API
answers 403 to the same call regardless.

## `src/shared/ui/route-error.tsx`

```tsx,verify
// file: src/shared/ui/route-error.tsx
import { useQueryErrorResetBoundary } from "@tanstack/react-query";
import { type ErrorComponentProps, useRouter } from "@tanstack/react-router";
import { useEffect } from "react";
import { ApiError } from "@/api/api-error";
import { Button } from "./button";

/** The router's `defaultErrorComponent`: the page failed to load or render. */
export function RouteError({ error }: ErrorComponentProps) {
  const router = useRouter();
  const { reset } = useQueryErrorResetBoundary();
  // A query that failed inside the boundary would otherwise rethrow its cached error on retry.
  useEffect(() => reset(), [reset]);
  // Signed in but not allowed: signing in again cannot change the answer.
  const title =
    error instanceof ApiError && error.status === 403
      ? "You do not have access to this page"
      : "This page could not be loaded";

  return (
    <div role="alert" className="flex flex-col items-start gap-3">
      <title>{title}</title>
      <h1 className="font-semibold text-xl">{title}</h1>
      {error instanceof ApiError && error.requestId ? <p>Request id: {error.requestId}</p> : null}
      <Button onClick={() => router.invalidate()}>Try again</Button>
    </div>
  );
}
```

## `src/shared/lib/safe-url.ts`

`frontend-deploy`'s file, the same bytes; keep the one already in the app. `startKeycloak` passes
the saved return path through `sameOriginPath`. When the file is new, add `safe-url.test.ts` from
`frontend-deploy`'s client-security reference with it: without the test, knip reports `safeHref` as
an unused export and `pnpm check` fails.

```ts,verify
// file: src/shared/lib/safe-url.ts
const LINK_PROTOCOLS = new Set(["https:", "mailto:"]);

/** A user-supplied link target, or undefined when its scheme is not allowed. */
export function safeHref(value: string): string | undefined {
  const url = URL.parse(value);
  return url && LINK_PROTOCOLS.has(url.protocol) ? url.href : undefined;
}

/** A redirect target such as `?returnTo=`: a path on this origin, or "/" for anything else. */
export function sameOriginPath(value: string | null | undefined): string {
  const url = URL.parse(value ?? "/", window.location.origin);
  // "/.//evil.example" resolves to the path "//evil.example", which a browser reads as another host.
  if (url?.origin !== window.location.origin || url.pathname.startsWith("//")) return "/";
  return url.pathname + url.search + url.hash;
}
```

## The Keycloak client

Set up once per environment by whoever administers the realm; the app needs these values (Keycloak's
admin-console names):

| Setting | Value |
|---|---|
| Client authentication | off (a public client) |
| Flows | standard flow only; implicit flow, direct access grants and service accounts off |
| PKCE | `S256` required (client advanced setting) |
| Valid redirect URIs | exactly the app's root URL per origin (`<origin>/`, or `<origin><base>` under a Vite `base`): production, `http://localhost:5173/` (dev), `http://localhost:4173/` (`pnpm test:e2e`). No `*` |
| Valid post logout redirect URIs | the same list |
| Web origins | exactly each app origin, no `+` or `*`: the token endpoint answers the browser's CORS request with it |
| Realm: Revoke Refresh Token | on: each refresh rotates the refresh token |
| Tokens | access token 5 to 15 minutes; SSO Session Idle bounds an idle tab, because nothing refreshes without a request |
| Scopes | no `offline_access`: an offline token survives sign-out and idle limits |
| Audience | an audience mapper naming the API, which checks `aud` |

## Bundle cost and what was run

Measured with `pnpm build` on the scaffold: this file set adds about 10 KB gzip to the entry chunk
and its static imports, almost all of it keycloak-js. Raise `ENTRY_BUDGET_BYTES` in `vite.config.ts`
by the growth `pnpm build` reports, in the same change, naming keycloak-js as the cause; never a
fixed number without the build (the plugin is
`frontend-tooling`'s); a dynamic `import("@/app/keycloak")` only moves the same bytes behind one
more round trip before first render.

With these files and the end-to-end files of the auth-tests reference, the scaffold's
`pnpm test:e2e` passes with the users pages moved under `_signed-in/`: the production build behind
the generated CSP with Trusted Types, against Keycloak 26.8.2 (public client, PKCE, refresh-token
rotation) on another site than the app. In Chromium, Firefox and WebKit it signs in, signs out by
form POST without a confirmation page and back at the app's root, sends a second signed-in tab to
Keycloak's form through the broadcast, puts `id_token_hint` in no URL and reports no CSP violation.

The back-forward cache, shown in Chromium (Playwright's default `--disable-back-forward-cache`
removed): a signed-in page left for another site comes back with `persisted` and, without the
`pageshow` listener, stays signed in; with it, it reloads. A page that receives the sign-out message
while cached is evicted instead (`notRestoredReasons`: `broadcastchannel-message`). Firefox and
WebKit under Playwright restored no page at all, so the listener is unproven there.
