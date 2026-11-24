// The one source of the response headers: `_headers` (Cloudflare), `headers.caddy` (the container)
// and `vite preview` are all rendered from `headerRules`, so they cannot drift.

type Scope = "all" | "assets";

/** `connectOrigins`: every origin the browser calls (API, identity provider, realtime, telemetry). */
function csp(connectOrigins: readonly string[]) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    ["connect-src 'self'", ...connectOrigins].join(" "),
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ].join("; ");
}

function headerRules(connectOrigins: readonly string[]): Record<Scope, Record<string, string>> {
  return {
    all: {
      // Everything unhashed revalidates: index.html, the SPA fallback, files from public/.
      "Cache-Control": "no-cache",
      "Content-Security-Policy": csp(connectOrigins),
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
export function headersFor(path: string, connectOrigins: readonly string[]) {
  const { all, assets } = headerRules(connectOrigins);
  return path.startsWith("/assets/") ? { ...all, ...assets } : all;
}

// Cloudflare joins a header that two matching rules set with a comma, so the `/assets/*` rule first
// detaches (`! Name`) what the `/*` rule set.
export function cloudflareHeaders(connectOrigins: readonly string[]) {
  const { all, assets } = headerRules(connectOrigins);
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
export function caddyHeaders(connectOrigins: readonly string[]) {
  return Object.entries(headerRules(connectOrigins))
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
