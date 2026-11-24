---
name: frontend-i18n
description: "Use when adding translations or a second language to a Vite React SPA, or fixing i18next code: useTranslation, t() keys, Trans components, plural keys _one _few _other, i18next-cli extract --ci, status or lint failing, resources.d.ts and CustomTypeOptions, 'pass these arguments as t() options', fallbackLng, changeLanguage, html lang, translated dates and server error text. Not for date and money formatting rules (frontend-code-style), form wiring (frontend-forms), the test harness (frontend-testing) or wording and tone (web-design-guidelines)."
metadata:
  version: "0.1.0"
---

# Translations with i18next

Assumes i18next 27.2, react-i18next 18.0, i18next-cli 1.91, zod 4.6.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another version of a package than the line above, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

Wording, tone and error copy belong to `web-design-guidelines`. If that skill is available, load it before writing the source-language strings. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules.

## Important

- After adding, renaming or editing a key, run `pnpm i18n:extract`, write the English text and run `pnpm check`: `types --ci` fails until `i18n:extract` regenerates `resources.d.ts` from the edited English text. Other languages may follow; `pnpm i18n:status` fails the release, not the commit.
- Set `fallbackLng` and `supportedLngs` in `init`: i18next 27 defaults `fallbackLng` to `false`, so a key missing in one language renders as the key instead of the English text.
- `main.tsx` starts `router.load()`, then renders after the messages: `ready.then(render).catch(startFailed)`, where `startFailed` reports and renders one static message. `ready` rejects when a message file fails, because i18next only emits `failedLoading`; with a session, `Promise.all([..., ready])`.

## References

- `references/setup.md` — the ordered steps, per-file additions for merging with other add-ons, `src/app/i18n.ts`, `main.tsx`, `router.tsx`, message files, typed keys and their `tsc` errors, the entry budget. Open when adding the add-on or changing init options.
- `references/messages.md` — calls, plurals, `<Trans>`, the date formatters, a translated page, the switcher and shell, server and field errors, Base UI labels and direction. Open when writing a component's text.
- `references/gates.md` — `i18next.config.ts`, each gate's failures, the lines for scripts, the hook, each CI forge and the release job, the lint baseline. Open when a gate fails or when wiring them.
- `references/tests.md` — `renderRoute` with a `language`, route, setup-module, first-load and field-error tests, which gate catches which mistake, the nested-`$t()` guard. Open before testing translated screens.

## Setup decisions

| Concern | Decision |
| --- | --- |
| Provider | `createI18n(language)` in `src/app/i18n.ts` builds one instance per router (`createInstance()`); `createAppRouter({ history, i18n })` mounts `I18nextProvider` in `Wrap`; components call `useTranslation()` and never `import i18n from "i18next"` |
| A switch | `i18n.changeLanguage(lng)` loads first; the `languageChanged` listener sets `<html lang>` and `dir` and stores the choice, or reports a file that failed and switches back |
| Files | `src/app/locales/<language>/<namespace>.json`, JSON v4; `common` for layout and `shared/ui`, one namespace per feature, named after its folder |
| A new language | add it to `LANGUAGES` in `src/app/i18n.ts` and to `locales` in `i18next.config.ts`, run `pnpm i18n:extract`, translate every key before the release; without the config entry `extract` writes no files for it |
| Bundle | raise `ENTRY_BUDGET_BYTES` by the growth `pnpm build` reports, in the same change, naming i18next as the cause (setup reference) |

## Keys and messages

- Nested by screen part, camelCase, naming the place: `list.title`, `errors.emailTaken`, `t("common:nav.users")` for another namespace. Never the English sentence as the key.
- A runtime value maps through literal calls: `{ active: t("status.active"), ... } satisfies Record<Status, string>`.
- Ordinals `t("list.rank", { count, ordinal: true })`; context `t("list.invited", { context: role })`.
- `<Trans t={t} i18nKey="summary.invite" components={{ create: <Link to="/users/new" /> }} />`, tags named by meaning; in running text the paragraph underlines the link (messages reference).
- A page's `<title>` is translated like its heading: `<title>{t("list.title")}</title>`.
- Inside a sentence the message formats the value: `{{count, number}}`, `{{date, datetime(dateStyle: medium)}}`, `{{names, list}}`. A value alone uses `formatDateTime(iso, i18n.language)` or `formatDate(isoDate, i18n.language)`: the add-on gives both a `language` parameter (messages reference), so a switch re-renders them. Formatter shapes are `frontend-code-style`'s.

## Text from elsewhere

| Source | Do |
| --- | --- |
| `ApiError` | `submitErrors` takes `t`: a literal call per variant, `failed` and `requestId` as variables; never render `ApiError.message` |
| a field error (`FieldError` or a zod issue) | the bound field in `use-app-form.tsx`: a literal call per backend `code` and per issue kind (`code`, `origin`, the bound), chosen at render, else the error's own `message`, so an untranslated server code shows the backend's sentence |
| other zod issues (`validateSearch`, a parsed stream) | zod's English: developer text, never shown as a field error |
| Base UI `NumberField`, `Slider`, `Progress`, `Meter` | `locale={i18n.language}`, else they follow the browser |
| Base UI's own English labels (`Toast.Viewport`'s "Notifications", `NumberField`'s "Increase") | `aria-label={t("...")}` on the part; no gate sees them |
| `NOTICES` toast titles in `router.tsx` | a literal `i18n.t("notices.refresh")` call per `Notify` reason; lint cannot see them |

## Gates

`pnpm i18n:check` (`extract --ci`, `types --ci`, `lint`) runs in `pnpm check` before `tsc`, in a prek hook and in the CI check job; `pnpm i18n:status` runs in the job that releases. What each fails on, and each forge's lines: gates reference; what `tsc` catches: setup reference.

Adding the add-on to an app with English JSX baselines it once (`lint --update-baseline`); after that a new finding is translated, never baselined. No gate sees a runtime key, a string in a JSX ternary or outside JSX.

## Tests

`renderRoute(path, { language })` (default `"en"`) loads the app's JSON in memory and returns `i18n`; a switch test runs `await act(() => i18n.changeLanguage("ru"))`.

## Prior-version corrections

| Older examples write | Correct now |
| --- | --- |
| `initImmediate`, `compatibilityJSON: "v3"`, `interpolation.format` | `initAsync`; JSON v4 `_one`/`_other`; built-in formatters (the old options fail with TS2769) |
| `t("Hello, world")` natural-language keys | nested keys by place |
| `<Trans>Hi <1>{{name}}</1></Trans>` | `i18nKey` and named `components` |
| `i18next-parser` and its config | `i18next-cli extract`; `migrate-config` converts the config |
| `i18next-icu`, `react-intl`, `@lingui/core` | i18next JSON v4 with built-in formatters |
| `i18next-http-backend` fetching `/locales/...json` from `public/` | the glob backend: unhashed files are revalidated on every load, and an open tab gets a new deploy's text for its old code |
| `i18next-browser-languagedetector` | `pickLanguage` with the stored choice validated |
| default `i18next` instance with `.use(initReactI18next)` | `createInstance()` per router and `I18nextProvider` in `Wrap` |
| `typeof import("./en.json")` in `CustomTypeOptions` | generated `resources.d.ts`, which also checks variables |
| `<Trans shouldUnescape>` | ignored with a `DEPRECATED_OPTION` warning at react-i18next 18: remove it |
| `react-i18next/icu.macro` | removed at react-i18next 18 |
| `ready.then(render, startFailed)` | `ready.then(render).catch(startFailed)`: the second argument misses a throw in `render` |
| `i18next-cli status` in `pnpm check` or the hook | `pnpm i18n:status` in the release job |
| `z.config(ru())` from `zod/locales` for form errors | the bound field's keys: zod's locale text is developer wording |
| `i18n.language !== prev.language` to detect a switch | compare the `i18n` objects: a live proxy since 18 |

## Red Flags — STOP

| About to… | Do this instead |
| --- | --- |
| `"Hello, " + name`, `{t("label")}: {value}` or `` t(`status.${code}`) `` | one literal key per sentence with `{{variables}}`: no gate sees a runtime key, and joined fragments break word order |
| `count === 1 ? ... : ...` | `t("summary.total", { count })`: the extractor writes `_one`, `_few`, `_many`, `_other` per language |
| `vi.mock("react-i18next")`, `cimode` or a `t` that echoes its key | `renderRoute` with real messages: those pass with a missing key or a wrong plural form |
| `$t(key, {"x": "{{x}}"})` nested in a message | a second `t()` call passed as a plain variable: on i18next 27.2.2 with `escapeValue: false` the value rewrites the nested options (`lng`, `ns`); tests reference guard |
| `components={{ link: <a /> }}` | a non-void name: `guide`, `create`, `bold` |
| render `error.message` from an `ApiError` | a key per status or `code` |
| `date.toLocaleDateString()` or `Intl.DateTimeFormat("en")` | `formatDateTime(iso, i18n.language)` or a formatter in the message |
| `t("key", "Default text")` | the English text in `en/<namespace>.json`: a default value turns the key check off unless `strictKeyChecks: true` is set |
| edit `resources.d.ts` or reorder plural keys by hand | `pnpm i18n:extract` |
| `lint --update-baseline` to pass a new finding | translate the string |
