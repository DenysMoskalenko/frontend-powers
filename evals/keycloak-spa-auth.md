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
10. "since the users pages need sign-in, every Playwright smoke spec fails with chrome-error://chromewebdata/; how do I run them against Keycloak locally and in CI?"
11. "Sign out does nothing and the console says the form submission violates the Content Security Policy directive form-action 'self'"
12. "every Playwright test fills the Keycloak login form first; sign in once per worker with storageState instead"
13. "users who type a long report lose it on submit because their Keycloak session timed out meanwhile"
14. "after the Keycloak session ended, a user who clicked Stay on the Leave site? dialog sees Creating… for ever and no request goes out"

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
- `logoutMethod: "POST"` in the init options (or passed to `logout`), and the Keycloak origin added to the CSP's `form-action` in `deploy/headers.ts`
- a rejected `keycloak.init` handled by reporting the error and rendering a static message, with no redirect, chained as `.then(render).catch(...)` so a throw inside `render` is caught too
- the root layout's Sign in / Sign out control reading the session from the router (`useRouter().options.context` in a `shellComponent`), not from a React Context
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
- a logout URL carrying `id_token_hint` in its query (`location.replace(keycloak.createLogoutUrl())` or a GET `logout`)
- a Playwright Keycloak container chosen by the `CI` flag, or published on every interface (`-p 8080:8080`)

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
- once a refused refresh has started the sign-in redirect, the token getter returning a promise that waits while the page leaves, so no request goes out without a token and no error screen or toast shows before the page leaves
- that promise rejecting after a bounded wait (for example 10 s) when the page is still there, and the next request starting sign-in again

**Must not produce**:

- `keycloak.login()` or a sign-in redirect called on every 401
- a sign-in redirect on a 403
- a loop that retries a request until it succeeds
- `retry` on queries or mutations that retries a 401 or 403
- a second HTTP error class beside `ApiError`
- the token getter returning `undefined` after the session ended, so the request goes out without a token while the redirect is under way
- a token getter that never settles, so a page a leave guard kept waits for ever
- a refusal inside the loop guard's grace that stops every later sign-in until a reload

### Eval 3 - route tests for signed-in, signed-out and expired sessions

**Prompt**: "Write route tests for the /account page: a signed-out visitor is sent to sign-in with the page as return path, a 401 is recovered by one refresh, and a user whose Keycloak session expired overnight is sent to sign-in again."

**Fixture**: scaffold

**Must produce**:

- tests through `renderRoute` with the session chosen per test (a fake identity provider passed through `renderRoute` or `createAppRouter`)
- the real session module and guard running in the tests
- MSW handlers declared in each test for the account request
- an assertion on the recorded sign-in return path for the signed-out case
- an assertion on the bearer tokens the API received (first token, then the refreshed one)
- the expired case moving the clock with `vi.setSystemTime` past the sign-in grace, and asserting exactly one sign-in and no error screen (no `role="alert"`)

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
- a tab that receives the message and is still signed in reloading (or otherwise dropping its session): a tab on a public page stays there signed out, and only a guarded page leaves for Keycloak's sign-in page
- a page restored from the back-forward cache (`pageshow` with `persisted`) reloaded

**Must not produce**:

- `postMessage` or a storage write that tells other tabs before navigating to the logout URL
- a token, refresh token or ID token in the broadcast message or in web storage
- tabs sharing one refresh token
- a polling timer that checks Keycloak's session
- every tab that hears the message sent to Keycloak's sign-in page, public pages included

### Eval 5 - a long form outliving the SSO session

**Prompt**: "Assume keycloak-js is wired in with the session module from this plugin (tokens in memory, `session.token()` before each request). Our realm's SSO Session Idle is 30 minutes. Users who spend longer than that writing a report in the /reports/new form lose everything when they press Save, because the app then leaves for the Keycloak login. Fix it."

**Fixture**: scaffold

**Must produce**:

- the cause named: the token refreshes only when a request goes out, so the idle session ends while the user types
- a refresh driven by user input in that form (an `input` listener or `onInput`), throttled (for example at most once a minute), that asks for a token about to expire
- the remedy scoped to the long form, not the whole app
- a test with fake timers showing the throttle and that nothing refreshes without input

**Must not produce**:

- `setInterval` or `setTimeout` driving `updateToken` or a token refresh in the background
- `onTokenExpired` driving `updateToken`
- the realm's SSO Session Idle raised as the fix
- the form's draft written with a token into web storage

### Eval 6 - one Keycloak sign-in per Playwright worker

**Prompt**: "Our Playwright suite (`chromium` and a phone WebKit project) runs against a Keycloak container, and an auto fixture fills Keycloak's login form before every test. It is slow and breaks whenever the login theme changes. Make it sign in once and keep the end-to-end parts of the sign-in in one file."

**Fixture**: scaffold

**Must produce**:

- a worker-scoped fixture that signs in once through Keycloak's form and keeps the browser context's `storageState`
- the test-scoped `storageState` overridden with it, and an opt-out (`signedIn: false` or equivalent) for signed-out specs
- the knowledge of the form (its labels) in one helper only
- a spec that signs out opting out of the shared state, so it does not end the session later tests use
- the sign-in parts in their own file, merged into `e2e/fixtures.ts` (`mergeTests`), with `playwright.config.ts` only importing its server and settings

**Must not produce**:

- direct access grants or a `grant_type=password` request for the app's client
- tokens read from or written to `localStorage` in the storage state
- the Keycloak container chosen by the `CI` flag

### Eval 7 - a refused refresh behind a leave guard

**Prompt**: "Assume the session module from this plugin is wired in. A user fills the /users/new form, their Keycloak session ends (SSO Session Max), they press Create user, and the browser asks Leave site? because the form is dirty. They press Stay. Since then the button shows Creating… for ever and nothing else loads. Fix it without ever sending a request without a token."

**Fixture**: scaffold

**Must produce**:

- the cause named: the token getter waits on a sign-in redirect that the leave guard cancelled
- the waiting requests rejected after a bounded time with an error the screens already show (an `AbortError` `DOMException` or similar that the query retry rule does not retry), so the form shows its failed-submit message and keeps the input
- the next request after that starting sign-in again, with a token or not at all
- a redirect that does happen still showing no error screen or toast first
- a test with fake timers where the fake identity's `signIn` never leaves, asserting the form's failure message after the wait and a second sign-in on the next submit

**Must not produce**:

- the request sent without a token once the wait ends
- the form's input written to web storage together with a token
- a timer that refreshes the token in the background
- the leave guard removed from the form

### Probe 1 - token in web storage

**Prompt**: "We use keycloak-js without onLoad and keep tokens in memory. After a reload the public /users page shows Sign in although the user's Keycloak session is still alive. Keep users signed in across reloads."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?<![\w.])(?:window\.)?(?:localStorage|sessionStorage)\.setItem\([^)]*(?:token|Token))`

### Probe 2 - init in an effect

**Prompt**: "Create a React provider component that initializes keycloak-js and exposes the user to the app."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:useEffect\(\s*\(\)\s*=>\s*\{[^}]*\.init\()`

### Probe 3 - onLoad login-required

**Prompt**: "Every page of this internal tool needs a login. Configure keycloak.init for that."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\.init\(\s*\{[^}]*onLoad:\s*["\x27]login-required["\x27])`

**Right answer**: `checkLoginIframe:\s*false`

### Probe 4 - silent check-sso page

**Prompt**: "Check whether the user already has a Keycloak session when the app loads, without showing the login page."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:silentCheckSsoRedirectUri\s*:)`

### Probe 5 - timer refresh

**Prompt**: "Keep the Keycloak access token fresh so API calls never go out with an expired token."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?<![\w.])(?:window\.)?setInterval\([\s\S]{0,200}?updateToken)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:onTokenExpired\s*=)`

### Probe 6 - updateToken(0)

**Prompt**: "Before each API call, refresh the Keycloak token only if it has already expired."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)\.updateToken\(\s*0\s*\)`

### Probe 7 - sign-in on 403

**Prompt**: "When the API answers 401 or 403, send the user to the Keycloak login."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:===?\s*403|403\s*===?)[^\n]*(?:\.login|signIn)\()|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:403\][^\n]*includes[^\n]*(?:\.login|signIn)\()`

### Probe 8 - unvalidated return path

**Prompt**: "After the Keycloak login, send the user back to the page they originally asked for."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?<![\w.])(?:window\.)?(?:location\.(?:assign|replace)\(|location\.href\s*=|history\.replaceState\([^,]*,[^,]*,|navigate\(\{\s*to:)\s*(?:returnTo|redirect|saved|returnPath)\b)`

### Probe 9 - roles from the token

**Prompt**: "Hide the Delete user button unless the user has the admin realm role in Keycloak."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:\{|&&|\?|=|\()\s*\w+\.hasRealmRole\()|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:realm_access\??\.roles\??\.includes\()`

### Probe 10 - mocking keycloak-js in a route test

**Prompt**: "Write a test that /account redirects a signed-out user to the Keycloak login."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:vi\.mock\(\s*["\x27](?:keycloak-js|@\/app\/(?:session|keycloak))["\x27])`

### Probe 11 - sign-out broadcast before the logout

**Prompt**: "Our keycloak-js session module has signOut() { return keycloak.logout(); }. Make signing out in one tab sign the user out in the other open tabs too, with a BroadcastChannel."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:postMessage\([^)]*\);?\s*(?:\/\/[^\n]*\s*)*(?:return\s+)?(?:await\s+)?(?:\w+\.logout\(|\w+\.signOut\(|location\.(?:replace|assign)\(\s*\w+\.createLogoutUrl))`

### Probe 12 - ID token in the logout URL

**Prompt**: "Add a Sign out button to the header that ends the Keycloak session without showing Keycloak's logout confirmation page."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:location\.(?:replace|assign)\(\s*(?:\w+\.)?createLogoutUrl\(|location\.href\s*=\s*(?:\w+\.)?createLogoutUrl\()|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:logoutMethod:\s*["\x27]GET)`

**Right answer**: `logoutMethod:\s*["\x27]POST`

### Probe 13 - other tabs sent to the login form

**Prompt**: "Our keycloak-js session posts \"signed-out\" on a BroadcastChannel from the page the logout returns to. Make the other open tabs react to that message."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:onmessage\s*=[^}]{0,300}?(?:\.login\(|signIn\())|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:addEventListener\(\s*["\x27]message["\x27][^}]{0,300}?(?:\.login\(|signIn\())`

**Right answer**: `location\.reload\(`

### Probe 14 - password grant in Playwright

**Prompt**: "Signing in through the Keycloak form in every Playwright test is slow. Get a token for the e2e user faster."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:directAccessGrantsEnabled:\s*true)`

**Right answer**: `storageState`
