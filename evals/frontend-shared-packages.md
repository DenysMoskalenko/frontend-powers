# frontend-shared-packages

### Triggering

**Should load**

1. "we're adding an admin app next to this one and it needs the same Button, TextField and the generated API client. set up the repo for two apps"
2. "vite build fails with `Error [ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING]: Stripping types is currently unsupported for files under node_modules` after the other repo installed our @org/ui package"
3. "`pnpm --filter @org/ui add -D react@19.3.0` says ERR_PNPM_CATALOG_VERSION_MISMATCH, what's the catalog thing?"
4. "how do we release packages/ui and packages/api with pnpm change and versioning.fixed, and who creates the tag?"
5. "the admin app's CSS has none of the kit's classes since we moved the wrappers into packages/ui"
6. "publish our shared ui and api packages to the company registry so the mobile web repo can install them"
7. "turn this single app into apps/web plus packages/, step by step, without breaking pnpm check"
8. "can packages/ui export everything from an index.ts so apps write `import { Button } from \"@org/ui\"`?"

**Should not load**

1. "add a minimumReleaseAgeExclude entry so we can install the patched release of a dependency today" -> `frontend-tooling`
2. "two features both need a useDebounce hook, where does it go?" -> `frontend-project-structure`
3. "start a brand-new admin SPA in an empty directory" -> `frontend-scaffolding`
4. "add a `danger` variant to the Button wrapper" -> `tailwind-base-ui`
5. "openapi.json changed, regenerate the client and fix the loaders" -> `tanstack-query-api`
6. "set immutable Cache-Control on /assets in the Caddy container" -> `frontend-deploy`
7. "our kit's Dialog has isConfirm and isDanger boolean props; redesign it as compound parts" -> `vercel-composition-patterns`

### Eval 1 - a second app sharing the kit and the client

**Prompt**: "We need an admin app beside this one. It must use the same Base UI wrappers, tokens and generated API client, and both apps keep deploying separately. Restructure the repository."

**Fixture**: scaffold

**Must produce**:

- `pnpm-workspace.yaml` with `packages` listing `apps/*` and `packages/*`
- versions moved into `catalog:` in `pnpm-workspace.yaml`, with `"catalog:"` in the `package.json` files
- the apps depending on the packages with `"workspace:*"`
- package `exports` with one subpath per public file pointing at `.ts` or `.tsx` source
- a root `tsconfig.base.json` that every project's `tsconfig.json` extends
- the kit's CSS containing `@source "./"` and each app's CSS importing `tailwindcss` before the kit's stylesheet
- each app calling `configureApi` from the API package in its own `main.tsx`

**Must not produce**:

- an `index.ts` in a package that re-exports its modules
- a `dist/` build, `"main"` or `"types"` field, or a build script for a package
- an `@/` import inside `packages/`
- React or `@base-ui/react` in a package's `dependencies` instead of `peerDependencies`
- TypeScript project references (`composite`, `references`, `tsc -b`)
- a task runner or release tool other than pnpm (`turbo` (Turborepo), `lerna`, `@changesets/cli`)

### Eval 2 - publishing for another repository

**Prompt**: "Our repository is a pnpm workspace with `apps/web`, `apps/admin`, `packages/ui` (`@org/ui`) and `packages/api` (`@org/api`). The packages in packages/ must be installable from our private registry at https://npm.example.com by apps in other repositories. Set up versioning, the release flow and the CI publish job, and tell me what a consuming app must configure."

**Fixture**: empty

**Must produce**:

- `versioning.fixed` in `pnpm-workspace.yaml` listing every published package
- change intents recorded with `pnpm change` and a release made with `pnpm version -r`
- a CI publish job that runs only on a `v<version>` tag and calls `pnpm -r publish --no-git-checks`
- the registry token written to the user-level `~/.npmrc` in the publish job
- the consumer's `pnpm-workspace.yaml` with a `registries` entry for the scope and `"@org/*"` (or the project's scope) under `minimumReleaseAgeExclude`
- consumers pinning exact versions and upgrading all shared packages together

**Must not produce**:

- `@changesets/cli` or a `changeset` command
- an npm publish command
- `${NPM_TOKEN}` written into the repository's `.npmrc`
- `@org:registry=` in an `.npmrc`
- removing or lowering `minimumReleaseAge` for all packages
- hand-edited version numbers in package `package.json` files

### Eval 3 - sharing Vite config helpers

**Prompt**: "Both apps carry the same entryBudget and securityHeaders plugins in vite.config.ts. Move them into a shared workspace package so there's one copy, and make sure the other repositories that install our packages can use it too."

**Fixture**: scaffold

**Must produce**:

- the statement that Node 26 refuses to strip types from `.ts` files under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), so a registry consumer's `vite.config.ts` cannot import a source-only package
- the plugins kept in each app's `vite.config.ts`, or the user told that sharing them needs a package that is not source-only

**Must not produce**:

- a source-only package with `.ts` `exports` imported from `vite.config.ts` and presented as working for registry consumers
- a build step added to the UI or API package

### Eval 4 - a dependency for the kit

**Prompt**: "Our repository is a pnpm workspace with `apps/web`, `apps/admin`, `packages/ui` (`@org/ui`) and `packages/api` (`@org/api`); every version lives in the root `catalog:` with `catalogMode: strict`. packages/ui needs lucide-react for icons inside the kit's wrappers. Add it."

**Fixture**: empty

**Must produce**:

- `pnpm --filter @org/ui add lucide-react` (or the project's kit name), with the version ending up in `catalog:`
- `"lucide-react": "catalog:"` in the kit's `package.json`

**Must not produce**:

- a version or range written into the kit's `package.json`
- the package added to the root `package.json`
- a `pnpm add lucide-react@<range>` command

### Probe 1 - barrel entry for a package

**Prompt**: "Our repository is a pnpm workspace with `apps/web`, `apps/admin`, `packages/ui` (`@org/ui`) and `packages/api` (`@org/api`). Create packages/ui so apps can import the Button and TextField wrappers from it."

**Fixture**: empty

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:export\s+(\*|\{[^}]*\})\s+from\s+["']\./)`

**Right answer**: `"\./button"\s*:\s*"\./src/button\.tsx"`

### Probe 2 - built package

**Prompt**: "Write the package.json for packages/api so both apps can consume the generated client."

**Fixture**: scaffold

**Wrong answer**: `(?:^|\n)\s*"(?:main|types|typings)"\s*:\s*"(?:\./)?dist/|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:"\.\/dist\/)`

**Right answer**: `"exports"\s*:`

### Probe 3 - React as a package dependency

**Prompt**: "Our repository is a pnpm workspace with `apps/web`, `apps/admin`, `packages/ui` (`@org/ui`) and `packages/api` (`@org/api`); every version lives in the root `catalog:` with `catalogMode: strict`. Write packages/ui/package.json; the wrappers use react, react-dom and @base-ui/react."

**Fixture**: empty

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:"dependencies"\s*:\s*\{[^}]*"(react|@base-ui/react)")`

**Right answer**: `"peerDependencies"\s*:\s*\{[^}]*"react"\s*:\s*"catalog:"`

### Probe 4 - release tool

**Prompt**: "Set up changelogs and version bumps for the packages in packages/."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:pnpm add[^\n]*@changesets\/cli)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:"@changesets\/cli"\s*:)|(?:^|\n)\s*(?:pnpm\s+(?:exec\s+)?|npx\s+)?changeset\s+(?:version|publish)\b`

**Right answer**: `pnpm change`

### Probe 5 - token in the repository .npmrc

**Prompt**: "Our repository is a pnpm workspace with `apps/web`, `apps/admin`, `packages/ui` (`@org/ui`) and `packages/api` (`@org/api`). Write the CI step that authenticates to https://npm.example.com with the NPM_TOKEN secret before publishing."

**Fixture**: empty

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:>>?\s*(\./)?\.npmrc\b)`

**Right answer**: `~\/\.npmrc|\$HOME\/\.npmrc|--location[= ](?:user|global)\b`

### Probe 6 - Tailwind path into node_modules

**Prompt**: "Our repository is a pnpm workspace with `apps/web`, `apps/admin`, `packages/ui` (`@org/ui`) and `packages/api` (`@org/api`). After moving the wrappers into packages/ui the admin app renders them unstyled. Fix the CSS."

**Fixture**: empty

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:@source\s+["'][^"']*node_modules)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:content\s*:\s*\[)`

**Right answer**: `@source\s+["']\./["']`

### Probe 7 - workspace reference through pnpm add

**Prompt**: "Our repository is a pnpm workspace with `apps/web`, `apps/admin`, `packages/ui` (`@org/ui`) and `packages/api` (`@org/api`); every version lives in the root `catalog:` with `catalogMode: strict`. Add the @org/ui workspace package as a dependency of apps/admin."

**Fixture**: empty

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:pnpm\s+(--filter\s+\S+\s+)?add\s+['"]?@org/ui@workspace)`

**Right answer**: `"@org/ui"\s*:\s*"workspace:\*"`

### Probe 8 - publishing from a tag checkout

**Prompt**: "Write the GitLab job that publishes our packages when a v* tag is pushed."

**Fixture**: scaffold

**Wrong answer**: `(?:^|\n)\s*(?:-\s*)?(?:run:\s*)?pnpm\s+(?:-r\s+publish|publish\s+-r)(?![^\n]*--no-git-checks)`

**Right answer**: `--no-git-checks`

### Probe 9 - alias inside a package

**Prompt**: "Our repository is a pnpm workspace with `apps/web`, `apps/admin`, `packages/ui` (`@org/ui`) and `packages/api` (`@org/api`). Add packages/ui/src/price.tsx that formats a price with the web app's helper in apps/web/src/shared/lib/format-money.ts."

**Fixture**: empty

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:from\s+["']@/shared/)`

### Probe 10 - template copied into a repository

**Prompt**: "Scaffold a second app, `admin`, at `apps/admin/` next to the app in this repository."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:cp\s+-R\b[^\n]*assets/app[^\n]*\s(?:\./)?apps/admin)`

**Right answer**: `apps/\*`

### Probe 11 - a workspace for one app

**Prompt**: "Move src/shared/ui into a packages/ui workspace package so it is reusable later."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:"workspace:\*")`

**Right answer**: `src\/shared`

### Probe 12 - a helper both apps need

**Prompt**: "Our repository is a pnpm workspace with `apps/web`, `apps/admin`, `packages/ui` (`@org/ui`) and `packages/api` (`@org/api`). Both apps now need `formatMoney` from apps/web/src/shared/lib/format-money.ts. Where should it live? Make the change."

**Fixture**: empty

**Wrong answer**: `packages/(?:lib|libs|utils?|shared|common|core|helpers)/[\w.-]`

**Right answer**: `packages/ui/src/format-money`
