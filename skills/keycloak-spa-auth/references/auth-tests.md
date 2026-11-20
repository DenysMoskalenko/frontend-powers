# Authentication tests

## Contents

- [The seam](#the-seam)
- [`src/test/identity.ts`](#srctestidentityts)
- [`src/test/render-route.tsx`](#srctestrender-routetsx)
- [Route tests: guard, 401, expiry, 403, sign-out](#route-tests-guard-401-expiry-403-sign-out)
- [Session unit tests](#session-unit-tests)
- [keycloak-js against a fake token endpoint](#keycloak-js-against-a-fake-token-endpoint)
- [End-to-end](#end-to-end)

## The seam

`createAppRouter` takes the `session`, and `renderRoute(path, { session })` passes one in. A route
test builds the real `createSession` over `fakeIdentity(state)`, a stand-in for Keycloak only, so the
guard, the refresh and retry policy, the loop guard and the 403 screen all run as in the app. No
`vi.mock` of `keycloak-js`, of `@/app/session` or of any other app module. `renderRoute(path)` with no
second argument is signed in as `user-1` with `token-1`, so route tests written before the add-on keep
passing unchanged.

| State | Build it with | The fake then |
|---|---|---|
| signed in | `renderRoute(path)` | `userId()` is `user-1`; `token(30)` is `token-1`; each `token(-1)` issues the next number |
| signed out | `createSession(fakeIdentity("signed-out"))` | `userId()` and every token are `undefined` |
| expired (the tab slept past the provider's session) | `createSession(fakeIdentity("expired"))`, then `vi.setSystemTime(Date.now() + 61_000)` | the first token request is refused and the user is gone |
| refused right after sign-in | `createSession(fakeIdentity("expired"))` without moving the clock | same refusal inside the 60 s grace |
| back from sign-out (the page the logout returns to) | `createSession(fakeIdentity("just-signed-out"))` | signed out, `justSignedOut` is `true`: the session tells the other tabs |

`signIn` and `signOut` record the call (`identity.signIns`, `identity.signedOut`) and never settle,
as the real ones never do. Assert on those records and on the screen, never on the session's
internals.

A test that ends before its requests settle leaks them into the next test, where they meet another
test's handlers: wait for the screen the request produces (`findByRole("alert")`), not only for the
sign-in record.

## `src/test/identity.ts`

```ts,verify
// file: src/test/identity.ts
import type { IdentityProvider } from "@/app/session";

/**
 * The identity provider's side of a route test. `expired`: the tab slept past the provider's
 * session, so the next refresh is refused.
 */
export function fakeIdentity(
  state: "signed-in" | "signed-out" | "just-signed-out" | "expired" = "signed-in",
) {
  let userId = state === "signed-in" || state === "expired" ? "user-1" : undefined;
  let issued = 1;
  const identity: IdentityProvider & { signIns: string[]; signedOut: boolean } = {
    signIns: [],
    signedOut: false,
    justSignedOut: state === "just-signed-out",
    userId: () => userId,
    async token(minValidity: number) {
      if (state === "expired") userId = undefined;
      if (!userId) return undefined;
      if (minValidity === -1) issued += 1;
      return `token-${issued}`;
    },
    signIn(returnTo: string) {
      identity.signIns.push(returnTo);
      return new Promise<never>(() => {});
    },
    signOut() {
      identity.signedOut = true;
      return new Promise<never>(() => {});
    },
  };
  return identity;
}
```

## `src/test/render-route.tsx`

The scaffold's file plus the `session` option, which `configureApi` and `createAppRouter` receive.

```tsx,verify
// file: src/test/render-route.tsx
import { createMemoryHistory, RouterProvider } from "@tanstack/react-router";
import { render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { configureApi } from "@/api/fetcher";
import { createAppRouter } from "@/app/router";
import { createSession, type Session } from "@/app/session";
import { fakeIdentity } from "./identity";

/** The API origin route tests run against; MSW answers it. */
export const TEST_API_ORIGIN = "https://api.test";

/**
 * Renders the whole app at `path`: the real route tree, a fresh QueryClient, the app's providers,
 * and a signed-in session unless the test passes another. Only the network and the identity
 * provider are fake.
 */
export function renderRoute(
  path: string,
  { session = createSession(fakeIdentity()) }: { session?: Session } = {},
) {
  configureApi({
    baseUrl: TEST_API_ORIGIN,
    getToken: session.token,
    retryToken: session.retryToken,
  });
  const router = createAppRouter({
    session,
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
  return { user, router };
}
```

## Route tests: guard, 401, expiry, 403, sign-out

Beside the protected route `src/routes/_signed-in/account.tsx`.

```tsx,verify,test
// file: src/routes/_signed-in/account.test.tsx
import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
import { createSession } from "@/app/session";
import { buildUser } from "@/test/factories/user";
import { fakeIdentity } from "@/test/identity";
import { renderRoute, TEST_API_ORIGIN } from "@/test/render-route";
import { server } from "@/test/server";

/** Answers `/users/user-1` with `me` for `accepted`, 401 for any other token, and records each header. */
function meFor(accepted: string, sent: (string | null)[] = []) {
  const me = buildUser({ id: "user-1", name: "Ada Lovelace" });
  server.use(
    http.get(`${TEST_API_ORIGIN}/users/user-1`, ({ request }) => {
      sent.push(request.headers.get("authorization"));
      return request.headers.get("authorization") === `Bearer ${accepted}`
        ? HttpResponse.json(me)
        : HttpResponse.json({ error: "unauthorized" }, { status: 401 });
    }),
  );
  return sent;
}

test("a signed-out visitor leaves for the sign-in page, and the page asks the API nothing", async () => {
  const identity = fakeIdentity("signed-out");

  renderRoute("/account?tab=keys", { session: createSession(identity) });

  await expect.poll(() => identity.signIns).toEqual(["/account?tab=keys"]);
});

test("preloading a signed-in page, as a hovered link does, stays on the page", async () => {
  const identity = fakeIdentity("signed-out");
  const { router } = renderRoute("/no-such-page", { session: createSession(identity) });
  await screen.findByRole("heading", { name: "Page not found" });

  await router.preloadRoute({ to: "/account" });

  expect(identity.signIns).toEqual([]);
});

test("a signed-in user sees the page, the request carrying the token", async () => {
  const sent = meFor("token-1");

  renderRoute("/account");

  expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  expect(sent).toEqual(["Bearer token-1"]);
});

test("a 401 refreshes the token once and retries the request", async () => {
  const identity = fakeIdentity();
  const sent = meFor("token-2");

  renderRoute("/account", { session: createSession(identity) });

  expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  expect(sent).toEqual(["Bearer token-1", "Bearer token-2"]);
  expect(identity.signIns).toEqual([]);
});

test("a refreshed token that is rejected too shows the error page, not another sign-in", async () => {
  const identity = fakeIdentity();
  const sent = meFor("never-accepted");

  renderRoute("/account", { session: createSession(identity) });

  expect(await screen.findByRole("alert")).toHaveTextContent("This page could not be loaded");
  expect(sent).toEqual(["Bearer token-1", "Bearer token-2"]);
  expect(identity.signIns).toEqual([]);
});

test("a session the provider ended while the tab slept leaves for the sign-in page", async () => {
  const identity = fakeIdentity("expired");
  const session = createSession(identity);
  vi.setSystemTime(Date.now() + 61_000);
  meFor("token-1");

  renderRoute("/account", { session });

  expect(await screen.findByRole("alert")).toHaveTextContent("This page could not be loaded");
  expect(identity.signIns).toHaveLength(1);
});

test("a session refused right after signing in shows the error page instead of looping", async () => {
  const identity = fakeIdentity("expired");
  meFor("token-1");

  renderRoute("/account", { session: createSession(identity) });

  expect(await screen.findByRole("alert")).toHaveTextContent("This page could not be loaded");
  expect(identity.signIns).toEqual([]);
});

test("a 403 shows no access and keeps the session", async () => {
  const identity = fakeIdentity();
  server.use(
    http.get(`${TEST_API_ORIGIN}/users/user-1`, () =>
      HttpResponse.json({ error: "forbidden", request_id: "req-7" }, { status: 403 }),
    ),
  );

  renderRoute("/account", { session: createSession(identity) });

  expect(await screen.findByRole("alert")).toHaveTextContent("You do not have access to this page");
  expect(identity.signIns).toEqual([]);
});

test("Sign out ends the provider's session", async () => {
  const identity = fakeIdentity();
  meFor("token-1");
  const { user } = renderRoute("/account", { session: createSession(identity) });

  await user.click(await screen.findByRole("button", { name: "Sign out" }));

  expect(identity.signedOut).toBe(true);
});
```

- The signed-out test needs no handler: the setup's unhandled-request check fails it if the guard
  let the loader run.
- Each test was checked against a broken session: dropping the 60 s grace fails the
  "right after signing in" test, dropping the `preload` check makes the preload test hang.

## Session unit tests

The tab broadcast and the refresh rate limit have no screen of their own.

```ts,verify,test
// file: src/app/session.test.ts
import { expect, test, vi } from "vitest";
import { fakeIdentity } from "@/test/identity";
import { createSession } from "./session";

/** Long enough for a `BroadcastChannel` message to arrive. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test("signed-in tabs leave for sign-in only once the logout has come back", async () => {
  const tabA = fakeIdentity();
  const tabB = fakeIdentity();
  const publicTab = fakeIdentity("signed-out");
  const sessionA = createSession(tabA);
  createSession(tabB);
  createSession(publicTab);

  void sessionA.signOut();
  await settle();
  expect(tabA.signedOut).toBe(true);
  expect(tabB.signIns).toEqual([]);

  // Tab A's next page load, which the provider's logout sends back.
  createSession(fakeIdentity("just-signed-out"));

  await expect.poll(() => tabB.signIns).toEqual(["/"]);
  await settle();
  expect(publicTab.signIns).toEqual([]);
});

test("under a Vite base, the path saved for the next sign-in is the router's", async () => {
  vi.stubEnv("BASE_URL", "/admin/");
  history.replaceState(null, "", "/admin/orders/7?tab=items");
  const tab = fakeIdentity();
  createSession(tab);

  createSession(fakeIdentity("just-signed-out"));

  await expect.poll(() => tab.signIns).toEqual(["/orders/7?tab=items"]);
  history.replaceState(null, "", "/");
});

test("concurrent 401s share one forced refresh", async () => {
  const session = createSession(fakeIdentity());

  const retries = await Promise.all([
    session.retryToken("token-1"),
    session.retryToken("token-1"),
    session.retryToken("token-1"),
  ]);

  expect(retries).toEqual(["token-2", "token-2", "token-2"]);
});

test("a refreshed token the API rejects too is not refreshed again within a minute", async () => {
  const session = createSession(fakeIdentity());

  expect(await session.retryToken("token-1")).toBe("token-2");
  expect(await session.retryToken("token-2")).toBeUndefined();
});
```

- Each test was checked against the bug it guards: posting `"signed-out"` from `signOut()` fails
  the first; dropping the `base` slice in `currentPath` fails the second.

## keycloak-js against a fake token endpoint

The adapter runs the real keycloak-js 26.2. MSW answers the token endpoint, a stubbed `location`
records where the page would go (jsdom cannot leave the origin), and the sign-in round trip is
replayed by writing Keycloak's callback fragment into the URL before a second `startKeycloak`.
Tokens are unsigned JWTs: keycloak-js only decodes them.

```ts,verify,test
// file: src/app/keycloak.test.ts
import { HttpResponse, http } from "msw";
import { beforeEach, expect, test, vi } from "vitest";
import { server } from "@/test/server";
import { startKeycloak } from "./keycloak";

const settings = { url: "https://auth.test", realm: "app", clientId: "app-spa" };
const oidc = "https://auth.test/realms/app/protocol/openid-connect";
const replace = vi.fn<(url: string) => void>();

const base64url = (value: object) =>
  btoa(JSON.stringify(value)).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
const jwt = (claims: object) => `${base64url({ alg: "none" })}.${base64url(claims)}.`;

/** A token response whose access token is named `name` (its `jti`) and lives five minutes. */
function grant(name: string, nonce?: string | null) {
  const iat = Math.floor(Date.now() / 1000);
  return HttpResponse.json({
    access_token: jwt({ sub: "user-1", iat, exp: iat + 300, jti: name }),
    refresh_token: jwt({ iat, exp: iat + 1800 }),
    id_token: jwt({ sub: "user-1", iat, exp: iat + 300, nonce }),
    token_type: "Bearer",
    expires_in: 300,
  });
}
const named = (token: string | undefined) =>
  JSON.parse(atob((token?.split(".")[1] ?? "").replaceAll("-", "+").replaceAll("_", "/"))).jti;

/** The token endpoint: answers in order, and records each request's grant type. */
function tokenEndpoint(...answers: (() => Response)[]) {
  const grants: (string | null)[] = [];
  server.use(
    http.post(`${oidc}/token`, async ({ request }) => {
      grants.push(new URLSearchParams(await request.text()).get("grant_type"));
      return answers.shift()?.() ?? HttpResponse.json({ error: "unexpected" }, { status: 500 });
    }),
  );
  return grants;
}

/** Where the page went last, through the stubbed `location.replace`. */
const lastLeft = () => new URL(replace.mock.lastCall?.[0] ?? "");

async function leaveForSignIn(returnTo: string) {
  const provider = await startKeycloak(settings);
  void provider.signIn(returnTo);
  await vi.waitFor(() => expect(replace).toHaveBeenCalled());
  return lastLeft();
}

/** Signs in through a simulated Keycloak round trip; `later` answers the refreshes that follow. */
async function signIn(returnTo: string, ...later: (() => Response)[]) {
  const login = await leaveForSignIn(returnTo);
  // Keycloak sends the browser back to the app's root with the code in the fragment.
  const callback = `#state=${login.searchParams.get("state")}&code=code-1`;
  history.replaceState(null, "", import.meta.env.BASE_URL + callback);
  const grants = tokenEndpoint(() => grant("a1", login.searchParams.get("nonce")), ...later);
  return { provider: await startKeycloak(settings), grants, login };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  history.replaceState(null, "", "/");
  replace.mockReset();
  const page = location;
  vi.stubGlobal("location", {
    get href() {
      return page.href;
    },
    get origin() {
      return page.origin;
    },
    get pathname() {
      return page.pathname;
    },
    get search() {
      return page.search;
    },
    get hash() {
      return page.hash;
    },
    replace,
  });
});

test("a signed-out page stays put until sign-in, which leaves with PKCE for the one redirect URI", async () => {
  history.replaceState(null, "", "/orders/7?tab=items");
  const provider = await startKeycloak(settings);
  expect(provider.userId()).toBeUndefined();
  expect(replace).not.toHaveBeenCalled();
  expect(document.querySelector("iframe")).toBeNull();

  const login = await leaveForSignIn("/orders/7?tab=items");

  expect(login.origin + login.pathname).toBe(`${oidc}/auth`);
  expect(Object.fromEntries(login.searchParams)).toMatchObject({
    client_id: "app-spa",
    redirect_uri: `${location.origin}/`,
    response_type: "code",
    response_mode: "fragment",
    code_challenge_method: "S256",
    scope: "openid",
  });
  expect(sessionStorage.getItem("auth.return-path")).toBe("/orders/7?tab=items");
});

test("the callback exchanges the code and reopens the saved path without the code", async () => {
  const { provider, grants } = await signIn("/orders/7?tab=items");

  expect(location.pathname + location.search + location.hash).toBe("/orders/7?tab=items");
  expect(provider.userId()).toBe("user-1");
  expect(named(await provider.token(30))).toBe("a1");
  expect(grants).toEqual(["authorization_code"]);
});

test.each([
  ["/orders/7?tab=items#notes", "/orders/7?tab=items#notes"],
  ["//evil.example/", "/"],
  ["/\\evil.example", "/"],
  ["https://evil.example/", "/"],
  ["javascript:alert(1)", "/"],
])("a saved return path %j reopens %j on this origin", async (saved, expected) => {
  await signIn(saved);

  expect(location.href).toBe(`${location.origin}${expected}`);
});

test("under a Vite base, Keycloak returns to the app's root and the saved path opens below it", async () => {
  vi.stubEnv("BASE_URL", "/admin/");

  const { provider, login } = await signIn("/orders/7?tab=items");
  expect(login.searchParams.get("redirect_uri")).toBe(`${location.origin}/admin/`);
  expect(location.pathname + location.search).toBe("/admin/orders/7?tab=items");

  void provider.signOut();
  expect(lastLeft().searchParams.get("post_logout_redirect_uri")).toBe(`${location.origin}/admin/`);
});

test("concurrent calls near expiry share one refresh", async () => {
  const { provider, grants } = await signIn("/", () => grant("a2"));
  vi.setSystemTime(Date.now() + 280_000);

  const tokens = await Promise.all([provider.token(30), provider.token(30), provider.token(30)]);

  expect(tokens.map(named)).toEqual(["a2", "a2", "a2"]);
  expect(grants).toEqual(["authorization_code", "refresh_token"]);
});

test("-1 forces a refresh, and minValidity 0 means 5 seconds", async () => {
  const { provider, grants } = await signIn(
    "/",
    () => grant("a2"),
    () => grant("a3"),
  );

  expect(named(await provider.token(-1))).toBe("a2");
  vi.setSystemTime(Date.now() + 297_000);
  expect(named(await provider.token(0))).toBe("a3");
  expect(grants).toEqual(["authorization_code", "refresh_token", "refresh_token"]);
});

test("a refused refresh (400) ends the session", async () => {
  const { provider } = await signIn("/", () =>
    HttpResponse.json({ error: "invalid_grant" }, { status: 400 }),
  );

  expect(await provider.token(-1)).toBeUndefined();
  expect(provider.userId()).toBeUndefined();
});

test("a failed refresh (503) keeps the held token for the API to judge", async () => {
  const { provider } = await signIn("/", () =>
    HttpResponse.json({ error: "unavailable" }, { status: 503 }),
  );

  expect(named(await provider.token(-1))).toBe("a1");
});

test("sign-out ends the Keycloak session with id_token_hint and comes back to the app's root", async () => {
  const { provider } = await signIn("/");

  void provider.signOut();

  const logout = lastLeft();
  expect(logout.origin + logout.pathname).toBe(`${oidc}/logout`);
  expect(logout.searchParams.get("post_logout_redirect_uri")).toBe(`${location.origin}/`);
  expect(logout.searchParams.get("id_token_hint")).toBeTruthy();
});

test("only the page the logout comes back to reports the sign-out, once", async () => {
  const { provider } = await signIn("/");
  expect(provider.justSignedOut).toBe(false);

  void provider.signOut();
  history.replaceState(null, "", "/");

  expect((await startKeycloak(settings)).justSignedOut).toBe(true);
  expect((await startKeycloak(settings)).justSignedOut).toBe(false);
});

test("a callback carrying an error rejects instead of signing in again", async () => {
  const login = await leaveForSignIn("/");
  history.replaceState(null, "", `/#error=access_denied&state=${login.searchParams.get("state")}`);

  await expect(startKeycloak(settings)).rejects.toMatchObject({ error: "access_denied" });
});
```

- `vi.setSystemTime` without fake timers moves only `Date`, which is all `isTokenExpired` reads;
  keycloak-js's awaits still settle.
- `unstubGlobals: true` and `unstubEnvs: true` in the Vitest config restore `location` and
  `BASE_URL` after each test.

## End-to-end

Playwright runs against a real Keycloak container seeded with the realm and one user per worker,
and signs in through Keycloak's own form. Tokens live in memory, so a saved `storageState` holds only
Keycloak's SSO cookie: opening a guarded route runs the code flow again without the form, and a
public page shows the signed-out state until then. Never enable direct access grants on the browser
client to shortcut the form. The fixture and the CSP guard are
`frontend-testing`'s.
