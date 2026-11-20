# vite.config.ts

The file verbatim, identical to the scaffold's, then what each part does and how to change it
safely. In an existing project merge only the part a change needs.

## Contents

- [The file](#the-file)
- [Plugins and their order](#plugins-and-their-order)
- [Public variables](#public-variables)
- [The bundle budget](#the-bundle-budget)
- [build, server and preview](#build-server-and-preview)
- [The test block](#the-test-block)

## The file

```ts,verify
// file: vite.config.ts
import { gzipSync } from "node:zlib";
import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { caddyHeaders, cloudflareHeaders, headersFor } from "./deploy/headers.ts";

// The only variables that reach the bundle. Each is public, and each is an origin the CSP allows.
const PUBLIC_ENV = ["PUBLIC_API_ORIGIN"];
const ENTRY_BUDGET_BYTES = 160_000;

/** Validates the public origins, then emits the deploy headers and serves them in `vite preview`. */
function securityHeaders(names: readonly string[]): Plugin {
  let origins: string[] = [];
  return {
    name: "security-headers",
    // A hook, not top-level code: tools that only load this file (Vitest, knip) need no environment.
    configResolved({ env, mode }) {
      if (mode === "test") return;
      origins = names.map((name) => {
        const value: unknown = env[name];
        if (typeof value !== "string" || !value) throw new Error(`${name} is not set`);
        // The value goes into the CSP as is: anything past a bare origin could add a directive.
        if (URL.parse(value)?.origin !== value) {
          throw new Error(`${name} is not a bare origin: ${value}`);
        }
        return value;
      });
    },
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "_headers", source: cloudflareHeaders(origins) });
      this.emitFile({ type: "asset", fileName: "headers.caddy", source: caddyHeaders(origins) });
      // Cloudflare uploads everything else in dist; source maps go to the error tracker only.
      this.emitFile({ type: "asset", fileName: ".assetsignore", source: "*.map\nheaders.caddy\n" });
    },
    configurePreviewServer(server) {
      server.middlewares.use((request, response, next) => {
        for (const [name, value] of Object.entries(headersFor(request.url ?? "/", origins))) {
          response.setHeader(name, value);
        }
        next();
      });
    },
  };
}

/** Fails the build, before anything is written, when the entry and its static imports exceed the budget. */
export function entryBudget(limit: number): Plugin {
  return {
    name: "entry-budget",
    apply: "build",
    generateBundle: {
      order: "post",
      handler(_, bundle) {
        const entry = Object.values(bundle).find((file) => file.type === "chunk" && file.isEntry);
        if (entry?.type !== "chunk") return this.error("entry-budget: no entry chunk");
        const files = new Set<string>();
        const visit = (name: string) => {
          const file = bundle[name];
          if (!file || files.has(name)) return;
          files.add(name);
          if (file.type === "chunk") {
            for (const dep of [...file.imports, ...(file.viteMetadata?.importedCss ?? [])]) {
              visit(dep);
            }
          }
        };
        visit(entry.fileName);
        let bytes = 0;
        for (const name of files) {
          const file = bundle[name];
          if (file) bytes += gzipSync(file.type === "chunk" ? file.code : file.source).length;
        }
        const report = `entry + static imports: ${bytes} B gzip (budget ${limit} B)`;
        if (bytes > limit) return this.error(report);
        this.info(report);
      },
    },
  };
}

export default defineConfig({
  envPrefix: PUBLIC_ENV,
  resolve: { tsconfigPaths: true },
  plugins: [
    // Both off under Vitest, where they would skew coverage (split chunks map back poorly, compiler
    // memo caches double the branch count); E2E runs the production build with both.
    tanstackRouter({
      target: "react",
      autoCodeSplitting: !process.env.VITEST,
      routeFileIgnorePattern: String.raw`\.test\.tsx?$`,
    }),
    react(),
    !process.env.VITEST && babel({ presets: [reactCompilerPreset()] }),
    tailwindcss(),
    securityHeaders(PUBLIC_ENV),
    entryBudget(ENTRY_BUDGET_BYTES),
  ],
  build: {
    // The browser floor: Tailwind 4 needs Firefox 128; the rest matches `lib: es2024` in tsconfig.json.
    target: ["chrome119", "edge119", "firefox128", "safari17.4"],
    // An inlined data: URL would need data: in the CSP's img-src and font-src.
    assetsInlineLimit: 0,
    // Written for the error tracker's upload, never referenced from the bundle, never deployed.
    sourcemap: "hidden",
    rolldownOptions: {
      output: {
        codeSplitting: {
          // Any chunk that builds a schema imports zod's chunk, so the config in it runs first.
          groups: [{ name: "zod", test: /src[\\/]app[\\/]zod-config\.ts$/ }],
        },
      },
    },
  },
  server: { port: 5173, strictPort: true },
  preview: { port: 4173, strictPort: true },
  test: {
    environment: "jsdom",
    include: ["**/*.test.{ts,tsx}"],
    setupFiles: ["src/test/setup.ts"],
    env: { TZ: "UTC" },
    restoreMocks: true,
    unstubGlobals: true,
    unstubEnvs: true,
    sequence: { shuffle: true },
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.gen.ts", "src/api/generated/**", "src/test/**", "src/main.tsx"],
      reporter: ["text-summary", "lcov", "cobertura"],
      thresholds: { lines: 80, branches: 80 },
    },
  },
});
```

`defineConfig` comes from `vitest/config` so the `test` block type-checks; Vitest reads this file,
there is no separate `vitest.config.ts`.

## Plugins and their order

1. `tanstackRouter(...)` first: it generates `src/routeTree.gen.ts` and splits route files before
   the React transform sees them. `routeFileIgnorePattern` keeps colocated `*.test.tsx` files out
   of the route tree. What the router options mean is `tanstack-router-spa`'s.
2. `react()`: `@vitejs/plugin-react` 6 transforms JSX with Oxc and has no Babel. Its `babel`
   option is gone: `react({ babel: { ... } })` fails `tsc` with TS2353 (`'babel' does not exist
   in type 'Options'`). Its `compiler` option is experimental and needs `oxc-transform-react`,
   which is not installed; do not use it.
3. `babel({ presets: [reactCompilerPreset()] })` from `@rolldown/plugin-babel` runs the React
   Compiler; it needs `@babel/core` and `babel-plugin-react-compiler` as dev dependencies.
4. `tailwindcss()`.
5. `securityHeaders(PUBLIC_ENV)`: validates the public origins, emits `_headers`, `headers.caddy`
   and `.assetsignore`, and serves the same headers in `vite preview`. The header content is
   `frontend-deploy`'s, generated from `deploy/headers.ts`.
6. `entryBudget(ENTRY_BUDGET_BYTES)`, `apply: "build"` only.

Off under Vitest (`process.env.VITEST` is set by Vitest; a `false` entry in `plugins` is
skipped): the React Compiler and route code splitting. Compiled components carry memo-cache
branches that only an unchanged re-render takes, which pushed branch coverage under the 80 %
gate; split route chunks map back to source poorly. The end-to-end suite runs the
production build with both on. Do not turn either on in tests to "test what ships": that is
what `pnpm test:e2e` is for.

`resolve.tsconfigPaths: true` makes Vite resolve the `@/*` alias from `tsconfig.json`; the
option defaults to `false`, and no alias plugin or `resolve.alias` copy is needed.

## Public variables

`envPrefix` holds exact variable names, not a prefix: only a listed name reaches
`import.meta.env`, so an unrelated `PUBLIC_*` or `VITE_*` variable in a CI environment never
lands in the bundle. The values are checked in the `configResolved` hook, skipped when
`mode === "test"`, because knip and Vitest load this file without any environment; a throw at
the top of the file breaks them. `pnpm dev` reads `.env.development`; `pnpm build` and
`pnpm preview` fail without the variable:

```text
Error: PUBLIC_API_ORIGIN is not set
Error: PUBLIC_API_ORIGIN is not a bare origin: https://api.example.com/x
```

A new variable is one more `PUBLIC_ENV` entry in this file; every listed value must be a bare
origin and lands in the CSP's `connect-src`. The other steps are
`frontend-deploy`'s procedure for adding an origin.

## The bundle budget

`entryBudget` gzips the entry chunk, every chunk it imports statically and their CSS, after
every other plugin (`generateBundle`, `order: "post"`), and fails the build before anything is
written to `dist/assets`. Every build prints the measurement:

```text
[plugin entry-budget] entry + static imports: <n> B gzip (budget 160000 B)
```

Over the budget:

```text
[plugin entry-budget]
RolldownError: entry + static imports: <n> B gzip (budget 160000 B)
```

- Over budget: find what joined the entry graph (a static import in `main.tsx`, `src/app/`,
  `__root.tsx` or a route's `validateSearch`) and move it behind a route or a dynamic `import()`
  before touching the number.
- Raise `ENTRY_BUDGET_BYTES` only for a measured, named cause: by the measured growth, in the
  same change that adds the weight, naming the cause in the report. An add-on that must load
  before first render states its own cost in its skill.
- Lower it after a reduction, keeping some headroom over the measured size.
- `vite.config.test.ts` builds a synthetic entry against `entryBudget`, which is why the function
  stays exported.

## build, server and preview

| Key | Why |
|---|---|
| `build.target` | The browser floor. The Vite 8 default (`baseline-widely-available`) is lower; Tailwind 4 needs Firefox 128. Raise it only together with `lib` in `tsconfig.json`. |
| `build.assetsInlineLimit: 0` | No `data:` URLs, which the CSP would have to allow. |
| `build.sourcemap: "hidden"` | Maps are written for an error tracker and never referenced; removing them from the deployed files is `frontend-deploy`'s. |
| `build.rolldownOptions.output.codeSplitting.groups` | One group puts `src/app/zod-config.ts` and the zod core it imports into a `zod-*.js` chunk that every schema-building chunk imports, so `jitless` is set before any schema probes `eval` (a Trusted Types violation). Static schema imports in entry code are then safe whatever the chunking; the entry budget counts that chunk. Route splitting comes from the router plugin. |
| `server`/`preview` `strictPort` | Fails when 5173 or 4173 is taken instead of moving to another port; Playwright expects 4173. |

## The test block

| Key | Why |
|---|---|
| `environment: "jsdom"` | One DOM for every test. |
| `include: ["**/*.test.{ts,tsx}"]` | Also collects the config tests next to their config (`vite.config.test.ts`, `deploy/headers.test.ts`, `biome-plugins/boundaries.test.ts`). |
| `setupFiles` | The MSW server, jest-dom matchers, cleanup and the `reportError` guard. Its content is `frontend-testing`'s. |
| `env: { TZ: "UTC" }` | Dates format the same on every machine. |
| `restoreMocks`, `unstubGlobals`, `unstubEnvs` | Every test starts from the real implementations. |
| `sequence.shuffle` | Order-dependent tests fail early. |
| `coverage.thresholds` | 80 % lines and branches, enforced only with `--coverage` (`pnpm test:coverage` and CI). |
| `coverage.reporter` | `text-summary` for the console and the GitLab `coverage:` regex, `lcov` for editors, `cobertura` for the GitLab coverage report. |
| `coverage.exclude` | Generated code, the test harness and `main.tsx`. Which code belongs in the denominator is `frontend-testing`'s call. |

`globals` is not set (default `false`): tests import `test`, `expect` and `vi` from `vitest`.
