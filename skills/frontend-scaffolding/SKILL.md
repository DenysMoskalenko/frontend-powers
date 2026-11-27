---
name: frontend-scaffolding
description: "Use when creating a brand-new frontend from nothing: start, bootstrap or scaffold a new SPA, React app, admin panel, dashboard UI or web client for an OpenAPI backend in a directory without package.json. Copies a template with list, detail and form pages, Vitest, Biome, hooks, GitHub and GitLab CI, a container image and Cloudflare config, green from the first commit. Not for features in an existing app (frontend-project-structure), a second app (frontend-shared-packages) or tooling (frontend-tooling)."
metadata:
  version: "0.2.0"
---

# Frontend Scaffolding (Greenfield Only)

Assumes pnpm 12.22, Node 26.13, Vite 8.3, TypeScript 7.0, orval 8.48, Playwright 1.65.

## Important

- Copy `assets/app/` whole, dotfiles and `pnpm-lock.yaml` included. Never `pnpm create vite`, a
  hand-written `package.json`, config file, Dockerfile or CI file, a version range or a version
  from memory: its exact versions and configs pass together; step 9 moves them within majors.
- Only into a new or empty directory (step 2). When the target already holds an app, stop and
  name the skill that applies.
- The gate (step 7: `pnpm check`, the build, `pnpm test:e2e`) is green before any feature code. A
  red baseline is a skipped step, never a reason to edit template code, switch off a rule or lower
  a threshold.
- Keep the `users` example until the first real list, detail and form compile, then delete it;
  never ship both.
- Day one changes names, the API origin and the example domain only, and versions only within
  their majors (step 9). Lint rules, the CSP and the folder layout stay as shipped until their
  owner in `references/file-map.md` changes them; a new origin goes into `PUBLIC_ENV` through
  `frontend-deploy`.

## References

- `references/file-map.md` - open to learn what a template file is, which skill owns it, and the
  full list of `users` example files to delete.

## When it applies

| Request | Skill |
| --- | --- |
| A new client-rendered app, empty directory or a fresh `git init` | this one |
| A new app in a subdirectory of an existing repository (`web/` beside a backend) | this one, with "In an existing repository" below |
| Bringing an existing app onto this stack | not a scaffold: `frontend-project-structure` (its adoption reference) |
| A server-rendered or static content site | out of scope (client-rendered only); say so |

## 1. Prerequisites

`git`, network access, and any `pnpm` on the `PATH` (it switches itself to 12.22.0). Without
pnpm: `npm install --global pnpm@12.22.0`; on `EACCES` ask the user to install it, never `sudo`.

## 2. Copy the template and rename

`<dest>` must not exist, or `ls -A <dest>` prints nothing or only `.git`. `<name>` is lowercase
letters, digits and `-` (also the Cloudflare Worker name). `<this skill's directory>` is the one
holding this SKILL.md.

```bash
mkdir -p <dest> && cp -R <this skill's directory>/assets/app/. <dest>/   # the /. copies dotfiles
cd <dest> && rm -rf node_modules dist coverage test-results playwright-report .tanstack
```

| File | Change |
| --- | --- |
| `package.json` | `"name": "frontend-app"` to `"name": "<name>"` |
| `wrangler.jsonc` | `"name": "frontend-app"` to `"name": "<name>"` |
| `index.html` | `<title>App</title>` to the product title (or `<name>`), the fallback for each page's own `<title>` |
| `README.md` | the `# frontend-app` heading, and the line under it once the example is replaced |

`grep -rn frontend-app --exclude=pnpm-lock.yaml .` then prints nothing.

Then keep one forge and the deploy targets the app will use. Take the forge from the request, or
from `git remote -v` when every remote names the same host; take the target from the request.
Otherwise ask, once, for both. Delete the files of the others:

| Not used | Delete | Also |
| --- | --- | --- |
| GitHub | `.github/` | |
| GitLab | `.gitlab-ci.yml` | |
| Cloudflare | `wrangler.jsonc` | after step 4: `pnpm remove wrangler`, drop `"ignoreDependencies": ["wrangler"]` from `knip.json`, the Cloudflare line in `README.md` and the `wrangler` line in `AGENTS.md` |
| Container | `Dockerfile`, `.dockerignore`, `deploy/Caddyfile` | the Container line in `README.md` |

`deploy/` keeps `headers.ts` and its test for every target.
When nobody can be asked, keep everything and report which files belong to which forge
and target. In a subdirectory of an existing repository the forge files go too (below).

## 3. Initialise git

```bash
git init -b main
```

prek installs its hook into `.git/hooks`. `-b main`: the GitHub workflow and `biome.json` expect
that branch. Inside an existing repository, skip this step.

## 4. Install

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium webkit   # once per machine; on Linux add --with-deps
```

`--with-deps` needs root; without root, ask the user to run
`sudo pnpm exec playwright install-deps chromium webkit`.

pnpm switches to 12.22.0 and installs Node 26.13.1 from `devEngines`; `pnpm` scripts and
`pnpm exec` use that Node, a bare `node` does not. A frozen-lockfile error means `package.json`
was edited: revert it.

## 5. Install the hooks

```bash
pnpm hooks
```

## 6. Point it at the backend

`.env.development` holds one line, `PUBLIC_API_ORIGIN=http://localhost:8000`. Set the backend's
origin: scheme, host and port, no path, no trailing slash (otherwise `PUBLIC_API_ORIGIN is not a
bare origin`); a developer's own goes in the git-ignored `.env.development.local`. The backend
must allow `http://localhost:5173` in its CORS origins. With no backend yet, run the stub:

```bash
pnpm exec node e2e/stub-api.ts                       # port 4010
PUBLIC_API_ORIGIN=http://127.0.0.1:4010 pnpm dev     # http://localhost:5173
```

## 7. Run the gate

```bash
pnpm check
PUBLIC_API_ORIGIN=https://api.example.com pnpm build
pnpm test:e2e
```

Green: every Vitest file and Playwright test passes and the build prints
`[plugin entry-budget] entry + static imports: ... B gzip (budget 160000 B)`. A build reads no
`.env.development`, hence the exported origin; `pnpm test:e2e` builds against the stub itself.

| Red result | Cause |
| --- | --- |
| `PUBLIC_API_ORIGIN is not set` from `pnpm build` | the origin was not exported for the build |
| `Executable doesn't exist` from Playwright | step 4's browser install was skipped |
| `Not in a Git repository` from `pnpm hooks` | step 3 was skipped; never automate it with a `prepare` script (the container build has no `.git`) |
| `ERR_CONNECTION_REFUSED` or `ECONNREFUSED` from Playwright | outside CI it reuses any server on 4010 or 4173, another project's too; stop it |
| an advisory from `pnpm audit` | published after the lockfile: `frontend-tooling` |

## 8. First commit

```bash
git add -A . && git commit -m "Scaffold <name>"
```

Run it in `<dest>`. `pnpm-lock.yaml`,
`.env.development`, `src/routeTree.gen.ts` and `src/api/generated/` are committed by design.

## 9. Move to newer releases within each major

From `<dest>`, after step 8; stage nothing until the gate below is green.

```bash
pnpm outdated
pnpm update --latest <names>
pnpm dedupe
pnpm exec biome migrate --write
pnpm api:generate
```

`pnpm outdated` lists only releases past the three-day cooldown, and exits 1 when it lists any.
`<names>` are the packages whose Latest keeps the major of Current (for `0.x`, the minor), all in
one command, except `pnpm (dev)` and `node (dev)` (the `devEngines` pins) and `@playwright/test`
(it equals the CI image tag). When none qualifies, skip to the report; never run `--latest`
without names. A package whose Latest is a higher major stays as shipped, since these skills
teach its current API: name it in the report. `biome migrate` and `api:generate` change nothing
unless Biome or orval moved.

Run step 7's gate again, with `pnpm test:coverage`, `pnpm dedupe --check` and
`pnpm audit --prod --audit-level=high`. Green: `git add -A .`, and commit
(`git commit -m "Update dependencies"`) only where step 8 committed. Red where step 7 was green:
keep the failing output, restore the baseline, and report the package it names; step 9 may run
again without that package.

```bash
cd <dest> && git checkout -- . && git clean -fd . && pnpm install --frozen-lockfile
```

## In an existing repository

When `<dest>` is a subdirectory of a repository:

- Skip step 3. For step 5 follow `frontend-tooling`'s subdirectory procedure; when
  `git rev-parse --git-path hooks/pre-commit` exists or `core.hooksPath` is set, another tool
  owns the hook: skip step 5 and say why.
- `<dest>/.github/` and `<dest>/.gitlab-ci.yml` do not run: CI reads only the repository root.
  Merge the repository's forge file into the root pipeline (`frontend-tooling`'s subdirectory
  procedure), delete both copies in `<dest>` and say so; until the merge, CI does not cover the app.
- `AGENTS.md`, `CLAUDE.md` and `.editorconfig` stay and apply to `<dest>` only; `.vscode/` applies
  when `<dest>` is opened as the workspace folder.
- Stage `<dest>` (`git add -A .` from it) and the root CI file you merged, by path; never
  `git add -A` at the root. Commit only when the user asked; stage before step 9, whose rollback
  restores what is staged.

## Connect the real backend

1. Copy the backend's document over `openapi.json`, run `pnpm format`, and commit it: CI fails
   when `pnpm api:generate` changes the generated client.
2. `pnpm api:generate` rewrites `src/api/generated/`; never edit it.
3. `pnpm exec tsc` now fails only in the example files (`references/file-map.md`), unless the
   backend still has `/users`.
4. `PUBLIC_API_ORIGIN` stays a bare origin. A path prefix the document leaves out, or an
   unfamiliar error body, is handled on this side by `tanstack-query-api`, never by asking the
   backend to change.
5. A backend that requires a token answers 401 until `keycloak-spa-auth` is added.

## Replace the example domain

The example is everything named `users` (list in `references/file-map.md`); `/users` in
`src/api/*.test.ts`, `deploy/headers.test.ts` and `biome-plugins/boundaries.test.ts` is test data:
keep it.

Write the first real list, detail and form in the example's shapes, then delete the example:

1. Run `pnpm test` once: the router plugin rewrites `src/routeTree.gen.ts` when Vite or Vitest
   runs; until then `tsc` checks the stale tree.
2. Rewrite `e2e/stub-api.ts` for the new resource, keeping `/health/live`, the CORS answer and the
   backend's error bodies, and `e2e/smoke.spec.ts` for its pages, keeping the CSP, toast and axe
   tests' shape.
3. `pnpm check` and `pnpm test:e2e` green.

knip reporting a skeleton file or dependency unused (`text-field.tsx`, `use-app-form.tsx`,
`format-date.ts`, `@tanstack/react-form`, `@axe-core/playwright`, an `e2e/fixtures.ts` export)
means the new domain lacks that form, date, error-path or smoke test yet: write it rather than
deleting the file.

## What the template leaves out

| Missing | Skill | Seam |
| --- | --- | --- |
| Authentication | `keycloak-spa-auth` | `configureApi({ getToken, retryToken })` and the session in the router context, both in `src/main.tsx` |
| Translations | `frontend-i18n` | a provider in `Wrap`; `src/shared/lib/format-date.ts` is fixed to `en` until then |
| Realtime | `frontend-realtime` | its `wss://` origin in `PUBLIC_ENV`; the client in `createAppRouter` |
| Telemetry | `frontend-deploy` | a listener on the `window` `error` event that `reportError` raises |
| Theme toggle | `tailwind-base-ui` | the role tokens in `src/styles.css`; dark mode follows the OS until then |
| Workspace | `frontend-shared-packages` | `pnpm-workspace.yaml` |

## After scaffolding

The first feature loads `frontend-project-structure`, `tanstack-query-api`,
`tanstack-router-spa`, `frontend-forms`, `tailwind-base-ui`, `frontend-testing` and
`frontend-code-style`; `frontend-deploy` comes before the first environment.
