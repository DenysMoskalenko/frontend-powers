# Hooks, CI and editor files

Each file verbatim, identical to the scaffold's, then job by job what it runs and what to keep in step. In an existing project merge only the
entries a change needs.

## Contents

- [.pre-commit-config.yaml](#pre-commit-configyaml)
- [.github/workflows/ci.yml](#githubworkflowsciyml)
- [.gitlab-ci.yml](#gitlab-ciyml)
- [Keeping the gates in step](#keeping-the-gates-in-step)
- [Deploy jobs](#deploy-jobs)
- [App in a subdirectory of a repository](#app-in-a-subdirectory-of-a-repository)
- [.editorconfig and .gitignore](#editorconfig-and-gitignore)
- [.vscode/settings.json](#vscodesettingsjson)
- [.vscode/extensions.json](#vscodeextensionsjson)

## .pre-commit-config.yaml

```yaml
repos:
  - repo: builtin
    hooks:
      - id: trailing-whitespace
        args: [--markdown-linebreak-ext=md]
      - id: end-of-file-fixer
      - id: check-merge-conflict
      - id: check-added-large-files
        args: [--maxkb=512]
      - id: check-yaml
        # pnpm 12 writes the lockfile as two YAML documents (package manager, then dependencies).
        args: [--allow-multiple-documents]
      - id: check-json
        exclude: ^(tsconfig\.json|\.vscode/.*\.json)$

  - repo: local
    hooks:
      - id: biome
        name: biome check
        entry: pnpm exec biome check --write --no-errors-on-unmatched --files-ignore-unknown=true
        language: system
        types_or: [javascript, jsx, ts, tsx, json, css]
      - id: tsc
        name: tsc
        entry: pnpm exec tsc
        language: system
        types_or: [ts, tsx]
        pass_filenames: false
      - id: knip
        name: knip
        entry: pnpm exec knip
        language: system
        files: \.(ts|tsx|json)$
        pass_filenames: false
      - id: pnpm-audit
        name: pnpm audit
        entry: pnpm audit --prod --audit-level=high
        language: system
        files: ^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$
        pass_filenames: false
```

prek runs this file. `pnpm hooks` (`prek install`) writes the git hook once per clone; nothing
installs it automatically, because a `prepare` script would fail `pnpm install` wherever git is
absent. `pnpm exec prek run --all-files` runs every hook over the repository;
`pnpm exec prek run` checks only staged files; `pnpm exec prek validate-config
.pre-commit-config.yaml` checks the file (without the path it prints `No configs to check` and
exits 0).

- `repo: builtin` hooks are prek's own Rust implementations of the standard hygiene hooks: no
  Python, no remote repository to pin.
- `check-yaml --allow-multiple-documents`: the pnpm 12 lockfile is two YAML documents.
- `check-json` skips `tsconfig.json` and `.vscode/*.json`, which allow comments.
- The local hooks call `pnpm exec`, so they use the project's pinned tools. The `biome` hook
  writes fixes to the staged files (`--write`); `tsc` and `knip` look at the whole project
  (`pass_filenames: false`); `pnpm-audit` runs only when a dependency file changes.
- Vitest is not a hook (too slow per commit); `pnpm check` and CI run it.

## .github/workflows/ci.yml

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:
  # Weekly, and by hand: the full audit. In a public repository GitHub disables the schedule after
  # 60 days without repository activity.
  schedule:
    - cron: "0 6 * * 1"
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: ${{ github.workflow }}-${{ github.event.pull_request.number || github.run_id }}
  cancel-in-progress: true

env:
  # A placeholder: this build proves the bundle compiles and fits its budget; deploys build per environment.
  PUBLIC_API_ORIGIN: https://api.example.com

jobs:
  check:
    if: ${{ github.event_name == 'push' || github.event_name == 'pull_request' }}
    runs-on: ubuntu-24.04
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      # Installs the pnpm and Node.js that devEngines pins, then `pnpm install --frozen-lockfile`.
      - uses: pnpm/setup@731dfb6463bbd11c11fd0ee11fe00ed0e36d48a1 # v3.2.0
        with:
          cache: true
          require-lockfile: true
      # Every installed tarball carries a valid registry signature, also through a mirror or proxy.
      - run: pnpm audit signatures
      - run: pnpm dedupe --check
      - run: pnpm exec biome ci --reporter=default --reporter=github
      - run: pnpm typecheck
      - run: pnpm knip
      # The committed client must be what openapi.json generates.
      - run: pnpm api:generate && git diff --exit-code src/api/generated
      # Coverage switches the React Compiler off, so this run is the one that tests compiled components.
      - run: pnpm test
      - run: pnpm exec vitest run --coverage --reporter=default --reporter=junit --outputFile.junit=test-results/vitest-junit.xml
      - run: pnpm build
      - if: ${{ !cancelled() }}
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: unit
          path: |
            coverage/
            test-results/
          retention-days: 14

  # Gates a merge: what ships to the browser, at high and above. A dev-only advisory waits for the weekly run.
  audit:
    if: ${{ github.event_name == 'push' || github.event_name == 'pull_request' }}
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/setup@731dfb6463bbd11c11fd0ee11fe00ed0e36d48a1 # v3.2.0
        with:
          install: false
      - run: pnpm audit --prod --audit-level=high

  audit-full:
    if: ${{ github.event_name == 'schedule' || github.event_name == 'workflow_dispatch' }}
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/setup@731dfb6463bbd11c11fd0ee11fe00ed0e36d48a1 # v3.2.0
        with:
          install: false
      - run: pnpm audit --audit-level=moderate

  e2e:
    if: ${{ github.event_name == 'push' || github.event_name == 'pull_request' }}
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    # Pinned by digest; the tag in the comment equals @playwright/test in package.json. It carries the browsers.
    container:
      image: mcr.microsoft.com/playwright@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579 # v1.65.1-noble
      options: --user 1001
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/setup@731dfb6463bbd11c11fd0ee11fe00ed0e36d48a1 # v3.2.0
        with:
          cache: true
          require-lockfile: true
      - run: pnpm test:e2e
      - if: ${{ failure() }}
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: playwright
          path: test-results/
          retention-days: 14
```

| Job | What it proves |
|---|---|
| `check` | `pnpm/setup` installs the pnpm and Node that `devEngines` pins, restores the store cache and runs `pnpm install --frozen-lockfile` (`require-lockfile: true`). Then: every installed tarball has a valid registry signature (`pnpm audit signatures`), the lockfile is minimal (`pnpm dedupe --check`), Biome as CI runs it (`biome ci`, annotations through `--reporter=github`), `tsc`, knip, the committed client equals what `openapi.json` generates, Vitest once as `pnpm test` (compiled components) and once with the coverage gate and a JUnit file (the compiler off), and a production build within the entry budget. |
| `audit` | `pnpm audit --prod --audit-level=high` against the registry, without installing (`install: false`). |
| `audit-full` | `pnpm audit --audit-level=moderate` over every dependency, on the weekly `schedule` and on `workflow_dispatch` only; `check`, `audit` and `e2e` run on push and pull request only. |
| `e2e` | `pnpm test:e2e` inside the Playwright image, pinned by digest, whose tag comment equals `@playwright/test`'s version; it carries the browsers, so there is no browser cache. |

Every action is pinned by full commit SHA with the version in a comment; an annotated tag must be
dereferenced to its commit. Container images are pinned the same way, by digest with the tag in a
comment. `permissions: contents: read` and `persist-credentials: false` keep
the token read-only and out of the workspace. `PUBLIC_API_ORIGIN` is a placeholder: this build
proves the bundle compiles and fits; deploys build per environment.

## .gitlab-ci.yml

```yaml
workflow:
  rules:
    # A pipeline schedule (weekly, created under Build > Pipeline schedules) runs only `audit-full`.
    - if: $CI_PIPELINE_SOURCE == "schedule"
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH && $CI_OPEN_MERGE_REQUESTS
      when: never
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
    - if: $CI_COMMIT_TAG
  auto_cancel:
    on_new_commit: interruptible

variables:
  PNPM_VERSION: 12.22.0
  PNPM_CONFIG_STORE_DIR: $CI_PROJECT_DIR/.pnpm-store
  # A placeholder: this build proves the bundle compiles and fits its budget; deploys build per environment.
  PUBLIC_API_ORIGIN: https://api.example.com

default:
  # Pinned by digest, like the Dockerfile; the tag is in the comment.
  image: node@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc # 26.13.1-trixie-slim
  interruptible: true
  # Node 26 ships no corepack. pnpm then switches to devEngines.packageManager and installs devEngines.runtime.
  before_script:
    - npm install --global pnpm@$PNPM_VERSION
    - pnpm install --frozen-lockfile
  cache:
    key:
      files: [pnpm-lock.yaml]
    paths: [.pnpm-store/]

stages: [check, e2e]

.not-scheduled:
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
      when: never
    - when: on_success

check:
  extends: .not-scheduled
  stage: check
  script:
    # Every installed tarball carries a valid registry signature, also through a mirror or proxy.
    - pnpm audit signatures
    - pnpm dedupe --check
    - pnpm exec biome ci --reporter=default --reporter=gitlab --reporter-file=gl-code-quality.json
    - pnpm typecheck
    - pnpm knip
    # The committed client must be what openapi.json generates (the image has no git).
    - cp -R src/api/generated /tmp/generated-committed
    - pnpm api:generate && diff -r /tmp/generated-committed src/api/generated
    # Coverage switches the React Compiler off, so this run is the one that tests compiled components.
    - pnpm test
    - pnpm exec vitest run --coverage --reporter=default --reporter=junit --outputFile.junit=test-results/vitest-junit.xml
    - pnpm build
  coverage: '/Lines\s*:\s*(\d+(?:\.\d+)?)%/'
  artifacts:
    when: always
    expire_in: 2 weeks
    reports:
      codequality: gl-code-quality.json
      junit: test-results/vitest-junit.xml
      coverage_report:
        coverage_format: cobertura
        path: coverage/cobertura-coverage.xml

# Gates a merge: what ships to the browser, at high and above. A dev-only advisory waits for the weekly run.
audit:
  extends: .not-scheduled
  stage: check
  before_script:
    - npm install --global pnpm@$PNPM_VERSION
  cache: []
  script:
    - pnpm audit --prod --audit-level=high

audit-full:
  stage: check
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  before_script:
    - npm install --global pnpm@$PNPM_VERSION
  cache: []
  script:
    - pnpm audit --audit-level=moderate

e2e:
  extends: .not-scheduled
  stage: e2e
  # Pinned by digest; the tag in the comment equals @playwright/test in package.json. It carries the browsers.
  image: mcr.microsoft.com/playwright@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579 # v1.65.1-noble
  script:
    - pnpm test:e2e
  artifacts:
    when: on_failure
    expire_in: 2 weeks
    paths: [test-results/]
    reports:
      junit: test-results/junit.xml
```

Keep `PNPM_VERSION` equal to `devEngines.packageManager.version`.

| Job | What it proves |
|---|---|
| `default` | Node 26 image, pinned by digest, without corepack: bootstrap pnpm with npm once, then pnpm switches to the `devEngines` versions and installs with `--frozen-lockfile`. The store lives in the project directory (`PNPM_CONFIG_STORE_DIR`) so the cache keyed on `pnpm-lock.yaml` can keep it. |
| `check` | The same steps as GitHub's `check`, except the generator freshness check: the Node image has no git, so it copies the committed client aside and compares with `diff -r` instead of `git diff`. `biome ci --reporter=gitlab --reporter-file=gl-code-quality.json` feeds the code-quality widget while `--reporter=default` keeps the console readable. The `coverage:` regex reads the `Lines` figure from Vitest's `text-summary`; cobertura and JUnit feed the merge request widgets. |
| `audit` | Overrides `before_script` to skip the install, and `cache: []` to skip the store. |
| `audit-full` | The full audit, like GitHub's; its `rules` admit only a schedule pipeline. |
| `.not-scheduled` | A hidden template `check`, `audit` and `e2e` extend: `when: never` in a schedule pipeline, `on_success` otherwise, so a schedule runs `audit-full` alone. |
| `e2e` | The Playwright image; artifacts only on failure. |

`workflow.rules` let any schedule pipeline through first, then run merge-request pipelines, skip the duplicate branch pipeline while a merge
request is open, and run on the default branch and tags; `interruptible` with
`auto_cancel.on_new_commit` cancels superseded pipelines.

## Keeping the gates in step

Biome, `tsc` and knip run in all four places: `pnpm check`, the prek hooks and both CI files.
The hooks add `pnpm audit` and skip Vitest; CI adds `pnpm audit signatures`, `pnpm dedupe --check`,
the generator freshness check, coverage and the build. A new gate step (a script, a generator drift check, a new tool)
goes into `pnpm check` or a hook and into both CI files in the same commit. Both CI files always carry the same jobs. A version that
appears in CI (`PNPM_VERSION`, the Playwright and Node images with their digests and tag
comments) changes in the same commit as `package.json`.

The audit is split in two. The gate on every pull request, push and deploy is
`pnpm audit --prod --audit-level=high` (the hook runs the same) plus `pnpm audit signatures`: a
fresh advisory against a development-only package must not block a deploy for the three days
the cooldown holds its fix back. `audit-full` checks every dependency at `moderate` on a weekly
schedule or by hand, so that advisory is still seen; treat its failure as work to schedule, not
as a broken build. Keep `--prod` off `audit-full` and on the gate.

The schedule itself is the forge's:

- GitHub runs the `schedule` trigger from the workflow file on the default branch only, and
  `workflow_dispatch` needs the file there too (Actions, CI, Run workflow). In a public
  repository GitHub disables a schedule after 60 days without repository activity; re-enable it
  under Actions.
- GitLab needs a pipeline schedule created by hand: Build, Pipeline schedules, New schedule,
  target the default branch, a weekly cron. It runs with its owner's permissions; Run on the
  schedule starts it by hand.

## Deploy jobs

The scaffold ships no deploy job on purpose: a deploy needs credentials and a target the
template cannot know. Asked for one, add one job per environment to the CI file the repository
keeps (both, while both are kept). It runs on the default branch or a tag after `check`, `audit`
and `e2e` pass (`needs:` on GitHub; on GitLab a `deploy` entry appended to `stages`), names its forge `environment`
so that environment's protection rules and secrets apply, and sets the environment's real value
for every `PUBLIC_*` name over the placeholder. Then it runs the commands of one target; what
they do is `frontend-deploy`'s. `<...>` marks a value the project supplies.

```bash
# Cloudflare: CLOUDFLARE_API_TOKEN as a secret, CLOUDFLARE_ACCOUNT_ID as a secret or variable.
PUBLIC_API_ORIGIN=<staging API origin> pnpm build
pnpm exec wrangler deploy --env staging # production, the top-level config: --env=""

# Container: the Dockerfile installs and builds, so the job needs Docker, not pnpm
# (on GitLab, `before_script: []` and a Docker-capable runner); registry login is the forge's.
docker build --build-arg PUBLIC_API_ORIGIN=<staging API origin> -t <registry>/<image>:<commit>-staging .
docker push <registry>/<image>:<commit>-staging
```

Source maps a tracker needs are uploaded for the exact release between the build and the deploy,
as `frontend-deploy` describes.

## App in a subdirectory of a repository

The app's files stay as they are in its directory (`web/` below; use the real name). Only the hook
installation and the CI files change.

**Hooks.** `web/.pre-commit-config.yaml` stays in `web/`. `pnpm hooks` run in `web/` installs a git
hook for that directory only (the shim carries `--cd=web`). If the repository root has its own
`.pre-commit-config.yaml` or `prek.toml`, run `prek install` from the root instead: prek finds
`web/`'s file as a nested project. Either way the hooks run inside `web/`, so `pnpm exec` finds the
app's tools and `files` patterns stay relative to `web/`.

**GitHub.** Only the root `.github/workflows/` runs; a copied `web/.github/` is dead. Move `ci.yml`
there under its own file and `name:` (`concurrency.group` starts with the workflow name) and change:

| Key | Change |
|---|---|
| `on.push`, `on.pull_request` | `paths: ["web/**", .github/workflows/web.yml]`. A skipped workflow leaves its checks pending, so a required check blocks unrelated pull requests: keep these jobs unrequired or drop the filter. |
| top level | `defaults: { run: { working-directory: web } }`, for every `run` step. |
| each `pnpm/setup` step | `working-directory: web`: `defaults.run` does not reach a `uses` step. The cache key then hashes `web/pnpm-lock.yaml`; `cache-dependency-path` is needed only for a lockfile elsewhere. |
| `upload-artifact` `path` | `web/coverage/`, `web/test-results/`: it resolves from the repository root. |

**GitLab.** Only the root `.gitlab-ci.yml` runs. Merge the jobs into it; when the root file already
has a `default:` for other jobs, move this one's `image`, `before_script` and `cache` into a hidden
`.web` job that `check`, `audit`, `audit-full` and `e2e` `extends` (`extends: [.not-scheduled, .web]`
where a job already extends the template). Then:

| Key | Change |
|---|---|
| `before_script` (the default, `audit`'s and `audit-full`'s) | `cd web` first: it runs in the same shell as `script`, so every command runs in `web/`. |
| `cache.key.files` | `[web/pnpm-lock.yaml]`. `PNPM_CONFIG_STORE_DIR` and `cache.paths` keep the store at the project root. |
| `artifacts.paths`, `artifacts.reports` | prefixed with `web/` (`web/gl-code-quality.json`, `web/coverage/cobertura-coverage.xml`, `web/test-results/`): they resolve from `$CI_PROJECT_DIR`. |
| `check`, `audit`, `e2e` | `rules` replace the template's: `- if: $CI_PIPELINE_SOURCE == "schedule"` with `when: never`, then `- changes: ["web/**/*", .gitlab-ci.yml]`. `changes` is always true on a new branch, on tag pipelines and in a schedule, which is why the schedule rule comes first. `audit-full` keeps its schedule rule. |

## .editorconfig and .gitignore

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
indent_style = space
indent_size = 2
insert_final_newline = true
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false

[Caddyfile]
indent_style = tab
```

For editors and for files Biome does not format (Markdown, YAML, the Caddyfile); Biome itself
does not read it.

```text
node_modules/
dist/
coverage/
test-results/
playwright-report/
.wrangler/
*.local
.tanstack/
```

Biome reads `.gitignore` (`vcs.useIgnoreFile`), so whatever is listed here is also unlinted.
`.env.development` is committed: it holds only the local public origin.

## .vscode/settings.json

```json
{
  "editor.defaultFormatter": "biomejs.biome",
  "editor.formatOnSave": true,
  "editor.codeActionsOnSave": {
    "source.fixAll.biome": "explicit",
    "source.organizeImports.biome": "explicit"
  },
  "files.associations": { "*.css": "tailwindcss" }
}
```

Biome formats on save and applies its safe fixes and import sorting on explicit save. CSS opens
in the `tailwindcss` language mode.

## .vscode/extensions.json

```json
{
  "recommendations": ["biomejs.biome", "TypeScriptTeam.native-preview"]
}
```

The Biome extension, and the TypeScript 7 language service: VS Code's built-in TypeScript service
does not run TypeScript 7.
