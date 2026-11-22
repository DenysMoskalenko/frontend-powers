---
name: frontend-tooling
description: "Use when changing package.json scripts, pnpm-workspace.yaml, tsconfig.json, biome.json, vite.config.ts, knip.json, .pre-commit-config.yaml or the CI files, or adding, removing or upgrading a dependency — ERR_PNPM_NO_MATURE_MATCHING_VERSION, ERR_PNPM_IGNORED_BUILDS, Agent skills awaiting approval, allowBuilds, devEngines, TS5102 baseUrl, TS5108, biome-ignore, the entry budget, pnpm check or CI failing on config. Not for fixing one lint finding (frontend-code-style), import-boundary rules (frontend-project-structure), Dockerfile or headers (frontend-deploy), or a new app (frontend-scaffolding)."
metadata:
  version: "0.1.0"
---

# Frontend Tooling

Assumes pnpm 12.22, Node 26.13, TypeScript 7.0, Vite 8.3, @vitejs/plugin-react 6.3, Biome 2.6, Vitest 5.1, knip 6.46, prek 0.5, Playwright 1.65.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another version of a package than the line above, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

## Important

- Run `pnpm check` (`biome check && tsc && knip && vitest run`) after every change, before
  reporting done, and whatever `## What to run` adds for that change.
- Add a dependency with a bare `pnpm add <pkg>` (`-D` for tools): with `minimumReleaseAge` and
  `saveExact: true` in `pnpm-workspace.yaml` (check both), it pins the newest mature release
  exactly; without `saveExact`, use `pnpm add -E <pkg>`. `pnpm add pkg@^3` or `pkg@3` writes a
  caret despite `saveExact`.
- Never weaken the supply-chain settings to get past an install error: no deleting
  `minimumReleaseAge`, no `--ignore-scripts`, no `dangerouslyAllowAllBuilds`. Decide per
  package, in `pnpm-workspace.yaml`, with a reason comment. A request that names a version is
  not confirmation: ask before any cooldown exclusion, and exclude every package the error names.
- Write no configuration key from memory: check `## Prior-version names` first.
- A new gate step goes into `pnpm check` or a prek hook and into both CI files in the same
  commit; `.github/workflows/ci.yml` and `.gitlab-ci.yml` always carry the same jobs.

## References

- `references/package-and-pnpm.md` — `package.json` and `pnpm-workspace.yaml` verbatim, the
  pnpm 12.22 error output and fix for each install failure, upgrades, lockfile, audit, bumping
  pnpm or Node. Open it before touching a dependency or when an install fails.
- `references/typescript-biome-knip.md` — `tsconfig.json`, `biome.json`, `boundaries.grit` and
  `knip.json` verbatim, key by key, with the TypeScript 7 error codes. Open it before editing one
  of them or when `tsc`, Biome or knip fails on configuration.
- `references/vite-config.md` — `vite.config.ts` verbatim, plugin order, public variables, the
  entry budget, `build.*` with zod's chunk, the `test` block. Open it before editing the Vite config.
- `references/hooks-ci-editor.md` — `.pre-commit-config.yaml`, both CI files job by job, deploy jobs, an app
  in a subdirectory, editor files. Open it when adding a gate step or a deploy job, or debugging CI.

## What to run

| Situation | Command |
|---|---|
| Any change | `pnpm check` |
| One test file | `pnpm test <file>`, `-t "<name>"` for one test |
| Format, sort imports, safe fixes | `pnpm format` |
| Routes, `vite.config.ts`, `deploy/`, `index.html` changed | also `pnpm test:e2e` (once per machine: `pnpm exec playwright install chromium`) |
| Before a pull request | `pnpm test:coverage` (the 80 % gate CI enforces) |
| Dependencies or lockfile changed | `pnpm dedupe --check` and `pnpm audit --audit-level=high` |
| Build config or bundle size | `PUBLIC_API_ORIGIN=https://api.example.com pnpm build` |
| `openapi.json` changed | `pnpm format`, then `pnpm api:generate` (`tanstack-query-api`'s); CI fails on drift |
| Fresh clone | `pnpm install`, then `pnpm hooks` once |

Never run `biome check` and `vitest run` in parallel in one checkout: the boundary-plugin test
writes files Biome would lint.

## Dependencies under the supply-chain settings

| What the agent sees | Do |
|---|---|
| `ERR_PNPM_NO_MATURE_MATCHING_VERSION` ... `within the minimumReleaseAge cutoff` | `pnpm add <pkg>` with no version takes the newest mature one. Say the version is inside the cooldown and what excluding it means. After the user confirms (or for a needed security fix), list each package the error names (vitest's own `@vitest/*` ship with it) as an exact `"pkg@version"` in `minimumReleaseAgeExclude`, with a comment naming the date to remove them. |
| `ERR_PNPM_IGNORED_BUILDS` ... `Ignored build scripts: esbuild@0.28.2` | Read the script; add `pkg: false` (`true` only if the package needs it) under `allowBuilds` by hand, with a reason comment. Not `pnpm approve-builds`: with a `permissions` block it writes `permissions.<pkg>.build`, splitting build decisions across two lists. |

Every other install error (agent-skill approval, trust downgrade, unrecognized setting, dedupe,
audit signatures, audit): its output and fix are in `references/package-and-pnpm.md`.

Upgrade with `pnpm update <pkg> --latest`; then `pnpm exec biome migrate --write` for Biome, the
image digest and its tag comment in both CI files for Playwright. Add a dependency in the same
change as its first import, or knip fails; asked to add one with no caller named, install it
and say that knip reports it until the first import lands. Never delete the lockfile.

## Runtime and package manager

`devEngines` pins pnpm 12.22.0 and Node 26.13.1 with `onFail: "download"`: any pnpm 12 switches
to the pin and installs that Node into `node_modules`. Images bootstrap with
`npm install --global pnpm@$PNPM_VERSION`. A bump edits `devEngines`, `.gitlab-ci.yml` and the
Dockerfile in one commit. `pnpm outdated` never reports these pins: an audit checks them by hand
(package reference).

## tsconfig.json

One file, no project references. `paths` maps `@/*` without `baseUrl`; `types` lists `node` and
`vite/client` because TypeScript 7 defaults it to `[]` (TS2882 on the CSS import otherwise). A
removed option is TS5102 or TS5108: delete it. TypeScript 7 has no classic compiler API, so a
tool built on it fails.

## biome.json

- A domain never enables a nursery rule and nursery defaults to `info`, so every nursery rule
  the project uses is listed at `"error"`.
- `plugins` loads `boundaries.grit` (rules: `frontend-project-structure`).
- Add a rule under the group `pnpm exec biome explain <rule>` names, at `"error"`; narrow one with
  an `overrides` entry (extend the one whose `includes` already match), never by weakening the base rule.
- Suppress one finding with a reason, on the line before it:

```ts
// biome-ignore lint/correctness/noComponentHookFactories: built once per router, which keeps it.
```

A suppression without `: <reason>` is a `suppressions/parse` error and suppresses nothing.
Fixing the finding in code is `frontend-code-style`'s.

## vite.config.ts

The React Compiler runs through `@rolldown/plugin-babel` with `reactCompilerPreset()`; it and
route splitting are off under `process.env.VITEST`, where they skew coverage.

- `envPrefix` is the exact list `PUBLIC_ENV`, validated in a `configResolved` hook because knip
  and Vitest load the file without an environment. A new variable is one more `PUBLIC_ENV`
  entry here; the other steps are `frontend-deploy`'s.
- In dev the app calls `PUBLIC_API_ORIGIN` directly, and the backend's CORS allows the dev
  origin. A team that wants `server.proxy` keeps the variable a bare origin, the dev server's
  own (`http://localhost:5173`; `/api` fails as `not a bare origin`), and proxies only paths no
  page route uses.
- Over budget the build fails with `RolldownError: entry + static imports: <n> B gzip (budget
  160000 B)`. First check what can leave the entry (behind a route or a dynamic `import()`);
  then raise `ENTRY_BUDGET_BYTES` by the measured growth, in the same change, naming the cause.

## knip, hooks and CI

`knip.json` ignores the generated client and `wrangler`; add `entry` only for a file no knip
plugin sees. `pnpm hooks` installs the prek hooks (no `prepare` script). The hooks add
`pnpm audit` to `pnpm check` and skip Vitest; CI adds `pnpm audit signatures`, dedupe, the
generator freshness check, coverage and the build. GitHub actions are pinned by SHA, CI images
by digest with the tag in a comment; the Playwright image's tag equals `@playwright/test`'s
version. A new script gets a `group:action` name. The scaffold has no deploy job on purpose; the
reference gives one per target.

Dockerfile, wrangler and headers are `frontend-deploy`'s; workspace configuration is
`frontend-shared-packages`'s.

## Prior-version names

| Older examples write | Correct now |
|---|---|
| `onlyBuiltDependencies`, `neverBuiltDependencies`, `ignoredBuiltDependencies` | `allowBuilds: { pkg: true \| false }`; pnpm 12 ignores the old lists without a warning |
| `"packageManager": "pnpm@x"` with `corepack enable` | `devEngines.packageManager` with `onFail: "download"`; no corepack in Node 25+ |
| `.nvmrc`, `actions/setup-node`, `pnpm/action-setup` | `devEngines.runtime`; `pnpm/setup` installs pnpm, Node and dependencies in one step |
| `.npmrc` `save-exact=true`, `npm_config_store_dir` | `saveExact` in `pnpm-workspace.yaml`; `PNPM_CONFIG_STORE_DIR` |
| `packageManagerStrict` | removed: `ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS` |
| `"baseUrl": "."`, `"moduleResolution": "node"` | `paths` alone, `module: "preserve"`; TS5102 and TS5108 in TypeScript 7 |
| `tsconfig.app.json` + `tsconfig.node.json` + `references`, `tsc -b` | one `tsconfig.json`, `tsc` |
| `build.rollupOptions`, `output.manualChunks`, `advancedChunks` | `build.rolldownOptions.output.codeSplitting` (the scaffold's one group is zod's) |
| `vite-tsconfig-paths` plugin | `resolve.tsconfigPaths: true` |
| `@vitejs/plugin-react-swc` | `@vitejs/plugin-react` 6 (Oxc) |
| `react({ babel: { plugins: ["babel-plugin-react-compiler"] } })` | `babel({ presets: [reactCompilerPreset()] })` from `@rolldown/plugin-babel` (TS2353 otherwise) |
| Biome 1 `files.ignore`, `files.include`, top-level `organizeImports` | `files.includes` with `!` globs; `assist.actions.source.organizeImports`, on by default |
| Biome `useSortedClasses`, `css.parser.tailwindDirectives` | `useTailwindSortedClasses` (not enabled here); implied by `tailwind.stylesheet` |
| ESLint with typescript-eslint, Prettier | Biome; typescript-eslint needs TypeScript 6 installed beside 7 until 7.1 ships a new API, and Biome's `types` domain covers what this config enables |
| `eslint-plugin-react-hooks`, `eslint-plugin-react-compiler` | Biome `react` domain and `nursery/useReactCompiler` |
| husky with lint-staged, lefthook, a `prepare` script | prek with `.pre-commit-config.yaml`, `pnpm hooks` once per clone |
| size-limit, dependency-cruiser | `entryBudget` in `vite.config.ts`; `biome-plugins/boundaries.grit` |
