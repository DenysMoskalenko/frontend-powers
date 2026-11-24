---
name: keycloak-spa-auth
description: "Use when adding login, sign-in or bearer tokens to the SPA with keycloak-js, or showing UI by role: keycloak.init, updateToken, checkLoginIframe, onLoad check-sso, configureApi getToken and retryToken, a 401 or 403 from the API, a sign-in redirect loop, a _signed-in guard route, sign-out and its form-action, PUBLIC_AUTH_ORIGIN, oidc-client-ts, signed-out sessions in route tests, Playwright against Keycloak. Not for beforeLoad and redirect mechanics (tanstack-router-spa), apiFetch and ApiError (tanstack-query-api), other CSP headers (frontend-deploy)."
metadata:
  version: "0.1.0"
---

# Keycloak sign-in for a browser-only SPA

Assumes keycloak-js 26.2, oidc-client-ts 3.5, @tanstack/react-router 1.170, @playwright/test 1.65.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another version of a package than the line above, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

## Important

- Tokens live only in the keycloak-js instance's memory, never in web storage, a cookie, a URL, a `BroadcastChannel` or a log; sign-out posts the ID token hint in a form body (`logoutMethod: "POST"`). The cost: every page load starts signed out, so a guarded page makes a round trip through Keycloak and the app starts twice, and a public page looks signed out until Sign in. Showing the signed-in state there needs `check-sso`, priced in the session-module reference; the user decides.
- One `keycloak.init` per page load, in `main.tsx` before `createAppRouter`, with `checkLoginIframe: false`, `redirectUri` set to the app's root URL and no `onLoad`: a second `init` throws, `"login-required"` leaves the page on every cleared token, and without `redirectUri` a deep link is sent as the redirect URI.
- A 401 gets one forced refresh (shared, at most one a minute) and one retry, then the error page. Sign-in starts only from the guard, the Sign in button, or a refused refresh (never within 60 s of a sign-in); from then `session.token()` waits while the page leaves, so nothing goes out without a token and no error shows first. A 403 is a no-access screen, never a sign-in.
- Route tests choose the session through `renderRoute(path, { session: createSession(fakeIdentity(state)) })`. Never `vi.mock("keycloak-js")` or an app module.
- What the UI shows about the user (name, roles, permissions) comes from the API (a `/me` endpoint), never from token claims, and hiding by role only hides: the API enforces the same rule with a 403.

## References

- `references/session-module.md` — every file the add-on adds or changes (the CSP's `form-action` included); moving routes under the guard; keycloak-js 26.2 facts; the Keycloak client; the cost of tokens in memory and `check-sso`. Open when adding authentication or changing the session.
- `references/auth-tests.md` — the fake identity provider, `renderRoute` with a session, route, session and keycloak-js tests, and `pnpm test:e2e` against a real Keycloak (`e2e/auth.ts`, one sign-in per worker, the CI service). Open before any test that involves the session.
- `references/oidc-client-ts.md` — the same contract over `oidc-client-ts`, and when keycloak-js's `oidcProvider` will do. Open when the identity provider is not Keycloak.

Guard mechanics are `tanstack-router-spa`'s; `apiFetch`, `apiUpload`, `ApiError` and the retry predicate `tanstack-query-api`'s; a `PUBLIC_*` origin and the CSP `frontend-deploy`'s; `renderRoute`, MSW and the composed Playwright files `frontend-testing`'s.

## The decision

Authorization Code with PKCE in the browser, a public client, tokens in memory, `Authorization: Bearer` to the app's own API. A stated deviation: RFC 10017 (BCP 212) does not recommend a browser-only client for business, sensitive or personal-data applications and recommends a backend-for-frontend; static hosting is the owner's constraint, and the strict CSP with Trusted Types makes script injection harder but does not stop injected script from running its own sign-in flow. The app's architecture document records the choice. When a project requires backend-for-frontend guarantees (no token in page script, a confidential client, back-channel logout), say so and stop.

## The session

`src/app/session.ts` holds the policy over an `IdentityProvider` that `src/app/keycloak.ts` (the only importer of `keycloak-js`) implements and route tests fake. `main.tsx` chains `startKeycloak(...).then(render).catch(startFailed)`; `render` gives `configureApi` the session's `token` and `retryToken` and puts the session in the router context. Only the composition root, route files and tests read it, never through a React Context; a feature gets `userId` or a callback as props.

| Situation | What happens | What the user sees |
|---|---|---|
| a request | refresh first when under 30 s remain | nothing |
| API answers 401 | one forced refresh, then one retry | the page, if the retry succeeds |
| 401 again, with a fresh token | `ApiError` 401; no sign-in: the API rejects good tokens | the route's error page |
| Keycloak refuses the refresh (400), as after SSO Session Idle | the session ends and leaves for sign-in; requests wait | the page as it was, Keycloak's login, the same page |
| a leave guard keeps the page ("Leave site?", Stay) | after 10 s waiting requests reject (`AbortError`); the next one leaves again | the form's failure, input kept; or the error page or refresh toast |
| refused within 60 s of a sign-in | the request goes out without a token: the loop guard; the first request after the 60 s leaves | the error page |
| API answers 403 | `ApiError` 403 | "You do not have access to this page" |
| signed out, public page | requests carry no token | the page |

The token refreshes only when a request goes out, so a form filled for longer than the realm's SSO Session Idle is lost on submit: a route whose form can take that long wraps it in `<div onInput={session.activity}>`.

## Route guard policy

Every route is public unless it sits under `src/routes/_signed-in/`, whose `beforeLoad` returns `{ userId }` or, signed out, the never-settling `session.signIn(location.href)`; a preload throws instead, so a hovered link never leaves the page. When every page needs sign-in, every route file but `__root.tsx` moves there; URLs do not change. The return path travels in `sessionStorage`, never through Keycloak (one exact redirect URI, the app's root URL), and comes back through `sameOriginPath`.

## Sign-out, other tabs, sleeping tabs

| Event | What happens | What the user sees |
|---|---|---|
| Sign out | a form POST to Keycloak's logout; the page Keycloak sends back posts `"signed-out"` on a `BroadcastChannel` named after Vite's `base` | no confirmation page; the app's root |
| signed out in another tab | every other signed-in tab reloads and starts signed out | a guarded page: Keycloak's login page; a public page: the page, signed out |
| a page comes back from the back-forward cache | it reloads: it may have missed the message | the page |

## Configuration and tests

`PUBLIC_AUTH_ORIGIN`, the bare Keycloak origin (`frontend-deploy`'s procedure, read as `env.authOrigin`), goes into `connect-src` and `form-action`; without the latter, sign-out fails with `violates the following Content Security Policy directive: "form-action 'self'"`. Raise `ENTRY_BUDGET_BYTES` by the growth `pnpm build` reports (about 10 KB gzip for keycloak-js), naming keycloak-js as the cause.

`renderRoute(path)` without options is signed in, so existing route tests keep passing; `pnpm test:e2e` needs a real Keycloak once guarded pages exist.

## Prior-version corrections

| Older examples write | Correct now |
|---|---|
| `onLoad: "check-sso"` with `silentCheckSsoRedirectUri` and `public/silent-check-sso.html` | no `onLoad`, no silent page, unless a public page must show the signed-in state (session-module reference) |
| tokens in `localStorage`, `init({ token, refreshToken })` from storage | memory only |
| `@react-keycloak/web`, `react-oidc-context`, a `<ReactKeycloakProvider>` | the session in the router context |
| `flow: "implicit"`, `response_type=token` | standard flow with PKCE (`pkceMethod: "S256"`, the default since 26) |
| `setInterval(() => keycloak.updateToken(70), 60_000)`, `onTokenExpired = () => keycloak.updateToken()` | `session.token()` before each request; `session.activity()` on input in a long form |
| `updateToken(0)` meaning "only once expired" | `0` means 5 seconds; `-1` forces |
| `keycloak.hasRealmRole("admin")`, `tokenParsed.realm_access.roles` to decide access | permissions from the API; keycloak-js verifies no signature |
| `keycloak.logout()` or `location.replace(keycloak.createLogoutUrl())` (a GET with `id_token_hint` in the query), oidc-client-ts `signoutRedirect()` | `logoutMethod: "POST"` (oidc-client-ts: a posted form), the provider's origin in `form-action` |
| a Playwright fixture that fills Keycloak's form before every test | one sign-in per worker, its SSO cookie through `storageState` (`e2e/auth.ts`) |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| pass `?redirect=${location.href}` through Keycloak, or register `<origin>/*` | the return path in `sessionStorage`, read through `sameOriginPath`; one exact redirect URI |
| share tokens between tabs, or broadcast `"signed-out"` before leaving for the logout | each tab its own chain (a rotated refresh token survives one tab); the page the logout returns to broadcasts |
| add an idle-logout timer or a token-refresh loop | nothing for idle tabs: Keycloak's SSO Session Idle ends them; `session.activity()` on input for a long form |
| return `undefined`, or a promise that never settles, from `getToken` once sign-in has started | the session's departure promise: it rejects after 10 s if the page stays |
| send every tab that hears `"signed-out"` to Keycloak's form | reload it |
| treat a signed-in user whose access token has no `sub` as signed out | reject the start (`startKeycloak` throws): the guard would loop through Keycloak without end |
| enable direct access grants for Playwright sign-ins | Keycloak's form, once per worker: a password grant skips the code flow and PKCE |
| assert an expired session's redirect right after `createSession` | `vi.setSystemTime(Date.now() + 61_000)` first, or the 60 s loop guard holds the redirect |
