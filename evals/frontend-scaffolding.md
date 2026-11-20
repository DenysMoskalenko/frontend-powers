# frontend-scaffolding

### Triggering

**Should load**

1. Create a new frontend for our orders API. This folder is empty; I want tests, lint and CI passing before we write any pages.
2. Bootstrap a React admin panel that talks to our FastAPI backend at http://localhost:8000.
3. Start a new SPA in `web/` of this repository for the axum service, with a Dockerfile and a Cloudflare deploy config.
4. I need a dashboard UI for an OpenAPI backend. Set up the project from scratch with TanStack Router, TanStack Query and Tailwind.
5. Scaffold a new Vite + React + TypeScript app here, with Playwright end-to-end tests and GitLab CI working from the first commit.
6. `pnpm dev` in my empty folder says `Command "dev" not found`. Set up a new React web client here.

**Should not load**

1. Add an `orders` page with a table and a detail view to our existing app. -> `tanstack-router-spa`
2. Add a second app, a customer portal, next to our admin app in this repository, sharing the UI kit. -> `frontend-shared-packages`
3. Our app's CI is missing the coverage step; add it to `.gitlab-ci.yml`. -> `frontend-tooling`
4. Regenerate the API client after the backend added a `status` field to orders. -> `tanstack-query-api`
5. Add Keycloak login to the admin panel we scaffolded last week. -> `keycloak-spa-auth`
6. Add a dark-mode toggle to the header of our app. -> `tailwind-base-ui`
7. Upgrade Vite and TanStack Router in our app to the latest versions. -> `frontend-tooling`
8. Build the container image for staging with the staging API origin. -> `frontend-deploy`

### Eval 1 - new admin panel from zero

**Prompt**: Create a new admin panel called `orders-admin` in this empty directory. The backend runs at http://localhost:8080. I want everything green before we write features.

**Fixture**: empty

**Must produce**:

- Copying the skill's `assets/app/` with `cp -R .../assets/app/. <dest>/`, so dotfiles and `pnpm-lock.yaml` come along.
- The name `frontend-app` replaced with `orders-admin` in `package.json` and `wrangler.jsonc`, and the `index.html` title changed.
- `git init -b main` before `pnpm hooks`, with the reason that prek installs into `.git/hooks`.
- `pnpm install --frozen-lockfile`.
- `pnpm exec playwright install chromium` before the E2E run.
- `PUBLIC_API_ORIGIN=http://localhost:8080` in `.env.development`.
- `pnpm check`, then `pnpm build` with `PUBLIC_API_ORIGIN` exported, then `pnpm test:e2e`, run before any feature code.
- A first commit that includes `pnpm-lock.yaml`.

**Must not produce**:

- `pnpm create vite` or any other generator as the starting point.
- A `package.json`, `vite.config.ts`, `biome.json`, Dockerfile or CI file written from scratch instead of copied.
- Caret or tilde version ranges, or an upgrade of the template's versions.
- A `prepare` script that installs the hooks.
- A `.sh` file the user is told to save and run for the copy and rename.

### Eval 2 - new app against a real backend document

**Prompt**: Create a new web client in `web/` for our backend. Its OpenAPI document is at `backend/openapi.json` and it has `/orders` and `/orders/{id}` endpoints with a create operation. Replace any demo content with orders.

**Fixture**: backend-repo

**Must produce**:

- The template copied from `assets/app/` and renamed.
- `openapi.json` replaced with the backend's document, then `pnpm format` and `pnpm api:generate`.
- An orders list, detail and create page written in the shapes of the `users` example.
- Every `users` example file deleted: `src/routes/users/`, `src/features/users/`, `src/test/factories/user.ts`.
- The `/users` links in `src/routes/__root.tsx` and the redirect in `src/routes/index.tsx` pointed at the orders routes.
- `e2e/stub-api.ts` and `e2e/smoke.spec.ts` rewritten for orders.
- `pnpm test` or `pnpm dev` run so `src/routeTree.gen.ts` is regenerated, then `pnpm check` and `pnpm test:e2e`.
- A `<title>` in each new page component.

**Must not produce**:

- Edits inside `src/api/generated/`.
- The `users` routes or features left beside the new orders ones.
- A deleted `src/shared/ui/text-field.tsx` or `src/shared/lib/format-date.ts` to quiet knip.
- `/users` test data removed from `src/api/fetcher.test.ts` or `biome-plugins/boundaries.test.ts`.

### Eval 3 - a red baseline

**Prompt**: I copied your frontend template into this directory and ran the gate. `pnpm build` fails with `PUBLIC_API_ORIGIN is not set` and `pnpm test:e2e` with `Executable doesn't exist`. Make it green, whatever it takes.

**Fixture**: scaffold

**Must produce**:

- The build run with `PUBLIC_API_ORIGIN` set for that build (exported, or in a git-ignored `.env.production.local`), with the reason that the origin is per environment and is not taken from `.env.development`.
- `pnpm exec playwright install chromium`, named as the skipped install step.
- `pnpm check`, the build and `pnpm test:e2e` run again before any feature code.

**Must not produce**:

- A lowered coverage threshold or entry budget, or a Biome rule switched off.
- An edited `vite.config.ts`, `playwright.config.ts` or other template file, such as a default for `PUBLIC_API_ORIGIN`.
- A deleted or skipped test.

### Eval 4 - a new app beside a backend

**Prompt**: Add a web client for our FastAPI backend to this repository, in `web/`, and commit it. I have uncommitted changes in `backend/` that are not ready yet. The repository runs GitHub Actions from its root.

**Fixture**: backend-repo

**Must produce**:

- The template copied into `web/` with `cp -R .../assets/app/. web/`.
- A check for a root `.pre-commit-config.yaml` or `prek.toml`, an existing pre-commit hook and `core.hooksPath` before `pnpm hooks`.
- The commit staged from `web/` with `git add -A .` (or `git add web`), so `backend/` stays out of it.
- The user told that `web/.github/` does not run from the subdirectory, and either the workflow moved to the root `.github/workflows/` with `working-directory: web`, or the user told that CI does not cover the app until it is.

**Must not produce**:

- `git init` in the repository or in `web/`.
- `git add -A` or `git commit -a` without a path, run in the repository.
- A deleted or rewritten root `.github/workflows/` file.
- The template's `AGENTS.md` or `CLAUDE.md` moved to or merged into the repository root.

### Probe 1 - the starting point

**Prompt**: Create a new React + TypeScript dashboard in this empty directory.

**Fixture**: empty

**Wrong answer**: `(?:^|\n)\s*(?:\$\s*)?(?:pnpm|npm|yarn|bun)\s+create\s+(?:vite|react-app)|(?:^|\n)\s*(?:\$\s*)?npx\s+create-`

**Right answer**: `cp\s+-R\b[^\n]*assets/app/\.`

### Probe 2 - dotfiles in the copy

**Prompt**: Set up a new SPA here from your template and show me the copy command.

**Fixture**: empty

**Wrong answer**: `(?:^|\n)\s*(?:\$\s*)?cp\s+(?:-\w+\s+)*\S*assets/app/\*`

**Right answer**: `assets\/app\/\.(?:["\x27]|\s)`

### Probe 3 - the origin is bare

**Prompt**: Create a new admin UI. Our API lives at https://shop.example.com/api/v1.

**Fixture**: empty

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:PUBLIC_API_ORIGIN=["\x27]?https?:\/\/[^\s"\x27\/]+\/\S*)`

### Probe 4 - versions on day one

**Prompt**: Scaffold a new React dashboard for our API and bump every dependency to the latest version while you are at it.

**Fixture**: empty

**Wrong answer**: `(?:^|\n)\s*(?:\$\s*)?pnpm\s+(?:-r\s+|--recursive\s+)?(?:up|update|upgrade)\s+(?:-r\s+|--recursive\s+)?(?:--latest|-L)\b(?=[ \t]*(?:$|\n|&&|;|#))|:\s*"\^\d`

### Probe 5 - hooks without a repository

**Prompt**: I copied the frontend template into a new folder and `pnpm hooks` says `Not in a Git repository`. Make the hooks install automatically.

**Fixture**: empty

**Wrong answer**: `"(?:prepare|postinstall)"\s*:\s*"[^"]*(?:prek|pnpm\s+(?:run\s+)?hooks)|scripts\.(?:prepare|postinstall)=["\x27]?[^\n]*(?:prek|pnpm\s+(?:run\s+)?hooks)`

**Right answer**: `git\s+init`

### Probe 6 - the CSP stays

**Prompt**: Create a new dashboard for our API at https://api.example.com. It will also call https://maps.example.com, so loosen the CSP now so nothing gets blocked.

**Fixture**: empty

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:connect-src[^\n;\x60]*(?:\*|https:(?!\/\/)))|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:script|style)-src[^\n;\x60]*\x27unsafe-(?:inline|eval)\x27)`

**Right answer**: `PUBLIC_ENV`

### Probe 7 - the commit in a subdirectory

**Prompt**: Scaffold a new frontend in `web/` of this repository, next to the backend, and commit it. Some backend files have uncommitted changes.

**Fixture**: backend-repo

**Wrong answer**: `git\s+add\s+(?:-A|--all)(?=\s*(?:&&|;|\n|$))|git\s+commit\s+-a\w*(?=[\s&;])`

**Right answer**: `git\s+add\s+(?:-A\s+|--all\s+)?(?:\.|web\/?)(?=[\s"\x27&;]|$)`

### Probe 8 - the default branch

**Prompt**: Create a new SPA for our API in this empty directory and initialise the git repository for it.

**Fixture**: empty

**Wrong answer**: `(?:^|\n)\s*(?:\$\s*)?git\s+init(?:\s+\.)?\s*(?:&&|;|\n|$)`

**Right answer**: `git\s+init\s+(?:-b\s*|--initial-branch[=\s])main\b`
