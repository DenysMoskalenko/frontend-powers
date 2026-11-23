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
| CI images | scaffold `.github/workflows/ci.yml` and `.gitlab-ci.yml`: the Playwright image (tag equal to `@playwright/test`) and the GitLab `node` image, each pinned by digest with the tag in a comment; the same STACK.md line; `frontend-tooling` and `frontend-shared-packages` references |
| GitHub Actions | `.github/workflows/check.yml`, scaffold CI files, `frontend-tooling` references (full SHA plus `# vX.Y.Z` comment) |
| prek and its hooks | `@j178/prek` in the scaffold `package.json`, the `pnpm dlx @j178/prek@...` line in `.github/workflows/check.yml` |
| Claude Code for CI | the `pnpm dlx @anthropic-ai/claude-code@...` line in `.github/workflows/check.yml` |
| browser floor | the `build.target` list in STACK.md (Build) and the scaffold `vite.config.ts`; its copy in `frontend-tooling` references and the floor prose in skills, listed by `make validate` as `stale browser floor` errors |
| versions quoted in skill bodies | the version-pin line at the top of every SKILL.md; every other exact copy (the `package.json` copy in `frontend-tooling`, the catalog in `frontend-shared-packages`, prose) is listed by `make validate` as a `stale version` error; `grep -rnE '[0-9]+\.[0-9]+\.[0-9]+' skills/ --include='*.md'` for the rest |

Current versions:

- Inside a copy of the scaffold outside the repository: `pnpm outdated --long`. A new major needs
  research; a release younger than the scaffold's `minimumReleaseAge` waits for the next audit unless
  it fixes an advisory.
- `pnpm view <package> version dist-tags` for anything not in the lockfile.
- By hand, because `pnpm outdated` reports neither: `npm view pnpm time` and the Node release index
  for the `devEngines` pins; Caddy's releases and the Playwright image tag; then each image digest
  resolved again from its tag (`docker buildx imagetools inspect <image>:<tag>`). A security release
  of pnpm is taken at the next audit once past the cooldown.
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
6. `metadata.version` in every skill whose files changed (`frontend-scaffolding` whenever the template
   changed): patch for wording or a pin, minor for an API change. `validate_skills.py --base` enforces it.
7. The release `version` in `.claude-plugin/plugin.json`, `.codex-plugin/plugin.json`,
   `.cursor-plugin/plugin.json` and both version fields of `.claude-plugin/marketplace.json`
   (top-level `version` and `metadata.version`). An installed plugin sees a change only when it
   changes, and `validate_skills.py --base` fails a pull request that changes `skills/` without it.
   A major bump of React, TypeScript or Vite also edits the manifest descriptions if they name it.

8. The browser floor, at every audit. Set `build.target` to the newest Chrome, Edge, Firefox (never
   below 128, which Tailwind 4 needs) and Safari released on or before the audit date minus 30
   months, from the release dates in the current `@mdn/browser-compat-data`, in STACK.md and the
   scaffold `vite.config.ts`; `make validate` lists every other copy. Then check each browser API,
   HTML attribute and CSS feature the skills and the template use against that data by its exact
   compatibility key, not its web-features group (the `url` group is Baseline high while
   `URL.parse` needs Safari 18), and build a scaffold copy with every Tailwind class from the
   skills to scan the emitted CSS. Remove workarounds the new floor makes native (as the
   `light-dark()` rewrite was), fix or feature-detect every use still above it, and check the
   STACK.md `## Watch` rows that wait for the floor (`Temporal`, `URL.parse`, stream async
   iteration, `style-src-elem`).

Editing rules: no reflow, no touching the neighbouring sentence, keep every deliberately worded warning.
Never edit the verify copy; it is regenerated on every `make snippets`.

## 5. Verify

- `make check`, without `--skip-tests`.
- The scaffold gate from a copy outside the repository, as AGENTS.md `## Verification` lists it (the
  CI `scaffold` job runs the same commands).
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

Then publish the release note as a GitHub Release on that tag:
`gh release create frontend-powers--vX.Y.Z --title "frontend-powers X.Y.Z" --notes-file <file>`. Its
body is the inventory table (what moved, what was held back and why) followed by the update commands.
The Releases page is the changelog; there is no CHANGELOG file.

Users of a third-party marketplace do not get updates automatically unless they turn auto-update on
for it; the release note tells them to run `claude plugin marketplace update frontend-powers` and
`claude plugin update frontend-powers@frontend-powers`.

## Audit of 22 November 2026

Cut-off: the three-day cooldown at install time on 22 November 2026, which fell at about 12:30Z on
19 November: a release published before it was taken (i18next-cli 1.91.2, 12:20Z), one after it was not.

| Moved | From | To | Why it matters |
|---|---|---|---|
| pnpm (`devEngines`, CI, Dockerfile) | 12.21.0 | 12.22.0 | security release: `pnpm audit` dropped advisories with a string id; a registry change skipped `minimumReleaseAge` and `trustPolicy` |
| jsdom | 30.1.3 | 31.0.1 | major; adds a native `reportError` that only logs, which the setup still replaces; suite unchanged |
| `@testing-library/jest-dom` | 7.0.1 | 8.0.0 | major; drops Vitest below 5, no test changes |
| vitest, `@vitest/coverage-v8` | 5.1.0 | 5.1.1 | the seeded shuffle now sorts files first, so a printed seed reproduces the order |
| `@tanstack/react-query` | 5.107.1 | 5.108.0 | pin lines only |
| msw, user-event, knip, wrangler | 3.0.6, 14.6.12, 6.45.1, 4.163.0 | 3.0.7, 14.6.13, 6.46.1, 4.165.0 | no teaching impact |
| i18next, react-i18next, i18next-cli (add-ons) | 27.1.3, 18.0.2, 1.88.0 | 27.2.2, 18.0.3, 1.91.2 | 27.2.0 lets a load-callback or listener error reach the app |
| lucide-react, virtua (add-ons) | 1.73.0, 0.54.2 | 1.76.0, 0.55.0 | no teaching impact |
| CI images | by tag | by digest, tag in a comment | same stance as the Dockerfile and the SHA-pinned actions |
| CI `check` job | — | `pnpm audit signatures` first | verifies registry signatures, also through a mirror |

Held back: i18next 27.2.3 (21 November, inside the cooldown on the audit day). It fixes a nested
`$t()` option injection under the `escapeValue: false` that `frontend-i18n` sets, so the next audit
takes it first, with the react-i18next and i18next-cli releases of the same pass. Query 5.108.1 and
5.108.2 (5.108.1 published 19 November 14:03Z) were also inside the cooldown and carry no
security fix. i18next-cli 1.91.3 (19 November 12:34Z) fell just after the cut-off. Unchanged after
checking: Node 26.13.1, every other scaffold pin, the Faro, react-table, centrifuge, eventsource-parser,
keycloak-js, oidc-client-ts and zustand add-ons, and the `node`, `caddy` and Playwright images
(same digests).

For the next audit:

- i18next 27.2.3 or later and i18next-cli 1.91.3 or later, as above.
- Every `## Watch` row in STACK.md: check whether its event has happened.
- Caddy 2.11.10: 2.11.9 is built with a Go release that scanners will flag.
- The `@opentelemetry/api` override for Faro: drop it once `@grafana/faro-web-tracing` accepts the
  current `@opentelemetry/api` (`pnpm peers check` without the override).
- `@tanstack/react-table` now ships agent skills: the install asks for approval; decline it.

## Browser floor of 23 November 2026

First set by this procedure: `chrome125`, `edge125`, `firefox128`, `safari17.5` (was `chrome119`,
`edge119`, `firefox128`, `safari17.4`), the newest releases on or before 23 May 2024 from
`@mdn/browser-compat-data` 8.1.10, Firefox raised from 126 to 128. Among the 661 web-features
entries Baseline low by that date, the highest requirements are Chrome 125, Firefox 126 and
Safari 17.5. `ios17.5` built byte-identical output and was left out. Consequences: `light-dark()`
ships natively (the Lightning CSS rewrite and its caveats were removed); `URL.parse` became
`new URL` in `try`/`catch` in `safe-url.ts` (both copies); the SSE reader became a `getReader()`
loop, since stream async iteration needs Safari 27. Next floor moves: Chrome 126 (11 June 2024),
Edge 126, Firefox stays 128, Safari 17.6 (29 July 2024), once the audit date passes 30 months
after them. Nothing runs on a real floor browser: Playwright's engines are current builds.

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
| A container image pinned by tag | Pin the digest with the tag in a comment. |
| The floor moved in `vite.config.ts` only | STACK.md's `build.target` list first; `make validate` then lists every stale copy. |
