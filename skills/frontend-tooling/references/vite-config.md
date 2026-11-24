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
import type { Plugin, PluginOption, ResolvedConfig } from "vite";
import { defaultExclude, defineConfig } from "vitest/config";
import { caddyHeaders, cloudflareHeaders, headersFor, isBareOrigin } from "./deploy/headers.ts";

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
        if (!isBareOrigin(value)) {
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

/**
 * The React Compiler, under Vitest too. A coverage run (`--coverage` or `coverage.enabled`) leaves it
 * out: its memo caches double the branch count.
 */
function reactCompiler(): PluginOption[] {
  const preset = reactCompilerPreset();
  const rolldown = {
    ...preset.rolldown,
    configResolvedHook: (config: ResolvedConfig) => !config.test?.coverage?.enabled,
  };
  return [
    babel({ presets: [{ ...preset, rolldown }] }),
    {
      name: "react-compiler-state",
      // Read from Vitest's own resolved config, so a test can check the switch above.
      configureVitest: ({ vitest, project }) => {
        project.provide("reactCompiler", !vitest.config.coverage.enabled);
      },
    },
  ];
}

declare module "vitest" {
  interface ProvidedContext {
    reactCompiler: boolean;
  }
}

export default defineConfig({
  envPrefix: PUBLIC_ENV,
  resolve: { tsconfigPaths: true },
  plugins: [
    // Off under Vitest, where split chunks map back poorly to coverage; E2E runs the production build.
    tanstackRouter({
      target: "react",
      autoCodeSplitting: !process.env.VITEST,
      routeFileIgnorePattern: String.raw`\.test\.tsx?$`,
    }),
    react(),
    reactCompiler(),
    tailwindcss(),
    securityHeaders(PUBLIC_ENV),
    entryBudget(ENTRY_BUDGET_BYTES),
  ],
  build: {
    // The browser floor: Baseline Widely Available at the last version audit (the newest releases on
    // or before 23 May 2024), Firefox raised to 128 for Tailwind 4. It moves at every audit.
    target: ["chrome125", "edge125", "firefox128", "safari17.5"],
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
    // Chosen by file name: `*.test.tsx` and `*.dom.test.ts` get a DOM, every other `*.test.ts` runs in Node.
    projects: [
      {
        extends: true,
        test: {
          name: "node",
          environment: "node",
          include: ["**/*.test.ts"],
          exclude: [...defaultExclude, "**/*.dom.test.ts"],
          setupFiles: ["src/test/setup.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "dom",
          environment: "jsdom",
          include: ["**/*.test.tsx", "**/*.dom.test.ts"],
          setupFiles: ["src/test/setup.ts", "src/test/setup-dom.ts"],
        },
      },
    ],
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
3. `reactCompiler()`: `babel({ presets: [...] })` from `@rolldown/plugin-babel` with
   `reactCompilerPreset()`, which runs the React Compiler; it needs `@babel/core` and
   `babel-plugin-react-compiler` as dev dependencies. The preset compiles browser modules only
   (its `applyToEnvironmentHook`), so files of the `node` test project are never compiled.
4. `tailwindcss()`.
5. `securityHeaders(PUBLIC_ENV)`: validates the public origins with `isBareOrigin` from
   `deploy/headers.ts`, emits `_headers`, `headers.caddy`
   and `.assetsignore`, and serves the same headers in `vite preview`. The header content is
   `frontend-deploy`'s, generated from `deploy/headers.ts`.
6. `entryBudget(ENTRY_BUDGET_BYTES)`, `apply: "build"` only.

The React Compiler runs under `pnpm test`, so a test that renders code with a bug that exists
only when compiled (mutating a prop with `push` or `sort`) fails under `pnpm test`, `pnpm check`
and CI's plain test step. The coverage run leaves the compiler out and passes it: the preset's
`rolldown.configResolvedHook` returns `!config.test?.coverage?.enabled`, and Vitest has merged
`--coverage` and `--coverage.enabled=true` into that config before the hook runs, so the switch
needs no script variable. Compiled components carry memo-cache branches that only an unchanged
re-render takes: on the scaffold they raise the v8 branch count from 183 to 333, so the gate
would measure the compiler instead of the app. The `react-compiler-state` plugin provides
`inject("reactCompiler")` from Vitest's own resolved config, and
`src/app/react-compiler.dom.test.ts` fails if the switch and the transform disagree. Running
the compiler in tests cost nothing measurable on the scaffold (median 3.18 s against 3.27 s).

Route code splitting stays off under Vitest (`!process.env.VITEST`): split chunks map back to
source poorly. The end-to-end suite runs the production build with both on.

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
origin and lands in the CSP's `connect-src`. `isBareOrigin` accepts `http`, `https`, `ws` and
`wss` with a DNS host or an IPv6 literal and an optional port; it refuses wildcards (`https://*`),
a path or trailing slash, and the characters that would widen the CSP or become a Caddy
placeholder (`;`, `,`, `{`, `$`, `'`, a space). The other steps are
`frontend-deploy`'s procedure for adding an origin.

In dev the app calls `PUBLIC_API_ORIGIN` directly, and the backend's CORS allows the dev origin.
A team that wants `server.proxy` keeps the variable a bare origin, the dev server's own
(`http://localhost:5173`; `/api` fails as `not a bare origin`), and proxies only paths no page
route uses.

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

- First check what can leave the entry: find what joined the entry graph (a static import in
  `main.tsx`, `src/app/`, `__root.tsx` or a route's `validateSearch`) and move it behind a route
  or a dynamic `import()` before touching the number.
- Then raise `ENTRY_BUDGET_BYTES` by the measured growth, in the same change that adds the
  weight, naming the cause in the report. Headroom is not a reserve for the next feature. An
  add-on that must load before first render states its own cost in its skill.
- Lower it after a reduction, keeping some headroom over the measured size.
- `vite.config.test.ts` builds a synthetic entry against `entryBudget`, which is why the function
  stays exported.

## build, server and preview

| Key | Why |
|---|---|
| `build.target` | The browser floor (below the table). |
| `build.assetsInlineLimit: 0` | No `data:` URLs, which the CSP would have to allow. |
| `build.sourcemap: "hidden"` | Maps are written for an error tracker and never referenced; removing them from the deployed files is `frontend-deploy`'s. |
| `build.rolldownOptions.output.codeSplitting.groups` | One group puts `src/app/zod-config.ts` and the zod core it imports into a `zod-*.js` chunk that every schema-building chunk imports, so `jitless` is set before any schema probes `eval` (a Trusted Types violation). Static schema imports in entry code are then safe whatever the chunking; the entry budget counts that chunk. Route splitting comes from the router plugin. |
| `server`/`preview` `strictPort` | Fails when 5173 or 4173 is taken instead of moving to another port; Playwright expects 4173. |

### The browser floor

`build.target` is `chrome125`, `edge125`, `firefox128`, `safari17.5`: the browsers that are
Baseline Widely Available on the date of the last version audit (the newest releases at least 30
months old), with Firefox never below 128, which Tailwind 4 needs. It moves at every version
audit, never between them. Vite 8's own default (`baseline-widely-available`) is a fixed, older
list. What the floor guards and what it does not:

- `build.target` lowers JavaScript syntax and CSS that Lightning CSS can rewrite; it adds no API
  and no polyfill.
- `lib: ["es2024", "dom"]` in `tsconfig.json` stops JavaScript built-ins from ES2025 on
  (`Promise.try`, iterator helpers, `Temporal`) with a type error.
- Nothing stops a DOM API or a CSS feature newer than the floor (`URL.parse`, `for await` over a
  `ReadableStream`): the `dom` lib tracks current Chromium and CSS is never type-checked. The
  rule for people is `frontend-code-style`'s.

## The test block

| Key | Why |
|---|---|
| `projects` | Two, chosen by file name with no judgement: `node` runs every `*.test.ts` except `*.dom.test.ts` in Node with `src/test/setup.ts`; `dom` runs `*.test.tsx` and `*.dom.test.ts` in jsdom with `setup.ts` then `setup-dom.ts`. Both `extends: true`, so every other key below applies to both. Which test goes where and what each setup file holds is `frontend-testing`'s. |
| `projects[].include` | Also collects the config tests next to their config (`vite.config.test.ts`, `deploy/headers.test.ts`, `biome-plugins/boundaries.test.ts`), which run in `node`. |
| `env: { TZ: "UTC" }` | Dates format the same on every machine. |
| `restoreMocks`, `unstubGlobals`, `unstubEnvs` | Every test starts from the real implementations. |
| `sequence.shuffle` | Order-dependent tests fail early. |
| `coverage.thresholds` | 80 % lines and branches, enforced only with `--coverage` (`pnpm test:coverage` and CI). |
| `coverage.reporter` | `text-summary` for the console and the GitLab `coverage:` regex, `lcov` for editors, `cobertura` for the GitLab coverage report. |
| `coverage.exclude` | Generated code, the test harness and `main.tsx`. Which code belongs in the denominator is `frontend-testing`'s call. |

`globals` is not set (default `false`): tests import `test`, `expect` and `vi` from `vitest`.

The split exists because jsdom took 40 to 47 % of the run while most `*.test.ts` files need no
DOM; on the scaffold it cut the median run from about 4.0 s to 3.3 s. A `*.test.ts` that touches
the DOM fails in `node` with `ReferenceError: document is not defined` (storage: `TypeError:
Cannot read properties of undefined (reading 'setItem')`): rename it to `*.dom.test.ts`, so the
file name keeps deciding. `isolate: false` gave no stable gain, and
`pool: "vmThreads"` breaks MSW (`WritableStream is not defined`) and `vite.config.test.ts`, so
neither is used.
