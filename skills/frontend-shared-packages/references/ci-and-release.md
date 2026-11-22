# CI, release and registry consumers

The workspace CI, the additions a publishing workspace needs, the release procedure, the setup of
an app in another repository, and the container build. Commands and messages are pnpm 12.22's;
the release ran end to end against a local registry, and a separate app installed, type-checked,
tested and built the published packages.

## Contents

- [Commands in a workspace](#commands-in-a-workspace)
- [GitHub workflow](#github-workflow)
- [GitLab pipeline](#gitlab-pipeline)
- [Publishing additions](#publishing-additions)
- [Release procedure](#release-procedure)
- [What the change commands do](#what-the-change-commands-do)
- [An app in another repository](#an-app-in-another-repository)
- [Container build of one app](#container-build-of-one-app)

## Commands in a workspace

| Goal | Command |
|---|---|
| The whole gate | `pnpm check` at the root |
| One app in dev | `pnpm --filter web dev` |
| One project's tests | `pnpm --filter @org/ui test` |
| A package and every project that depends on it | `pnpm --filter "...@org/ui" typecheck` |
| An app and the packages it uses | `pnpm --filter "web..." <script>` |
| Projects changed since `main`, with their dependents | `pnpm --filter "...[origin/main]" test` |
| Every project that has a script | `pnpm -r test:coverage` (projects without it are skipped) |
| Add an external dependency to one project | `pnpm --filter @org/ui add -D <pkg>` (strict catalog mode writes the catalog entry) |
| Regenerate the client | `pnpm --filter @org/api api:generate` |

A `[<ref>]` filter selects the projects whose files changed. A change to a root file
(`pnpm-workspace.yaml`, the lockfile, `tsconfig.base.json`, `biome.json`) selects only the root
project and none of the apps it affects, so the gate always runs on everything; use filters for
local loops. Source-only packages have no build step, so there is no build order and nothing to
cache between jobs: each project's `tsc` and Vitest read the packages' source directly.

## GitHub workflow

The in-repository form. Against the scaffold's file: the e2e job runs once per app, tests run per
project, and the generated client lives in `packages/api`.

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

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
      - run: pnpm peers check
      - run: pnpm exec biome ci --reporter=default --reporter=github
      - run: pnpm typecheck
      - run: pnpm knip
      # The committed client must be what openapi.json generates.
      - run: pnpm --filter @org/api api:generate && git diff --exit-code packages/api/src/generated
      - run: pnpm exec vitest run --dir biome-plugins
      - run: pnpm --filter "./packages/*" test
      - run: pnpm -r test:coverage --reporter=default --reporter=junit --outputFile.junit=test-results/vitest-junit.xml
      - run: pnpm build
      - if: ${{ !cancelled() }}
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: unit
          path: |
            apps/*/coverage/
            apps/*/test-results/
          retention-days: 14

  audit:
    runs-on: ubuntu-24.04
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/setup@731dfb6463bbd11c11fd0ee11fe00ed0e36d48a1 # v3.2.0
        with:
          install: false
      - run: pnpm audit --audit-level=high

  e2e:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    strategy:
      fail-fast: false
      matrix:
        app: [web, ui-harness]
    # Pinned by digest; the tag in the comment equals @playwright/test in the catalog. It carries the browsers.
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
      - run: pnpm --filter ${{ matrix.app }} test:e2e
      - if: ${{ failure() }}
        uses: actions/upload-artifact@cf430e030ddbb5b0abf93d22962f4752f3646cd9 # v7.0.2
        with:
          name: playwright-${{ matrix.app }}
          path: apps/${{ matrix.app }}/test-results/
          retention-days: 14
```

`pnpm peers check` exits 1 when a project's own version of React, Query or another shared library
differs from what a package declares as its peer. A new app is one more `matrix.app` entry.

## GitLab pipeline

Against the scaffold's `.gitlab-ci.yml` (the `default` block with its `before_script` and cache
stays as is):

```diff
 check:
   stage: check
   script:
     # Every installed tarball carries a valid registry signature, also through a mirror or proxy.
     - pnpm audit signatures
     - pnpm dedupe --check
+    - pnpm peers check
     - pnpm exec biome ci --reporter=default --reporter=gitlab --reporter-file=gl-code-quality.json
     - pnpm typecheck
     - pnpm knip
     # The committed client must be what openapi.json generates (the image has no git).
-    - cp -R src/api/generated /tmp/generated-committed
-    - pnpm api:generate && diff -r /tmp/generated-committed src/api/generated
-    - pnpm exec vitest run --coverage --reporter=default --reporter=junit --outputFile.junit=test-results/vitest-junit.xml
+    - cp -R packages/api/src/generated /tmp/generated-committed
+    - pnpm --filter @org/api api:generate && diff -r /tmp/generated-committed packages/api/src/generated
+    - pnpm exec vitest run --dir biome-plugins
+    - pnpm --filter "./packages/*" test
+    - pnpm -r test:coverage --reporter=default --reporter=junit --outputFile.junit=test-results/vitest-junit.xml
     - pnpm build
   coverage: '/Lines\s*:\s*(\d+(?:\.\d+)?)%/'
   artifacts:
     when: always
     expire_in: 2 weeks
     reports:
       codequality: gl-code-quality.json
-      junit: test-results/vitest-junit.xml
+      junit: apps/*/test-results/vitest-junit.xml
       coverage_report:
         coverage_format: cobertura
-        path: coverage/cobertura-coverage.xml
+        path: apps/*/coverage/cobertura-coverage.xml
...
 e2e:
   stage: e2e
-  # Pinned by digest; the tag in the comment equals @playwright/test in package.json. It carries the browsers.
+  # Pinned by digest; the tag in the comment equals @playwright/test in the catalog. It carries the browsers.
   image: mcr.microsoft.com/playwright@sha256:1507cbfc550a63a6b7396791ca4f00df17beb56342d2447b3f106c306f525579 # v1.65.1-noble
+  parallel:
+    matrix:
+      - APP: [web, ui-harness]
   script:
-    - pnpm test:e2e
+    - pnpm --filter "$APP" test:e2e
   artifacts:
     when: on_failure
     expire_in: 2 weeks
-    paths: [test-results/]
+    paths: [apps/$APP/test-results/]
     reports:
-      junit: test-results/junit.xml
+      junit: apps/$APP/test-results/junit.xml
```

## Publishing additions

`pnpm-workspace.yaml` gains the lockstep group and the registry for the scope (the URL is the key;
pnpm 12 does not expand `${VAR}` in it and fails the command on one). Use pnpm 12.22.0 or later, the
pinned version: before it, adding or changing a scoped registry let `pnpm install` reuse the
lockfile's verification and skip `minimumReleaseAge` and `trustPolicy` for the new registry.

```yaml
# One version for every published package: a change to one releases all.
versioning:
  fixed:
    - ["@org/api", "@org/ui"]
registries:
  https://npm.example.com/:
    scopes: ["@org"]
```

Each published package replaces `"private": true` with `"version": "0.1.0"` and adds its `files`
line. The scope map alone routes `pnpm publish`; no `publishConfig.registry` is needed. `knip.json`
gains `"ignoreBinaries": ["change"]`: knip reads the CI files and reports `pnpm change check` as
an unlisted binary `change`.

GitHub: the trigger adds tags, `check` fetches history and gains two steps, and a `publish` job
runs on a tag after every other job:

```yaml
on:
  push:
    branches: [main]
    tags: ["v*"]
  pull_request:

# check: under actions/checkout `with:` add `fetch-depth: 0`, then after `pnpm knip`:
      - run: pnpm change check
      # A change under packages/ carries a change intent (`pnpm change`, `--bump none` when it releases nothing).
      - if: github.event_name == 'pull_request'
        run: >-
          git diff --quiet "origin/$GITHUB_BASE_REF...HEAD" -- packages ||
          git diff --name-only --diff-filter=A "origin/$GITHUB_BASE_REF...HEAD" -- .changeset | grep -q '^\.changeset/[^/]*\.md$'

  publish:
    if: github.ref_type == 'tag'
    needs: [check, audit, e2e]
    runs-on: ubuntu-24.04
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: pnpm/setup@731dfb6463bbd11c11fd0ee11fe00ed0e36d48a1 # v3.2.0
        with:
          cache: true
          require-lockfile: true
      # The tag names the version `pnpm version -r` wrote; a mismatch publishes nothing.
      - run: test "v$(pnpm exec node -p 'require("./packages/ui/package.json").version')" = "$GITHUB_REF_NAME"
      # User-level: pnpm ignores a token variable in the repository's .npmrc.
      - run: echo "//npm.example.com/:_authToken=\${NPM_TOKEN}" > ~/.npmrc
      # A tag checkout has a detached HEAD, which the publish branch check rejects.
      - run: pnpm -r publish --no-git-checks --report-summary
        env:
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
```

GitLab: `stages: [check, e2e, publish]`, `- pnpm change check` after `- pnpm knip` in `check`, and
two jobs. The default image has no git, so the intent check is a rule: the job runs, and fails,
only when a merge request changes `packages/` and no `.changeset/*.md`:

```yaml
change-intent:
  stage: check
  rules:
    - if: $CI_PIPELINE_SOURCE != "merge_request_event"
      when: never
    - changes: [".changeset/*.md"]
      when: never
    - changes: ["packages/**/*"]
  before_script: []
  cache: []
  script:
    - echo "A change under packages/ needs a change intent (pnpm change, --bump none when it releases nothing)." >&2
    - exit 1

publish:
  stage: publish
  rules:
    - if: $CI_COMMIT_TAG =~ /^v/
  script:
    # The tag names the version `pnpm version -r` wrote; a mismatch publishes nothing.
    - test "v$(pnpm exec node -p 'require("./packages/ui/package.json").version')" = "$CI_COMMIT_TAG"
    # User-level: pnpm ignores a token variable in the repository's .npmrc. NPM_TOKEN is a protected variable.
    - echo "//npm.example.com/:_authToken=\${NPM_TOKEN}" > ~/.npmrc
    # A tag pipeline has a detached HEAD, which the publish branch check rejects.
    - pnpm -r publish --no-git-checks --report-summary
```

Protect `v*` tags and the token variable, so only maintainers can start a release.

- The intent check fails (exit 1) on a merge request that changes `packages/` without an intent
  file (on GitLab, an edited intent counts too); `pnpm change check` alone does not, it only
  validates the intents that exist.
- A token in the repository's `.npmrc` is refused: `[WARN] Ignored project-level auth setting
  "//npm.example.com/:_authToken": environment variables are not expanded in
  repository-controlled registry credentials.` and the publish fails with 401. The user-level
  file expands `${NPM_TOKEN}`.
- Without `--no-git-checks` a tag pipeline fails with `ERR_PNPM_GIT_UNKNOWN_BRANCH ... The Git HEAD
  may not attached to any branch, but your "publish-branch" is set to "master|main".`
- A rerun after a successful publish prints `There are no new packages that should be published`
  and succeeds.
- `--provenance` signs the release on a registry that supports it, from a CI with an identity
  token. Decide once: consumers run `trustPolicy: no-downgrade`, so a release without provenance
  after one with it fails their install with `High-risk trust downgrade`.

## Release procedure

1. Every merge request that changes `packages/` records an intent:
   `pnpm change --bump <patch|minor|major> --summary "<changelog line>" @org/ui` (or plain
   `pnpm change` interactively); `--bump none` for a change that releases nothing. Review the
   `.changeset/<name>.md` it writes like code.
2. When a release is due, on an up-to-date `main` with a clean tree: `pnpm change status`
   (prints the release plan), then `pnpm version -r`.
3. Commit the version bumps and `.changeset/` changes as `Release v<version>` through a merge
   request, like any change.
4. After it merges, tag that commit on `main` and push the tag:
   `git tag v0.3.0 && git push origin v0.3.0`. The tag pipeline runs every check and publishes.
5. Apps in other repositories upgrade every `@org/*` package to the new version in one change.

Never publish from a laptop or a branch, never edit a package version by hand, and never keep a
prerelease in an app's lockfile.

## What the change commands do

| Command | Behaviour at 12.22 |
|---|---|
| `pnpm change --bump minor --summary "Add a Button size" @org/ui` | writes `.changeset/<three-word-name>.md`: front matter `"@org/ui": minor`, then the summary |
| `pnpm change status` | `Release plan:` `@org/api: 0.1.0 → 0.2.0 (minor, via fixed)`, `@org/ui: 0.1.0 → 0.2.0 (minor, via fixed+intent)` |
| `pnpm change check` | validates intents and versions: `ERR_PNPM_VERSIONING_UNKNOWN_PACKAGE` for an intent naming a package not in the workspace, `ERR_PNPM_VERSIONING_INVARIANTS_VIOLATED` ... `The fixed group [@org/api, @org/ui] is not in lockstep` after a hand edit, `ERR_PNPM_VERSIONING_UNRELEASABLE_PACKAGE` for a package without a `version` |
| `pnpm version -r` | bumps the whole fixed group, writes `.changeset/ledger.yaml` and `.changeset/changelogs/<scope>!<name>@<version>.md`, deletes `none` intents; makes no commit and no tag; refuses a dirty tree with `ERR_PNPM_UNCLEAN_WORKING_TREE` |
| `pnpm version -r --dry-run` | prints the plan, changes nothing |
| `pnpm -r publish` | skips private projects, replaces `catalog:` and `workspace:*` with exact versions, packs a `CHANGELOG.md` holding only that version's entry from `.changeset/changelogs/`; no `CHANGELOG.md` is written into the package folder |

`pnpm change status` and `pnpm version -r` read the published versions from the registry, so they
fail with a DNS or network error where it does not resolve.

An applied intent stays in `.changeset/` until the next `pnpm version -r` after its release is
published, which deletes it; `ledger.yaml` records which release consumed it. Exclude
`.changeset` from Biome (`references/workspace-files.md`).

## An app in another repository

A scaffold-based app consumes the published packages with three changes.

`pnpm-workspace.yaml`, added to the scaffold's:

```yaml
registries:
  https://npm.example.com/:
    scopes: ["@org"]
# Own packages: released from a reviewed tag by own CI, so the cooldown adds nothing.
minimumReleaseAgeExclude:
  - "@org/*"
```

Without the exclusion a fresh release cannot be installed for three days:
`ERR_PNPM_NO_MATURE_MATCHING_VERSION` ... `@org/ui@0.2.1 was published at ..., within the
minimumReleaseAge cutoff`. This is the one standing pattern entry `frontend-tooling` allows in
`minimumReleaseAgeExclude`; every other package keeps the cooldown, and any other exclusion stays
one exact version with a removal date. `@org` must be the team's own scope, mapped in
`registries`: a scope the team does not own would skip the cooldown for public packages. A registry that requires a token for reads gets the user-level `~/.npmrc` line in CI as
above.

`package.json`: `pnpm add @org/ui @org/api` writes exact versions (`"@org/ui": "0.2.1"`); upgrade
them together. `src/styles.css` imports the kit as in the workspace, and the app's `tsconfig.json`
stays the scaffold's, whose options equal the base the packages were written against.

Verified in such an app: `pnpm check` (Biome, `tsc` over the packages' `.ts` in `node_modules`,
knip, Vitest) and `pnpm build` pass, and the kit's classes are in the CSS. Two differences from
the workspace:

- Node cannot load the packages. A `vite.config.ts` that imports one fails with
  `failed to load config` and `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`, and so do
  `orval.config.ts`, a script, and a Playwright spec or fixture that imports a value from one;
  Vitest compiles them and passes, and `import type` is erased. Inside the workspace the same
  imports work, because the link resolves outside `node_modules`.
- A React or Base UI version other than the packages' peers installs with
  `[WARN] Issues with peer dependencies found. Run "pnpm peers check" to list them.`, and
  `pnpm peers check` in CI turns it into a failure.

## Container build of one app

The app's Dockerfile (`frontend-deploy` owns the rest of it) builds with the repository root as
context: `docker build -f apps/web/Dockerfile --build-arg PUBLIC_API_ORIGIN=... .`

```diff
 RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
-    pnpm install --offline --frozen-lockfile --store-dir /pnpm/store
+    pnpm install --offline --frozen-lockfile --store-dir /pnpm/store --filter web...
 # One image per environment: the origins are baked into the bundle and the CSP.
 ARG PUBLIC_API_ORIGIN
+WORKDIR /app/apps/web
 RUN pnpm build \
...
-COPY deploy/Caddyfile /etc/caddy/Caddyfile
+COPY apps/web/deploy/Caddyfile /etc/caddy/Caddyfile
 COPY --from=build /headers.caddy /etc/caddy/headers.caddy
-COPY --from=build /app/dist /public
+COPY --from=build /app/apps/web/dist /public
```

The ignore file moves beside the Dockerfile as `apps/web/Dockerfile.dockerignore`, read for that
Dockerfile whatever the context, with every entry but `.git` prefixed by `**/` so it matches in
every project:

```text
.git
**/.env*
**/node_modules
**/dist
**/coverage
**/test-results
**/playwright-report
**/.wrangler
**/Dockerfile
**/Dockerfile.dockerignore
**/.tanstack
```

Verified: the image builds from the root and serves the app with its headers. `wrangler.jsonc` stays in `apps/web/`, beside the
`dist/` it uploads.
