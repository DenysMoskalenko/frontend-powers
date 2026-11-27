---
name: frontend-shared-packages
description: "Use when a second app, admin panel or deployable must share the UI kit or API client: a pnpm workspace with apps/* and packages/*, pnpm-workspace.yaml catalog: and catalogMode, workspace:*, source-only packages with exports to .ts, tsconfig.base.json, peerDependencies, pnpm change, versioning.fixed, pnpm version -r, publishing @scope packages to a registry, ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING, ERR_PNPM_CATALOG_VERSION_MISMATCH, @source in a kit. Not for single-app configuration (frontend-tooling), folders inside one app (frontend-project-structure), or a new app (frontend-scaffolding)."
metadata:
  version: "0.1.1"
---

# Shared packages

Assumes pnpm 12.22, Node 26.13, TypeScript 7.0, Vite 8.3, Tailwind CSS 4.3, Biome 2.6, knip 6.46, orval 8.48.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another major of a package than the line above, or an older minor, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

Component API design for kit components belongs to `vercel-composition-patterns`. If that skill is available, load it before designing a kit component's props. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules.

## Important

- Packages are source-only: `exports` maps one subpath per public file to its `.ts`, `.tsx` or
  `.css`; no build step, no `index.ts`. Every `tsconfig.json` extends the root
  `tsconfig.base.json` and adds only `types`, `paths` (apps) and `include`: each app's `tsc`
  checks package source under the app's options. Each app keeps its own `configureApi` call.
- Inside `packages/` import `./file` or another package by name, never `@/`: in an app's `tsc`
  the alias silently resolves to that app's `src/`.
- Every version lives in `catalog:`; a package takes React, Base UI, Query, zod and the like as
  `peerDependencies` plus `devDependencies`, both `"catalog:"` (a published package's peers:
  `"catalog:peers"`, below); own packages are `"workspace:*"`, written by hand (`pnpm add` would
  move the reference into the catalog).

## References

- `references/workspace-files.md` — every root and per-project config file. Open before changing
  workspace configuration.
- `references/packages.md` — `packages/api`, `packages/ui`, the kit's CSS, kit tests, the harness
  app, and the error each boundary mistake produces. Open before creating or changing a package.
- `references/ci-and-release.md` — commands and filters, both CI files, publishing, releases,
  `pnpm change` output, a consumer in another repository, the container build. Open for CI or a
  release.
- `references/migration.md` — a single app into a workspace in ten checked steps; step 10 adds
  every later app as a copy of `apps/web`, never of the template.

## When a workspace, and which kind

| Situation | Do |
|---|---|
| One app; code reused across its features | `src/shared/` (`frontend-project-structure`) |
| A second app in the same repository needs the kit or the client | the default: a workspace, packages as `"workspace:*"` |
| Apps in other repositories, or on their own release schedule | the workspace also publishes the packages, in lockstep |
| A domain-free helper both apps need (a display formatter) | the UI kit; a new package only when a consumer that must not depend on the kit appears |
| Node-side code to share (a Vite plugin, scripts) | a copy per app: Node refuses `.ts` under `node_modules` (`ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`), which the workspace link hides until the first registry consumer |

In-repository packages are `"private": true` with no `version`. Publishing adds `version`,
`files`, `versioning.fixed`, `registries`, a `peers` catalog, change intents and a tag job.

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

Vite and Vitest compile package source with no `optimizeDeps`, `ssr` or alias entries; Node does
not, so `vite.config.ts`, `orval.config.ts`, scripts and Playwright specs import only types from a
package. A kit's CSS carries `@source "./";`, relative to that file, so it holds for a workspace
link and a registry install alike; without it the app emits none of the kit-only classes. Token and
`@theme` mechanics are `tailwind-base-ui`'s.

## One version

`catalogMode: strict` makes `pnpm add` write the catalog entry and fails another version with
`ERR_PNPM_CATALOG_VERSION_MISMATCH`; `pnpm peers check` in CI catches a hand-written one. A package's `dependencies` hold only libraries no app
imports: shared ones are peers, or an app bundles two copies and hooks or `instanceof` break.

## Boundaries

`apps/* -> packages/* -> (other packages it declares)`: apps never import each other, a package
imports only what its `package.json` declares (`noUndeclaredDependencies`), and the kit and the
client stay independent, so a component that needs `ApiError` or the router stays in the app
(`route-error.tsx`). `boundaries.grit` gains `A package never imports @/`.

## The two packages

`packages/ui` takes the wrappers and tokens, `packages/api` the spec, orval's output, `fetcher.ts`
and `api-error.ts`. Each app keeps its own `configureApi` call (in `main.tsx` and `renderRoute`),
`src/app/zod-config.ts` with the `zod` chunk group, and imports `tailwindcss` before
`@org/ui/styles.css`; `apps/ui-harness` fails on any CSP error in the production build. Files and
tests: packages reference.

## Release, when packages are published

One `versioning.fixed` group, `pnpm change` in every change to `packages/`, `pnpm version -r`
merged as a normal change, then a `v<version>` tag whose CI job publishes. Peers are written
`"catalog:peers"`, a named catalog of ranges: `"catalog:"` publishes the exact version and forces
the consumer's React, Base UI and zod to the patch. Consumers map the scope in `registries` and
exclude `"@org/*"` from the cooldown (`references/ci-and-release.md`).

## Prior-version corrections

| Older examples write | Correct now |
|---|---|
| `"main": "dist/index.js"`, `"types": "dist/index.d.ts"`, a library build per package | `exports` to `.ts` source; the app compiles it |
| `src/index.ts` re-exporting the package | one `exports` subpath per public file |
| TypeScript project references, `composite`, `tsc -b` | one `tsc` per project over package source; nothing to build first |
| `@changesets/cli`: `changeset`, `changeset version`, `changeset publish` | `pnpm change`, `pnpm version -r`, `pnpm -r publish`; same `.changeset/*.md` format |
| `turbo` (Turborepo) or `lerna` task pipelines, `nx affected` | `pnpm -r <script>`, `--filter "...[origin/main]"` for local loops |
| `"@org/ui": "link:../../packages/ui"` or `file:` | `"workspace:*"`; `link:` is published verbatim and breaks consumers |
| `shamefullyHoist`, `publicHoistPattern`, `nodeLinker: hoisted` to reach an undeclared package | declare it (peer plus dev, `catalog:`) |
| a `pnpm-lock.yaml` per package, `sharedWorkspaceLockfile: false` | one root lockfile |
| `"pnpm": { "overrides": … }` in `package.json`, `.npmrc` `link-workspace-packages` | `pnpm-workspace.yaml`; pnpm 12 ignores the field with `[WARN] The "pnpm" field in package.json is no longer read`, the key silently |
| `.npmrc` `@org:registry=https://…` | `registries:` in `pnpm-workspace.yaml`, URL as the key |
| `//host/:_authToken=${NPM_TOKEN}` in the repository `.npmrc` | the user-level `~/.npmrc`, written in CI |
| peers `"react": "^18 \|\| ^19"` written by hand | `"catalog:"` in the workspace; `"catalog:peers"`, a named catalog of ranges, in a published package |
| `@source "../node_modules/@org/ui"` or a `content` glob in each app | `@source "./";` in the kit's CSS |
| `storybook` for the kit | `apps/ui-harness`: it runs the kit's production build under the production CSP, which a Storybook preview does not |

## Red Flags — STOP

| About to… | Do this instead |
|---|---|
| create `packages/` for code one app uses | `src/shared/` in that app |
| import `@org/ui/src/button.tsx` | `@org/ui/button`, adding the `exports` entry if missing: a path outside `exports` fails in `tsc` and Vite |
| edit a package `version` by hand or bump one package alone | `pnpm change`; the fixed group bumps all |
| publish from a laptop or a branch | tag `v<version>` on `main`; CI publishes what every check passed |
| put the registry token in the repository `.npmrc` | `~/.npmrc` written in the publish job: pnpm ignores a `${VAR}` token in the repository's |
| gate CI on `--filter "...[origin/main]"` only | run the whole `pnpm check`; a root-file change selects no app |
