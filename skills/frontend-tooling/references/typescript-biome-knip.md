# tsconfig.json, biome.json, the boundary plugin and knip.json

Each file verbatim, identical to the scaffold's, followed by the keys that are not defaults or
that a model gets wrong. In an existing project merge only the entries a change needs.

## Contents

- [tsconfig.json](#tsconfigjson)
- [TypeScript 7 errors on old options](#typescript-7-errors-on-old-options)
- [biome.json](#biomejson)
- [Changing the Biome config](#changing-the-biome-config)
- [biome-plugins/boundaries.grit](#biome-pluginsboundariesgrit)
- [knip.json](#knipjson)

## tsconfig.json

```json
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024", "dom"],
    "module": "preserve",
    "jsx": "react-jsx",
    "types": ["node", "vite/client"],
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "noEmit": true,
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "e2e", "deploy", "biome-plugins", "*.ts"]
}
```

| Key | Why |
|---|---|
| one file, `include` with `*.ts` | Type-checks the app, `vite.config.ts`, Playwright, `deploy/` and the plugin test in one `tsc` run. No `tsconfig.app.json`/`tsconfig.node.json` split, no `references`, no `tsc -b`. |
| `module: "preserve"` | Resolution defaults to `bundler`; leave `moduleResolution` out. |
| `lib: ["es2024", "dom"]` | Matches the `build.target` floor in `vite.config.ts`. |
| `types` | TypeScript 7 defaults `types` to `[]`: an ambient package is visible only when listed. Without `vite/client` the CSS import fails with TS2882, because `noUncheckedSideEffectImports` is now on by default. |
| `strict` | The TypeScript 7 default, kept explicit. |
| `exactOptionalPropertyTypes`, `noUncheckedIndexedAccess`, `noImplicitOverride` | Not in `strict`. What they demand of code is `frontend-code-style`'s. |
| `verbatimModuleSyntax` | Type-only imports must be `import type`; implies `isolatedModules`. |
| `erasableSyntaxOnly` | Rejects `enum`, `namespace` and parameter properties (TS1294), so Node 26 can run every `.ts` config and script directly by stripping types. |
| `allowImportingTsExtensions` | Config files import `./deploy/headers.ts` with the extension, as Node requires. Needs `noEmit`. |
| `paths` | `@/*` with no `baseUrl`; paths resolve relative to the tsconfig. Vite reads the same map through `resolve.tsconfigPaths`. |
| not set: `noPropertyAccessFromIndexSignature` | Conflicts with Biome's `useLiteralKeys` and `import.meta.env` access. |
| not set: `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` | Biome reports the same things with fixes. |
| not set: `incremental` | No gain at this size; it adds an artifact. |

TypeScript 7 is the native compiler. It drops the classic compiler API: `import ts from
"typescript"` exports only `version` and `versionMajorMinor`, and the new API is unstable, under
`typescript/unstable/sync` and `typescript/unstable/async`. A tool built on the classic API
fails; Biome, knip 6, orval, Vite and the router plugin do not need it.
The VS Code language service comes from the `TypeScriptTeam.native-preview` extension.

## TypeScript 7 errors on old options

| Option | Error |
|---|---|
| `baseUrl` | `TS5102: Option 'baseUrl' has been removed. Please remove it from your configuration.` with the hint `Use '"paths": {"*": ["./*"]}' instead.` |
| `downlevelIteration`, `outFile` | TS5102, removed. |
| `moduleResolution: "node"` or `"node10"` | `TS5108: Option 'moduleResolution=node10' has been removed.` |
| `target: "es5"`, `esModuleInterop: false`, `allowSyntheticDefaultImports: false` | TS5108, that value removed. |
| `importsNotUsedAsValues`, `preserveValueImports`, `suppressImplicitAnyIndexErrors` | `TS5023: Unknown compiler option`. `verbatimModuleSyntax` replaces the first two. |
| `types` without `vite/client` | `TS2882: Cannot find module or type declarations for side-effect import of '@/styles.css'.` |

Delete the option; none of them has a TypeScript 7 replacement other than the one named.

## biome.json

```json
{
  "$schema": "./node_modules/@biomejs/biome/configuration_schema.json",
  "vcs": { "enabled": true, "clientKind": "git", "useIgnoreFile": true, "defaultBranch": "main" },
  "files": { "includes": ["**", "!src/routeTree.gen.ts", "!src/api/generated"] },
  "formatter": { "indentStyle": "space", "lineWidth": 100 },
  "tailwind": { "stylesheet": "./src/styles.css", "mergeFunctions": ["cx"] },
  "plugins": ["./biome-plugins/boundaries.grit"],
  "linter": {
    "domains": {
      "react": "recommended",
      "project": "recommended",
      "types": "recommended",
      "test": "recommended"
    },
    "rules": {
      "complexity": { "noExcessiveCognitiveComplexity": "error" },
      "correctness": {
        "noNestedComponentDefinitions": "error",
        "noUndeclaredDependencies": "error",
        "noUnresolvedImports": "off"
      },
      "nursery": {
        "noFloatingPromises": "error",
        "noMisusedPromises": "error",
        "noTailwindArbitraryValue": "error",
        "noTailwindLegacyUtilities": "error",
        "noTailwindRawColors": "error",
        "noTailwindRestyledComponents": "error",
        "useReactCompiler": "error",
        "useTailwindShorthandClasses": "error",
        "useTailwindStaticClassStrings": "error",
        "useTailwindVariablesShorthand": "error"
      },
      "performance": { "noBarrelFile": "error", "noReExportAll": "error" },
      "style": {
        "noDefaultExport": "error",
        "noNonNullAssertion": "error",
        "useFilenamingConvention": {
          "level": "error",
          "options": { "filenameCases": ["kebab-case"], "requireAscii": true }
        }
      },
      "suspicious": {
        "noConsole": "error",
        "noExplicitAny": "error",
        "noImportCycles": "error",
        "noReactForwardRef": "error"
      }
    }
  },
  "overrides": [
    {
      "includes": ["src/routes/**"],
      "linter": { "rules": { "style": { "useFilenamingConvention": "off" } } }
    },
    {
      "includes": ["src/shared/ui/**"],
      "linter": {
        "rules": {
          "nursery": { "noTailwindArbitraryValue": "off", "noTailwindRestyledComponents": "off" }
        }
      }
    },
    {
      "includes": ["*.config.ts"],
      "linter": { "rules": { "style": { "noDefaultExport": "off" } } }
    },
    {
      "includes": ["e2e/**"],
      "linter": {
        "domains": { "playwright": "recommended" },
        "rules": { "suspicious": { "noConsole": "off" } }
      }
    }
  ]
}
```

| Key | Why |
|---|---|
| `vcs.useIgnoreFile` | Biome skips what `.gitignore` lists. It errors when no `.gitignore` exists. |
| `files.includes` | `!` globs exclude the generated route tree and API client. `files.ignore` and `files.include` are Biome 1 keys and abort Biome 2. |
| `formatter` | Two spaces, 100 columns; the other defaults (double quotes, semicolons, trailing commas) stay. `.editorconfig` is not read by Biome. |
| `tailwind` | `stylesheet` lets the Tailwind rules know the project's tokens and turns on Tailwind directive parsing in CSS (no `css.parser.tailwindDirectives` key needed); `mergeFunctions` makes them lint the arguments of `cx()`. |
| `plugins` | The GritQL boundary plugin. Its diagnostics print as `plugin`. |
| `linter.domains` | `recommended` turns on each domain's stable recommended rules: React hooks and JSX (`react`), import cycles and undeclared dependencies through the module graph (`project`), type-aware rules (`types`), test-file rules (`test`). Never `"all"` for `react`: it adds `noJsxPropsBind`, which forbids the inline handlers the React Compiler makes free. |
| `nursery` rules | A domain never enables a nursery rule, and a nursery rule defaults to `info`, so each is listed at `error`. `noFloatingPromises` and `noMisusedPromises` need the `types` domain. `useReactCompiler` reports code the compiler skips. The seven Tailwind rules enforce the styling contract (`tailwind-base-ui` owns what they mean). |
| `noExcessiveCognitiveComplexity` | Default severity is `info`; raised to `error` at the default threshold of 15. |
| `noUndeclaredDependencies` | An import of a package not in `package.json` fails lint. |
| `noUnresolvedImports: "off"` | `tsc` already reports an unresolved import, with the right paths. |
| `noBarrelFile`, `noReExportAll`, `noDefaultExport`, `useFilenamingConvention` | House structure rules (`frontend-project-structure` owns them); off by default in Biome. |
| `noConsole` | No allow list: app code reports through `reportError`. |
| override `src/routes/**` | TanStack file-route names (`$userId.tsx`) are not kebab-case. |
| override `src/shared/ui/**` | The wrappers are where the restyled-component and arbitrary-value classes legitimately live. |
| override `*.config.ts` | Vite, Playwright and orval load a default export. |
| override `e2e/**` | Playwright rules on, `console` allowed in the end-to-end helpers. |
| not enabled: `useTailwindSortedClasses` | Class order is not enforced; its order changed between Biome minors and churns every file on upgrade. |

## Changing the Biome config

- Look the rule up first: `pnpm exec biome explain <ruleName>` prints its group (the
  `Diagnostic category` line, `lint/<group>/<rule>`), default severity and whether a domain
  enables it. Put it under that group at `"error"`, then run `pnpm check` and fix or justify
  every new finding in the same change.
- Scope a rule to some paths with a new `overrides` entry (`includes` globs relative to the
  project root), never by editing the base rule.
- Suppress one finding on the line before it, with the rule's full name and a reason, as
  `src/app/router.tsx` does:

  ```ts
  // biome-ignore lint/correctness/noComponentHookFactories: built once per router, which keeps it.
  ```

  Without `: <reason>` Biome reports `suppressions/parse` and the suppression does not apply; a
  suppression that matches nothing is reported as `suppressions/unused`. Never suppress a
  boundary `plugin` diagnostic: move the code.
- After a Biome upgrade run `pnpm exec biome migrate --write`, then `pnpm check`. An unknown key
  (``Found an unknown key `useSortedClasses`.``) aborts every Biome command, including the hook.

## biome-plugins/boundaries.grit

```text
language js

JsModuleSource() as $source where {
  or {
    and {
      $source <: r"[\"']\.\./.*[\"']",
      register_diagnostic(span=$source, message="Import from another folder with the @/ alias, not ../")
    },
    and {
      $filename <: r".*/src/features/([^/]+)/.*"($feature),
      $source <: r"[\"']@/features/([^/]+)/.*[\"']"($target),
      not $target <: $feature,
      register_diagnostic(span=$source, message="A feature never imports another feature: compose both in the route, or move the domain-free part to @/shared.")
    },
    and {
      $filename <: r".*/src/(?:features|shared|api)/.*",
      $source <: r"[\"']@/(?:routes|app)/.*[\"']",
      register_diagnostic(span=$source, message="features/, shared/ and api/ never import routes/ or app/.")
    },
    and {
      $filename <: r".*/src/(?:shared|api)/.*",
      $source <: r"[\"']@/features/.*[\"']",
      register_diagnostic(span=$source, message="shared/ and api/ never import a feature.")
    },
    and {
      $source <: r"[\"']@/test/.*[\"']",
      not $filename <: r".*(?:/src/test/.*|\.test\.tsx?)",
      register_diagnostic(span=$source, message="Only tests import @/test/.")
    }
  }
}
```

The rules themselves are `frontend-project-structure`'s. Mechanics: the plugin matches import
sources by regular expression against the file path, so it sees static `import` and `export ...
from`, not `import()`. `biome-plugins/boundaries.test.ts` lints seeded violations in a temporary
`tmp-boundaries-*` directory under the project root, because Biome refuses files outside its
root; do not run `biome check` and `vitest run` in parallel in the same checkout. Change the
plugin and its test together.

## knip.json

```json
{
  "$schema": "https://unpkg.com/knip@6/schema.json",
  "ignore": ["src/api/generated/**"],
  "ignoreDependencies": ["wrangler"]
}
```

knip 6 finds unused files, exports and dependencies. Its Vite, Vitest, Playwright, TanStack
Router and Biome plugins find the entry points, and it skips `routeTree.gen.ts` itself (an
`ignore` entry for it is reported as redundant). Add `entry` only for a file no plugin sees,
such as a `scripts/*.ts` run by `node`. `ignoreDependencies` is for a package only an external
pipeline calls, with the reason in the commit; never for one that simply lost its last import.
knip loads `vite.config.ts`, which is why the config validates the environment inside a plugin
hook rather than at the top of the file.
