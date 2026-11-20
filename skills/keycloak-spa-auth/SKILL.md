---
name: keycloak-spa-auth
description: "Use when adding login, sign-in or bearer tokens to the SPA with keycloak-js, or showing UI by role: keycloak.init options, updateToken, checkLoginIframe, onLoad check-sso or login-required, silent-check-sso.html, configureApi getToken and retryToken, a 401 or 403 from the API, a sign-in redirect loop, a _signed-in guard route, sign-out, PUBLIC_AUTH_ORIGIN, oidc-client-ts, signed-out or expired sessions in route tests. Not for beforeLoad and redirect mechanics (tanstack-router-spa), apiFetch and ApiError (tanstack-query-api), CSP headers (frontend-deploy)."
metadata:
  version: "0.1.0"
---

# Keycloak sign-in for a browser-only SPA

Assumes keycloak-js 26.2, oidc-client-ts 3.5, @tanstack/react-router 1.170.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, use its own modules, helpers and scripts, and say so when it has no equivalent instead of adding one unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If `pnpm-lock.yaml` pins another major version than the line above, follow the project and say which rules may not apply.

## Important

- Tokens live only in the keycloak-js instance's memory. Never write a token to `localStorage`, `sessionStorage`, a cookie, the URL, a `BroadcastChannel` or a log: any script on the origin reads storage. A reload starts signed out: a guarded route runs the code flow again (silently while Keycloak's SSO cookie lives), a public page shows the signed-out state until the user signs in.
- One `keycloak.init` per page load, in `main.tsx` before `createAppRouter`, with `checkLoginIframe: false`, `redirectUri` set to the app's root URL and no `onLoad`: a second `init` throws, `onLoad: "login-required"` makes every cleared token leave the page, and without `redirectUri` keycloak-js sends the current URL, which a deep link never registers.
- A 401 gets one forced refresh (shared by concurrent requests, at most one a minute) and one retry, then the route's error page. Sign-in starts only from the guard, the Sign in button, another tab's sign-out, or Keycloak refusing a refresh, and never in the first 60 s after a sign-in. A 403 is a no-access screen, never a sign-in.
- Route tests choose the session through `renderRoute(path, { session: createSession(fakeIdentity(state)) })`. Never `vi.mock("keycloak-js")` or an app module.
- What the UI shows or hides by role comes from the API (a `/me` endpoint), never from token claims, and only hides: the API enforces the same rule with a 403.

## References

- `references/session-module.md` — `session.ts`, `keycloak.ts` and every scaffold file the add-on changes, complete, with what each adds; the keycloak-js 26.2 fact table; Keycloak client settings; bundle cost. Open when adding authentication or changing the session.
- `references/auth-tests.md` — the fake identity provider, the changed `renderRoute`, route tests (guard, 401, expiry, loop guard, 403, sign-out), the two-tab sign-out, keycloak-js against a fake token endpoint. Open before any test that involves the session.
- `references/oidc-client-ts.md` — the same contract over `oidc-client-ts` with its defaults overridden, and its tests. Open when the identity provider is not Keycloak.

Guard mechanics are `tanstack-router-spa`'s; `apiFetch`, `ApiError` and the Query retry predicate `tanstack-query-api`'s; adding a `PUBLIC_*` origin and the CSP `frontend-deploy`'s; `renderRoute` and MSW `frontend-testing`'s.

## The decision

Authorization Code with PKCE in the browser, a public client, tokens in memory, `Authorization: Bearer` to the app's own API. An accepted risk: RFC 10017 prefers a backend-for-frontend for business and personal-data apps, because page script can use in-memory tokens; the strict CSP with Trusted Types is the mitigation. When a project requires that page script never holds a token, a confidential client or back-channel logout, say so and stop.

## The files

| File | Holds |
|---|---|
| `src/app/session.ts` | `IdentityProvider` (what Keycloak provides), `Session` (what the app uses), `createSession(provider)` with the whole policy |
| `src/app/keycloak.ts` | `startKeycloak({ url, realm, clientId })`, the only importer of `keycloak-js` |
| `src/app/router.tsx` | `createAppRouter({ session, history })`, `context: { queryClient, session }` |
| `src/routes/_signed-in.tsx` | the guard; protected routes live in `src/routes/_signed-in/` |
| `src/test/identity.ts` | `fakeIdentity("signed-in" \| "signed-out" \| "just-signed-out" \| "expired")` |

Only the composition root, route files and tests read the session; a feature gets `userId` or an `onSignOut` callback as props. The session lives in the router context, never in a React Context: it changes only across page loads. `main.tsx` renders once the session exists: `startKeycloak(...).then(render, startFailed)`, `startFailed` being the start-up handler every add-on shares (`frontend-project-structure`).

## keycloak-js 26.2

- `init` resolves `true` only after processing Keycloak's callback in the URL fragment, which it strips; otherwise `false`, with no request. It rejects with a plain `{ error, error_description }` object on an `error=` callback: `startFailed`, never another redirect.
- `updateToken(minValidity)` refreshes when the token expires within `minValidity` seconds; concurrent calls share one request.
- A 400 from the token endpoint clears every token; a network error or 5xx keeps the held token for the API to judge.

## Token and status policy

| Situation | What happens | What the user sees |
|---|---|---|
| a request | refresh first when under 30 s remain | nothing |
| API answers 401 | one forced refresh, shared and at most one a minute, then one retry | the page, if the retry succeeds |
| 401 again, with a fresh token | `ApiError` 401; no sign-in: the API rejects good tokens | the route's error page with the request id |
| Keycloak refuses the refresh (400) | the session ends and leaves for sign-in with the current path | Keycloak's login page, then the same page |
| refused within 60 s of a sign-in | the session ends without leaving: the loop guard | the error page |
| API answers 403 | `ApiError` 403 | "You do not have access to this page" |
| signed out, public page | requests carry no token | the page |

`createQueryClient` never retries a 401 or 403.

## Route guard policy

Every route is public unless it sits under `src/routes/_signed-in/`. When every page needs sign-in, every route file moves there, `index.tsx` included, and `__root.tsx` stays outside; URLs do not change. The guard is the whole policy:

```tsx
beforeLoad: ({ context, location, preload }) => {
  const userId = context.session.userId();
  if (userId) return { userId };
  if (preload) throw new Error("Signed out");
  return context.session.signIn(location.href);
},
```

- `signIn` never settles, so the screen stays while the browser leaves; a hovered link only preloads and must not leave the page.
- The return path travels in `sessionStorage`, never through Keycloak: one exact redirect URI, the app's root URL. On return it goes through `sameOriginPath` (`frontend-deploy`'s `src/shared/lib/safe-url.ts`), which turns `//evil.example`, `/\evil.example`, `/.//evil.example` and URLs into `/`.

## Sign-out, other tabs, sleeping tabs

| Event | What happens | What the user sees |
|---|---|---|
| Sign out (root layout) | the logout URL with `id_token_hint`; the page Keycloak sends back posts `"signed-out"` on `BroadcastChannel("session")` | no confirmation page; back at the app's root |
| signed out in another tab | every other signed-in tab leaves for sign-in | Keycloak's login page |
| the tab slept past Keycloak's SSO Session Idle | the refresh is refused, the session ends | Keycloak's login page, then the same page |

Each tab holds its own refresh chain: tabs sharing one rotated refresh token end each other's session.

## Configuration

- `PUBLIC_AUTH_ORIGIN`: the bare Keycloak origin, added through `frontend-deploy`'s procedure and read as `env.authOrigin`. Only `connect-src` changes in the CSP: logout is a GET navigation and no iframe exists.
- The Keycloak client: public, standard flow only, PKCE S256, redirect and post-logout URIs exactly the app's root URL per origin (`<origin>/`, or `<origin><base>` under a Vite `base`), exact web origins, refresh-token rotation, no `offline_access`.
- Raise `ENTRY_BUDGET_BYTES` by the growth `pnpm build` reports (about 10 KB gzip for keycloak-js on the scaffold), in the same change, naming keycloak-js as the cause; never a fixed number without the build.

## Tests

`renderRoute(path)` without options is signed in, so existing route tests keep passing; `fakeIdentity` replaces only Keycloak. An expired session needs `vi.setSystemTime(Date.now() + 61_000)` after `createSession`, or the loop guard holds the redirect.

## Prior-version corrections

| Older examples write | Correct now |
|---|---|
| `onLoad: "check-sso"` with `silentCheckSsoRedirectUri` and `public/silent-check-sso.html` | no `onLoad`, no silent page: its iframe needs third-party cookies (blocked by Safari and Firefox) and `frame-src`; the fallback is a `prompt=none` redirect on every load |
| tokens in `localStorage`, `init({ token, refreshToken })` from storage | memory only; a guarded route runs the code flow again |
| `@react-keycloak/web`, `react-oidc-context`, a `<ReactKeycloakProvider>` | `createSession` in `main.tsx`, the session in the router context |
| `flow: "implicit"`, `response_type=token` | standard flow with PKCE (`pkceMethod: "S256"`, the default since 26) |
| `setInterval(() => keycloak.updateToken(70), 60_000)`, `onTokenExpired = () => keycloak.updateToken()` | `session.token()` before each request |
| `updateToken(0)` meaning "only once expired" | `0` means 5 seconds; `-1` forces |
| `keycloak.hasRealmRole("admin")`, `tokenParsed.realm_access.roles` to decide access | permissions from the API; keycloak-js verifies no signature |
| `new Keycloak("/keycloak.json")` | `new Keycloak({ url, realm, clientId })` (the string form fetches a file first) |
| `import Keycloak from "keycloak-js/dist/keycloak"` | `import Keycloak from "keycloak-js"`: ESM only, exports `.` and `./authz` |
| `oidc-client-ts` defaults: `sessionStorage` user store, `automaticSilentRenew: true` | `InMemoryWebStorage` user store, renew on demand |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| redirect to Keycloak on every 401, or on a 403 | one forced refresh and retry; the no-access screen |
| pass `?redirect=${location.href}` through Keycloak, or register `<origin>/*` | the return path in `sessionStorage`, read through `sameOriginPath`; one exact redirect URI |
| share tokens between tabs, or broadcast `"signed-out"` before leaving for the logout | each tab its own chain; the page the logout returns to broadcasts: earlier, the other tabs get a code the logout invalidates |
| put the token in a WebSocket or SSE URL | the `Authorization` header or the first message (`frontend-realtime`) |
| enable direct access grants for Playwright sign-ins | sign in through Keycloak's form |
| add an idle timer or refresh loop | Keycloak's SSO Session Idle |
| build a token proxy or backend-for-frontend inside this SPA | stop and raise it: the architecture decides |
