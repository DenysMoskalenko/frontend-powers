# A non-Keycloak identity provider: oidc-client-ts

## Contents

- [`src/app/oidc.ts`](#srcappoidcts)
- [Defaults and behaviour in 3.5](#defaults-and-behaviour-in-35)
- [`src/app/oidc.test.ts`](#srcappoidctestts)

`oidc-client-ts` 3.5 behind the same `IdentityProvider` contract, so `createSession`, the guard,
`configureApi` and every route test stay as they are. Swap `startKeycloak(...)` for
`startOidc({ authority: \`${env.authOrigin}/<issuer path>\`, clientId: "app-spa" })` in `main.tsx`.

## `src/app/oidc.ts`

```ts,verify
// file: src/app/oidc.ts
import {
  ErrorResponse,
  InMemoryWebStorage,
  type User,
  UserManager,
  WebStorageStateStore,
} from "oidc-client-ts";
import { sameOriginPath } from "@/shared/lib/safe-url";
import type { IdentityProvider } from "./session";

const SIGNED_OUT_KEY = "auth.signed-out";

/** The same contract as `startKeycloak`, for an identity provider other than Keycloak. */
export async function startOidc(settings: {
  authority: string;
  clientId: string;
}): Promise<IdentityProvider> {
  // The one URI registered for sign-in and sign-out: the app's root under Vite's `base`.
  const appUrl = new URL(import.meta.env.BASE_URL, location.origin);
  const manager = new UserManager({
    authority: settings.authority,
    client_id: settings.clientId,
    redirect_uri: appUrl.href,
    post_logout_redirect_uri: appUrl.href,
    // The defaults keep the tokens in sessionStorage and renew them on a timer forever.
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    automaticSilentRenew: false,
  });
  let user: User | null = null;
  // The answer arrives only at the app's root; `state` alone may be any page's own search param.
  const answer = new URLSearchParams(location.search);
  if (
    location.pathname === appUrl.pathname &&
    answer.has("state") &&
    (answer.has("code") || answer.has("error"))
  ) {
    user = await manager.signinRedirectCallback();
    // `.` resolves the router path below the app's root.
    const reopenAt = new URL(`.${sameOriginPath(user.url_state)}`, appUrl);
    history.replaceState(history.state, "", reopenAt);
  }
  const justSignedOut = take(SIGNED_OUT_KEY) !== null && !user;

  // oidc-client-ts runs concurrent refreshes in parallel; a rotated refresh token survives only one.
  let renewing: Promise<void> | undefined;
  const renew = async () => {
    // Without one, signinSilent() opens a hidden iframe at redirect_uri, which the CSP blocks.
    if (!user?.refresh_token) {
      user = null;
      return;
    }
    try {
      user = await manager.signinSilent();
    } catch (error) {
      // Refused (invalid_grant): the session ended. A network error keeps the token for the API.
      if (error instanceof ErrorResponse) user = null;
    }
  };

  return {
    userId: () => user?.profile.sub,
    async token(minValidity) {
      if (!user) return undefined;
      if (minValidity === -1 || (user.expires_in ?? 0) < Math.max(minValidity, 5)) {
        renewing ??= renew().finally(() => {
          renewing = undefined;
        });
        await renewing;
      }
      return user?.access_token;
    },
    async signIn(returnTo) {
      await manager.signinRedirect({ url_state: returnTo, redirectMethod: "replace" });
      return new Promise<never>(() => {});
    },
    async signOut() {
      // The page the provider sends back reads it and tells the other tabs.
      save(SIGNED_OUT_KEY, "1");
      await manager.signoutRedirect({ redirectMethod: "replace" });
      return new Promise<never>(() => {});
    },
    justSignedOut,
  };
}

function save(key: string, value: string) {
  try {
    sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked: other tabs learn at their next refresh.
  }
}

function take(key: string) {
  try {
    const value = sessionStorage.getItem(key);
    sessionStorage.removeItem(key);
    return value;
  } catch {
    return null;
  }
}
```

## Defaults and behaviour in 3.5

Read in `oidc-client-ts` 3.5.0 `dist/esm/oidc-client-ts.js`; the rows marked (run) are asserted by
`src/app/oidc.test.ts` against a fake provider. Not run against a real provider.

| Default or behaviour | Why it is overridden or relied on |
|---|---|
| `userStore`: `sessionStorage` | tokens stay in memory: `WebStorageStateStore` over `InMemoryWebStorage` |
| `automaticSilentRenew: true` | a timer one minute before expiry renews forever and keeps idle tabs signed in; renew on demand instead |
| `stateStore`: `localStorage` | kept: only the request state and PKCE verifier, removed on the callback |
| `response_mode`: unset | the provider's default for the code flow, the query string. The callback is detected only at the app's root path, by `state` plus `code` or `error`; a page's own `?state=` is left alone (run) |
| `monitorSession: false` | kept: the check-session iframe needs third-party cookies |
| `signinSilent()` | uses the refresh token when the user has one. Without one it falls back to a hidden `prompt=none` iframe at `silent_redirect_uri`, which defaults to `redirect_uri`; the CSP blocks it and the call waits `silentRequestTimeoutInSeconds` (10). So `renew` ends the session itself and never calls it without a refresh token (run) |
| concurrent `signinSilent()` | not serialized by the library: two parallel refreshes spend a rotated refresh token twice, so `renew` is single-flight |
| `ErrorResponse` | thrown for an error answer from the provider (`invalid_grant`): the session ended (run) |
| `signoutRedirect()` | adds `id_token_hint` from the stored user itself; sends no `state` unless given one |
| `url_state` | travels through the provider in `state` and returns on `User.url_state`: the return path, still checked with `sameOriginPath` (run) |

The provider must issue refresh tokens to a public client with rotation, and list the app's root URL
exactly as a redirect and post-logout URI, like the Keycloak client.

## `src/app/oidc.test.ts`

MSW answers the discovery document and the token endpoint; a stubbed `location` records where the
page would go, as in the keycloak-js tests.

```ts,verify,test
// file: src/app/oidc.test.ts
import { HttpResponse, http } from "msw";
import { beforeEach, expect, test, vi } from "vitest";
import { server } from "@/test/server";
import { startOidc } from "./oidc";

const authority = "https://idp.test";
const settings = { authority, clientId: "app-spa" };
const replace = vi.fn<(url: string) => void>();

const base64url = (value: object) =>
  btoa(JSON.stringify(value)).replaceAll("=", "").replaceAll("+", "-").replaceAll("/", "_");
const jwt = (claims: object) => `${base64url({ alg: "none" })}.${base64url(claims)}.`;

/** The token endpoint: the code exchange gets `first`, a refresh gets `refresh`. */
function tokenEndpoint(first: object, refresh: () => Response) {
  server.use(
    http.post(`${authority}/token`, async ({ request }) => {
      const grantType = new URLSearchParams(await request.text()).get("grant_type");
      if (grantType === "refresh_token") return refresh();
      return HttpResponse.json({
        id_token: jwt({ sub: "user-1" }),
        access_token: "a1",
        token_type: "Bearer",
        expires_in: 300,
        ...first,
      });
    }),
  );
}

/** Signs in through a simulated round trip to the provider and back to the app's root. */
async function signIn(returnTo: string, tokens: object, refresh = () => HttpResponse.error()) {
  void (await startOidc(settings)).signIn(returnTo);
  await vi.waitFor(() => expect(replace).toHaveBeenCalled());
  const state = new URL(replace.mock.lastCall?.[0] ?? "").searchParams.get("state") ?? "";
  tokenEndpoint(tokens, refresh);
  history.replaceState(null, "", `/?${new URLSearchParams({ state, code: "code-1" })}`);
  return startOidc(settings);
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
  server.use(
    http.get(`${authority}/.well-known/openid-configuration`, () =>
      HttpResponse.json({
        issuer: authority,
        authorization_endpoint: `${authority}/authorize`,
        token_endpoint: `${authority}/token`,
        end_session_endpoint: `${authority}/logout`,
      }),
    ),
  );
});

test("a page's own ?state= search param is not a sign-in answer", async () => {
  history.replaceState(null, "", "/orders?state=shipped");

  const provider = await startOidc(settings);

  expect(provider.userId()).toBeUndefined();
  expect(location.pathname + location.search).toBe("/orders?state=shipped");
});

test("the answer at the app's root signs in and reopens the saved path", async () => {
  const provider = await signIn("/orders/7?tab=items", { refresh_token: "r1" });

  expect(provider.userId()).toBe("user-1");
  expect(location.pathname + location.search).toBe("/orders/7?tab=items");
});

test("without a refresh token, a renewal ends the session instead of opening an iframe", async () => {
  const provider = await signIn("/", {});

  expect(await provider.token(-1)).toBeUndefined();
  expect(provider.userId()).toBeUndefined();
  expect(document.querySelector("iframe")).toBeNull();
});

test("a refused refresh ends the session", async () => {
  const provider = await signIn("/", { refresh_token: "r1" }, () =>
    HttpResponse.json({ error: "invalid_grant" }, { status: 400 }),
  );

  expect(await provider.token(-1)).toBeUndefined();
  expect(provider.userId()).toBeUndefined();
});

test("only the page the logout comes back to reports the sign-out", async () => {
  const provider = await signIn("/", { refresh_token: "r1" });

  void provider.signOut();
  await vi.waitFor(() => expect(replace).toHaveBeenCalledTimes(2));
  history.replaceState(null, "", "/");

  expect((await startOidc(settings)).justSignedOut).toBe(true);
  expect((await startOidc(settings)).justSignedOut).toBe(false);
});
```
