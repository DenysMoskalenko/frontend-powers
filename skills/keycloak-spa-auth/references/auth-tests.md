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
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

/** For the 10 s a page gets to leave for sign-in; `renderRoute`'s own `user` would wait on real timers. */
function fakeTime() {
  vi.useFakeTimers();
  vi.stubGlobal("jest", { advanceTimersByTime: vi.advanceTimersByTime });
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
}

/** The provider ended the session while the tab slept: the first refresh is refused. */
function endedSession() {
  const identity = fakeIdentity("expired");
  const session = createSession(identity);
  vi.setSystemTime(Date.now() + 61_000);
  return { identity, session };
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

test("a session the provider ended while the tab slept leaves for sign-in, sending nothing", async () => {
  fakeTime();
  const { identity, session } = endedSession();
  const sent = meFor("token-1");

  renderRoute("/account", { session });

  // Up to the moment the page gives up on leaving: no request, error screen or toast.
  await act(() => vi.advanceTimersByTimeAsync(9_999));
  expect(identity.signIns).toHaveLength(1);
  expect(screen.getByRole("progressbar", { name: "Loading page" })).toBeInTheDocument();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(sent).toEqual([]);
});

test("a loading page that did not leave for sign-in shows its error page, still sending nothing", async () => {
  fakeTime();
  const { identity, session } = endedSession();
  const sent = meFor("token-1");

  renderRoute("/account", { session });
  await act(() => vi.advanceTimersByTimeAsync(10_000));

  expect(screen.getByRole("alert")).toHaveTextContent("This page could not be loaded");
  expect(sent).toEqual([]);
  expect(identity.signIns).toHaveLength(1);
});

test("a form whose page stayed keeps its input, shows the failure, and the next submit signs in", async () => {
  const user = fakeTime();
  const { identity, session } = endedSession();
  renderRoute("/users/new", { session });

  await user.type(await screen.findByRole("textbox", { name: "Name" }), "Ada");
  await user.type(screen.getByRole("textbox", { name: "Email" }), "ada@example.com");
  await user.click(screen.getByRole("button", { name: "Create user" }));
  await act(() => vi.advanceTimersByTimeAsync(9_999));
  expect(identity.signIns).toHaveLength(1);
  expect(screen.getByRole("button", { name: "Creating…" })).toBeInTheDocument();

  // The leave guard asked "Leave site?" and the user stayed.
  await act(() => vi.advanceTimersByTimeAsync(1));
  expect(screen.getByRole("alert")).toHaveTextContent("The user was not created. Try again.");
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Ada");

  await user.click(screen.getByRole("button", { name: "Create user" }));
  expect(identity.signIns).toHaveLength(2);
  await act(() => vi.advanceTimersByTimeAsync(10_000));
});

test("a background refresh whose page stayed keeps the data and shows the refresh toast", async () => {
  fakeTime();
  const identity = fakeIdentity();
  meFor("token-1");
  renderRoute("/account", { session: createSession(identity) });
  await screen.findByRole("heading", { name: "Ada Lovelace" });
  // The provider ends the session, as SSO Session Max does.
  identity.token = async () => undefined;

  vi.setSystemTime(Date.now() + 61_000);
  window.dispatchEvent(new Event("visibilitychange"));
  await act(() => vi.advanceTimersByTimeAsync(10_000));

  expect(identity.signIns).toHaveLength(1);
  expect(screen.getByRole("alert")).toHaveTextContent("Could not refresh the data");
  expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
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
  "right after signing in" test, dropping the `preload` check makes the preload test hang, and a
  sign-in promise that never settles fails the three tests of a page that stayed.
- The fake `signIn` never leaves the page, which is what a leave guard's "Stay" does to the real
  one; the tests of a page that stayed advance fake timers past the 10 s (`frontend-testing`'s
  rules for fake timers with Testing Library).

## Session unit tests

The tab broadcast, the refresh rate limit, the departure and `activity()` have no screen of their
own. Each broadcast test stubs its own `BASE_URL`, so it opens a channel that no session from
another test listens on.

```ts,verify,test
// file: src/app/session.dom.test.ts
import { expect, test, vi } from "vitest";
import { fakeIdentity } from "@/test/identity";
import { createSession } from "./session";

/** Long enough for a `BroadcastChannel` message to arrive. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

/** What a request waiting on `promise` has seen so far. */
function seen(promise: Promise<unknown>) {
  const outcome: { settled: boolean; error?: unknown } = { settled: false };
  promise.then(
    () => {
      outcome.settled = true;
    },
    (error: unknown) => {
      outcome.settled = true;
      outcome.error = error;
    },
  );
  return outcome;
}

test("signed-in tabs reload once the logout has come back, a signed-out tab stays", async () => {
  vi.stubEnv("BASE_URL", "/tabs/");
  const reload = vi.fn();
  vi.stubGlobal("location", { reload });
  const tabA = fakeIdentity();
  const sessionA = createSession(tabA);
  createSession(fakeIdentity());
  createSession(fakeIdentity("signed-out"));

  void sessionA.signOut();
  await settle();
  expect(tabA.signedOut).toBe(true);
  expect(reload).not.toHaveBeenCalled();

  // Tab A's next page load, which the provider's logout sends back.
  createSession(fakeIdentity("just-signed-out"));

  // Tab A (which a browser has left by now) and tab B; never the signed-out tab.
  await expect.poll(() => reload.mock.calls.length).toBe(2);
  await settle();
  expect(reload).toHaveBeenCalledTimes(2);
});

test("two apps under one origin, at different bases, do not sign each other out", async () => {
  const reload = vi.fn();
  vi.stubGlobal("location", { reload });
  vi.stubEnv("BASE_URL", "/admin/");
  createSession(fakeIdentity());
  vi.stubEnv("BASE_URL", "/shop/");
  createSession(fakeIdentity());

  createSession(fakeIdentity("just-signed-out"));

  await expect.poll(() => reload.mock.calls.length).toBe(1);
  await settle();
  expect(reload).toHaveBeenCalledOnce();
});

test("a page the back-forward cache restores reloads instead of showing its signed-in state", () => {
  const reload = vi.fn();
  vi.stubGlobal("location", { reload });
  createSession(fakeIdentity());

  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: false }));
  expect(reload).not.toHaveBeenCalled();

  window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  expect(reload).toHaveBeenCalled();
});

test("a refresh refused after a 401 leaves once; requests wait, fail if the page stays, then leave again", async () => {
  vi.useFakeTimers();
  const identity = fakeIdentity();
  // The held token is still valid, and the provider refuses the forced refresh.
  identity.token = async (minValidity) => (minValidity === -1 ? undefined : "token-1");
  const session = createSession(identity);
  vi.setSystemTime(Date.now() + 61_000);

  const retry = seen(session.retryToken("token-1"));
  await vi.advanceTimersByTimeAsync(0);
  const next = seen(session.token());
  await vi.advanceTimersByTimeAsync(9_999);
  expect(identity.signIns).toHaveLength(1);
  expect([retry.settled, next.settled]).toEqual([false, false]);

  await vi.advanceTimersByTimeAsync(1);
  expect(retry.error).toMatchObject({ name: "AbortError" });
  expect(next.error).toMatchObject({ name: "AbortError" });

  const after = seen(session.token());
  await vi.advanceTimersByTimeAsync(0);
  expect(identity.signIns).toHaveLength(2);
  expect(after.settled).toBe(false);
  await vi.advanceTimersByTimeAsync(10_000);
});

test("a refusal right after sign-in sends without a token for the grace only, then signs in", async () => {
  vi.useFakeTimers();
  const identity = fakeIdentity("expired");
  const session = createSession(identity);

  expect(await session.token()).toBeUndefined();
  expect(identity.signIns).toEqual([]);

  vi.setSystemTime(Date.now() + 61_000);
  const later = seen(session.token());
  await vi.advanceTimersByTimeAsync(0);
  expect(identity.signIns).toHaveLength(1);
  expect(later.settled).toBe(false);
  await vi.advanceTimersByTimeAsync(10_000);
});

test("typing that finds the session refused leaves once; after that, typing starts nothing", async () => {
  vi.useFakeTimers();
  const identity = fakeIdentity("expired");
  const session = createSession(identity);
  vi.setSystemTime(Date.now() + 61_000);

  session.activity();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(identity.signIns).toHaveLength(1);

  await vi.advanceTimersByTimeAsync(60_000);
  session.activity();
  await vi.advanceTimersByTimeAsync(0);
  expect(identity.signIns).toHaveLength(1);
});

test("a tab that stays after the sign-out broadcast signs in before its next request", async () => {
  vi.useFakeTimers();
  vi.stubEnv("BASE_URL", "/stays/");
  const reload = vi.fn();
  vi.stubGlobal("location", { reload, pathname: "/stays/users", search: "", hash: "" });
  const identity = fakeIdentity();
  const session = createSession(identity);
  createSession(fakeIdentity("just-signed-out"));
  // The reload did not leave: a leave guard's "Stay".
  await expect.poll(() => reload.mock.calls.length).toBe(1);

  vi.setSystemTime(Date.now() + 61_000);
  const next = seen(session.token());
  await vi.advanceTimersByTimeAsync(0);
  expect(identity.signIns).toEqual(["/users"]);
  expect(next.settled).toBe(false);
  await vi.advanceTimersByTimeAsync(10_000);
});

test("under a Vite base, the path saved for the next sign-in is the router's", async () => {
  vi.useFakeTimers();
  vi.stubEnv("BASE_URL", "/back-office/");
  history.replaceState(null, "", "/back-office/orders/7?tab=items");
  const identity = fakeIdentity("expired");
  const session = createSession(identity);
  vi.setSystemTime(Date.now() + 61_000);

  seen(session.token());
  await vi.advanceTimersByTimeAsync(10_000);

  expect(identity.signIns).toEqual(["/orders/7?tab=items"]);
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

test("typing asks for a fresh token at most once a minute, and never without input", () => {
  vi.useFakeTimers();
  const identity = fakeIdentity();
  const token = vi.spyOn(identity, "token");
  const session = createSession(identity);

  vi.advanceTimersByTime(10 * 60_000);
  expect(token).not.toHaveBeenCalled();

  session.activity();
  session.activity();
  vi.advanceTimersByTime(59_000);
  session.activity();
  expect(token).toHaveBeenCalledExactlyOnceWith(30);

  vi.advanceTimersByTime(1_000);
  session.activity();
  expect(token).toHaveBeenCalledTimes(2);
});
```

- Each test was checked against the bug it guards: posting `"signed-out"` from `signOut()` or
  reloading every tab fails the first; a channel named `"session"` for every base fails the second;
  removing the `pageshow` listener fails the third; a sign-in promise that never settles fails the
  fourth; a refusal inside the grace that stops every later sign-in fails the fifth; typing that
  leaves again once the session is lost fails the sixth, and without its `.catch` Vitest reports an
  unhandled rejection; a broadcast that does not mark the session lost fails the seventh; dropping
  the `base` slice in `currentPath` fails the eighth.
- A test that starts the departure uses fake timers and advances past the 10 s, so no rejection
  outlives it.
- The reload test asserts `toHaveBeenCalled()`, not once: every session an earlier test created in
  the file also listens for `pageshow`.

## keycloak-js against a fake token endpoint

The adapter runs the real keycloak-js 26.2. MSW answers the token endpoint, a stubbed `location`
records where the page would go (jsdom cannot leave the origin), and the sign-in round trip is
replayed by writing Keycloak's callback fragment into the URL before a second `startKeycloak`.
Tokens are unsigned JWTs: keycloak-js only decodes them.

```ts,verify,test
// file: src/app/keycloak.dom.test.ts
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
function grant(name: string, nonce?: string | null, subject: object = { sub: "user-1" }) {
  const iat = Math.floor(Date.now() / 1000);
  return HttpResponse.json({
    access_token: jwt({ ...subject, iat, exp: iat + 300, jti: name }),
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

/** The sign-out form keycloak-js submitted: its target and its fields. */
function submittedForm() {
  const form = document.querySelector("form");
  if (!form) throw new Error("no form was submitted");
  return {
    method: form.method,
    action: form.action,
    fields: Object.fromEntries(new FormData(form)),
  };
}

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
  history.replaceState(null, "", "/");
  document.body.replaceChildren();
  replace.mockReset();
  // jsdom cannot navigate; the test reads the form keycloak-js appended.
  vi.spyOn(HTMLFormElement.prototype, "submit").mockImplementation(() => {});
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
  expect(sessionStorage.getItem("/auth.return-path")).toBe("/orders/7?tab=items");
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
  await vi.waitFor(() =>
    expect(submittedForm().fields.post_logout_redirect_uri).toBe(`${location.origin}/admin/`),
  );
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

test("sign-out posts the ID token hint in a form body, never in a URL, and comes back to the root", async () => {
  const { provider } = await signIn("/");
  replace.mockReset();

  void provider.signOut();

  await vi.waitFor(() => expect(HTMLFormElement.prototype.submit).toHaveBeenCalledOnce());
  expect(submittedForm()).toEqual({
    method: "post",
    action: `${oidc}/logout`,
    fields: {
      id_token_hint: expect.stringMatching(/^ey/),
      client_id: "app-spa",
      post_logout_redirect_uri: `${location.origin}/`,
    },
  });
  expect(replace).not.toHaveBeenCalled();
});

test("only the page the logout comes back to reports the sign-out, once", async () => {
  const { provider } = await signIn("/");
  expect(provider.justSignedOut).toBe(false);

  void provider.signOut();
  await vi.waitFor(() => expect(HTMLFormElement.prototype.submit).toHaveBeenCalledOnce());
  history.replaceState(null, "", "/");

  expect((await startKeycloak(settings)).justSignedOut).toBe(true);
  expect((await startKeycloak(settings)).justSignedOut).toBe(false);
});

test("a callback carrying an error rejects instead of signing in again", async () => {
  const login = await leaveForSignIn("/");
  history.replaceState(null, "", `/#error=access_denied&state=${login.searchParams.get("state")}`);

  await expect(startKeycloak(settings)).rejects.toMatchObject({ error: "access_denied" });
});

test("an access token without sub rejects instead of starting signed out", async () => {
  const login = await leaveForSignIn("/");
  history.replaceState(null, "", `/#state=${login.searchParams.get("state")}&code=code-1`);
  tokenEndpoint(() => grant("a1", login.searchParams.get("nonce"), {}));

  // Started signed out, the guard would send the user to Keycloak and back without end.
  await expect(startKeycloak(settings)).rejects.toThrow("no sub claim");
});
```

- `vi.setSystemTime` without fake timers moves only `Date`, which is all `isTokenExpired` reads;
  keycloak-js's awaits still settle.
- `unstubGlobals: true` and `unstubEnvs: true` in the Vitest config restore `location` and
  `BASE_URL` after each test.

## End-to-end

Playwright runs the production build behind the generated CSP against a real Keycloak and signs in
through Keycloak's own form, as users do. Once the guarded pages need a session, the scaffold's
smoke specs fail without these files (`toHaveURL("/users")` receives `chrome-error://chromewebdata/`:
nothing answers at `PUBLIC_AUTH_ORIGIN`). The guard fixture and the specs themselves are
`frontend-testing`'s, and so is the form of `e2e/fixtures.ts` and `playwright.config.ts` for an
app with several add-ons.

| File | What the add-on adds |
|---|---|
| `e2e/auth.ts` | new, everything the add-on needs: `AUTH_ORIGIN`, the realm import (`globalSetup`), the Keycloak container (`authServers`), the build's `PUBLIC_AUTH_ORIGIN` (`authBuildEnv`), `signInWithForm`, and a `test` whose worker signs in once and whose tests start with that SSO cookie; `test.use({ signedIn: false })` opts a spec out |
| `e2e/fixtures.ts` | `mergeTests` of the template's fixtures and `e2e/auth.ts`'s |
| `playwright.config.ts` | imports and lists: `globalSetup`, `...authServers`, `...authBuildEnv` |
| `e2e/sign-out.spec.ts` | new: sign-out by form POST in three tabs, and the CSP's `form-action` |
| `e2e/stale-chunk.spec.ts`, `e2e/smoke.spec.ts` | unchanged: the template's specs already count page loads from the moment the page shows and wait for a heading, not the URL, since with sign-in a page load is two (the app, then the app back from Keycloak) |
| the CI file the app has | Keycloak as a service of the `e2e` job, named in `E2E_AUTH_ORIGIN` |

```ts,verify
// file: e2e/auth.ts
import {
  type BrowserContext,
  test as base,
  expect,
  type FullConfig,
  type Page,
} from "@playwright/test";

/** Keycloak: the container `authServers` starts, unless E2E_AUTH_ORIGIN names one (CI). */
export const AUTH_ORIGIN = process.env.E2E_AUTH_ORIGIN ?? "http://127.0.0.1:8080";
/** The password of the users the realm import creates, `e2e-0` to `e2e-<workers - 1>`. */
const E2E_PASSWORD = "e2e-password";
/** A page under `src/routes/_signed-in/`: its guard leads to Keycloak's form. */
const GUARDED_PATH = "/users";
/** Keycloak's settings, test only; the CI service gets the same. */
const keycloakEnv = { KC_BOOTSTRAP_ADMIN_USERNAME: "admin", KC_BOOTSTRAP_ADMIN_PASSWORD: "admin" };

/** The one place that knows Keycloak's form: its labels come from the login theme. */
export async function signInWithForm(page: Page, worker: number) {
  await page.goto(GUARDED_PATH);
  await page.getByRole("textbox", { name: "Username or email" }).fill(`e2e-${worker}`);
  await page.getByRole("textbox", { name: "Password" }).fill(E2E_PASSWORD);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
  // Signed in once the app shows it: a navigation started earlier races the app's start.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

/**
 * Each worker signs in once; its tests start with that Keycloak SSO cookie, so a guarded page runs
 * the code flow without the form. A spec that tests the signed-out state writes
 * `test.use({ signedIn: false })`.
 */
export const test = base.extend<
  { signedIn: boolean },
  { keycloakSession: Awaited<ReturnType<BrowserContext["storageState"]>> }
>({
  signedIn: [true, { option: true }],
  keycloakSession: [
    async ({ browser }, use, workerInfo) => {
      const { baseURL } = workerInfo.project.use;
      const context = await browser.newContext(baseURL ? { baseURL } : {});
      await signInWithForm(await context.newPage(), workerInfo.parallelIndex);
      // Tokens live in memory: the state holds only Keycloak's cookies.
      const state = await context.storageState();
      await context.close();
      await use(state);
    },
    { scope: "worker" },
  ],
  storageState: async ({ signedIn, keycloakSession, storageState }, use) => {
    await use(signedIn ? keycloakSession : storageState);
  },
});

/** The build's origin for keycloak-js, beside the template's `PUBLIC_API_ORIGIN`. */
export const authBuildEnv = { PUBLIC_AUTH_ORIGIN: AUTH_ORIGIN };

/** Keycloak in Docker, on this machine only; none where E2E_AUTH_ORIGIN names one (CI). */
export const authServers = process.env.E2E_AUTH_ORIGIN
  ? []
  : [
      {
        command: [
          `docker run --rm --name app-e2e-keycloak -p 127.0.0.1:${new URL(AUTH_ORIGIN).port}:8080`,
          ...Object.keys(keycloakEnv).map((name) => `-e ${name}`),
          "quay.io/keycloak/keycloak:26.8.2 start-dev",
        ].join(" "),
        env: keycloakEnv,
        url: `${AUTH_ORIGIN}/realms/master`,
        // The default SIGKILL ends the docker CLI and leaves the container running.
        gracefulShutdown: { signal: "SIGTERM" as const, timeout: 10_000 },
        reuseExistingServer: true,
        timeout: 180_000,
      },
    ];

// Test only: the production client's settings (session-module reference) in a realm that serves
// plain HTTP, with one user per worker and a known password.
const realm = (appRoot: string, users: number) => ({
  realm: "app",
  enabled: true,
  // Test only: this Keycloak serves plain HTTP; a production realm keeps "external".
  sslRequired: "none",
  revokeRefreshToken: true,
  accessTokenLifespan: 300,
  clients: [
    {
      clientId: "app-spa",
      publicClient: true,
      standardFlowEnabled: true,
      implicitFlowEnabled: false,
      directAccessGrantsEnabled: false,
      redirectUris: [appRoot],
      webOrigins: [new URL(appRoot).origin],
      attributes: { "pkce.code.challenge.method": "S256", "post.logout.redirect.uris": appRoot },
    },
  ],
  users: Array.from({ length: users }, (_, index) => ({
    username: `e2e-${index}`,
    enabled: true,
    email: `e2e-${index}@example.com`,
    emailVerified: true,
    firstName: "E2E",
    lastName: `User ${index}`,
    credentials: [{ type: "password", value: E2E_PASSWORD, temporary: false }],
  })),
});

async function adminToken() {
  // Keycloak answers before it accepts logins; a CI service may still be starting.
  for (let attempt = 0; attempt < 90; attempt++) {
    const response = await fetch(`${AUTH_ORIGIN}/realms/master/protocol/openid-connect/token`, {
      method: "POST",
      // The test container's bootstrap admin (`keycloakEnv`, the CI service).
      body: new URLSearchParams({
        grant_type: "password",
        client_id: "admin-cli",
        username: "admin",
        password: "admin",
      }),
    }).catch(() => undefined);
    if (response?.ok) return ((await response.json()) as { access_token: string }).access_token;
    await new Promise((resolve) => setTimeout(resolve, 2_000));
  }
  throw new Error(`Keycloak at ${AUTH_ORIGIN} did not accept the admin sign-in`);
}

/** Playwright's globalSetup: replaces the realm `app`, so every run starts from the same users. */
// biome-ignore lint/style/noDefaultExport: Playwright loads globalSetup's default export.
export default async function importRealm(config: FullConfig) {
  // The preview server's root, the config's baseURL: the one redirect and post-logout URI.
  const appRoot = `${config.projects[0]?.use.baseURL}/`;
  const headers = { authorization: `Bearer ${await adminToken()}` };
  await fetch(`${AUTH_ORIGIN}/admin/realms/app`, { method: "DELETE", headers });
  const created = await fetch(`${AUTH_ORIGIN}/admin/realms`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(realm(appRoot, config.workers)),
  });
  if (!created.ok)
    throw new Error(`Realm import failed: ${created.status} ${await created.text()}`);
}
```

- One sign-in per worker, through the form; every test then passes on the SSO cookie, so only
  `signInWithForm` depends on the login theme's labels. Tokens live in memory, so each `page.goto`
  still runs the code flow, without the form.
- Every `page.goto` of a guarded page leaves for Keycloak and comes back, and the layout with its
  links shows in between. Wait for something only the signed-in page shows (its heading, the Sign
  out button), never the URL, which is the guarded page before the round trip: a click in between
  is lost, and WebKit reports `Load failed` or `is interrupted by another navigation`.
- One user per worker: sessions of parallel workers never share a refresh-token chain. A spec that
  signs out ends its session, so it opts out and signs in on its own, or the worker's later tests
  would meet the form.
- The realm import uses the master realm's `admin-cli` with the container's bootstrap admin. The
  app's own client never gets direct access grants: a password grant skips the code flow and PKCE
  the test is there to prove, and OAuth 2.1 removes it.

The template's `e2e/fixtures.ts` with the add-on: its `test` is renamed `app` and merged.

```ts,verify
// file: e2e/fixtures.ts
import { test as base, expect, mergeTests, type Page } from "@playwright/test";
import { test as auth } from "./auth.ts";

/** Where the stub API listens; a real backend's origin works the same way. */
export const API_ORIGIN = "http://127.0.0.1:4010";

interface Options {
  /** Errors a spec provokes on purpose (the route error screen reports one); others still fail it. */
  expectedErrors: RegExp[];
}

/**
 * Every test fails on a console error, an uncaught page error or a CSP / Trusted Types violation.
 * "Failed to load resource" is the browser logging an HTTP error status a test asked for.
 */
const app = base.extend<Options & { guard: undefined }>({
  expectedErrors: [[], { option: true }],
  guard: [
    async ({ page, expectedErrors }, use) => {
      const problems: string[] = [];
      const record = (text: string) => {
        if (!expectedErrors.some((expected) => expected.test(text))) problems.push(text);
      };
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
          record(message.text());
        }
      });
      page.on("pageerror", (error) => record(error.message));
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
        });
      });
      await use(undefined);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

export const test = mergeTests(app, auth);

/** The page never scrolls sideways (a wide table scrolls inside its own container). */
export async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

export { expect };
```

The template's `playwright.config.ts` with the add-on: one import, `globalSetup`, the container
first in `webServer`, and the auth origin in the build's environment.

```ts,verify
// file: playwright.config.ts
import { defineConfig, devices } from "@playwright/test";
import { authBuildEnv, authServers } from "./e2e/auth.ts";
import { API_ORIGIN } from "./e2e/fixtures.ts";

const isCI = !!process.env.CI;
const APP_ORIGIN = "http://localhost:4173";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // A test that passes only on a retry fails CI; the retry still records its trace.
  failOnFlakyTests: isCI,
  reporter: isCI ? [["list"], ["junit", { outputFile: "test-results/junit.xml" }]] : "list",
  use: { baseURL: APP_ORIGIN, trace: "on-first-retry" },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    // Safari's engine on a phone-sized touch screen: the narrow layout and WebKit-only bugs.
    { name: "phone", use: devices["iPhone 17e"] },
  ],
  // Creates the realm and its users in whichever Keycloak `AUTH_ORIGIN` names.
  globalSetup: "./e2e/auth.ts",
  webServer: [
    ...authServers,
    {
      command: "node e2e/stub-api.ts",
      url: `${API_ORIGIN}/health/live`,
      env: { PORT: new URL(API_ORIGIN).port },
      reuseExistingServer: !isCI,
    },
    {
      // The production build with the generated security headers, as users get it.
      command: "pnpm build && pnpm preview",
      url: APP_ORIGIN,
      env: { PUBLIC_API_ORIGIN: API_ORIGIN, ...authBuildEnv },
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
```

- `E2E_AUTH_ORIGIN` set means a Keycloak already runs there (the CI service): no container. The
  run never keys on `CI`, so `CI=1 pnpm test:e2e` on a workstation starts the container as usual.
- The container publishes its port on `127.0.0.1` only: its admin is `admin`/`admin`.
- Pin the Keycloak image by exact version (`26.8.2`), like every other image; CI pins it by digest.
- Each origin and port is written once: `AUTH_ORIGIN` in `e2e/auth.ts` (the container's `-p`
  follows it), the app's in `APP_ORIGIN` (the realm's redirect URI follows it). Another preview
  port also changes `preview.port` in `vite.config.ts`.

```ts,verify
// file: e2e/sign-out.spec.ts
import { AUTH_ORIGIN, signInWithForm } from "./auth.ts";
import { expect, test } from "./fixtures.ts";

// Signing out ends the session; the worker's shared one must outlive this spec.
test.use({ signedIn: false });

const signInPage = new RegExp(`^${AUTH_ORIGIN}/realms/app/protocol/openid-connect/auth\\?`);

test("signing out ends the session in every tab, with no token in any URL", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const urls: string[] = [];
  context.on("request", (request) => urls.push(request.url()));
  await signInWithForm(page, testInfo.parallelIndex);
  const guardedTab = await context.newPage();
  await guardedTab.goto("/users");
  await expect(guardedTab.getByRole("button", { name: "Sign out" })).toBeVisible();
  const publicTab = await context.newPage();
  await publicTab.goto("/users");
  await expect(publicTab.getByRole("button", { name: "Sign out" })).toBeVisible();
  // A signed-in tab on a public page: only a client-side navigation keeps the session.
  await publicTab.evaluate(() => {
    history.pushState(history.state, "", "/no-such-page");
    dispatchEvent(new PopStateEvent("popstate", { state: history.state }));
  });
  await expect(publicTab.getByRole("heading", { name: "Page not found" })).toBeVisible();
  const pages: string[] = [];
  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) pages.push(frame.url());
  });

  const logout = page.waitForRequest((request) => request.url().endsWith("/logout"));
  await page.getByRole("button", { name: "Sign out" }).click();

  expect((await logout).method()).toBe("POST");
  expect((await logout).postData()).toContain("id_token_hint=");
  // Keycloak sent the browser straight back to the app's root, with no confirmation page; the
  // guard of /users then sent the signed-out visitor to sign in again.
  await expect(page).toHaveURL(signInPage);
  expect(pages[0]).toBe(`${baseURL}/`);
  expect(
    pages.filter((url) =>
      url.startsWith(`${AUTH_ORIGIN}/realms/app/protocol/openid-connect/logout`),
    ),
  ).toEqual([]);
  // The broadcast reloads the other tabs: the guarded one leaves, the public one stays signed out.
  await expect(guardedTab).toHaveURL(signInPage);
  await expect(publicTab.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();
  expect(publicTab.url()).toBe(`${baseURL}/no-such-page`);
  expect(urls.filter((url) => url.includes("id_token_hint"))).toEqual([]);
});

test("the CSP lets a form post to Keycloak and nowhere else", async ({ page }) => {
  const response = await page.goto("/users");

  expect(response?.headers()["content-security-policy"]).toContain(
    `form-action 'self' ${AUTH_ORIGIN};`,
  );
});
```

Without the auth origin in `form-action` the sign-out spec fails in every engine, with
Chromium's `Sending form data to '<auth origin>/realms/app/protocol/openid-connect/logout' violates
the following Content Security Policy directive: "form-action 'self'"`, Firefox's
`Content-Security-Policy: The page’s settings blocked the loading of a resource (form-action)` and
WebKit's `Refused to load … because it does not appear in the form-action directive`.

The `e2e` jobs run inside the Playwright image, which has no Docker, so Keycloak is a service of the
job: on one network with the job, reached by its name, its settings as environment variables, and
the job waits for it (GitHub by its `--health-cmd`, GitLab by `HEALTHCHECK_TCP_PORT`). Add it to
the CI file the app has. GitHub, `.github/workflows/ci.yml`:

```yaml
  e2e:
    # ... runs-on, timeout-minutes, container and steps as in the scaffold
    services:
      keycloak:
        image: quay.io/keycloak/keycloak@sha256:7e66a96e4739239070aeaf72e4c5decf0f7f682cfc725b9f7ea2b336eaba38b3 # 26.8.2
        command: start-dev
        env:
          # Test only, like the realm.
          KC_BOOTSTRAP_ADMIN_USERNAME: admin
          KC_BOOTSTRAP_ADMIN_PASSWORD: admin
        options: --health-cmd "exec 3<>/dev/tcp/127.0.0.1/8080" --health-interval 2s --health-retries 90
    env:
      E2E_AUTH_ORIGIN: http://keycloak:8080
```

GitLab, `.gitlab-ci.yml`:

```yaml
e2e:
  # ... stage, image, script and artifacts as in the scaffold
  services:
    - name: quay.io/keycloak/keycloak@sha256:7e66a96e4739239070aeaf72e4c5decf0f7f682cfc725b9f7ea2b336eaba38b3 # 26.8.2
      alias: keycloak
      command: ["start-dev"]
      variables:
        # Test only, like the realm.
        KC_BOOTSTRAP_ADMIN_USERNAME: admin
        KC_BOOTSTRAP_ADMIN_PASSWORD: admin
        HEALTHCHECK_TCP_PORT: "8080"
  variables:
    # The job and its services on one network, each reached by its name.
    FF_NETWORK_PER_BUILD: "true"
    E2E_AUTH_ORIGIN: http://keycloak:8080
```

`globalSetup` still waits for the admin sign-in, which Keycloak accepts a little after its port
opens. Another preview port changes nothing here: the realm takes it from the config. Run with
`pnpm test:e2e`, or `CI=1 pnpm test:e2e` as CI runs it: the specs passed in Chromium, and with
Firefox and WebKit projects added, against Keycloak 26.8.2 on another site than the app
(`127.0.0.1` against `localhost`), and in the Playwright 1.65.1 image with Keycloak reached as
`http://keycloak:8080`.
