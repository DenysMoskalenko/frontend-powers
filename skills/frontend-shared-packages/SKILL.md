---
name: frontend-shared-packages
description: "Use when a second app, admin panel or deployable must share the UI kit or API client: a pnpm workspace with apps/* and packages/*, pnpm-workspace.yaml catalog: and catalogMode, workspace:*, source-only packages with exports to .ts, tsconfig.base.json, peerDependencies, pnpm change, versioning.fixed, pnpm version -r, publishing @scope packages to a registry, ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING, ERR_PNPM_CATALOG_VERSION_MISMATCH, @source in a kit. Not for single-app configuration (frontend-tooling), folders inside one app (frontend-project-structure), or a new app (frontend-scaffolding)."
metadata:
  version: "0.1.0"
---

# Shared packages

Assumes pnpm 12.21, Node 26.13, TypeScript 7.0, Vite 8.3, Tailwind CSS 4.3, Biome 2.6, knip 6.45, orval 8.48.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, use its own modules, helpers and scripts, and say so when it has no equivalent instead of adding one unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If `pnpm-lock.yaml` pins another major version than the line above, follow the project and say which rules may not apply.

Component API design for kit components belongs to `vercel-composition-patterns`. If that skill is available, load it before designing a kit component's props. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules.

## Important

- A workspace exists only for a second deployable that shares the UI kit or the API client now;
  one app keeps shared code in `src/shared/` and `src/api/`.
- Packages are source-only: `exports` maps one subpath per public file to its `.ts`, `.tsx` or
  `.css`; no build step, no `index.ts`. Every `tsconfig.json` extends the root
  `tsconfig.base.json` and adds only `types`, `paths` (apps) and `include`: each app's `tsc`
  checks package source under the app's options.
- Inside `packages/` import `./file` or another package by name, never `@/`: in an app's `tsc`
  the alias silently resolves to that app's `src/`.
- Every version lives in `catalog:`; a package takes React, Base UI, Query, zod and the like as
  `peerDependencies` plus `devDependencies`, both `"catalog:"`; own packages are `"workspace:*"`,
  written by hand.
- Nothing Node loads (`vite.config.ts`, scripts) imports a package: Node 26 refuses `.ts` under
  `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`). The workspace link hides this;
  the first registry consumer hits it.

## References

- `references/workspace-files.md` — every root and per-project config file. Open before changing
  workspace configuration.
- `references/packages.md` — `packages/api`, `packages/ui`, the kit's CSS, kit tests, the harness
  app, and the error each boundary mistake produces. Open before creating or changing a package.
- `references/ci-and-release.md` — commands and filters, both CI files, publishing, releases,
  `pnpm change` output, a consumer in another repository, the container build. Open for CI or a
  release.
- `references/migration.md` — a single app into a workspace in ten checked steps.

## When a workspace, and which kind

| Situation | Do |
|---|---|
| One app; code reused across its features | `src/shared/` (`frontend-project-structure`) |
| A second app in the same repository needs the kit or the client | the default: a workspace, packages as `"workspace:*"` |
| Apps in other repositories, or on their own release schedule | the workspace also publishes the packages, in lockstep |
| Node-side code to share (a Vite plugin, scripts) | a copy per app; a source-only package cannot carry it |

In-repository packages are `"private": true` with no `version`. Publishing adds `version`,
`files`, `versioning.fixed`, `registries`, change intents and a tag job.

## Layout

```text
pnpm-workspace.yaml  package.json  tsconfig.base.json  tsconfig.json  biome.json  knip.json
apps/web/            the scaffold's app, unchanged inside
apps/ui-harness/     the kit's workshop and CSP check, never deployed
packages/ui/         Base UI wrappers, tokens, the kit's CSS
packages/api/        openapi.json, orval output, apiFetch, ApiError
```

| Moves to the root | Stays per app |
|---|---|
| `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `devEngines`, `tsconfig.base.json` (every flag) | `package.json` with `catalog:` versions, `tsconfig.json` (`types`, `paths`, `include`) |
| `biome.json`, `biome-plugins/`, `knip.json`, `.pre-commit-config.yaml`, both CI files | a nested `biome.json` naming its Tailwind stylesheet; `vite.config.ts`, `src/`, `e2e/`, `deploy/`, `Dockerfile` |

Biome, knip and prek run once at the root; `tsc` and Vitest run per project through `pnpm -r`.
`@org` stands for the team's own npm scope: use the real one everywhere, `registries` and
`minimumReleaseAgeExclude` included.

## A package's public surface

`noBarrelFile` holds in packages too: the public surface is the `exports` map, one entry per file
a consumer may import (`@org/ui/button` is `src/button.tsx`). A file without an entry (`cx.ts`)
is private: importing it fails in `tsc` (TS2307) and in Vite (`"./src/cx.ts" is not exported
under the conditions ...`). Set `"type": "module"` and `sideEffects` (`["*.css"]` for the kit).

Vite and Vitest compile package source with no `optimizeDeps`, `ssr` or alias entries. A kit's CSS
carries `@source "./";`, or the app emits none of the kit-only classes (`tailwind-base-ui`).

## One version

- `catalogMode: strict` makes `pnpm --filter <project> add <pkg>` write the catalog entry; a
  version outside it fails with `ERR_PNPM_CATALOG_VERSION_MISMATCH`.
- A hand-written version still installs; `pnpm peers check` in CI fails when it meets a
  package's peer.
- A package's `dependencies` hold only libraries no app imports; shared ones are peers, or an
  app bundles two copies and hooks or `instanceof` break.

## Boundaries

```text
apps/*  ->  packages/*  ->  (other packages it declares)
```

Apps never import each other; a package imports only packages its `package.json` declares
(`noUndeclaredDependencies`). The kit and the client stay independent: a component that needs
`ApiError` or the router stays in the app (`route-error.tsx`). `boundaries.grit` gains
`A package never imports @/`.

## The two packages

- UI kit: `button`, `text-field`, `toast` and `cx` move to `packages/ui/src/`, the tokens and
  `@theme` blocks to its `styles.css`; each app's CSS imports `tailwindcss`, then
  `@org/ui/styles.css`. Kit tests render one wrapper; `apps/ui-harness` renders all of them and
  its Playwright spec fails on any CSP error in the production build.
- API client: `openapi.json`, `orval.config.ts`, `fetcher.ts`, `api-error.ts` and the generated
  files move to `packages/api/`. Each app calls `configureApi` from `@org/api/fetcher` in its
  own `main.tsx` and `renderRoute`, and keeps `src/app/zod-config.ts` and the `zod` group in its
  `vite.config.ts`; CI fails on a diff after `pnpm --filter @org/api api:generate`.

## Release, when packages are published

One `versioning.fixed` group holds every published package. A merge request that touches
`packages/` adds an intent (`pnpm change`); `pnpm change check` validates intents but never
requires one, so CI also checks for a new `.changeset/*.md`. Release: `pnpm version -r` (no
commit, no tag) merged as a normal change, then a `v<version>` tag whose job runs
`pnpm -r publish --no-git-checks` with the token in the user-level `~/.npmrc` (pnpm ignores a
`${VAR}` token in the repository's). A consumer elsewhere maps the scope in `registries`, adds
`"@org/*"` to `minimumReleaseAgeExclude`, the one standing cooldown exception because the team
releases it from reviewed tags (else `ERR_PNPM_NO_MATURE_MATCHING_VERSION` for three days), pins
exact versions and upgrades every `@org/*` package together.

## Prior-version corrections

| Older examples write | Correct now |
|---|---|
| `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`, a library build per package | `exports` to `.ts` source; the app compiles it |
| `src/index.ts` re-exporting the package | one `exports` subpath per public file |
| TypeScript project references, `composite`, `tsc -b` | one `tsc` per project over package source; nothing to build first |
| `@changesets/cli`: `changeset`, `changeset version`, `changeset publish` | `pnpm change`, `pnpm version -r`, `pnpm -r publish`; same `.changeset/*.md` format |
| `turborepo` or `lerna` task pipelines, `nx affected` | `pnpm -r <script>`, `--filter "...[origin/main]"` for local loops |
| `"@org/ui": "link:../../packages/ui"` or `file:` | `"workspace:*"`; `link:` is published verbatim and breaks consumers |
| `shamefullyHoist`, `publicHoistPattern`, `nodeLinker: hoisted` to reach an undeclared package | declare it (peer plus dev, `catalog:`) |
| a `pnpm-lock.yaml` per package, `sharedWorkspaceLockfile: false` | one root lockfile |
| `"pnpm": { "overrides": … }` in `package.json`, `.npmrc` `link-workspace-packages` | `pnpm-workspace.yaml`; pnpm 12 ignores the field with `[WARN] The "pnpm" field in package.json is no longer read`, the key silently |
| `.npmrc` `@org:registry=https://…` | `registries:` in `pnpm-workspace.yaml`, URL as the key |
| `//host/:_authToken=${NPM_TOKEN}` in the repository `.npmrc` | the user-level `~/.npmrc`, written in CI |
| peers `"react": "^18 \|\| ^19"` | `"catalog:"`, published as the exact catalog version |
| `@source "../node_modules/@org/ui"` or a `content` glob in each app | `@source "./";` in the kit's CSS |
| `storybook` for the kit | `apps/ui-harness`, a Vite app under the production CSP |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| create `packages/` for code one app uses | `src/shared/` in that app |
| add a build step, `dist/` or `types` to a package | export the source |
| set any other compiler option in one project's `tsconfig.json` | change `tsconfig.base.json` for all |
| write `"react": "19.3.1"` in a package's `dependencies` | `peerDependencies` plus `devDependencies`, both `"catalog:"` |
| `pnpm add '@org/ui@workspace:*'` | write `"@org/ui": "workspace:*"` by hand, then `pnpm install` |
| import `@org/ui/src/button.tsx` | `@org/ui/button`; add the `exports` entry if it is missing |
| edit a package `version` by hand or bump one package alone | `pnpm change`; the fixed group bumps all |
| publish from a laptop or a branch | tag `v<version>` on `main`; CI publishes |
| put the registry token in the repository `.npmrc` | `~/.npmrc` written in the publish job |
| gate CI on `--filter "...[origin/main]"` only | run the whole `pnpm check`; a root-file change selects no app |
