# Turning a single app into a workspace

The procedure that turned the scaffold into `apps/web` + `packages/api` + `packages/ui` +
`apps/ui-harness`, with the check that closes each step. Do it on a branch from a clean tree, one
commit per step, and keep `pnpm check` green at every commit after step 5. File contents are in
`references/workspace-files.md` and `references/packages.md`.

## Contents

- [1. Move the app](#1-move-the-app)
- [2. Root files](#2-root-files)
- [3. The catalog](#3-the-catalog)
- [4. tsconfig](#4-tsconfig)
- [5. Biome, knip, hooks](#5-biome-knip-hooks)
- [6. The API-client package](#6-the-api-client-package)
- [7. The UI-kit package](#7-the-ui-kit-package)
- [8. The harness](#8-the-harness)
- [9. CI, container, docs](#9-ci-container-docs)
- [10. The second app](#10-the-second-app)

## 1. Move the app

```bash
mkdir -p apps/web
git mv src e2e public deploy .env.development Dockerfile .dockerignore index.html openapi.json \
  orval.config.ts package.json playwright.config.ts tsconfig.json vite.config.ts \
  vite.config.test.ts wrangler.jsonc apps/web/
```

Stay at the root: `.git`, `.github/`, `.gitlab-ci.yml`, `.pre-commit-config.yaml`,
`.editorconfig`, `.gitignore`, `.vscode/`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `biome.json`,
`biome-plugins/`, `knip.json`, `AGENTS.md`, `CLAUDE.md`, `README.md`. `git mv` keeps each file's
history.

## 2. Root files

Write the root `package.json` with exact versions in `devDependencies` until step 3 (before the
catalog exists, `catalog:` fails with `ERR_PNPM_CATALOG_ENTRY_NOT_FOUND_FOR_SPEC`). In
`apps/web/package.json` set `"name": "web"`, delete `version`,
`devEngines` and the scripts `lint`, `format`, `knip`, `check`, `hooks`, and move
`@biomejs/biome`, `@j178/prek` and `knip` to the root. Add `packages: [apps/*, packages/*]` to
`pnpm-workspace.yaml`.

Check: `pnpm install` succeeds; `cd apps/web && pnpm --version` prints `12.21.0`.

## 3. The catalog

Copy every version from `apps/web/package.json` into `catalog:` in `pnpm-workspace.yaml`, set
`catalogMode: strict`, and replace each version in every `package.json` with `"catalog:"`.

Check: `pnpm install` prints no version changes, `git diff pnpm-lock.yaml` shows only importer
moves, the new `catalogs:` block and `catalog:` specifiers, `pnpm dedupe --check` passes.

## 4. tsconfig

Create `tsconfig.base.json` from the app's `compilerOptions` minus `types` and `paths`. The app's
`tsconfig.json` extends `../../tsconfig.base.json` and keeps `types`, `paths` and `include` (drop
`biome-plugins` from it). Add the root `tsconfig.json` for `biome-plugins/`.

Check: `pnpm typecheck` at the root runs the root `tsc` and the app's.

## 5. Biome, knip, hooks

Apply the `biome.json` changes, add `apps/web/biome.json`, add the package rule and its three
cases to the boundary plugin, set `knip.json` (plus `"ignore": ["apps/web/src/api/generated/**"]`
until step 6), update `.pre-commit-config.yaml`. Run
`pnpm exec biome check --write` once.

Check: `pnpm check` and `pnpm exec prek run --all-files` pass.

## 6. The API-client package

```bash
mkdir -p packages/api/src
git mv apps/web/openapi.json apps/web/orval.config.ts packages/api/
git mv apps/web/src/api/generated packages/api/src/generated
git mv apps/web/src/api/fetcher.ts apps/web/src/api/fetcher.test.ts \
  apps/web/src/api/api-error.ts apps/web/src/api/api-error.test.ts packages/api/src/
```

Write the package's `package.json`, `tsconfig.json`, `vitest.config.ts` and `src/test/`. In
`fetcher.test.ts` replace `@/test/server` with `./test/server`; the other same-folder imports are
already `./`. Fix the three paths in `orval.config.ts`. In the app: add `"@org/api": "workspace:*"`
to `dependencies` by hand, rewrite `@/api/...` imports to `@org/api/...`, delete the now empty
`src/api/`, the `api:generate` script and `orval`, drop
`"src/api/generated/**"` from the coverage `exclude` and the `ignore` from `knip.json`.
`pnpm install`, then
`pnpm exec biome check --write` to re-sort the rewritten imports.

Check: `pnpm check`; `pnpm --filter @org/api api:generate && git diff --exit-code
packages/api/src/generated` is clean (the generated `api.ts` imports `'../fetcher.ts'`, which
still resolves); the app's coverage still meets 80 % (the move takes the
well-tested client out of the app's denominator).

## 7. The UI-kit package

```bash
mkdir -p packages/ui/src
git mv apps/web/src/shared/ui/button.tsx apps/web/src/shared/ui/text-field.tsx \
  apps/web/src/shared/ui/toast.tsx apps/web/src/shared/ui/cx.ts packages/ui/src/
```

Write the kit's `package.json`, `tsconfig.json`, `biome.json`, `vitest.config.ts`,
`src/test/setup.ts`, `src/styles.css` (tokens, `@theme`, base layer, scrollbar rules,
`@source "./"`) and the first kit test. Cut the same blocks from the app's `src/styles.css`, which
becomes the two `@import` lines plus app-only scales and `#root`. In the app add
`"@org/ui": "workspace:*"` and rewrite `@/shared/ui/button`, `text-field` and `toast` to
`@org/ui/...`. Wrappers that know the router or `ApiError` (`route-error.tsx`) stay in
`apps/web/src/shared/ui/`, with their `./button` import rewritten to `@org/ui/button`;
`src/test/setup.ts` stays as it is.

Check: `pnpm check`; `PUBLIC_API_ORIGIN=https://api.example.com pnpm --filter web build`, and
the built CSS contains a class used only inside the kit (`data-disabled\:opacity-50`);
`pnpm --filter web test:e2e` passes, axe scan in both colour schemes included.

## 8. The harness

Create `apps/ui-harness` (`references/packages.md`), with a copy of the app's `e2e/fixtures.ts`.

Check: `pnpm check`; `pnpm --filter ui-harness test:e2e`; then append a runtime `<style>` to its `main.tsx` once
and watch the spec fail, so the check is known to bite.

## 9. CI, container, docs

Replace both CI files with the workspace versions, apply the Dockerfile change and rename
`apps/web/.dockerignore` to `apps/web/Dockerfile.dockerignore` with its entries prefixed. Rewrite the root `AGENTS.md` commands for
the workspace (`pnpm check` at the root, `pnpm --filter web dev`, `pnpm --filter @org/api
api:generate`) and its layout section for `apps/` and `packages/`; the app's layer rules stay as
they are, now under `apps/web/src/`.

Check: a fresh clone passes `pnpm install --frozen-lockfile && pnpm check && pnpm build` (with
`PUBLIC_API_ORIGIN` set), and `docker build -f apps/web/Dockerfile .` succeeds.

## 10. The second app

The reason for the workspace. Copy `apps/web` to `apps/<name>` without `node_modules`, `dist`,
`coverage` and `test-results`, then change:

- `name` in `package.json` and in `wrangler.jsonc`;
- the ports, to ones no other app uses: `server.port` and `preview.port` in `vite.config.ts`,
  `APP_ORIGIN` in `playwright.config.ts`, `API_ORIGIN` in `e2e/fixtures.ts`;
- the `<title>` in `index.html`, and the app's own `PUBLIC_*` origins;
- in the `Dockerfile`, `--filter web...` and every `apps/web` path.

Then delete the routes, features, factories, route tests and e2e specs of web's domain that the
new app does not serve, and rewrite its stub API and smoke spec, as `frontend-scaffolding` does
when it replaces its example domain; the skeleton files stay.

The copy keeps its own `src/app/zod-config.ts` and the `zod` group in `vite.config.ts`. Add the
app to the e2e matrix in both CI files.

Check: `pnpm install`, `pnpm check`, `pnpm build`, `pnpm --filter <name> test:e2e` (also while the
other apps' specs run), and `docker build -f apps/<name>/Dockerfile .`.
