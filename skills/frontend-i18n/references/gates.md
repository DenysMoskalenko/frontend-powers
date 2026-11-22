# The i18next-cli gates

Contents

- [`i18next.config.ts`](#i18nextconfigts)
- [What each command does](#what-each-command-does)
- [Lines this add-on adds](#lines-this-add-on-adds)
- [The lint baseline](#the-lint-baseline)
- [The everyday loop](#the-everyday-loop)

## `i18next.config.ts`

At the app root, beside the other `*.config.ts` files (the Biome override allows its default
export).

```ts,verify
// file: i18next.config.ts
import { defineConfig } from "i18next-cli";

export default defineConfig({
  locales: ["en", "ru"],
  extract: {
    input: ["src/**/*.{ts,tsx}"],
    // Keys used only by tests would otherwise be written into every language.
    ignore: [
      "src/**/*.test.{ts,tsx}",
      "src/test/**",
      "src/routeTree.gen.ts",
      "src/api/generated/**",
    ],
    output: "src/app/locales/{{language}}/{{namespace}}.json",
    defaultNS: "common",
  },
  lint: { acceptedTags: "all", checkConcatenation: "error", checkTranslationPlaceholders: "error" },
  types: {
    input: ["src/app/locales/en/*.json"],
    output: "src/app/i18next.d.ts",
    resourcesFile: "src/app/resources.d.ts",
  },
});
```

| Key | Why |
| --- | --- |
| `locales` | The first entry is the primary language: its file gets the key as value for a new key, the others `""`. Keep it equal to `LANGUAGES` in `src/app/i18n.ts`. |
| `extract.ignore` | Without the test pattern, a key a test calls is written into every language file. |
| `defaultNS: "common"` | Must match `defaultNS` in `createI18n`; a `t()` with no namespace lands in `common.json`. |
| `lint.acceptedTags: "all"` | The default list checks only HTML tags (`p`, `button`, `label`...); `"all"` also catches text in your own components (`<Link>Back to users</Link>`, `<Toast.Close>Dismiss</Toast.Close>`) and their `label` attributes. |
| `checkConcatenation: "error"` | The default `"warn"` prints `t("a") + name` and still exits 0. |
| `checkTranslationPlaceholders: "error"` | Fails when a translation drops or renames a variable: `Placeholder mismatch: "list.pageOf: missing {{pages}} (compared with "en")"`. |
| `types` | Generates the typed keys from the English files. |

`removeUnusedKeys` stays at its default `true`: `extract` deletes keys no code calls.

## What each command does

Measured on i18next-cli 1.91.2 against the scaffold with two namespaces:

| Command | Fails (exit 1) when | Side effect |
| --- | --- | --- |
| `i18next-cli extract --ci` | the files differ from what the code needs: a new key, an unused key, plural forms missing or out of CLDR order. Prints `❌ Some files were updated. This should not happen in CI mode.` with each `+ key: value` | writes the corrected files, so a second run passes: commit them (with real text) |
| `i18next-cli types --ci` | `src/app/resources.d.ts` is stale: `❌ TypeScript definitions are out of date. Run 'i18next-cli types' and commit the changes.` | none |
| `i18next-cli status` | a secondary language lacks a key or has `""` (`ru: ... 64% (16/25 keys) — 9 untranslated`), or the primary lacks a key used in code (`Primary language "en" is missing 1 key(s) that are used in code.`) | none |
| `i18next-cli lint` | hardcoded JSX text or attributes, `<title>` included (`Found hardcoded string: "User not found"`), concatenation, placeholder mismatches | none |
| `i18next-cli status --unused` | unused keys exist (read-only) | none |

What none of them sees: a key built at runtime (`` t(`status.${code}`) `` is skipped silently), a
string in a ternary inside JSX (`{busy ? "Creating…" : "Create user"}`), strings outside JSX
(`window.confirm("Discard?")`, toast titles). The typed keys catch the first;
review catches the rest. The English value equal to its key (`"missingKey": "list.missingKey"`)
passes `status`: read the diff of `en/*.json` before committing.

## Lines this add-on adds

`package.json` scripts (`i18n:check` runs before `tsc`, so stale types fail with their own
message first):

```json
{
  "check": "biome check && pnpm i18n:check && tsc && knip && vitest run",
  "i18n:extract": "i18next-cli extract && i18next-cli types",
  "i18n:check": "i18next-cli extract --ci && i18next-cli types --ci && i18next-cli status && i18next-cli lint"
}
```

`.pre-commit-config.yaml`, a local hook before `tsc`:

```yaml
      - id: i18n
        name: i18next-cli gates
        entry: pnpm i18n:check
        language: system
        files: \.(ts|tsx|json)$
        pass_filenames: false
```

Both CI files, in the `check` job after the Biome step:

```yaml
    - pnpm i18n:check
```

```yaml
      - run: pnpm i18n:check
```

`biome.json`: the generated resources file is not linted, like the route tree:

```json
{
  "files": {
    "includes": ["**", "!src/routeTree.gen.ts", "!src/api/generated", "!src/app/resources.d.ts"]
  }
}
```

`knip.json`: no knip plugin reads `i18next.config.ts`, so it is an entry (otherwise knip reports
it as an unused file and `i18next-cli` as an unused devDependency):

```json
{
  "$schema": "https://unpkg.com/knip@6/schema.json",
  "entry": ["i18next.config.ts"],
  "ignore": ["src/api/generated/**"],
  "ignoreDependencies": ["wrangler"]
}
```

`vite.config.ts`: `ENTRY_BUDGET_BYTES` raised by the growth `pnpm build` reports (the setup
reference has it). What each of these files does in general is `frontend-tooling`'s.

## The lint baseline

Added to an app with English JSX (the scaffold included), `lint` fails on every existing string
(`✖ Linter found <n> potential issues.`). Baseline them once, as the last setup step:
`pnpm exec i18next-cli lint --update-baseline` writes `i18next-lint-baseline.json` (commit it), and
from then on `lint` prints `✔ No new issues found (<n> in the baseline).` and fails only on new
hardcoded text. A new finding is translated, never baselined. When a screen moves to keys, `lint`
prints `<n> baseline entries no longer occur`; run `--update-baseline` again so they drop out, only when
`lint` reports no new issue, because the same run baselines any new finding.
A string that stays English on purpose (the start-up failure in `main.tsx`) carries
`// i18next-instrument-ignore-next-line` on the line above.

## The everyday loop

1. Write the code with `t("...")` calls and literal keys.
2. `pnpm i18n:extract`: new keys appear in every language file and in `resources.d.ts`.
3. Replace each English placeholder value (the key repeated) with the English text, and fill the
   other languages, or hand them to translators: `status` keeps failing on `""` until they are
   filled.
4. `pnpm i18n:extract` again after editing text by hand: `types` only rewrites
   `resources.d.ts` when it runs, and `types --ci` fails on the stale literal values.
5. `pnpm check`.

Renaming a key: `pnpm exec i18next-cli rename-key list.title list.heading` rewrites the calls and
every language file. Give the key as the call writes it: with a namespace prefix
(`users:list.title`) it renames the files but finds no call. Then `pnpm i18n:extract` for the
types.
