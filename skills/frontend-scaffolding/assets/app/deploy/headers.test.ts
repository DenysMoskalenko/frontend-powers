import { expect, test } from "vitest";
import { caddyHeaders, cloudflareHeaders, headersFor } from "./headers.ts";

const api = ["https://api.example.com"];

test("the CSP allows the app's own scripts and styles and the given origins only", () => {
  expect(headersFor("/", api)["Content-Security-Policy"]).toBe(
    "default-src 'self'; script-src 'self'; style-src 'self'; " +
      "connect-src 'self' https://api.example.com; object-src 'none'; base-uri 'none'; " +
      "form-action 'self'; frame-ancestors 'none'; " +
      "require-trusted-types-for 'script'; trusted-types 'none'",
  );
});

test("only hashed assets are cached for a year", () => {
  expect(headersFor("/users/1", api)["Cache-Control"]).toBe("no-cache");
  expect(headersFor("/assets/index-abc.js", api)["Cache-Control"]).toBe(
    "public, max-age=31536000, immutable",
  );
});

test("Cloudflare's /assets/* rule detaches the Cache-Control that /* sets", () => {
  const lines = cloudflareHeaders(api).split("\n");
  const assets = lines.indexOf("/assets/*");

  expect(lines.slice(assets)).toEqual([
    "/assets/*",
    "  ! Cache-Control",
    "  Cache-Control: public, max-age=31536000, immutable",
    "",
  ]);
});

test("the Caddy snippets carry the same headers, quoted", () => {
  expect(caddyHeaders(api)).toContain(
    '(assets_headers) {\n\tCache-Control "public, max-age=31536000, immutable"\n}',
  );
  expect(caddyHeaders(api)).toContain('\tX-Content-Type-Options "nosniff"\n');
});
