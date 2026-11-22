# Frontend Powers - Agent Instructions

## Repository Identity

This repository is a shared, opinionated playbook for building frontend applications: a
client-rendered Vite SPA in TypeScript and React that talks to OpenAPI backends. The only
shipped artifact is the `skills/` tree; everything else exists to keep those skills accurate,
portable, and installable in Claude Code, Codex, and Cursor.

`STACK.md` is the single source of truth for versions and library choices. It is not a skill
and is never quoted from inside one. python-powers and rust-powers are the sibling projects
for the backends this frontend calls.

## The Skills

Fourteen skills, each owning its domain exclusively. If a rule belongs to a sibling, link the
sibling by name in one sentence instead of restating the rule.

| Skill | What it is | Owner boundary |
| --- | --- | --- |
| `frontend-code-style` | TypeScript 7 strictness and what it forbids, type conventions, error classes and the one reporting funnel, exports and dependency injection, React 19 API facts, the React Compiler policy, naming, dates and money. Carries the precedence note for third-party React skills. | Language and React API only; never lint configuration, file placement, or query code. |
| `frontend-project-structure` | The `src/` tree, the `routes -> features -> shared` layers and their import rules, feature anatomy, file naming, no barrels, where state lives, app composition, growth rules, bringing an existing app onto the standard, in order. | Where code lives and who may import whom; what goes inside a route file is `tanstack-router-spa`'s, the Biome config that enforces boundaries is `frontend-tooling`'s. |
| `tanstack-router-spa` | File-route conventions, route options, the loader shape, search params, navigation, guard mechanics, pending, error and not-found components, code-splitting rules, navigation blockers, router creation and context. | The URL layer; query options and mutations are `tanstack-query-api`'s, the session is `keycloak-spa-auth`'s. |
| `tanstack-query-api` | `openapi.json`, the orval config and regeneration, `apiFetch`, `ApiError`, QueryClient defaults, queries, mutations, invalidation, optimistic UI, pagination, wire formats, where zod validates. | Everything between a component and the backend; forms are `frontend-forms`'s, route files are `tanstack-router-spa`'s. |
| `frontend-forms` | TanStack Form with zod schemas and Base UI Field parts, submitting through a mutation, mapping server field errors, the leave guard, one-field `FormData` forms. | Form state and submission; form UX, input types and autofill tokens belong to third-party skills. |
| `tailwind-base-ui` | Tailwind 4 CSS-first mechanics, design-token plumbing, Base UI wrappers in `shared/ui`, the styling contract, the no-runtime-style rule and the CSP-safe library picks. | Styling mechanics and UI-library picks only; never visual direction, motion, or component API design. |
| `frontend-testing` | Route integration tests through `renderRoute`, MSW handlers, user-event, factories, time, jsdom gaps, coverage, the flaky-test table, Playwright end-to-end tests. | Test authoring; test-quality principles belong to `writing-good-tests`, config keys and CI to `frontend-tooling`. |
| `frontend-tooling` | `package.json` scripts, `pnpm-workspace.yaml`, `devEngines`, `tsconfig.json`, `biome.json`, `vite.config.ts`, knip, prek, both CI files, adding and upgrading dependencies. | Configuration files and their contents; fixing one lint finding is `frontend-code-style`'s, deploy files are `frontend-deploy`'s. |
| `frontend-deploy` | Per-environment build configuration, the generated security headers and the CSP, Cloudflare static assets, the Caddy container, cache policy, source maps, stale-chunk recovery, client-side security rules, optional Faro telemetry. | How the built app is configured, served, secured and observed; CI job wiring is `frontend-tooling`'s. |
| `frontend-scaffolding` | Creating a brand-new app from the buildable template in `assets/app/`. | Greenfield only; changing an existing app is every other skill's. It is the only place the initial file set lives. |
| `keycloak-spa-auth` | The session module over keycloak-js, the token for `apiFetch`, the 401 and 403 policy, route guard policy, logout, multi-tab behaviour, auth tests. | Authentication only; guard mechanics are `tanstack-router-spa`'s. |
| `frontend-i18n` | i18next setup, keys, plurals, `<Trans>`, the CLI gates, typed keys, lazy loading, tests with real resources. | Translation mechanics only; date and money formatting is `frontend-code-style`'s, wording belongs to a third-party skill. |
| `frontend-realtime` | SSE over fetch, the Centrifugo client module, raw WebSocket rules, the push-to-cache bridge, realtime tests. | Streaming and push only; cache API details are `tanstack-query-api`'s. |
| `frontend-shared-packages` | A pnpm workspace of source-only packages: catalogs, lockstep versioning and release, UI-kit and API-client packaging. | More than one deployable; single-app configuration is `frontend-tooling`'s. |

Three contracts every skill follows instead of restating:

- **One error class.** `apiFetch` throws exactly `ApiError`; no skill adds a second HTTP error
  type or branches on generated error types. Owned by `tanstack-query-api`.
- **One reporting funnel.** Unexpected errors go to the platform `reportError`, which raises a
  `window` `error` event; no skill adds another sink or a `console` call. Owned by
  `frontend-code-style`, wired in the scaffold's `src/app/error-reporting.ts`.
- **No runtime style or script injection.** The shipped CSP is `script-src 'self'; style-src
  'self'` with Trusted Types enforced; no skill recommends a library that needs an exception.
  The header set is owned by `frontend-deploy`, the library consequences by `tailwind-base-ui`.

## Third-Party Skills

These skills are maintained elsewhere and are used alongside this plugin. Never restate or
contradict their rules; point to them by bare name, one line each:

| Skill | Owns |
| --- | --- |
| `vercel-react-best-practices` | render performance, re-render and bundle micro-rules |
| `vercel-composition-patterns` | component API and composition patterns |
| `web-design-guidelines` | UI review: accessibility, form UX, typography, copy |
| `frontend-design` | visual direction |
| `emil-design-eng`, `animate`, `review-animations`, `apple-design` | UI polish and motion |
| `pick-ui-library`, `ask-sonner` | UI-library picks and the Sonner API; their picks are subject to the CSP table in `tailwind-base-ui` |
| `mobile-native` | mobile viewport, touch and safe-area fixes |
| `modern-web-guidance` | native web-platform APIs and their semantics |
| `writing-good-tests` | test-quality principles |

They cannot be declared as plugin dependencies and may be absent. The pointer wording, placed
under the scope block and never in a description:

> Render-performance rules belong to `vercel-react-best-practices`. If that skill is available,
> load it before changing render code. If it is not installed, continue with this skill alone:
> do not ask the user to install it and do not reconstruct its rules.

Several of their rules assume Next.js, SSR, SWR, inline scripts or runtime style injection.
`frontend-code-style` carries the table of those rules with the reading that is correct for
this stack; a new conflict is added there, not in the skill that tripped over it.

## House Conventions

**Frontmatter.** Exactly `name`, `description`, and `metadata` with a quoted `version` line
(bumped with every change to the skill, together with the plugin version; see step 6 below).
`name` is lowercase kebab-case and identical to its directory name, 64 characters or fewer,
and never contains `claude` or `anthropic`. No `<`, `>`, or `#` anywhere in frontmatter.

**Description.** Double-quoted, at most 75 words, third person, and it starts with
`"Use when "`. Follow that with the concrete triggers: the task shapes, the error strings an
agent will paste (`ERR_PNPM_IGNORED_BUILDS`, `TS1294`, `Applying inline style violates`), and
the package and API names a reader arrives with (`validateSearch`, `useSuspenseQuery`,
`orval.config.ts`). Describe a skill by stack nouns and engineering artifacts, never by
"React components", "data fetching", "component architecture", "review UI" or a bare "tests":
those phrases belong to third-party descriptions. End with the negatives, each naming the
skill that wins. The description is the entire triggering mechanism: it is loaded for every
session while the body is not, so trigger words go first. Claude Code and Codex cap the whole
session's skill listing (Claude Code 1 % of the context window, Codex 2 %, both 8,000
characters when the window is unknown), shared with every other installed skill. On overflow
Claude Code drops whole descriptions of the least-invoked skills, and Codex shortens
descriptions and then omits skills. The add-ons and `frontend-scaffolding` are invoked least,
so their names must still say what they do. All fourteen descriptions together stay under
8,000 characters; spend fewer where a trigger is redundant.

**Budgets and shape.** `SKILL.md` targets 250 lines and 1500 words; 300 lines and 2000 words
is the hard cap that fails validation. Claude Code keeps only the first 5,000 tokens of an
invoked skill after compaction and 25,000 tokens across all of them, and a frontend task
loads three skills on median and up to nine; `frontend-code-style` is in three of every four. Open with a one-line version pin naming only the
packages that skill touches, then the scope block below, then the third-party pointers that
apply, then a `## Important` block of three to five non-negotiable bullets, then the
`## References` index, so the index survives compaction. Discipline skills end with a
`## Red Flags — STOP` table and, where one exists, a prior-version correction table (what
older examples write, what is correct now) under a heading that contains `Prior-version`.
Technique skills - `frontend-tooling`, `frontend-scaffolding` - have no Red Flags table;
`frontend-tooling` still carries a prior-version table, because renamed configuration keys
are its main failure mode.

**Scope block.** Current models apply rules literally, including to code a task did not ask
them to change. Every skill except the greenfield `frontend-scaffolding` carries this
paragraph verbatim after its version pin, as one unwrapped line of plain text (no blockquote
marker), before the first `## ` heading:

> Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another version of a package than the line above, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

**What earns a place in `## Important` and Red Flags.** A failure that reproduces on a model
the skills support: an eval case where the skill makes a difference, or a recorded incident.
House conventions the model cannot guess and API facts newer than its training usually
qualify; general practice a current model already follows usually does not. The skills target
current models first and must keep working on older ones, so general advice that only older
models need moves to a one-line Red Flags row rather than disappearing. A rule that
`pnpm check` already enforces earns an `## Important` bullet only when a recorded case shows
agents breaking it. A rule without a recorded failure is not deleted for that reason alone
until it has been measured on the smallest supported model. Say each rule once, give its
reason in one clause, and prefer what to do over what to avoid.

**References.** One level deep under `references/`, plural, no size cap. A reference over
100 lines needs a `Contents` heading or an anchor list in its first 20 lines. Every
`SKILL.md` with a `references/` directory carries a `## References` index with one line per
file saying when to open it - `SKILL.md` is the only index, so a reference never links to
another reference (the validator fails on such a link, in this skill or any other). No
`README.md` inside a skill directory. Skills ship instructions, not scripts: an agent follows
a checklist it can read and never runs a script it cannot see, so no `scripts/` directory
inside a skill.

**Fence tags.** Only these are verifiable:

- ` ```ts,verify ` and ` ```tsx,verify ` - a complete module, imports included. Extracted
  into a copy of the scaffold, type-checked and linted. Without a `// file:` first line it
  may import packages only; with `// file: src/features/users/user-table.tsx` it is written
  at that path in the copy, replacing the scaffold's file if one exists, so `@/` imports and
  file routes resolve as they do in a real app.
- ` ```ts,verify,test ` and ` ```tsx,verify,test ` - a complete test file. Extracted the same
  way and run by Vitest with the scaffold's setup (MSW server, jest-dom, `renderRoute`).
- ` ```ts,ignore ` and ` ```tsx,ignore ` - deliberately wrong: bad examples and
  counter-examples.
- ` ```ts ` and ` ```tsx ` - a fragment. Not extracted and not verified, so keep fragments
  short and push anything load-bearing into a tagged block.

A verified block compiles under the scaffold's `tsconfig.json` and passes its `biome.json`,
formatter included: `import type` for types, no `enum`, no default export, no barrel, and
JSX only under a `tsx` tag. A `ts` or `tsx` fence is never indented (inside a list item, for
example): the snippet check skips indented fences, so the validator fails one. Prefer tagged
blocks in references and short fragments in `SKILL.md`. Configuration shown in a skill (`json`, `jsonc`, `yaml`, `css`, `dockerfile`,
`bash`) is checked against the scaffold by eye, so quote the scaffold's file rather than
writing a variant.

**Ownership.** Exclusive. Cross-reference a sibling by name, never by repeating its rules.
The one deliberate exception is `frontend-tooling`, which repeats config file contents
inline, equal to the scaffold's, so it is readable without opening the scaffold.

**No repository plumbing inside skills.** A skill is read inside somebody else's project,
where the verify copy, this repository's `scripts/`, `evals/`, `make validate`,
`make snippets`, `tmp/`, and `STACK.md` do not exist. Mentioning them is a validation error,
with no exemptions; the same holds for the template's `AGENTS.md` and `README.md`, which ship
into every new app. Version facts belong in the skill's own version-pin line, not in a
pointer to `STACK.md`.

**Out-of-stack terms.** A skill never recommends Next.js, SSR, server components, SWR,
ESLint, Prettier, Jest, npm or yarn commands, or any library in `STACK.md`'s `## Rejected`
table. Naming one is allowed only in a table row under a heading that contains `Red Flags`,
`Prior-version` or `precedence`, or inside an `ignore`-tagged fence; prose under those
headings is not exempt. The one npm command a skill may show is the bootstrap
`npm install --global pnpm@<version>` for images without pnpm.

**Codex metadata.** Each skill carries `agents/openai.yaml` with `interface.display_name`,
`interface.short_description` (30 characters or fewer), and
`policy.allow_implicit_invocation`.

## Evaluation Scenarios

Every skill has `evals/<skill>.md` at the repository root. It holds one `### Triggering`
block - prompts that should load the skill, and near misses that should not, each of those
naming the skill that should win instead (a sibling here, or a third-party skill from the
table above) - at least three `Eval N` blocks of Prompt / Must produce / Must not produce,
and `Probe N` blocks that each test one rule with a wrong-answer regex. `evals/README.md` has
the exact format, and the validator parses it. An eval never contradicts the skill it tests
or a sibling skill.

`make evals` generates `claude plugin eval` cases from these files into the gitignored
`evals/.run/` and runs every eval and probe with and without the plugin, so each case reports
what the skill adds. Runs are billed model calls: run the suite before a release, when a new
model ships, and after a description change, never in CI. An agent that plans to run any eval
in a session asks the user in chat for approval at the start of that session, naming the
cases, whether each runs with or without the plugin, and a cost cap, and runs only what was
approved. Keep the per-case summary that justifies an `## Important` bullet or a Red Flags
row under `maintenance/`.

A behaviour change that changes what a good agent response looks like updates the matching
eval file in the same commit.

## Verification

`make check` runs what the CI `check` job runs, so green there predicts a green pull request:
`make validate`, `make test-scripts`, `make lint`, `make plugin-validate` and `make snippets`.
`make validate` is `validate_skills.py --strict --base $(BASE)` with `BASE ?= origin/main`;
when that ref does not exist it says so and runs without `--base`. `make plugin-validate`
skips with a notice when the `claude` binary is not installed.

`scripts/validate_skills.py` checks that frontmatter parses and uses only the three
allowed keys with a quoted `metadata.version`, `name` matches its directory, the description
is double-quoted, at most 75 words and free of forbidden characters, the summed description
length, line and word budgets, no skill `README.md` or `scripts/`, reference depth and TOCs,
no reference-to-reference links, fence tags in the allowed set, no JSX under a `ts` tag, the
`## References` index, `agents/openai.yaml` presence, `evals/<skill>.md` presence and format,
no indented `ts` or `tsx` fence, every file a `## References` index names exists (dotfiles
such as `.DS_Store` are ignored), no repository plumbing and no out-of-stack terms in skill
text or in the template's `AGENTS.md` and `README.md`, the scope block, equal versions in
every plugin manifest, no `SKILL.md` outside `skills/*/`, no build output inside `skills/`,
that the `dependencies`, `devDependencies` and `devEngines` of
`skills/frontend-scaffolding/assets/app/package.json` still match STACK.md's
`## package.json` block, and that every exact version of a pinned package written anywhere
under `skills/` equals its pin. That last check reads the names in STACK.md's
`## package.json` and `## Add-on packages` blocks, and a few display names (`TanStack Query`,
`Tailwind CSS`, `Biome`, `Base UI`, `jest-dom`), and finds `"<name>": "x.y.z"`,
`<name>: x.y.z`, `<name>@x.y.z`, `<name> x.y.z`, a `^` or `~` range, a table row
`| <name> | x.y.z |`, a YAML `name:` with its `version:`, and a name that ends one line with
the version starting the next; the `devEngines` pnpm and Node versions as `pnpm@`, `node:<v>`,
`PNPM_VERSION:`, a `devEngines` copy, or a bare version after the word pnpm or node in the
same sentence; and the image tags on STACK.md's container-images line (Playwright against
`@playwright/test`, Caddy, and the add-ons' Keycloak and Centrifugo services), as `<image>:<tag>`
or a digest pin with the tag in a comment. It skips `pnpm-lock.yaml` and the first cell of a
row under a `Prior-version` heading, and reports `file:line`, the name, the version found and
the pin. A malformed JSON block in STACK.md is reported as such and skips this check. Warnings do not fail; errors exit 1. `--strict` promotes a missing eval file to an
error, `--json` emits findings as JSON, and `--base <ref>` fails when a skill changed since
that ref without a `metadata.version` bump, when `skills/` changed without a plugin version
bump, and when a skill or plugin version moved backwards.

`make test-scripts` runs `scripts/test_validate_skills.py` (stdlib `unittest`, about 20
seconds, no network): it seeds one violation per validator check into a temporary copy of the
repository and asserts the specific error, checks that accepted content stays accepted, and
proves that `build_eval_cases.py --out` refuses a directory it did not generate. A new
validator check gets a case there in the same change.

`make snippets` runs `scripts/check_snippets.py`: for each skill in turn it regenerates a
verify copy of `skills/frontend-scaffolding/assets/app/` outside the repository (by default
under the system temp directory, because the plugin root is the repository root, which an
install copies or, from a local marketplace, loads in place), adds the packages from
STACK.md's `## Add-on packages` block to the copy's `package.json`, writes that skill's verified blocks into it, installs, then runs
`tsc`, `biome check --error-on-warnings` and `vitest run`. Skills are verified in isolation,
so two skills may replace the same scaffold file; within one skill a `// file:` path is
written once. Generated file names are kebab-case and
a test block becomes a `*.test.ts(x)` file, as the scaffold's lint rules require; a snippet
that imports a package in neither `package.json` nor the add-on block cannot be verified.
Snippets must already be formatted as Biome formats them; a formatting failure prints the
diff. The install is reused while the scaffold's `package.json`, lockfile and workspace
file and the add-on block are unchanged. On failure it prints
which `skill/file.md:line` the failing file came from. `--dry-run` extracts and summarizes
without installing; `--skip-tests` stops after Biome; `--only <skill>...` checks only those
skills' snippets; `--verify-dir <dir>` uses another directory, so agents working on
different skills can check side by side. The script deletes a directory only if it generated
it.

`claude plugin validate --strict .` checks the manifests, the marketplace file and every
`SKILL.md`'s YAML; `npx skills add . --list` must list exactly the fourteen shipped skills.

The scaffold has its own gate, which the CI `scaffold` job runs from a copy outside the
repository and `make check` does not: `pnpm install --frozen-lockfile`, `pnpm dedupe --check`,
`pnpm check`, `pnpm test:coverage`, `pnpm api:generate` followed by a comparison that shows
the committed client unchanged, `pnpm build` with `PUBLIC_API_ORIGIN=https://api.example.com`
exported, `pnpm test:e2e`, and `docker build`. Run it by hand from a copy outside the
repository after any change to the template. Never leave `node_modules/`, `dist/`,
`coverage/`, `test-results/` or `playwright-report/` inside `skills/`.

CI (`.github/workflows/check.yml`, on every push to `main` and every pull request) has two
jobs. `check`: `validate_skills.py --strict` (with `--base origin/<base branch>` on a pull
request), the script tests, prek, `claude plugin validate --strict .` and
`check_snippets.py`. `scaffold`: the template gate above.

`make lint` runs `prek run --all-files --config .pre-commit-config.yaml` for whitespace,
JSON and YAML hygiene. The `--config` flag is required: without it prek also discovers the
scaffold's own hook file and installs `node_modules/` inside `skills/`.

## Adding or Changing a Skill

1. **Research.** Confirm the topic has at least three distinct recurring triggers and that
   no sibling or third-party skill already owns it. Narrow topics extend an existing skill
   instead of becoming one. Read the current `SKILL.md` in full before editing it. If the
   requested change is unnecessary or wrong, say so instead of making it.
2. **Write.** Follow the budgets and section order above. Prefer one excellent example over
   three mediocre ones. Preserve deliberately worded warnings and comments unless the change
   makes them irrelevant. Verify every API name, config key and CLI flag against the
   installed package or current documentation; a model's memory of this stack is a major
   version behind.
3. **Tag fences.** Anything a reader will copy gets a `verify` tag. Anything deliberately
   wrong gets an `ignore` tag.
4. **Evals.** Add or update `evals/<skill>.md` in the same change.
5. **`make check`.** Green before review; after a change to the template, also its gate (see
   Verification).
6. **Version.** Any change under `skills/<name>/` bumps that skill's `metadata.version` and
   the `version` in every plugin manifest (`.claude-plugin/plugin.json`, both version fields
   of `.claude-plugin/marketplace.json`, `.codex-plugin/plugin.json`,
   `.cursor-plugin/plugin.json`). An installed plugin sees a change only when that version
   changes.
7. **Review.** Re-read the changed section end to end. Verify every relative path you
   touched exists. Update the rest of the plugin manifests only when the change alters what
   the plugin advertises.

## Versions

`STACK.md` is the single source of truth; every other copy of a version follows it. To bump a
dependency, a runtime or an image:

1. **Find the version.** Take the newest release older than the three-day cooldown
   (`minimumReleaseAge` in the scaffold's `pnpm-workspace.yaml`). In a copy of the scaffold
   outside the repository, `pnpm outdated --long` lists the packages. Add-on packages are not
   installed there: `pnpm view <package> time --json` for each name in `## Add-on packages`.
   `pnpm outdated` does not list the `devEngines` pins either: read `npm view pnpm time --json` for pnpm and
   `https://nodejs.org/dist/index.json` for Node. Container images: the tag on its registry and
   the digest it resolves to now (`docker buildx imagetools inspect <image>:<tag>`).
2. **Edit `STACK.md`.** The `## package.json` block (or `## Add-on packages` for a package the
   scaffold does not install), the container-images line under it, and any prose in that file
   that names the old version.
3. **Mirror into the template.** Edit `skills/frontend-scaffolding/assets/app/package.json` to
   match, copy the template to a directory outside the repository, run `pnpm install` there,
   and copy its `pnpm-lock.yaml` back. Never run pnpm inside `skills/`. An image moves, tag and
   digest together, in the template's `Dockerfile` (`<image>:<tag>@sha256:<digest>`) and its
   `.github/workflows/ci.yml` and `.gitlab-ci.yml` (`<image>@sha256:<digest> # <tag>`); the
   add-ons' service images (Keycloak, Centrifugo) move in `keycloak-spa-auth`'s and
   `frontend-realtime`'s end-to-end references, in the same two forms.
4. **Update every other copy.** Run `python3 scripts/validate_skills.py`: it lists every stale
   copy under `skills/` as `file:line`, with the name, the version found and the pin, and
   fails until none is left. The usual places: `frontend-tooling`'s references (a verbatim
   `package.json`, the CI files, the bootstrap line), `frontend-shared-packages`' catalog and
   CI references, `frontend-deploy`'s container reference, `frontend-scaffolding`'s `SKILL.md`
   and `file-map.md`, and each skill's version-pin line. The check sees exact `x.y.z`
   versions only: a two-part pin line (`Assumes zod 4.6`) and a digest are yours to check;
   `grep -rn <old digest> skills/` lists every copy of a digest, including one that moved
   under an unchanged tag.
5. **An add-on pin** has no lockfile: the snippet run installs it on top of the template's
   lockfile, and pnpm refuses a release younger than the cooldown there
   (`ERR_PNPM_NO_MATURE_MATCHING_VERSION`), so a too-new pin fails `make snippets`.
6. **Teach the change.** If the new version changes an API a skill teaches, update that
   skill's version-pin line and add a row to its prior-version correction table in the same
   commit.
7. **Bump versions.** Bump `metadata.version` of `frontend-scaffolding` (the template
   changed) and of every other skill whose files changed, and the plugin version (step 6 of
   Adding or Changing a Skill). `make validate` fails a pull request that skips either.
8. **Re-run the gates.** The template gate from the outside copy (see Verification), then
   `make check`.

Never bump a version only in a skill body. `maintenance/` holds the release procedure and
the research sources; it is repository documentation that no skill reads, though every install
copies it with the rest of the repository root.

## What Belongs Here

Acceptable: conventions that generalize across frontend applications, corrections that make
a skill more accurate or less overlapping, reference material that supports a skill without
bloating its `SKILL.md`, and repository docs explaining how to use the skills.

Not acceptable: app-specific or team-private conventions, one-off workflows, new libraries
without a decision recorded in `STACK.md` first, rules a third-party skill already owns,
visual-design or motion guidance, formatting-only churn across many skills, and claims about
CI, review, or deployment that this repository does not actually have.

## Working Here

Read `README.md`, this file, and the relevant `SKILL.md` before editing. Check
`git status --short` and preserve existing working-tree changes. Keep changes scoped to this
repository's docs and skill content. Report what you changed and what you verified. Stage
files you create with `git add`; commits are made by the repository owner. This repository is
hosted on GitHub - say "pull request", show the complete diff, and get explicit approval
before opening one.
