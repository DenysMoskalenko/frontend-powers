# Sources

The public sources behind the decisions in `STACK.md` and the skills, grouped by topic, each with the
decision it supports. Update this file whenever a decision in `STACK.md` changes: add the source that
justified the change and remove a source that no longer supports anything.

Decisions were also checked against installed package type definitions, changelogs inside package
tarballs, `--help` output and sandbox runs; those are recorded in the release inventory, not here.

## Contents

- [Tooling and language](#tooling-and-language)
- [Structure](#structure)
- [Routing and data](#routing-and-data)
- [Forms](#forms)
- [Styling and CSP](#styling-and-csp)
- [Testing](#testing)
- [Serving and security](#serving-and-security)
- [Auth](#auth)
- [i18n](#i18n)
- [Realtime](#realtime)
- [Workspace](#workspace)
- [Plugin authoring](#plugin-authoring)

## Tooling and language

| Source | URL | Supports |
|---|---|---|
| pnpm settings | https://pnpm.io/settings | `pnpm-workspace.yaml` keys: `minimumReleaseAge`, `saveExact`, `trustPolicy`, `allowBuilds` |
| pnpm dependency-resolution settings | https://pnpm.io/settings/dependency-resolution | v12 resolution defaults that need no key |
| pnpm build settings | https://pnpm.io/settings/build | `allowBuilds` and `strictDepBuilds` replacing `onlyBuiltDependencies` |
| pnpm CLI settings | https://pnpm.io/settings/cli | `devEngines` with `onFail: "download"` (`pmOnFail` default) |
| pnpm audit | https://pnpm.io/cli/audit | the CI `audit` job with `--audit-level=high`, `audit.ignore`, advisory fixes under the cooldown |
| pnpm/setup README | https://github.com/pnpm/setup | the GitHub CI setup step taking pnpm and Node from `devEngines` |
| pnpm/action-setup README | https://github.com/pnpm/action-setup | the alternative replaced by `pnpm/setup` |
| Announcing TypeScript 7.0 | https://devblogs.microsoft.com/typescript/announcing-typescript-7.0/ (also cited as https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) | TS 7 defaults (`strict`, `types: []`, `noUncheckedSideEffectImports`), removed options, no compiler API |
| React Compiler introduction | https://react.dev/learn/react-compiler/introduction | the React Compiler on in dev and build, no new `useMemo`, `useCallback` or `memo` |
| React 19.3 blog post | https://react.dev/blog/2026/09/09/react-19-3 | React 19.3 API facts in `frontend-code-style` |
| web-features: Temporal | https://web-platform-dx.github.io/web-features-explorer/features/temporal/ | `Date` and `Intl` instead of `Temporal`; `lib` kept at `es2024` |
| Biome VS Code reference | https://biomejs.dev/reference/vscode/ | the scaffold's `.vscode/` settings |
| Playwright CI | https://playwright.dev/docs/ci | the Playwright image tag equal to `@playwright/test`, no browser cache |

## Structure

| Source | URL | Supports |
|---|---|---|
| bulletproof-react project structure | https://github.com/alan2207/bulletproof-react/blob/master/docs/project-structure.md | the `routes -> features -> shared` direction, no cross-feature imports, no barrels |
| Feature-Sliced Design overview | https://feature-sliced.design/docs/get-started/overview | the rejected alternative: six layers with slices and segments |
| Biome GritQL reference | https://biomejs.dev/reference/gritql/ | boundary enforcement through `biome-plugins/boundaries.grit` |
| Biome `noPrivateImports` | https://biomejs.dev/linter/rules/no-private-imports/ | why the built-in rule does not cover layer boundaries |
| TanStack Router file naming conventions | https://tanstack.com/router/latest/docs/framework/react/routing/file-naming-conventions | directory routes and route-file naming |
| TanStack Router code splitting | https://tanstack.com/router/latest/docs/framework/react/guide/code-splitting | `autoCodeSplitting`; a route file exports only `Route` |

## Routing and data

| Source | URL | Supports |
|---|---|---|
| TanStack Router external data loading | https://tanstack.com/router/latest/docs/framework/react/guide/external-data-loading | loaders that fill the Query cache |
| TanStack Router Query integration | https://tanstack.com/router/latest/docs/framework/react/integrations/query | loaders call `queryClient.query`; `ensureQueryData` deprecated |
| TanStack Query `QueryClient` reference | https://tanstack.com/query/latest/docs/reference/QueryClient | `query` and `infiniteQuery`, the deprecated `prefetchQuery` and `fetchQuery` |

## Forms

| Source | URL | Supports |
|---|---|---|
| Base UI forms handbook | https://base-ui.com/react/handbook/forms | TanStack Form with Base UI `Field` parts, no Base UI `Form` |

## Styling and CSP

| Source | URL | Supports |
|---|---|---|
| Tailwind CSS upgrade guide | https://tailwindcss.com/docs/upgrade-guide | Tailwind 4 CSS-first setup in one `src/styles.css` |
| Tailwind CSS theme variables | https://tailwindcss.com/docs/theme | semantic tokens through `@theme inline`, `--color-*: initial` |

## Testing

| Source | URL | Supports |
|---|---|---|
| MSW 3.0.0 release | https://github.com/mswjs/msw/releases/tag/v3.0.0 | MSW 3 as ESM-only, `onUnhandledFrame`, import paths |
| Vitest 5 migration guide | https://vitest.dev/guide/migration | `vi.mock` only at module top, Vitest 5 defaults |
| Vitest 4 migration guide | https://v4.vitest.dev/guide/migration | `projects` replacing `workspace` and the removed match-glob options |
| Vitest Browser Mode | https://vitest.dev/guide/browser/ | jsdom kept for route tests; Browser Mode not adopted |
| Announcing Vitest 4 | https://voidzero.dev/posts/announcing-vitest-4 | Browser Mode stable since 4.0 |
| Vitest reporters | https://vitest.dev/guide/reporters | no `reporters` key, so the agent reporter is picked automatically |
| InfoQ: Vitest 4.1 for AI agents | https://www.infoq.com/news/2026/05/vitest-4-1-ai-agents/ | the agent reporter |
| jest-dom releases | https://github.com/testing-library/jest-dom/releases | `@testing-library/jest-dom` 7 with the `/vitest` entry until 8 passes the cooldown |
| Playwright authentication | https://playwright.dev/docs/auth | storage-state files per account in end-to-end tests |

## Serving and security

| Source | URL | Supports |
|---|---|---|
| Cloudflare static assets binding | https://developers.cloudflare.com/workers/static-assets/binding/ | `wrangler.jsonc` with an `assets` block and no Worker script |
| Cloudflare static assets headers | https://developers.cloudflare.com/workers/static-assets/headers/ | the generated `_headers` file and detaching `Cache-Control` on `/assets/*` |
| Cloudflare static assets redirects | https://developers.cloudflare.com/workers/static-assets/redirects/ | no `_redirects` SPA rule: wrangler rejects `/* /index.html 200` as a loop |
| Cloudflare SPA routing | https://developers.cloudflare.com/workers/static-assets/routing/single-page-application/ | `not_found_handling: "single-page-application"` and its missing-asset limit |
| Cloudflare HTML handling | https://developers.cloudflare.com/workers/static-assets/routing/advanced/html-handling/ | the default `html_handling` of the `assets` block |
| Cloudflare billing and limitations | https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/ | static assets with no Worker script as the default deploy target |
| Cloudflare with GitLab CI/CD | https://developers.cloudflare.com/workers/ci-cd/external-cicd/gitlab-cicd/ | one `wrangler deploy --env <env>` per build from CI |
| Cloudflare version affinity | https://developers.cloudflare.com/workers/versions-and-deployments/gradual-deployments/version-affinity/ | no gradual deployments, so one version serves all assets |
| nginx security advisories | https://nginx.org/en/security_advisories.html | nginx rejected for the container |
| Grafana Alloy `faro.receiver` | https://grafana.com/docs/alloy/latest/reference/components/faro/faro.receiver/ | optional Faro telemetry, receiver CORS and source-map settings |

## Auth

| Source | URL | Supports |
|---|---|---|
| RFC 10017 | https://www.rfc-editor.org/rfc/rfc10017.txt | Authorization Code + PKCE, tokens in memory, refresh rotation; the backend-for-frontend as an accepted-risk note |
| IETF OAuth list message on RFC 10017 | https://mailarchive.ietf.org/arch/msg/oauth/VxtwQa4eBrl1Xt9AngohL3BYAFo/ | the same browser-client guidance |
| keycloak-js releases | https://github.com/keycloak/keycloak-js/releases | keycloak-js 26.2 behaviour (`updateToken`, `checkLoginIframe`) |
| oidc-client-ts | https://github.com/authts/oidc-client-ts | the pick for a non-Keycloak identity provider |
| Search Engine Land: Privacy Sandbox shut down | https://searchengineland.com/google-officially-shuts-down-privacy-sandbox-463561 | third-party-cookie behaviour behind `checkLoginIframe: false` and the silent-SSO limits |
| eMarketer: Privacy Sandbox elimination | https://www.emarketer.com/content/google-s-privacy-sandbox-elimination-ends-quest-cookieless-chrome | the same |

## i18n

| Source | URL | Supports |
|---|---|---|
| i18next changelog | https://raw.githubusercontent.com/i18next/i18next/master/CHANGELOG.md | i18next 27, `fallbackLng` defaulting to `false` |
| react-i18next v17 to v18 migration | https://react.i18next.com/latest/migrating-v17-to-v18 | react-i18next 18 API changes |

## Realtime

| Source | URL | Supports |
|---|---|---|
| MSW server-sent events | https://mswjs.io/docs/sse/ | SSE tests with MSW |

## Workspace

| Source | URL | Supports |
|---|---|---|
| pnpm workspaces | https://pnpm.io/workspaces | source-only packages, `catalog:` and `workspace:*` |
| pnpm versioning | https://pnpm.io/versioning | lockstep versions with `versioning.fixed` instead of changesets |
| pnpm change | https://pnpm.io/cli/change | `pnpm change` for release notes |
| pnpm settings | https://pnpm.io/settings | scoped registries and `minimumReleaseAgeExclude` for an own scope |

## Plugin authoring

| Source | URL | Supports |
|---|---|---|
| Claude Code skills | https://code.claude.com/docs/en/skills.md | frontmatter, description budget, compaction limits |
| Claude Code plugins reference | https://code.claude.com/docs/en/plugins-reference.md | `.claude-plugin/plugin.json` and how the `skills` key combines |
| Claude Code marketplace reference | https://code.claude.com/docs/en/plugins/marketplace-reference.md | `.claude-plugin/marketplace.json` |
| Claude Code plugin loading | https://code.claude.com/docs/en/plugins/loading.md | auto-update off for third-party marketplaces |
| Claude Code plugin dependencies | https://code.claude.com/docs/en/plugins/dependencies.md | third-party skills cannot be declared as dependencies |
| Claude Code publishing plugins | https://code.claude.com/docs/en/plugins/publish.md | version bumps and `claude plugin tag` |
| Claude Code measuring plugins | https://code.claude.com/docs/en/plugins/measure.md | token cost of the skill listing |
| Claude Code plugin CLI reference | https://code.claude.com/docs/en/plugins/cli-reference.md | install, update, validate commands |
| Claude Code plugin evals | https://code.claude.com/docs/en/plugin-evals.md | `make evals` through `claude plugin eval` |
| Claude Code settings reference | https://code.claude.com/docs/en/settings-reference.md | skill-listing budget settings |
| Agent Skills overview | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview.md | skill shape and progressive loading |
| Agent Skills best practices | https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices.md | budgets, one-level references, descriptions |
| Agent Skills specification | https://agentskills.io/specification.md | `name` rules shared by all harnesses |
| Optimizing skill descriptions | https://agentskills.io/skill-creation/optimizing-descriptions.md | trigger words first in descriptions |
| Agent Plugins manifest | https://agent-plugins.org/plugin-authors/manifest.md, https://agent-plugins.org/llms.txt | no root Agent Plugins manifest for now |
| OpenAI plugin build guide | https://developers.openai.com/plugins/build/plugins.md | `.codex-plugin/plugin.json` |
| OpenAI plugin submission | https://developers.openai.com/plugins/deploy/submission.md | the `skills` key in the Codex manifest |
| Codex skills | https://developers.openai.com/codex/skills.md | `agents/openai.yaml` per skill |
| Codex CLI reference | https://developers.openai.com/codex/cli/reference.md | Codex install commands |
| Cursor plugins | https://cursor.com/docs/plugins.md, https://cursor.com/docs/reference/plugins.md | `.cursor-plugin/plugin.json`, `/add-plugin`, local plugin folder |
| Cursor skills | https://cursor.com/docs/skills.md | skill frontmatter fields Cursor reads |
