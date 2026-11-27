# package.json, pnpm-workspace.yaml and dependency procedures

Both files as the scaffold ships them (`package.json` without `dependencies` and
`devDependencies`), then the procedures and the exact pnpm 12.22 messages. In an existing project merge only the entries a
change needs into its own files.

## Contents

- [package.json](#packagejson)
- [pnpm-workspace.yaml](#pnpm-workspaceyaml)
- [Adding, removing and upgrading](#adding-removing-and-upgrading)
- [Install errors and what to do](#install-errors-and-what-to-do)
- [Agent skills that dependencies ship](#agent-skills-that-dependencies-ship)
- [Lockfile, dedupe and audit](#lockfile-dedupe-and-audit)
- [Bumping pnpm or Node](#bumping-pnpm-or-node)

## package.json

```json
{
  "name": "frontend-app",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "lint": "biome check",
    "format": "biome check --write",
    "typecheck": "tsc",
    "knip": "knip",
    "test": "vitest run",
    "test:coverage": "vitest run --coverage",
    "test:e2e": "playwright test",
    "api:generate": "orval",
    "check": "biome check && tsc && knip && vitest run",
    "hooks": "prek install"
  },
  "devEngines": {
    "packageManager": {
      "name": "pnpm",
      "version": "12.22.0",
      "onFail": "download"
    },
    "runtime": {
      "name": "node",
      "version": "26.13.1",
      "onFail": "download"
    }
  }
}
```

- `dependencies` and `devDependencies` follow, every version exact: the scaffold's are the tested
  baseline, and a new app moves each within its major
  (`frontend-scaffolding`). Runtime: `@base-ui/react`, `@tanstack/react-form`,
  `@tanstack/react-query`, `@tanstack/react-router`, `react`, `react-dom`, `zod`. Every build and
  test tool is in `devDependencies`, listed in the scaffold's file; nothing is published, so the
  split only documents what reaches the bundle.
- `devEngines` pins both pnpm and Node with `onFail: "download"`: a pnpm of any 12.x switches to
  12.22.0 and installs Node 26.13.1 into `node_modules`, locked with integrity in
  `pnpm-lock.yaml` (`pnpm exec node -v` prints `v26.13.1` whatever Node the machine has). There
  is no `packageManager` field, no corepack, no `.nvmrc`.
- `hooks` exists so a fresh clone runs `pnpm hooks` once; there is no `prepare` script, so an
  install never touches `.git` and works in images without git. It also keeps knip from
  reporting `@j178/prek` as unused.
- `wrangler` is used only by the deploy pipeline, hence its `ignoreDependencies` entry in
  `knip.json`.
- A new script name must not shadow a pnpm command (`pnpm v` runs `pnpm view`, not a script
  called `v`). Use a `group:action` name such as `test:e2e`.

## pnpm-workspace.yaml

```yaml
# 3 days: npm's 72-hour unpublish window. Set explicitly, the cooldown is strict.
minimumReleaseAge: 4320
saveExact: true
trustPolicy: no-downgrade
# Only releases from the last 30 days are checked; older transitive packages predate provenance.
trustPolicyIgnoreAfter: 43200
allowBuilds:
  # Both postinstalls only re-check the platform binary that an optional dependency already installed.
  esbuild: false
  workerd: false
permissions:
  "@tanstack/react-router":
    skills: false
  "@tanstack/router-plugin":
    skills: false
```

| Key | Why it is set |
|---|---|
| `minimumReleaseAge: 4320` | Minutes. A release younger than three days is not installable. pnpm has a non-strict default; only an explicit value makes it strict, so a too-new exact pin fails instead of installing. |
| `saveExact: true` | `pnpm add <pkg>` and `pnpm update <pkg> --latest` write `1.2.3`, not `^1.2.3`. |
| `trustPolicy: no-downgrade` | Refuses a version published with weaker provenance than an earlier one (a possible account takeover). |
| `trustPolicyIgnoreAfter: 43200` | Minutes (30 days). Older releases are not checked, because many transitive packages were published before provenance existed. |
| `allowBuilds` | One line per package with a lifecycle script: `true` runs it, `false` skips it. Each entry carries a comment with the reason. An undecided package fails the install. |
| `permissions` | pnpm 12 records what a dependency may do. `skills: false` declines the agent skills a package ships. Its `build` capability does what `allowBuilds` does and takes precedence over it. |

pnpm 12 reads the project's install behaviour from this file; `npm_config_*` variables no longer
configure it (`PNPM_CONFIG_STORE_DIR` is the CI store variable). `.npmrc` still carries how to
reach and trust a registry: `registry` and `@scope:registry` URLs, `//host/:_authToken` tokens,
and the `ca`, `cafile`, `cert` and `key` settings. The project's `.npmrc` is read first, then
pnpm's `auth.ini`, then `~/.npmrc`. Never delete or empty a `.npmrc` that holds one of those:
move only a behaviour setting (`save-exact`, `store-dir`, `strict-peer-dependencies`, a proxy)
into `pnpm-workspace.yaml`, where pnpm 12 reads it, and keep a token out of git (an environment
variable in `${NPM_TOKEN}` form, or `auth.ini`).
An unknown or misspelled key fails every command with `ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS`;
the removed build lists (`onlyBuiltDependencies` and its siblings) are accepted and silently
ignored, which is worse.

## Adding, removing and upgrading

| Task | Command | Notes |
|---|---|---|
| Add a runtime dependency | `pnpm add <pkg>` | Newest version older than the cooldown, written exact. |
| Add a build or test tool | `pnpm add -D <pkg>` | Same. |
| Add a specific older version | `pnpm add <pkg>@1.4.2` | An exact version is written exact. |
| Remove | `pnpm remove <pkg>` | Then `pnpm check`: knip and Biome report leftovers. |
| See what can move | `pnpm outdated` | Lists only versions past the cooldown. |
| Upgrade one package | `pnpm update <pkg> --latest` | Writes the new exact version and moves the lockfile. |
| Upgrade Vitest | `pnpm update vitest @vitest/coverage-v8 --latest` | The two move together, at the same version. |
| Upgrade Biome | `pnpm update @biomejs/biome --latest`, then `pnpm exec biome migrate --write` | Rewrites renamed keys; nursery rules can change in a minor. |
| Upgrade orval | `pnpm update orval --latest`, then `pnpm api:generate` | A newer orval can rewrite the generated client; commit it in the same change, or CI fails on the drift. |
| Upgrade Playwright | `pnpm update @playwright/test --latest` | Change both CI files' Playwright image, digest and tag comment, to the same version in the same commit. |

`saveExact` applies only to a bare name: `pnpm add pkg@3` or `pkg@^3` writes `^3.0.6`, `pkg@~3.0`
writes `~3.0.6`, and a bare `pnpm add pkg` on a package already listed keeps its existing range.
Fix it with `pnpm add pkg@<the resolved exact version>`, which rewrites the entry exact. In a
project without `saveExact: true` a bare `pnpm add pkg` writes `^1.2.3`; there `pnpm add -E pkg`
writes it exact.

Add a dependency in the same change as its first import: knip reports a dependency nothing
imports, and Biome `noUndeclaredDependencies` reports an import of a package `package.json`
does not list. `@types/*` packages for a runtime dependency go in `devDependencies`, and an
ambient one (`@types/node`) also goes in tsconfig `types`.

After any of these: `pnpm check`, then `pnpm dedupe --check` and `pnpm audit --prod --audit-level=high`
(both run in CI), and `pnpm build` with `PUBLIC_API_ORIGIN` set when the package reaches the
bundle (the entry budget). Read the changelog for every version crossed.

## Install errors and what to do

A version younger than the cooldown, requested exactly:

```text
Error: ERR_PNPM_NO_MATURE_MATCHING_VERSION

  × adding a new package
  ╰─▶ 1 version does not meet the minimumReleaseAge constraint:
        @testing-library/jest-dom@8.0.0 was published at 2026-11-19T03:09:34.583Z, within the minimumReleaseAge cutoff (2026-11-16T18:40:48.856Z)
  help: Run the install interactively to approve these picks, add them to
        minimumReleaseAgeExclude in pnpm-workspace.yaml, or wait for the
        packages to mature.
```

Take the newest mature version (`pnpm add <pkg>` with no version). An exception is justified only
for a security fix the user needs now, or a release the user confirms they need before it matures.
A request that names the version is not that confirmation: say the version is inside the
cooldown, that excluding it installs code nobody has had three days to flag as malicious, and
add the exclusion only after the user confirms. It lists every package the error names, each at
its exact version (a release such as vitest publishes its `@vitest/*` packages with it, and the
cooldown blocks them too), with a comment naming the date to remove them, three days after the
release:

```yaml
minimumReleaseAgeExclude:
  # Needed before it matures: <the reason the user confirmed>. Remove these entries after 2026-11-21.
  - "vitest@5.1.1"
  - "@vitest/coverage-v8@5.1.1"
  - "@vitest/mocker@5.1.1"
  - "@vitest/spy@5.1.1"
```

`pnpm audit --fix` writes such an entry itself together with the override. Never delete
`minimumReleaseAge` and never accept the interactive approval on the user's behalf. The one
standing pattern entry is the team's own published scope (`"@org/*"`), released from reviewed tags;
it is `frontend-shared-packages`'s.

A package with a lifecycle script nobody decided on:

```text
Error: ERR_PNPM_IGNORED_BUILDS

  × installing dependencies
  ╰─▶ Ignored build scripts: esbuild@0.28.2
  help: Run "pnpm approve-builds" to pick which dependencies should be allowed
        to run scripts.
```

Read what the script does (`node_modules/<pkg>/package.json` `scripts`), then add one line under
`allowBuilds` with a comment: `false` when it only re-checks or downloads a binary that an
optional dependency already installed, `true` when the package does not work without it. Write
the entry by hand: because the file has a `permissions` block, `pnpm approve-builds` writes
`permissions.<pkg>.build` instead, which splits build decisions across two lists. Never pass
`--ignore-scripts` or set `dangerouslyAllowAllBuilds`.

A release with weaker provenance than its predecessors:

```text
Failed to resolve dependency: High-risk trust downgrade for "<pkg>@<version>" (possible package takeover)
```

Pin the previous version (`pnpm add <pkg>@<previous>`) and tell the user. Add a
`trustPolicyExclude` entry only after the user confirms the release is genuine, and only for that
exact `pkg@version`.

A setting pnpm 12 does not know:

```text
Error: ERR_PNPM_UNRECOGNIZED_WORKSPACE_SETTINGS

  × The following settings in pnpm-workspace.yaml are not recognized by this
  │ version of pnpm: "saveExacts" (did you mean "saveExact"?).
```

Fix the spelling or replace the key with its pnpm 12 name.

## Agent skills that dependencies ship

pnpm 12 links the agent skills a direct dependency ships (`skills/<name>/SKILL.md`) into the
project's agent directories after approval, and an install prints:

```text
Agent skills awaiting approval: @tanstack/react-router, @tanstack/router-plugin.
Run "pnpm approve" to review them.
```

The install still succeeds. Decline them unless the user asks for them, so the project's agent
instructions stay the ones it chose:

```bash
pnpm approve '!@tanstack/react-router' '!@tanstack/router-plugin'
```

That writes `permissions.<pkg>.skills: false` (with single quotes around scoped names; either
quoting is valid YAML). `pnpm approve <pkg>` approves instead; `pnpm permissions` lists what is
granted, denied and waiting. Always name the packages: without a terminal (an agent's shell, CI)
a bare `pnpm approve` fails with `"pnpm approve" without package arguments or --all requires an
interactive terminal`.

## Lockfile, dedupe and audit

- `pnpm-lock.yaml` changes only together with `package.json`, `pnpm-workspace.yaml` or
  `devEngines`, or from `pnpm dedupe` or `pnpm audit --fix`. A lockfile diff from a plain
  `pnpm install` on an unchanged manifest is a finding to explain, not to commit silently.
- Never delete the lockfile to fix a conflict: resolve `package.json`, then run `pnpm install`,
  which rewrites the lockfile from the merged manifest.
- CI installs with `--frozen-lockfile` and runs `pnpm dedupe --check`; when that fails, run
  `pnpm dedupe` and commit the lockfile.
- `pnpm audit --prod --audit-level=high` runs in CI and in the `pnpm-audit` hook and needs no
  install; the scheduled `audit-full` job runs `pnpm audit --audit-level=moderate` over every
  dependency (the reason is in the CI reference).
  Fix with `pnpm audit --fix` (an override in `pnpm-workspace.yaml`) or `pnpm audit --fix update`
  (re-resolves inside existing ranges). An advisory that does not apply is ignored with
  `pnpm audit --ignore GHSA-...`, which writes it under `auditConfig.ignoreGhsas` in
  `pnpm-workspace.yaml`; add a comment there saying why. Before pnpm 12.22 the audit dropped
  advisories with a string id and reported none.
- `pnpm audit signatures` runs first in both CI `check` jobs: it needs the installed tree and
  prints `<n> packages have verified registry signatures`, also when installs go through a
  mirror or proxy. A failure names a tarball without a valid registry signature: stop and tell
  the user, never skip the step.

## Bumping pnpm or Node

`pnpm outdated` lists both pins, as `pnpm (dev)` and `node (dev)`. `pnpm view pnpm time --json`
and `https://nodejs.org/dist/index.json` give the release dates: take the newest pnpm 12 past the
cooldown and the newest release of the pinned Node LTS line.

Edit `devEngines` in `package.json` and run `pnpm install`, which locks the new runtime. Then
change the same pnpm version in `.gitlab-ci.yml` (`PNPM_VERSION`) and in the Dockerfile's
bootstrap line, and the Node version in the GitLab default image and the Dockerfile's base
image (the Dockerfile is `frontend-deploy`'s file). CI images are pinned by digest with the tag
in a comment; `docker buildx imagetools inspect node:<tag>` prints the digest (its `Digest:`
line) for the new tag. A Node 25 or later image has no corepack, so
images bootstrap pnpm with exactly one npm command, after which pnpm switches to the pinned
version:

```bash
npm install --global pnpm@12.22.0
```
