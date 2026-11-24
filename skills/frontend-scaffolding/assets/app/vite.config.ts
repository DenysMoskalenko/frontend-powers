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
