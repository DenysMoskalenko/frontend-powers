---
name: frontend-scaffolding
description: "Use when creating a brand-new frontend from nothing: start, bootstrap or scaffold a new SPA, React app, admin panel, dashboard UI or web client for an OpenAPI backend in a directory without package.json. Copies a template with list, detail and form pages, Vitest, Biome, hooks, GitHub and GitLab CI, a container image and Cloudflare config, green from the first commit. Not for features in an existing app (frontend-project-structure), a second app (frontend-shared-packages) or tooling (frontend-tooling)."
metadata:
  version: "0.1.0"
---

# Frontend Scaffolding (Greenfield Only)

Assumes pnpm 12.22, Node 26.13, Vite 8.3, TypeScript 7.0, orval 8.48, Playwright 1.65.

## Important

- Copy `assets/app/` whole, dotfiles and `pnpm-lock.yaml` included. Never `pnpm create vite`, a
  hand-written `package.json`, config file, Dockerfile or CI file, or a version range: its
  exact versions and configs already pass together.
- Only into a new or empty directory (step 2). When the target already holds an app, stop and
  name the skill that applies.
- The gate (step 7: `pnpm check`, the build, `pnpm test:e2e`) is green before any feature code. A
  red baseline is a skipped step, never a reason to edit template code, switch off a rule or lower
  a threshold.
- Keep the `users` example until the first real list, detail and form compile, then delete it;
  never ship both.
- Day one changes names, the API origin and the example domain only. Versions, lint rules, the
  CSP and the folder layout stay as shipped until their owner in `references/file-map.md` changes
  them; a new origin goes into `PUBLIC_ENV` through `frontend-deploy`.

## References

- `references/file-map.md` - open to learn what a template file is, which skill owns it, and the
  full list of `users` example files to delete.

## When it applies

| Request | Skill |
| --- | --- |
| A new client-rendered app, empty directory or a fresh `git init` | this one |
| A new app in a subdirectory of an existing repository (`web/` beside a backend) | this one, with "In an existing repository" below |
| Bringing an existing app onto this stack | not a scaffold: `frontend-project-structure` (its adoption reference gives the order of single-concern changes) |
| A server-rendered or static content site | out of scope: this stack is client-rendered only; say so |

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

## 3. Initialise git

```bash
git init -b main
```

prek installs its hook into `.git/hooks`; without a repository `pnpm hooks` fails with
`Not in a Git repository`. `-b main`: the GitHub workflow and `biome.json` expect that branch.
Inside an existing repository, skip this step.

## 4. Install

```bash
pnpm install --frozen-lockfile
pnpm exec playwright install chromium   # once per machine; on Linux add --with-deps
```

`--with-deps` needs root; without root, ask the user to run
`sudo pnpm exec playwright install-deps chromium`.

From `devEngines`, pnpm switches to 12.22.0 and installs Node 26.13.1 into the project; `pnpm`
scripts and `pnpm exec` run on that Node, a bare `node` does not. Green ends with
`Done in ... using pnpm v12.22.0`. A frozen-lockfile error means `package.json` was edited: revert
it.

## 5. Install the hooks

```bash
pnpm hooks
```

Each commit then runs Biome with `--write`, `tsc`, knip and, when dependency files change,
`pnpm audit`.

## 6. Point it at the backend

`.env.development` holds one line, `PUBLIC_API_ORIGIN=http://localhost:8000`. Set the backend's
origin: scheme, host and port, no path, no trailing slash (otherwise `PUBLIC_API_ORIGIN is not a
bare origin`). A developer's own origin goes in the git-ignored `.env.development.local`. The backend must allow `http://localhost:5173` in its CORS origins. With no backend
yet, run the stub:

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

Green: `pnpm check` prints `No fixes applied.` and passes every Vitest file; the build prints
`[plugin entry-budget] entry + static imports: ... B gzip (budget 160000 B)`, then `built in`;
every Playwright test passes. A build reads no `.env.development`, hence the exported origin;
`pnpm test:e2e` builds against the stub by itself.

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

Run it in `<dest>`. Every hook passes on the untouched template. `pnpm-lock.yaml`,
`.env.development`, `src/routeTree.gen.ts` and `src/api/generated/` are committed by design.

## In an existing repository

When `<dest>` is a subdirectory of a repository:

- Skip step 3. For step 5, `frontend-tooling` says: "If the repository root has its own
  `.pre-commit-config.yaml` or `prek.toml`, run `prek install` from the root instead". Otherwise,
  when `git rev-parse --git-path hooks/pre-commit` exists or `core.hooksPath` is set, another tool
  owns the hook: skip step 5 and say why. Else `pnpm hooks` installs a hook for `<dest>` only.
- `<dest>/.github/` and `<dest>/.gitlab-ci.yml` do not run: CI reads only the repository root.
  Merge the file for the forge the repository uses into the root pipeline with
  `frontend-tooling`, delete the other one and say so; until the merge, tell the user that CI does
  not cover the app.
- `AGENTS.md`, `CLAUDE.md` and `.editorconfig` stay and apply to `<dest>` only; `.vscode/` applies
  when `<dest>` is opened as the workspace folder.
- Stage `<dest>` (`git add -A .` from it) and the root CI file you merged, by path; never
  `git add -A` at the root. Commit only when the user asked.

## Connect the real backend

1. Copy the backend's document over `openapi.json`, run `pnpm format`, and commit it: CI fails
   when `pnpm api:generate` changes the generated client.
2. `pnpm api:generate` rewrites `src/api/generated/`; never edit it.
3. `pnpm exec tsc` now fails only in the example files (`references/file-map.md`), unless the
   backend still has `/users`.
4. `PUBLIC_API_ORIGIN` stays a bare origin, never with a path; a path prefix the document's paths
   already include needs nothing. A prefix they leave out, or an error body other than axum
   `ErrorBody`, FastAPI `detail` or RFC 9457, is handled on this side by `tanstack-query-api`,
   never by asking the backend to change its routes.
5. A backend that requires a token answers 401 until `keycloak-spa-auth` is added.

## Replace the example domain

The example is everything named `users` (list in `references/file-map.md`); `/users` in
`src/api/*.test.ts`, `deploy/headers.test.ts` and `biome-plugins/boundaries.test.ts` is test data:
keep it.

Write the first real list, detail and form in the example's shapes; delete the example as soon as
they compile. Then:

1. Run `pnpm test` once: the router plugin rewrites `src/routeTree.gen.ts` when Vite or Vitest
   runs; until then `tsc` checks the stale tree.
2. Rewrite `e2e/stub-api.ts` for the new resource, keeping `/health/live`, the CORS answer and the
   backend's error bodies, and `e2e/smoke.spec.ts` for its pages, keeping the CSP, toast and axe
   tests' shape.
3. `pnpm check` and `pnpm test:e2e` green.

knip reporting `src/shared/ui/text-field.tsx`, `src/shared/lib/format-date.ts`,
`@tanstack/react-form` or `TEST_API_ORIGIN` unused means the new domain has no form, date or
error-path test yet; `test` and `expect` in `e2e/fixtures.ts` or `@axe-core/playwright` mean the
smoke test is not rewritten yet. Write those rather than deleting skeleton files; removing a
dependency is `frontend-tooling`'s.

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
`tanstack-router-spa`, `frontend-forms`, `tailwind-base-ui` and `frontend-testing`, with
`frontend-code-style` for every file; `frontend-deploy` before the first environment.
