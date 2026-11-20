# keycloak-spa-auth

### Triggering

**Should load**

1. "add Keycloak login to the app, only /account and /settings should need a signed-in user"
2. "our API now wants `Authorization: Bearer`, wire keycloak-js into configureApi getToken and retryToken"
3. "after logging in the app bounces back to Keycloak over and over, how do I stop the redirect loop?"
4. "should I use onLoad check-sso with silent-check-sso.html or login-required in keycloak.init?"
5. "updateToken(0) still refreshes tokens that have a few seconds left, why?"
6. "users who leave a tab open overnight get 401s in the morning instead of the login page"
7. "the API answers 403 for viewers and the app sends them to the Keycloak login again"
8. "how do I write a route test for a signed-out user without running Keycloak?"
9. "we use Entra ID, not Keycloak: same session setup with oidc-client-ts"

**Should not load**

1. "redirect from / to /users with beforeLoad" -> `tanstack-router-spa`
2. "ApiError should expose the x-request-id header from a 500" -> `tanstack-query-api`
3. "add PUBLIC_FARO_URL so the build knows where to send telemetry" -> `frontend-deploy`
4. "the users list test fails with Requests without an MSW handler: GET https://api.test/users" -> `frontend-testing`
5. "apiFetch should surface a network failure as a 'You are offline' notice instead of a TypeError" -> `tanstack-query-api`
6. "send the Authorization header on the Centrifugo connection and reconnect on expiry" -> `frontend-realtime`
7. "review the login form's labels and error messages for accessibility" -> `web-design-guidelines`

### Eval 1 - adding Keycloak to the scaffold

**Prompt**: "Add Keycloak sign-in to this app. Keycloak runs at http://localhost:8080 with realm `app` and public client `app-spa`. The user pages stay public; add an /account page that shows the signed-in user's own record from GET /users/{id} with their token `sub` as the id, and only signed-in users may open it. The API expects a bearer token."

**Fixture**: scaffold

**Must produce**:

- `keycloak-js` added and imported only by one module under `src/app/`
- `keycloak.init` called once from `src/main.tsx` before `createRoot(...).render` or `createAppRouter`
- `checkLoginIframe: false` in the init options
- `redirectUri` set to the app's root URL in the init options
- no `onLoad` option
- `configureApi` given `getToken` and `retryToken` from the session
- the session passed to `createAppRouter` and added to the router context and the `createRootRouteWithContext` type
- a pathless layout route (`src/routes/_signed-in.tsx` or similar) whose `beforeLoad` checks the session and starts sign-in
- the account route placed under that layout
- `PUBLIC_AUTH_ORIGIN` listed in `PUBLIC_ENV` in `vite.config.ts` and read as `env.authOrigin`
- `PUBLIC_AUTH_ORIGIN` given a value in `playwright.config.ts`'s preview server env
- a rejected `keycloak.init` handled by reporting the error and rendering a static message, with no redirect
- `ENTRY_BUDGET_BYTES` raised by the growth `pnpm build` reports (about 10 KB gzip for keycloak-js on the scaffold), with keycloak-js named as the cause

**Must not produce**:

- a token written to `localStorage`, `sessionStorage` or a cookie
- `keycloak.init` inside a component, hook or `useEffect`
- `onLoad: "login-required"` or `onLoad: "check-sso"`
- `silentCheckSsoRedirectUri` or a `silent-check-sso.html` file
- `setInterval` or `onTokenExpired` driving `updateToken`
- `@react-keycloak/web` or `react-oidc-context`
- a session provider mounted in `main.tsx` around `RouterProvider`, or any React Context holding the session
- `ENTRY_BUDGET_BYTES` raised with no cause stated, or by more than the keycloak-js growth

### Eval 2 - the 401 and 403 policy

**Prompt**: "Assume keycloak-js is already wired in: one keycloak.init in src/main.tsx, and configureApi gets the access token from it. Make the app behave sensibly on auth errors: when the API says 401 the token may just have expired, and when it says 403 the user lacks a permission. Make sure we can never end up in an endless login loop."

**Fixture**: scaffold

**Must produce**:

- after a 401, exactly one forced refresh (`updateToken(-1)` or equivalent) and one retry of the request
- concurrent 401s sharing one refresh
- a limit on forced refreshes (for example at most one a minute)
- no sign-in redirect for a 401 within a short time after a sign-in (a loop guard), showing an error page instead
- sign-in started only when the refresh is refused (the session ended)
- a 403 rendered as a no-access message without any sign-in call
- Query's retry predicate left not retrying 401 and 403

**Must not produce**:

- `keycloak.login()` or a sign-in redirect called on every 401
- a sign-in redirect on a 403
- a loop that retries a request until it succeeds
- `retry` on queries or mutations that retries a 401 or 403
- a second HTTP error class beside `ApiError`

### Eval 3 - route tests for signed-in, signed-out and expired sessions

**Prompt**: "Write route tests for the /account page: a signed-out visitor is sent to sign-in with the page as return path, a 401 is recovered by one refresh, and a user whose Keycloak session expired overnight is sent to sign-in again."

**Fixture**: scaffold

**Must produce**:

- tests through `renderRoute` with the session chosen per test (a fake identity provider passed through `renderRoute` or `createAppRouter`)
- the real session module and guard running in the tests
- MSW handlers declared in each test for the account request
- an assertion on the recorded sign-in return path for the signed-out case
- an assertion on the bearer tokens the API received (first token, then the refreshed one)
- the expired case moving the clock with `vi.setSystemTime` past the sign-in grace

**Must not produce**:

- `vi.mock("keycloak-js")` or `vi.mock` of `@/app/session` or another app module
- a test rendering the account component inside hand-made providers
- an assertion on a spy of `navigate`
- a real Keycloak URL or network call in a Vitest test

### Eval 4 - signing out in every tab

**Prompt**: "Assume keycloak-js is already wired in: one keycloak.init in src/main.tsx with tokens in memory, and a Sign out button that calls keycloak.logout(). Users open the app in several tabs; when they sign out in one, the other tabs should not stay signed in."

**Fixture**: scaffold

**Must produce**:

- other tabs told through a `BroadcastChannel` (or a `storage` event) carrying only the fact of the sign-out
- the message sent from the page the logout redirect returns to, after Keycloak has ended the session
- a flag in `sessionStorage` (or an equivalent marker) set before leaving for the logout URL, read and removed on the next start
- a tab that receives the message and is still signed in leaving for Keycloak's sign-in page

**Must not produce**:

- `postMessage` or a storage write that tells other tabs before navigating to the logout URL
- a token, refresh token or ID token in the broadcast message or in web storage
- tabs sharing one refresh token
- a polling timer that checks Keycloak's session

### Probe 1 - token in web storage

**Prompt**: "We use keycloak-js without onLoad and keep tokens in memory. After a reload the public /users page shows Sign in although the user's Keycloak session is still alive. Keep users signed in across reloads."

**Fixture**: scaffold

**Wrong answer**: `(?<![\x60\w.])(?:window\.)?(?:localStorage|sessionStorage)\.setItem\([^)]*(?:token|Token)`

### Probe 2 - init in an effect

**Prompt**: "Create a React provider component that initializes keycloak-js and exposes the user to the app."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:useEffect\(\s*\(\)\s*=>\s*\{[^}]*\.init\()`

### Probe 3 - onLoad login-required

**Prompt**: "Every page of this internal tool needs a login. Configure keycloak.init for that."

**Fixture**: scaffold

**Wrong answer**: `\.init\(\s*\{[^}]*onLoad:\s*["\x27]login-required["\x27]`

**Right answer**: `checkLoginIframe:\s*false`

### Probe 4 - silent check-sso page

**Prompt**: "Check whether the user already has a Keycloak session when the app loads, without showing the login page."

**Fixture**: scaffold

**Wrong answer**: `silentCheckSsoRedirectUri\s*:`

### Probe 5 - timer refresh

**Prompt**: "Keep the Keycloak access token fresh so API calls never go out with an expired token."

**Fixture**: scaffold

**Wrong answer**: `(?<![\x60\w.])(?:window\.)?setInterval\([\s\S]{0,200}?updateToken|(?<!\x60[^\x60\n]*)onTokenExpired\s*=`

### Probe 6 - updateToken(0)

**Prompt**: "Before each API call, refresh the Keycloak token only if it has already expired."

**Fixture**: scaffold

**Wrong answer**: `\.updateToken\(\s*0\s*\)`

### Probe 7 - sign-in on 403

**Prompt**: "When the API answers 401 or 403, send the user to the Keycloak login."

**Fixture**: scaffold

**Wrong answer**: `(?:===?\s*403|403\s*===?)[^\n]*(?:\.login|signIn)\(|403\][^\n]*includes[^\n]*(?:\.login|signIn)\(`

### Probe 8 - unvalidated return path

**Prompt**: "After the Keycloak login, send the user back to the page they originally asked for."

**Fixture**: scaffold

**Wrong answer**: `(?<![\x60\w.])(?:window\.)?(?:location\.(?:assign|replace)\(|location\.href\s*=|history\.replaceState\([^,]*,[^,]*,|navigate\(\{\s*to:)\s*(?:returnTo|redirect|saved|returnPath)\b`

### Probe 9 - roles from the token

**Prompt**: "Hide the Delete user button unless the user has the admin realm role in Keycloak."

**Fixture**: scaffold

**Wrong answer**: `(?:\{|&&|\?|=|\()\s*\w+\.hasRealmRole\(|realm_access\??\.roles\??\.includes\(`

### Probe 10 - mocking keycloak-js in a route test

**Prompt**: "Write a test that /account redirects a signed-out user to the Keycloak login."

**Fixture**: scaffold

**Wrong answer**: `(?<!\x60)vi\.mock\(\s*["\x27](?:keycloak-js|@\/app\/(?:session|keycloak))["\x27]`

### Probe 11 - sign-out broadcast before the logout

**Prompt**: "Our keycloak-js session module has signOut() { return keycloak.logout(); }. Make signing out in one tab sign the user out in the other open tabs too, with a BroadcastChannel."

**Fixture**: scaffold

**Wrong answer**: `postMessage\([^)]*\);?\s*(?:\/\/[^\n]*\s*)*(?:return\s+)?(?:await\s+)?(?:\w+\.logout\(|\w+\.signOut\(|location\.(?:replace|assign)\(\s*\w+\.createLogoutUrl)`
