---
name: keycloak-spa-auth
description: "Use when adding login, sign-in or bearer tokens to the SPA with keycloak-js, or showing UI by role: keycloak.init, updateToken, checkLoginIframe, onLoad check-sso, configureApi getToken and retryToken, a 401 or 403 from the API, a sign-in redirect loop, a _signed-in guard route, sign-out and its form-action, PUBLIC_AUTH_ORIGIN, oidc-client-ts, signed-out sessions in route tests, Playwright against Keycloak. Not for beforeLoad and redirect mechanics (tanstack-router-spa), apiFetch and ApiError (tanstack-query-api), other CSP headers (frontend-deploy)."
metadata:
  version: "0.1.0"
---

# Keycloak sign-in for a browser-only SPA

Assumes keycloak-js 26.2, oidc-client-ts 3.5, @tanstack/react-router 1.170.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another version of a package than the line above, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

## Important

- Tokens live only in the keycloak-js instance's memory, never in web storage, a cookie, a URL, a `BroadcastChannel` or a log; sign-out posts the ID token hint in a form body (`logoutMethod: "POST"`). A reload starts signed out: a guarded route runs the code flow again (silently while Keycloak's SSO cookie lives), a public page shows the signed-out state until the user signs in.
- One `keycloak.init` per page load, in `main.tsx` before `createAppRouter`, with `checkLoginIframe: false`, `redirectUri` set to the app's root URL and no `onLoad`: a second `init` throws, `onLoad: "login-required"` makes every cleared token leave the page, and without `redirectUri` keycloak-js sends the current URL, which a deep link never registers.
- A 401 gets one forced refresh (shared by concurrent requests, at most one a minute) and one retry, then the route's error page. Sign-in starts only from the guard, the Sign in button, another tab's sign-out, or Keycloak refusing a refresh, and never in the first 60 s after a sign-in. A 403 is a no-access screen, never a sign-in.
- Route tests choose the session through `renderRoute(path, { session: createSession(fakeIdentity(state)) })`. Never `vi.mock("keycloak-js")` or an app module.
- What the UI shows about the user (name, roles, permissions) comes from the API (a `/me` endpoint), never from token claims, and hiding by role only hides: the API enforces the same rule with a 403.

## References

- `references/session-module.md` — `session.ts`, `keycloak.ts` and every scaffold file the add-on changes, complete (the CSP's `form-action` included); moving routes under the guard; keycloak-js 26.2 facts; the Keycloak client settings; bundle cost. Open when adding authentication or changing the session.
- `references/auth-tests.md` — the fake identity provider, the changed `renderRoute`, route tests (guard, 401, expiry, loop guard, 403, sign-out), session and keycloak-js unit tests, and `pnpm test:e2e` against a real Keycloak (realm, sign-in fixture, `webServer`, CI services). Open before any test that involves the session.
- `references/oidc-client-ts.md` — the same contract over `oidc-client-ts` with its defaults overridden, and its tests. Open when the identity provider is not Keycloak.

Guard mechanics are `tanstack-router-spa`'s; `apiFetch`, `ApiError` and the Query retry predicate `tanstack-query-api`'s; adding a `PUBLIC_*` origin and the CSP `frontend-deploy`'s; `renderRoute` and MSW `frontend-testing`'s.

## The decision

Authorization Code with PKCE in the browser, a public client, tokens in memory, `Authorization: Bearer` to the app's own API. A stated deviation: RFC 10017 (BCP 212) rates a browser-only OAuth client "not recommended for business applications, sensitive applications, and applications that handle personal data" and strongly recommends a backend-for-frontend for them. Static hosting is the owner's constraint, so the browser client stays; the strict CSP with Trusted Types makes script injection harder and does not stop injected script from running its own sign-in flow. The app's architecture document records the choice. When a project requires backend-for-frontend guarantees (no token in page script, a confidential client, back-channel logout), say so and stop.

## The files

| File | Holds |
|---|---|
| `src/app/session.ts` | `IdentityProvider` (what Keycloak provides), `Session` (what the app uses), `createSession(provider)` with the whole policy |
| `src/app/keycloak.ts` | `startKeycloak({ url, realm, clientId })`, the only importer of `keycloak-js` |
| `src/main.tsx` | `configureApi({ baseUrl, getToken: session.token, retryToken: session.retryToken })` once the session exists |
| `src/app/router.tsx` | `createAppRouter({ session, history })`, `context: { queryClient, session }` |
| `src/routes/_signed-in.tsx` | the guard; protected routes live in `src/routes/_signed-in/` |
| `src/shared/ui/route-error.tsx` | a 403 reads "You do not have access to this page" |
| `src/test/identity.ts` | `fakeIdentity("signed-in" \| "signed-out" \| "just-signed-out" \| "expired")` |

Only the composition root, route files and tests read the session; a feature gets `userId` or an `onSignOut` callback as props. The session lives in the router context, never in a React Context: it changes only across page loads. `main.tsx` renders once the session exists: `startKeycloak(...).then(render, startFailed)`.

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

Every route is public unless it sits under `src/routes/_signed-in/`. When every page needs sign-in, every route file moves there, `index.tsx` included, and `__root.tsx` stays outside; URLs do not change. After a move, run `pnpm test` or `pnpm dev` once before `pnpm check`: `tsc` reads the committed `routeTree.gen.ts`. The guard is the whole policy:

```tsx
beforeLoad: ({ context, location, preload }) => {
  const userId = context.session.userId();
  if (userId) return { userId };
  if (preload) throw new Error("Signed out");
  return context.session.signIn(location.href);
},
```

- `signIn` never settles, so the screen stays while the browser leaves; a hovered link only preloads and must not leave the page.
- The return path travels in `sessionStorage`, never through Keycloak (one exact redirect URI, the app's root URL), and comes back through `frontend-deploy`'s `sameOriginPath`.

## Sign-out, other tabs, sleeping tabs

| Event | What happens | What the user sees |
|---|---|---|
| Sign out (root layout) | a form POST to Keycloak's logout with `id_token_hint`; the page Keycloak sends back posts `"signed-out"` on a `BroadcastChannel` named after Vite's `base` | no confirmation page; back at the app's root |
| signed out in another tab | every other signed-in tab leaves for sign-in | Keycloak's login page |
| the tab slept past Keycloak's SSO Session Idle | the refresh is refused, the session ends | Keycloak's login page, then the same page |
| a page comes back from the back-forward cache (`pageshow`, `persisted`) | it reloads: it may have missed the message | the page, signed in again or not |

## Configuration

- `PUBLIC_AUTH_ORIGIN`: the bare Keycloak origin, added through `frontend-deploy`'s procedure and read as `env.authOrigin`. It goes into `connect-src` and, for the sign-out form, `form-action` (`deploy/headers.ts`); without it there, sign-out fails with `violates the following Content Security Policy directive: "form-action 'self'"`.
- Raise `ENTRY_BUDGET_BYTES` by the growth `pnpm build` reports (about 10 KB gzip for keycloak-js on the scaffold), in the same change, naming keycloak-js as the cause; never a fixed number without the build.

## Tests

`renderRoute(path)` without options is signed in, so existing route tests keep passing; `fakeIdentity` replaces only Keycloak. `pnpm test:e2e` signs in through a real Keycloak (container locally, a job service in CI) once guarded pages exist; without it the smoke specs fail.

## Prior-version corrections

| Older examples write | Correct now |
|---|---|
| `onLoad: "check-sso"` with `silentCheckSsoRedirectUri` and `public/silent-check-sso.html` | no `onLoad`, no silent page: its iframe needs `frame-src`, and third-party cookies when Keycloak is on another site (blocked by Safari and Firefox); the fallback is a `prompt=none` redirect on every load |
| tokens in `localStorage`, `init({ token, refreshToken })` from storage | memory only; a guarded route runs the code flow again |
| `@react-keycloak/web`, `react-oidc-context`, a `<ReactKeycloakProvider>` | `createSession` in `main.tsx`, the session in the router context |
| `new Keycloak("/keycloak.json")` | `new Keycloak({ url, realm, clientId })`: the string form fetches that file before `init` |
| `flow: "implicit"`, `response_type=token` | standard flow with PKCE (`pkceMethod: "S256"`, the default since 26) |
| `setInterval(() => keycloak.updateToken(70), 60_000)`, `onTokenExpired = () => keycloak.updateToken()` | `session.token()` before each request |
| `updateToken(0)` meaning "only once expired" | `0` means 5 seconds; `-1` forces |
| `keycloak.hasRealmRole("admin")`, `tokenParsed.realm_access.roles` to decide access | permissions from the API; keycloak-js verifies no signature |
| `keycloak.logout()` or `location.replace(keycloak.createLogoutUrl())`, a GET with `id_token_hint` in the query | `logoutMethod: "POST"` in `init`, the Keycloak origin in `form-action` |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| pass `?redirect=${location.href}` through Keycloak, or register `<origin>/*` | the return path in `sessionStorage`, read through `sameOriginPath`; one exact redirect URI |
| share tokens between tabs, or broadcast `"signed-out"` before leaving for the logout | each tab its own chain (a rotated refresh token survives one tab); the page the logout returns to broadcasts: earlier, the other tabs get a code the logout invalidates |
| add an idle-logout timer or a token-refresh loop | nothing: Keycloak's SSO Session Idle ends an idle session, and the next refused refresh signs the tab out |
| enable direct access grants for Playwright sign-ins | sign in through Keycloak's form: a password grant skips the code flow and PKCE the test proves, and OAuth 2.1 removes it |
| assert an expired session's redirect right after `createSession` | `vi.setSystemTime(Date.now() + 61_000)` first, or the 60 s loop guard holds the redirect |
