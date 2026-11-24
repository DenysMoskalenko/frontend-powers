# frontend-powers

A shared playbook for humans and coding agents building client-rendered single-page apps with
Vite, React and TypeScript that talk to OpenAPI backends. It makes one pick per concern and
captures the conventions that go with it, so a team stops re-deciding the same things and
AI-assisted changes come out predictable. It is not for Next.js, server rendering or server
components: the app is static files served with a strict Content Security Policy.

The shipped artifact is [`skills/`](skills/): fourteen Markdown guides an agent loads per domain.
[`STACK.md`](STACK.md) is the single source of truth for every version and library choice,
including the rejected alternatives.

## The Stack

| Package | Pinned | Role |
| --- | --- | --- |
| Node, pnpm | 26.13, 12.22 | runtime and package manager, pinned in `devEngines` |
| TypeScript | 7.0 | the native compiler, one strict `tsconfig.json` |
| Vite, `@vitejs/plugin-react` | 8.3, 6.3 | build on Rolldown, React Compiler on in dev, build and tests |
| React | 19.3 | UI library |
| TanStack Router, Query | 1.170, 5.108 | file routes and loaders; server state |
| orval | 8.48 | query hooks, zod schemas and MSW handlers from a committed `openapi.json` |
| zod, TanStack Form | 4.6, 1.33 | validation at trust boundaries; forms |
| Tailwind CSS, `@base-ui/react` | 4.3, 1.9 | static CSS and unstyled accessible parts |
| Biome, knip | 2.6, 6.46 | lint, format, module boundaries, dead code |
| Vitest, MSW, Playwright | 5.1, 3.0, 1.65 | route integration tests and end-to-end tests |
| wrangler, Caddy | 4.165, 2.11 | Cloudflare static assets, or a container on `scratch` |

Add-ons pinned in STACK.md and added only when needed, such as keycloak-js, i18next with
react-i18next, `centrifuge` and `eventsource-parser`, Grafana Faro, zustand, virtua, TanStack Table.

## What's Inside

**Core skills**

| Skill | Loads when |
| --- | --- |
| [`frontend-code-style`](skills/frontend-code-style/SKILL.md) | Writing or reviewing TypeScript and React: strictness flags, error classes and the one reporting funnel, React 19 APIs, the React Compiler policy, naming, dates and money, browser APIs above the browser floor. |
| [`frontend-project-structure`](skills/frontend-project-structure/SKILL.md) | Deciding where code lives: the `routes -> features -> shared` layers, import rules, feature anatomy, file naming, where state lives. |
| [`tanstack-router-spa`](skills/tanstack-router-spa/SKILL.md) | Adding or changing a route: file-route conventions, loaders, `validateSearch`, navigation, guards, pending and error components, code splitting, blockers. |
| [`tanstack-query-api`](skills/tanstack-query-api/SKILL.md) | Anything between a component and the backend: `openapi.json`, orval regeneration, `apiFetch`, `ApiError`, queries, mutations, invalidation, optimistic UI, pagination, polling, files. |
| [`frontend-forms`](skills/frontend-forms/SKILL.md) | Building a form: TanStack Form through `useAppForm` with zod and Base UI `Field`, submitting through a mutation, server field errors, the leave guard. |
| [`tailwind-base-ui`](skills/tailwind-base-ui/SKILL.md) | Styling mechanics: Tailwind 4 tokens, responsive layout, Base UI wrappers in `shared/ui`, the no-runtime-style rule and the library picks that survive the CSP. |
| [`frontend-testing`](skills/frontend-testing/SKILL.md) | Writing tests: `renderRoute`, the Node and jsdom Vitest projects, MSW handlers, user-event, factories, time, coverage, flaky tests, `data-testid`, Playwright. |
| [`frontend-tooling`](skills/frontend-tooling/SKILL.md) | Changing configuration: `package.json` scripts, `pnpm-workspace.yaml`, `tsconfig.json`, `biome.json`, `vite.config.ts`, knip, prek, CI, dependency upgrades. |
| [`frontend-deploy`](skills/frontend-deploy/SKILL.md) | Per-environment builds, the generated security headers and CSP, Cloudflare static assets, the Caddy container, cache policy, source maps, stale-chunk recovery, telemetry. |

**Greenfield**

| Skill | Loads when |
| --- | --- |
| [`frontend-scaffolding`](skills/frontend-scaffolding/SKILL.md) | Creating a brand-new app from the buildable template in `assets/app/`. Never for an existing app. |

**Add-ons**

| Skill | Loads when |
| --- | --- |
| [`keycloak-spa-auth`](skills/keycloak-spa-auth/SKILL.md) | Adding login: the session module over keycloak-js, the token for `apiFetch`, 401 and 403 policy, route guards, logout, multi-tab behaviour. |
| [`frontend-i18n`](skills/frontend-i18n/SKILL.md) | Translating the UI: i18next setup, keys, plurals, `<Trans>`, the CLI gates, typed keys, lazy loading. |
| [`frontend-realtime`](skills/frontend-realtime/SKILL.md) | Streaming or push: SSE over `fetch`, the Centrifugo client, raw WebSocket rules, the push-to-cache bridge. |
| [`frontend-shared-packages`](skills/frontend-shared-packages/SKILL.md) | More than one deployable: a pnpm workspace of source-only packages, catalogs, lockstep versioning and release. |

Each skill owns its domain and links a sibling by name instead of repeating its rules, so a task
loads the few skills it touches. Adding a filtered list page, for example, loads
`tanstack-router-spa` for the route file and its search params, `tanstack-query-api` for the
generated query and the loader that fills the cache, `frontend-project-structure` for where the
feature component goes, and `frontend-testing` for the route test; `frontend-code-style` applies to
all of it. Three contracts hold across every skill: `apiFetch` throws exactly one `ApiError`,
unexpected errors go only to the platform `reportError`, and nothing injects styles or scripts at
runtime. To edit one of this repository's skills, read [`AGENTS.md`](AGENTS.md) first.

Some topics are left out on purpose (backends without OpenAPI, framework migrations, print styles,
server rendering and others): see "Not covered" in [`STACK.md`](STACK.md#not-covered).

## The Scaffold

Ask the agent to create a new frontend app; `frontend-scaffolding` copies its template into an empty
directory and runs the gate before any feature code. A new app starts with:

- a `users` example domain with list, detail and form pages, generated from a committed
  `openapi.json`, to replace with the real one;
- the `src/routes`, `src/features`, `src/shared`, `src/api` and `src/app` layers, with boundaries
  enforced by a Biome GritQL plugin;
- route integration tests through `renderRoute` with MSW, 80 % coverage gates, and Playwright
  end-to-end tests against the production build, in Desktop Chrome and a WebKit phone, with an
  axe scan and a CSP-violation guard;
- `pnpm check` (Biome, `tsc`, knip, Vitest), prek hooks, and the same CI jobs for GitHub Actions and
  GitLab CI;
- generated security headers with a strict CSP and Trusted Types, Cloudflare static-assets config,
  a Caddy container image on `scratch`, a gzip bundle budget enforced in the build, and a browser
  floor (Baseline Widely Available on the last audit) in `build.target`.

## Companion Skills

Optional third-party skills, never required: a skill names the one that applies and continues
alone when it is not installed.

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

Where one of their rules assumes Next.js, server rendering, SWR, inline scripts or runtime style
injection, the precedence table in `frontend-code-style` gives the reading correct for this stack.

## Install As A Claude Code Plugin

**From GitHub** (manifest: [`.claude-plugin/plugin.json`](.claude-plugin/plugin.json)):

```bash
claude plugin marketplace add https://github.com/DenysMoskalenko/frontend-powers
claude plugin install frontend-powers@frontend-powers
```

**Local development:** add a clean clone as a marketplace. Claude Code loads a plugin from a local
marketplace in place, so an edit applies on `/reload-plugins` without a version bump; a clean clone
keeps installs and build output out of `skills/`, which the plugin loads as it is.

```bash
git clone https://github.com/DenysMoskalenko/frontend-powers
claude plugin marketplace add ./frontend-powers
claude plugin install frontend-powers@frontend-powers
```

**Updates:** every change to `skills/` bumps the plugin `version`, and an installed plugin sees a
change only when that version changes. Auto-update is off by default for a third-party
marketplace; turn it on for this marketplace under `/plugin`, or update by hand and restart Claude
Code:

```bash
claude plugin marketplace update frontend-powers
claude plugin update frontend-powers@frontend-powers
```

## Install As A Codex Plugin

The marketplace file is [`.agents/plugins/marketplace.json`](.agents/plugins/marketplace.json), the
manifest [`.codex-plugin/plugin.json`](.codex-plugin/plugin.json).

**ChatGPT desktop app (Codex):** open the **Plugins Directory**, add the marketplace
`https://github.com/DenysMoskalenko/frontend-powers`, then install and enable **Frontend Powers**.

**Codex CLI:**

```bash
codex plugin marketplace add DenysMoskalenko/frontend-powers
codex plugin add frontend-powers@frontend-powers
```

Start a new Codex thread after installation so the skills are loaded.

## Install As A Cursor Plugin

The manifest is [`.cursor-plugin/plugin.json`](.cursor-plugin/plugin.json). In a Cursor Agent
chat, run:

```text
/add-plugin frontend-powers@https://github.com/DenysMoskalenko/frontend-powers
```

For local testing, copy a clean clone of this repository to `~/.cursor/plugins/local/frontend-powers`
(Cursor skips a symlink that points outside that folder), then restart Cursor or run
`Developer: Reload Window`.

## Other Agents

Any agent that reads Agent Skills:

```bash
npx skills add DenysMoskalenko/frontend-powers
```

## Related Plugins

[python-powers](https://github.com/DenysMoskalenko/python-powers) (FastAPI) and
[rust-powers](https://github.com/DenysMoskalenko/rust-powers) (axum) cover the backends this
frontend calls. `ApiError` reads an axum `ErrorBody`, a FastAPI `detail` and an RFC 9457 problem
document, and the scaffold's `openapi.json` mirrors the `users` API of the rust-powers scaffold.

## Repository Layout

- `skills/` - the fourteen shipped skills; `skills/frontend-scaffolding/assets/app/` is the template.
- `STACK.md` - versions, library choices and rejected alternatives.
- `AGENTS.md` (symlinked as `CLAUDE.md`) - house conventions and the checklist for changing a skill.
- `evals/` - per-skill triggering cases, evals and probes ([format](evals/README.md)).
- `scripts/` - the validator and its tests, the snippet checker and the eval tooling.
- `maintenance/` - the [release audit](maintenance/release-audit.md) and [sources](maintenance/sources.md); no skill
  reads it, but the plugin source is the repository root, so every install copies it, as it copies
  `evals/` and `scripts/`.
- `.claude-plugin/`, `.codex-plugin/`, `.cursor-plugin/`, `.agents/` - plugin and marketplace manifests.
- `assets/` - the plugin logo.

## Development

```bash
make check            # everything CI's check job runs; green here predicts a green pull request
make validate         # validate_skills.py --strict --base $(BASE): house rules, STACK.md parity, stale version and browser-floor copies, version bumps
make test-scripts     # seeds a violation per validator check into a temporary copy and asserts the error
make lint             # prek whitespace, JSON and YAML hooks
make plugin-validate  # claude plugin validate --strict . (skipped with a notice when claude is not installed)
make snippets         # tsc, Biome and Vitest over every verify block, in a temp copy of the scaffold
make evals            # billed: run evals/ with and without the plugin via claude plugin eval
```

`BASE` defaults to `origin/main`; when that ref does not exist (a clone without the remote branch),
`make validate` says so and skips the version-bump check.

[`.github/workflows/check.yml`](.github/workflows/check.yml) runs on every push to `main` and every
pull request. Its `check` job runs `validate_skills.py --strict` (with `--base` on pull requests,
which fails a skill change without a version bump), the script tests, the prek hooks,
`claude plugin validate --strict .` and `check_snippets.py`. Its `scaffold` job copies the template
out of the repository and runs the template's own gate there: `pnpm dedupe --check`, `pnpm check`,
`pnpm test:coverage`, the generated-client comparison after `pnpm api:generate`, `pnpm build` with
`PUBLIC_API_ORIGIN=https://api.example.com`, the Playwright end-to-end tests and the container image
build. `make evals` makes real model calls on your account, so it runs before a release or when a
new model ships, never in CI.

## Versioning And Release

All manifests carry one plugin version and every skill its own `metadata.version`; any change under
`skills/` bumps both. [`maintenance/release-audit.md`](maintenance/release-audit.md) is the
procedure the maintainer follows before a release.

## License

This project is licensed under the [Apache License 2.0](LICENSE).
