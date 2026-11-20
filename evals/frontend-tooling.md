# frontend-tooling

### Triggering

**Should load**

1. "`pnpm add -D @testing-library/jest-dom@8.0.0` fails with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`, how do I get it in"
2. "pnpm install dies with `ERR_PNPM_IGNORED_BUILDS` `Ignored build scripts: esbuild@0.28.2`, what now"
3. "add zustand to the project"
4. "tsc says `TS5102: Option 'baseUrl' has been removed` after I pasted our old tsconfig, how do I keep the @ alias"
5. "turn on Biome's useExhaustiveSwitchCases everywhere except the e2e folder"
6. "the build fails with `entry + static imports: 171234 B gzip (budget 160000 B)`, can you just raise the limit"
7. "upgrade vite to the newest version"
8. "pnpm install keeps printing `Agent skills awaiting approval: @tanstack/react-query`, what should I do with that"
9. "I just cloned the repo, how do I get the pre-commit hooks running"
10. "which commands do I need to run before I open the PR"
11. "our app lives in `web/` of the monorepo now, wire its CI into the root GitLab pipeline"

**Should not load**

1. "Biome flags `noFloatingPromises` on `router.navigate(...)` in this click handler, how should the code handle it" -> `frontend-code-style`
2. "the boundaries plugin says `A feature never imports another feature` on this import, where should the shared component live" -> `frontend-project-structure`
3. "add our analytics endpoint to the Content-Security-Policy the server sends" -> `frontend-deploy`
4. "create a new Vite React SPA with tests, lint and CI from scratch" -> `frontend-scaffolding`
5. "write a route test for /users that checks the empty state" -> `frontend-testing`
6. "set up a pnpm workspace with a shared UI package and catalog versions" -> `frontend-shared-packages`
7. "the orval client is out of date after the backend changed, regenerate it" -> `tanstack-query-api`
8. "add `PUBLIC_FILES_ORIGIN` to the build so code can read the file service origin" -> `frontend-deploy`

### Eval 1 - a dependency younger than the cooldown

**Prompt**: "We need `@testing-library/jest-dom` 8.0.0, it was released this morning. `pnpm add -D @testing-library/jest-dom@8.0.0` fails with `ERR_PNPM_NO_MATURE_MATCHING_VERSION`. Get it installed."

**Fixture**: scaffold

**Must produce**:

- names the cause: `minimumReleaseAge: 4320` in `pnpm-workspace.yaml`, a three-day cooldown
- keeps the installed mature version, says 8.0.0 is inside the cooldown and what the cooldown protects against, and asks the user to confirm before adding an exception
- the exception it proposes for after that confirmation: a `minimumReleaseAgeExclude` entry for exactly `"@testing-library/jest-dom@8.0.0"` (plus every other package the error names, each exact) with a comment naming the date to remove it
- `pnpm check` after the change

**Must not produce**:

- removing `minimumReleaseAge` or setting it to a lower number
- a `--config.minimum-release-age` style flag on the install command
- a bare package name, with no version, in `minimumReleaseAgeExclude`
- the exclusion written before the user confirms, treating the request that names the version as that confirmation
- a caret range such as `"^8.0.0"` in `package.json`

### Eval 2 - an ignored build script

**Prompt**: "After adding a package, `pnpm install` fails with `ERR_PNPM_IGNORED_BUILDS` and `Ignored build scripts: sharp@0.34.5`. Fix the install."

**Fixture**: scaffold

**Must produce**:

- an `allowBuilds` entry for `sharp` in `pnpm-workspace.yaml`, `true` or `false`
- a comment on the entry giving the reason for the decision
- the decision based on what the package's install script does
- a note that `pnpm approve-builds` writes to `permissions` in this project, so the entry is written by hand under `allowBuilds`

**Must not produce**:

- `onlyBuiltDependencies`
- `--ignore-scripts` on the install
- `dangerouslyAllowAllBuilds`
- a build setting in `.npmrc`

### Eval 3 - a Biome 1 files section

**Prompt**: "`biome check` now fails with ``Found an unknown key `ignore`.`` after I pasted our old biome.json section `"files": { "ignore": ["dist", "src/routeTree.gen.ts"] }`. Fix it."

**Fixture**: scaffold

**Must produce**:

- `files.includes` with `"**"` and a `!` glob for each excluded path that `.gitignore` does not already cover (`vcs.useIgnoreFile` is on)
- `pnpm check` after the change

**Must not produce**:

- `files.ignore` or `files.include` kept
- an `.eslintignore` or an ESLint config
- `biome.json` deleted or Biome removed from `pnpm check`

### Eval 4 - an old tsconfig

**Prompt**: "I copied the tsconfig from our older app: it has `"baseUrl": "."`, `"moduleResolution": "node"`, `"esModuleInterop": false` and `"paths": { "@/*": ["src/*"] }`. Now `tsc` prints TS5102 and TS5108. Fix it so `@/` imports keep working in `tsc`, Vite and Vitest."

**Fixture**: scaffold

**Must produce**:

- `baseUrl`, `moduleResolution` and `esModuleInterop` deleted
- `paths` written relative to the tsconfig, `"@/*": ["./src/*"]`
- `resolve.tsconfigPaths: true` in `vite.config.ts` named as what makes Vite and Vitest resolve the alias
- one `tsconfig.json`

**Must not produce**:

- `"moduleResolution": "node"` or `"node10"` kept
- an alias plugin for Vite
- a `resolve.alias` copy of the paths
- `tsconfig.app.json` or `tsconfig.node.json`

### Eval 5 - a Biome rule with an exception

**Prompt**: "Enable Biome's `useExhaustiveSwitchCases` as an error for the whole project except `e2e/`. Also show me how to silence it on one `switch` in `src/shared/lib/` that we will fix later."

**Fixture**: scaffold

**Must produce**:

- `"useExhaustiveSwitchCases": "error"` under `linter.rules.nursery` in `biome.json`
- an `overrides` entry with `"includes": ["e2e/**"]` that turns the rule off
- a `// biome-ignore lint/nursery/useExhaustiveSwitchCases: <reason>` comment with a reason
- `pnpm check` after the change

**Must not produce**:

- a `biome-ignore` comment without `: <reason>`
- the rule under a group other than `nursery`
- an eslint-disable comment

### Eval 6 - a new gate step

**Prompt**: "Make our checks fail when `pnpm exec knip --production` finds unused code in the production graph."

**Fixture**: scaffold

**Must produce**:

- the step in the `check` job of both `.github/workflows/ci.yml` and `.gitlab-ci.yml`
- the step also in `pnpm check` (the `check` script) or in a prek hook in `.pre-commit-config.yaml`
- `pnpm check` after the change

**Must not produce**:

- the step in only one of the two CI files
- a new job that exists in one CI file and not the other

### Probe 1 - old build allow-list

**Prompt**: "In a pnpm 12 project, what do I write so esbuild may run its postinstall script?"

**Fixture**: empty

**Wrong answer**: `(?:onlyBuiltDependencies|neverBuiltDependencies)"?\s*:`

**Right answer**: `allowBuilds`

### Probe 2 - baseUrl for the alias

**Prompt**: "Set up a `~/` import alias for `src/` in tsconfig."

**Fixture**: scaffold

**Wrong answer**: `(?:^|\n)\s*"baseUrl"\s*:`

### Probe 3 - Rollup-era chunk options

**Prompt**: "In our Vite 8 app, put React and React DOM in their own vendor chunk in the production build."

**Fixture**: empty

**Wrong answer**: `(?:rollupOptions|manualChunks|advancedChunks)\s*[:(]`

**Right answer**: `codeSplitting`

### Probe 4 - Babel option on the React plugin

**Prompt**: "Add babel-plugin-macros to the Vite build."

**Fixture**: scaffold

**Wrong answer**: `(?:(?:^|\n)\s*|\[\s*)react\(\s*\{\s*babel\s*:`

### Probe 5 - adding with a range

**Prompt**: "Add date-fns version 4 to the project."

**Fixture**: scaffold

**Wrong answer**: `(?:^|\n)\s*(?:\$\s*)?pnpm add (?:-D )?date-fns@[\^~]?\d+(?:\.\d+)?(?![.\d])|"date-fns"\s*:\s*"[\^~]`

**Right answer**: `pnpm add date-fns(?!@)`

### Probe 6 - a hook manager with a prepare script

**Prompt**: "Run Biome on every commit for everyone who clones the repo."

**Fixture**: scaffold

**Wrong answer**: `pnpm add[^\n]*\b(?:husky|lint-staged|lefthook)\b|"(?:prepare|lint-staged)"\s*:|npx\s+husky`

### Probe 7 - corepack pin

**Prompt**: "Pin the pnpm version of this pnpm 12 / Node 26 project so everyone gets the same one. Show the package.json change."

**Fixture**: empty

**Wrong answer**: `(?:(?:^|\n)\s*|[{,]\s*)"packageManager"\s*:\s*"pnpm@|(?:^|\n)\s*(?:RUN\s+|\$\s*)?corepack enable`

**Right answer**: `devEngines`

### Probe 8 - turning the cooldown off

**Prompt**: "Install vitest 5.1.1, it came out yesterday and fixes our flaky test."

**Fixture**: scaffold

**Wrong answer**: `minimumReleaseAge:\s*(?:\d{1,3}|[0-3]\d{3}|4[0-2]\d\d|43[01]\d)\b|--config\.minimum-release-age|#\s*minimumReleaseAge`

### Probe 9 - tsconfig-paths plugin

**Prompt**: "Our Vite 8 app has paths in tsconfig.json. Make Vite resolve them."

**Fixture**: empty

**Wrong answer**: `from\s+["']vite-tsconfig-paths["']|pnpm add[^\n]*vite-tsconfig-paths|(?:^|[\s\[,])tsconfigPaths\(\)`

**Right answer**: `tsconfigPaths:\s*true`
