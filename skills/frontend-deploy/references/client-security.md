# Client-side security helpers

## Contents

user-supplied URLs (`safeHref`, `sameOriginPath`) with their test · new windows and COOP ·
`postMessage` · web storage.

## User-supplied URLs

React 19 replaces a `javascript:` URL in `href` with one that throws "React has blocked a
javascript: URL as a security precaution.", but it lets `data:`, `vbscript:` and any other scheme
through, and it does nothing for `window.open`, `location.assign` or a redirect after sign-in.
Every URL that comes from a user, the API or the query string goes through one of these two
functions before it reaches `href`, `window.open` or navigation.

```ts,verify
// file: src/shared/lib/safe-url.ts
const LINK_PROTOCOLS = new Set(["https:", "mailto:"]);

/** `URL.parse` without it: Safari before 18 and Chrome before 126 lack it. */
function parseUrl(value: string, base?: string): URL | undefined {
  try {
    return new URL(value, base);
  } catch {
    // Not a URL: the callers' answer for that is "no link" or "/".
    return undefined;
  }
}

/** A user-supplied link target, or undefined when its scheme is not allowed. */
export function safeHref(value: string): string | undefined {
  const url = parseUrl(value);
  return url && LINK_PROTOCOLS.has(url.protocol) ? url.href : undefined;
}

/** A redirect target such as `?returnTo=`: a path on this origin, or "/" for anything else. */
export function sameOriginPath(value: string | null | undefined): string {
  const url = parseUrl(value ?? "/", window.location.origin);
  // "/.//evil.example" resolves to the path "//evil.example", which a browser reads as another host.
  if (url?.origin !== window.location.origin || url.pathname.startsWith("//")) return "/";
  return url.pathname + url.search + url.hash;
}
```

```ts,verify,test
// file: src/shared/lib/safe-url.dom.test.ts
import { expect, test } from "vitest";
import { safeHref, sameOriginPath } from "./safe-url";

test("only https and mailto links pass", () => {
  expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
  expect(safeHref("mailto:ada@example.com")).toBe("mailto:ada@example.com");
  expect(safeHref("javascript:alert(1)")).toBeUndefined();
  expect(safeHref("data:text/html,hello")).toBeUndefined();
  expect(safeHref("http://example.com")).toBeUndefined();
  expect(safeHref("/users")).toBeUndefined();
});

test("a redirect target stays on this origin", () => {
  expect(sameOriginPath("/users/1?tab=a#top")).toBe("/users/1?tab=a#top");
  expect(sameOriginPath("https://evil.example/users")).toBe("/");
  expect(sameOriginPath("//evil.example/users")).toBe("/");
  expect(sameOriginPath("/\\evil.example")).toBe("/");
  expect(sameOriginPath("/.//evil.example")).toBe("/");
  expect(sameOriginPath(null)).toBe("/");
});

test("URL.parse is not called", () => {
  const parse = URL.parse;
  // @ts-expect-error simulating a floor browser
  URL.parse = undefined;
  try {
    expect(safeHref("https://example.com/a")).toBe("https://example.com/a");
    expect(sameOriginPath("https://evil.example/users")).toBe("/");
  } finally {
    URL.parse = parse;
  }
});
```

An app link built from the route tree uses the router's `Link` with a typed `to`, never
`safeHref`. Add `http:` to `LINK_PROTOCOLS` only for a product that links to plain-HTTP sites on
purpose.

## New windows

- `<a href={safeHref(url)} target="_blank">` needs no `rel`: browsers imply `noopener` for
  `target="_blank"`. Add `rel="noreferrer"` only to withhold the referrer as well.
- `window.open(url, "_blank", "noopener")` for a tab opened from code; it returns `null`, so do not
  keep the handle. Only a window the app talks to (a payment popup) is opened without `noopener`.
- The shipped `Cross-Origin-Opener-Policy: same-origin` severs a cross-origin popup in both
  directions: the app's handle reads `closed === true`, the popup's `window.opener` is `null`, and
  no message arrives either way. A cross-origin popup the app exchanges messages with (payment,
  popup sign-in) needs COOP `same-origin-allow-popups` in `deploy/headers.ts`, as a reviewed change
  with a test; never drop the header. An embedded iframe (`frame-src` with the exact origin) is
  the alternative COOP does not affect.

## `postMessage`

Under COOP `same-origin-allow-popups` (above):

```ts
const PAYMENT_ORIGIN = "https://pay.example.com";
const popup = window.open(`${PAYMENT_ORIGIN}/checkout`, "_blank", "popup");
window.addEventListener("message", (event) => {
  if (event.origin !== PAYMENT_ORIGIN || event.source !== popup) return;
  const result = PaymentResult.safeParse(event.data);
  if (result.success) onPaid(result.data);
});
popup?.postMessage({ type: "ready" }, PAYMENT_ORIGIN);
```

Check `event.origin` against one exact origin and `event.source` against the window the app
opened, parse `event.data` with a zod schema, and always send with an explicit `targetOrigin`,
never `"*"`. A `BroadcastChannel` is same-origin and needs no origin check, but its messages are
still parsed.

## Web storage

`localStorage` and `sessionStorage` are readable by any script on the origin and by anyone with
the device. They may hold UI preferences (a collapsed sidebar, a table's column choice, a theme or
language choice), flags such as `reloaded-for-stale-chunk` (the last stale-chunk reload's
timestamp) and the signed-out flag, the sign-in return path, and the OAuth library's one-time
`state` and PKCE entries (owned by `keycloak-spa-auth`). They never hold an access, refresh or ID token, personal data, or an API
response that contains either. A value read back is untrusted: accept only the
values it may have (a zod schema, an allow-list, `sameOriginPath` for a path) and fall back to the
default otherwise.
