# Workspace files

Every root and per-project configuration file of a workspace with one app (`apps/web`), a UI kit
(`packages/ui`), an API client (`packages/api`) and the kit's harness (`apps/ui-harness`), as it
passes `pnpm install --frozen-lockfile`, `pnpm check` and `pnpm build` at pnpm 12.22. Files not
shown are the single app's, unchanged, inside `apps/web/`. `@org` stands for the team's own npm
scope: use the real one everywhere, `registries` and `minimumReleaseAgeExclude` included.

## Contents

- [Tree](#tree)
- [Root package.json](#root-packagejson)
- [pnpm-workspace.yaml](#pnpm-workspaceyaml)
- [tsconfig files](#tsconfig-files)
- [biome.json and the nested configs](#biomejson-and-the-nested-configs)
- [boundaries.grit](#boundariesgrit)
- [knip.json](#knipjson)
- [.pre-commit-config.yaml](#pre-commit-configyaml)
- [An app's package.json](#an-apps-packagejson)

## Tree

```text
package.json  pnpm-workspace.yaml  pnpm-lock.yaml  tsconfig.base.json  tsconfig.json
biome.json  biome-plugins/  knip.json  .pre-commit-config.yaml  .github/  .gitlab-ci.yml
.gitignore  .editorconfig  .vscode/  AGENTS.md  CLAUDE.md  README.md
apps/web/          package.json tsconfig.json biome.json vite.config.ts index.html src/ e2e/
                   public/ deploy/ Dockerfile Dockerfile.dockerignore wrangler.jsonc .env.development
apps/ui-harness/   package.json tsconfig.json biome.json vite.config.ts playwright.config.ts
                   index.html src/main.tsx src/styles.css e2e/fixtures.ts e2e/csp.spec.ts
packages/ui/       package.json tsconfig.json biome.json vitest.config.ts src/
packages/api/      package.json tsconfig.json vitest.config.ts orval.config.ts openapi.json src/
```

## Root package.json

```json
{
  "name": "frontend",
  "private": true,
  "type": "module",
  "scripts": {
    "lint": "biome check",
    "format": "biome check --write",
    "typecheck": "tsc && pnpm -r typecheck",
    "knip": "knip",
    "test": "vitest run --dir biome-plugins && pnpm -r test",
    "build": "pnpm -r build",
    "check": "biome check && pnpm typecheck && knip && pnpm test",
    "hooks": "prek install"
  },
  "devEngines": {
    "packageManager": {
      "name": "pnpm",
      "version": "12.22.0",
      "onFail": "download"
    },
    "runtime": {
      "name": "node",
      "version": "26.13.1",
      "onFail": "download"
    }
  },
  "devDependencies": {
    "@biomejs/biome": "catalog:",
    "@j178/prek": "catalog:",
    "@types/node": "catalog:",
    "knip": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  }
}
```

- `devEngines` lives here only. A `pnpm` run inside `apps/web` reads it too and switches to
  12.22.0 with Node 26.13.1.
- `pnpm -r` never includes the root project, so `tsc && pnpm -r typecheck` does not recurse;
  `--include-workspace-root` would add it.
- Root `vitest` runs only the boundary-plugin test (`--dir biome-plugins`): without `--dir` it
  would collect every project's tests without their configs.
- Biome, knip and prek run once at the root over the whole tree; `tsc` and Vitest run per
  project, because each has its own `tsconfig.json` and test environment.

## pnpm-workspace.yaml

The scaffold's file plus `packages`, `catalog` and `catalogMode`. A workspace that publishes adds
`versioning` and `registries` (`references/ci-and-release.md`).

```yaml
packages:
  - apps/*
  - packages/*
# The one version of every dependency; package.json files write "catalog:".
catalog:
  # every dependency of the apps, at the exact version their package.json files had
  react: <version>
  zod: <version>
catalogMode: strict
# 3 days: npm's 72-hour unpublish window. Set explicitly, the cooldown is strict.
minimumReleaseAge: 4320
saveExact: true
trustPolicy: no-downgrade
# Only releases from the last 30 days are checked; older transitive packages predate provenance.
trustPolicyIgnoreAfter: 43200
allowBuilds:
  # Both postinstalls only re-check the platform binary that an optional dependency already installed.
  esbuild: false
  workerd: false
permissions:
  "@tanstack/react-router":
    skills: false
  "@tanstack/router-plugin":
    skills: false
```

| Key | Behaviour at pnpm 12.22 |
|---|---|
| `packages` | the project globs; the root is always a project too |
| `catalog` | `"catalog:"` in any `dependencies`, `devDependencies` or `peerDependencies` resolves here; `pnpm pack` and `pnpm publish` write the catalog's exact version into the manifest; a publishing workspace adds a `peers` catalog of ranges (`references/ci-and-release.md`) |
| `catalogMode: strict` | `pnpm add <new-pkg>` writes the version into the catalog and `"catalog:"` into `package.json`; `pnpm add` of a `react` version other than the catalog entry fails with `ERR_PNPM_CATALOG_VERSION_MISMATCH` ... `Wanted dependency outside the version range defined in catalog` |
| the rest | the scaffold's supply-chain block, unchanged; `frontend-tooling` owns its keys |

`catalogMode: strict` (and `prefer`) also moves a workspace reference into the catalog:
`pnpm add '@org/ui@workspace:*'` writes `'@org/ui': workspace:*` under `catalog` and `"catalog:"`
in the app. Write `"@org/ui": "workspace:*"` into the app's `package.json` by hand and run
`pnpm install` instead.

A hand-written version (`"react"` with any version other than the catalog's) still installs under `catalogMode: strict`, and
`pnpm dedupe --check` still passes. Two things catch it: review of the `package.json` diff, and
`pnpm peers check`, which exits 1 with `✕ unmet peer react` when the stray version meets a
package's `catalog:` peer.

## tsconfig files

`tsconfig.base.json` is the scaffold's `compilerOptions` minus the per-project `types` and
`paths`:

```json
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024", "dom"],
    "module": "preserve",
    "jsx": "react-jsx",
    "strict": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitOverride": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "skipLibCheck": true,
    "noEmit": true
  }
}
```

Each project extends it and adds only `types`, `paths` (apps) and `include`:

```jsonc
// tsconfig.json (root: the boundary-plugin test)
{
  "extends": "./tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["biome-plugins"]
}
// apps/web/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "types": ["node", "vite/client"],
    "paths": { "@/*": ["./src/*"] }
  },
  "include": ["src", "e2e", "deploy", "*.ts"]
}
// packages/ui/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "include": ["src", "*.ts"]
}
// packages/api/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node"] },
  "include": ["src", "*.ts"]
}
// apps/ui-harness/tsconfig.json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "types": ["node", "vite/client"] },
  "include": ["src", "e2e", "*.ts"]
}
```

An app's `tsc` type-checks every package file it imports under the app's options: `skipLibCheck`
skips `.d.ts` files only. One stricter flag in one project shows up as errors in package code
that the package's own `tsc` accepts:

```text
../../packages/api/src/api-error.ts(52,49): error TS4111: Property 'message' comes from an index signature, so it must be accessed with ['message'].
```

The same holds for a registry consumer, with a `node_modules/.pnpm/@org+api@.../src/` path. A
project's `tsconfig.json` therefore adds nothing beyond `types`, `paths` and `include`; a flag
change goes into the base, for every project at once. `paths` stays in apps: an `@/x` import
inside a package fails the package's own `tsc` with TS2307, and in an app's `tsc` it silently
resolves to that app's `src/`.

## biome.json and the nested configs

One root `biome.json`: the scaffold's with five changes.

```diff
-  "files": { "includes": ["**", "!src/routeTree.gen.ts", "!src/api/generated"] },
+  "files": { "includes": ["**", "!**/src/routeTree.gen.ts", "!**/generated", "!.changeset"] },
   "formatter": { "indentStyle": "space", "lineWidth": 100 },
-  "tailwind": { "stylesheet": "./src/styles.css", "mergeFunctions": ["cx"] },
   "plugins": ["./biome-plugins/boundaries.grit"],
...
-      "includes": ["src/routes/**"],
+      "includes": ["**/src/routes/**"],
...
-      "includes": ["src/shared/ui/**"],
+      "includes": ["**/src/shared/ui/**"],
...
-      "includes": ["*.config.ts"],
+      "includes": ["**/*.config.ts"],
...
-      "includes": ["e2e/**"],
+      "includes": ["**/e2e/**"],
```

- `!.changeset`: Biome 2.6 formats Markdown and rewrites a change intent's front matter
  (`---` becomes a heading), which `pnpm change check` then cannot read.
- `!**/generated`: the generated client, in `apps/web/src/api/` during the move and in
  `packages/api/src/` after it.
- `**/` globs: a nested config that extends the root re-reads the root's `overrides` relative to
  its own directory, so `apps/*/src/routes/**` matches nothing there while `**/src/routes/**`
  matches from both places.

Each app and the kit carry a nested `biome.json` naming their own Tailwind entry:

```json
{
  "root": false,
  "extends": "//",
  "tailwind": { "stylesheet": "./src/styles.css", "mergeFunctions": ["cx"] }
}
```

The kit's adds the wrapper exemptions for all of its source (its CSS has no
`@import "tailwindcss"`; Biome accepts it as the stylesheet):

```json
{
  "root": false,
  "extends": "//",
  "tailwind": { "stylesheet": "./src/styles.css", "mergeFunctions": ["cx"] },
  "overrides": [
    {
      "includes": ["src/**"],
      "linter": {
        "rules": {
          "nursery": { "noTailwindArbitraryValue": "off", "noTailwindRestyledComponents": "off" }
        }
      }
    }
  ]
}
```

A nested `overrides` list adds to the root's; the root's `**/*.config.ts` exemption still applies
to `packages/ui/vitest.config.ts`. A project without a nested file (`packages/api`) gets the root
config as is. Without a stylesheet the kit's `styles.css` fails with `Tailwind-specific syntax is
disabled.`

`noUndeclaredDependencies` reads the nearest `package.json`: an import of `@org/api` from
`packages/ui` without a declaration reports `Dependency @org/api isn't specified in
packages/ui/package.json.`

## boundaries.grit

One rule added before the `@/test/` rule; the scaffold's rules match `apps/<app>/src/...` paths
unchanged.

```text
    and {
      $filename <: r".*/packages/[^/]+/.*",
      $source <: r"[\"']@/.*[\"']",
      register_diagnostic(span=$source, message="A package never imports @/: in an app's tsc it resolves to that app's src. Import ./file, or another package by name.")
    },
```

And three cases in `biome-plugins/boundaries.test.ts`:

```text
  ["packages/ui/src/a.tsx", "@/shared/lib/a", "A package never imports @/"],
  ["packages/ui/src/b.tsx", "./a", null],
  ["packages/ui/src/c.tsx", "@org/api/api-error", null],
```

The existing `../` rule already stops an import into another project by relative path. Which
package may import which is declared in `package.json` and enforced by
`noUndeclaredDependencies`; a cycle prints `[WARN] There are cyclic workspace dependencies:` on
install.

## knip.json

```json
{
  "$schema": "https://unpkg.com/knip@6/schema.json",
  "ignoreDependencies": ["wrangler"]
}
```

knip finds the workspaces itself from `pnpm-workspace.yaml`. Root-level `ignoreDependencies`
applies to every workspace. A package's `exports` targets count as entry
files, so the generated client needs no `ignore`, and knip does not report a kit export no app
imports: remove dead kit components by hand.

## .pre-commit-config.yaml

```diff
       - id: check-json
-        exclude: ^(tsconfig\.json|\.vscode/.*\.json)$
+        exclude: ^(.*tsconfig(\.base)?\.json|\.vscode/.*\.json)$
...
       - id: tsc
-        name: tsc
-        entry: pnpm exec tsc
+        name: tsc in every project
+        entry: pnpm typecheck
...
       - id: pnpm-audit
...
-        files: ^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$
+        files: (^|/)package\.json$|^pnpm-(lock|workspace)\.yaml$
```

`pnpm exec tsc` at the root would check only `biome-plugins/`.

## An app's package.json

The scaffold's, with `name` changed, `version` and `devEngines` removed, the root-level scripts
(`lint`, `format`, `knip`, `check`, `hooks`) and `api:generate` removed, every version replaced by
`"catalog:"`, `@biomejs/biome`, `@j178/prek`, `knip` and `orval` moved out, and the packages added:

```json
{
  "name": "web",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "typecheck": "tsc",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test"
  },
  "dependencies": {
    "@base-ui/react": "catalog:",
    "@org/api": "workspace:*",
    "@org/ui": "workspace:*",
    "@tanstack/react-form": "catalog:",
    "@tanstack/react-query": "catalog:",
    "@tanstack/react-router": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "zod": "catalog:"
  }
}
```

`devDependencies` are the scaffold's minus the four moved tools, each `"catalog:"`; `typescript`
and `vitest` stay because the app's own scripts run them. In `vite.config.ts` drop
`"src/api/generated/**"` from `test.coverage.exclude` and keep the `zod` code-splitting group.
