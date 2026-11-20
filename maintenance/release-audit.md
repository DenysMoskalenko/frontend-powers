# Release audit

*The procedure the maintainer follows before a frontend-powers release. Repository
documentation for this project, not a shipped skill.*

A release audit inside this repository: compare every pinned version with what is current, read
every crossed changelog, and let only the changes that alter what a skill teaches reach the skill, at
the line that teaches it. Never rewrite a section to modernize its wording; a bump that changes nothing
a skill teaches changes only the version-pin line.

## Important

- Understand first, then make the smallest edit in the right place.
- Read the whole section before editing it (the AGENTS.md rule), not only the line at issue.
- Every edit traces to a changelog line or a verified snippet, never to memory of the package.
- Smallest diff, in the owning skill; the ownership table in AGENTS.md decides which.
- Snippets passing is necessary, not sufficient: `make check` proves the API exists, not the teaching.
- A change of philosophy (a major with a different model, a library replaced by another) is an owner
  decision, recorded in STACK.md first, never made inside a skill.

## 1. Inventory

Everything pinned, and where it lives:

| Pin | Lives in |
|---|---|
| package versions | STACK.md `## package.json` block; its mirror `skills/frontend-scaffolding/assets/app/package.json` (`dependencies`, `devDependencies`, `devEngines`, validator-enforced) and that directory's `pnpm-lock.yaml` |
| add-on package versions | STACK.md `## Add-on packages` block (exact pins, no lockfile; `make snippets` resolves them on top of the scaffold lockfile); the version-pin lines of the add-on skills |
| pnpm and Node.js | `devEngines` in the same two places; the version-pin lines of `frontend-tooling` and `frontend-scaffolding` |
| pnpm settings | scaffold `pnpm-workspace.yaml` (`minimumReleaseAge`, `trustPolicy`, catalogs); mirrored in `frontend-tooling` references and, for catalogs, `frontend-shared-packages` |
| config files | scaffold `tsconfig.json`, `biome.json`, `vite.config.ts`, `knip.json`, `.pre-commit-config.yaml`; repeated verbatim in `frontend-tooling` references |
| container and server images | scaffold `Dockerfile` (tags pinned by digest) and `deploy/Caddyfile`; the container-images line under STACK.md `## package.json`; `frontend-deploy` references |
| Playwright image tag | scaffold `.github/workflows/ci.yml` and `.gitlab-ci.yml`, equal to `@playwright/test`; the same STACK.md line; `frontend-tooling` references |
| GitHub Actions | `.github/workflows/check.yml`, scaffold CI files, `frontend-tooling` references (full SHA plus `# vX.Y.Z` comment) |
| prek and its hooks | `@j178/prek` in the scaffold `package.json`, the `pnpm dlx @j178/prek@...` line in `.github/workflows/check.yml` |
| Claude Code for CI | the `pnpm dlx @anthropic-ai/claude-code@...` line in `.github/workflows/check.yml` |
| versions quoted in skill bodies | the version-pin line at the top of every SKILL.md, plus `grep -rnE '[0-9]+\.[0-9]+\.[0-9]+' skills/ --include='*.md'` |

Current versions:

- Inside a copy of the scaffold outside the repository: `pnpm outdated --long`. A new major needs
  research; a release younger than the scaffold's `minimumReleaseAge` waits for the next audit unless
  it fixes an advisory.
- `pnpm view <package> version dist-tags` for anything not in the lockfile.
- `gh api repos/<o>/<r>/releases/latest --jq .tag_name` for actions and tools, then dereference the tag
  to its commit SHA (annotated tags point at a tag object, not a commit).

Save it as `tmp/release/<date>-inventory.md` (gitignored):
package/tool | pinned | current | changelog range | bucket.

## 2. Research each change

Per changed item, in order of authority:

1. The package's CHANGELOG or GitHub releases for every version between pinned and current, not only
   the top entry.
2. The package's type definitions in the installed version for every identifier the skills use
   (`grep -rn '<identifier>' skills/` lists them): each still exists with the same signature.
3. Upstream agent docs and `llms.txt` where the project publishes them.
4. TypeScript, Biome and Vitest release notes: new compiler errors, new or promoted lint rules under
   the scaffold's `biome.json`, changed test defaults.

Classify every finding into exactly one bucket, recorded in the inventory:

| Bucket | Finding | Action |
|---|---|---|
| a | no teaching impact | pin line only |
| b | rename, removal, signature change | snippet fix plus a row in that skill's prior-version correction table |
| c | behaviour change | prose fix at the one place that teaches it |
| d | new feature replacing a workaround we teach | a proposal for the owner in `tmp/release/`; do not apply |
| e | new lint or compiler change that breaks the gate | fix scaffold and snippets; mirror any changed config file into `frontend-tooling` |
| f | philosophy change | stop and ask |

## 3. Locate the place

For each (b), (c) and (e) row: grep the identifier or the claim across `skills/` and the scaffold, list
every hit as `file:line`, read each whole section, then pick one owning location from the AGENTS.md
ownership table. A fact in both a reference and its SKILL.md is fixed in both; never add a third copy.
A fact that lives only in a Red Flags or correction-table row stays there.

## 4. Apply

The bump itself is AGENTS.md `## Versions`; the order across a release:

1. STACK.md: the `## package.json` or `## Add-on packages` block and prose naming the old version.
2. The scaffold `package.json` mirror, then `pnpm install` in a copy outside the repository and the
   lockfile copied back. Never run pnpm inside `skills/`: `node_modules/` there ships with every local
   install and fails validation.
3. `frontend-tooling` references re-mirrored byte for byte; `diff` each block against the scaffold file.
4. Skill pin lines, correction-table rows, snippets.
5. `evals/<skill>.md` in the same commit whenever what a good answer looks like changed.
6. `metadata.version` in every skill whose teaching changed: patch for wording, minor for an API change.
7. The release `version` in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`,
   `.cursor-plugin/plugin.json` and both version fields of `.claude-plugin/marketplace.json`
   (top-level `version` and `metadata.version`). An installed plugin sees a change only when it
   changes, and `validate_skills.py --base` fails a pull request that changes `skills/` without it.
   A major bump of React, TypeScript or Vite also edits the manifest descriptions if they name it.

Editing rules: no reflow, no touching the neighbouring sentence, keep every deliberately worded warning.
Never edit the verify copy; it is regenerated on every `make snippets`.

## 5. Verify

- `make check`, without `--skip-tests`.
- The scaffold gate from a copy outside the repository:
  `pnpm install --frozen-lockfile && pnpm check && pnpm build && pnpm test:e2e`.
- `claude plugin validate --strict .` and `npx skills add . --list` (exactly the fourteen skills).
- The exercise: build a throwaway app from the `frontend-scaffolding` text alone in a scratch
  directory, run its gate, delete it.
- `grep -rn '<package>'` and read each hit for the old version: it survives only in correction tables.
- `ls skills/frontend-scaffolding/assets/app` shows no `node_modules/`, `dist/`, `coverage/`,
  `test-results/` or `playwright-report/`.

## 6. Review and release

An independent, fresh-context review of the diff against the inventory table: every (b) and (c) row
has exactly one edit, no edit lacks a row. Show the complete diff; the pull request opens only on
the owner's explicit approval, its body the inventory table plus what was verified. Run the eval
suite (`make evals`) only with the approval AGENTS.md requires, and keep its summary under
`maintenance/`. After merge, on a clean tree at the merge commit, run `claude plugin tag --push`: it
validates the plugin, checks that `plugin.json` and the marketplace entry agree, and pushes the tag
`frontend-powers--vX.Y.Z` that Claude Code's dependency resolution looks for.

Users of a third-party marketplace do not get updates automatically unless they turn auto-update on
for it; the release note tells them to run `claude plugin marketplace update frontend-powers` and
`claude plugin update frontend-powers@frontend-powers`.

## Red Flags — STOP

| Signal | Instead |
|---|---|
| Rewriting a section because it reads better | Revert; only the line the changelog invalidates changes. |
| A version bumped in a skill body only | STACK.md and the scaffold mirror first, the pin line last. |
| A passing snippet taken as proof the teaching is right | Read the prose beside the block against the changelog entry. |
| A changelog example pasted into a snippet | Run it under the scaffold's tsconfig and Biome first; the strict flags reject most upstream examples. |
| A new library appearing in a skill | Stop; it needs a STACK.md decision first. |
| A rename fixed in a snippet with no correction-table row | Add the row; it saves the reader arriving with the old spelling. |
| An edit outside the owning skill | Move it; the sibling gets a one-sentence cross-reference at most. |
| `pnpm install` run inside `skills/` | Delete the `node_modules/`; install in a copy outside the repository. |
| An action pinned by tag | Pin the full commit SHA with the tag in a comment. |
