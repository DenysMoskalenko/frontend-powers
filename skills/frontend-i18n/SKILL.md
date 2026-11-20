---
name: frontend-i18n
description: "Use when adding translations or a second language to a Vite React SPA, or fixing i18next code: useTranslation, t() keys, Trans components, plural keys _one _few _other, i18next-cli extract --ci, status or lint failing, resources.d.ts and CustomTypeOptions, 'pass these arguments as t() options', fallbackLng, changeLanguage, html lang, translated dates and server error text. Not for date and money formatting rules (frontend-code-style), form wiring (frontend-forms), the test harness (frontend-testing) or wording and tone (web-design-guidelines)."
metadata:
  version: "0.1.0"
---

# Translations with i18next

Assumes i18next 27.1, react-i18next 18.0, i18next-cli 1.88, zod 4.6.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, use its own modules, helpers and scripts, and say so when it has no equivalent instead of adding one unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If `pnpm-lock.yaml` pins another major version than the line above, follow the project and say which rules may not apply.

Wording, tone and error copy belong to `web-design-guidelines`. If that skill is available, load it before writing the source-language strings. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules.

## Important

- Set `fallbackLng` and `supportedLngs` in `init`: i18next 27 defaults `fallbackLng` to `false`, so a key missing in one language renders as the key instead of the English text.
- A key is a string literal at the call, and one key holds a whole sentence with its values as `{{variables}}`: no gate sees a key built at runtime, and joined fragments break word order in other languages.
- Plurals pass `count` to the base key (`t("summary.total", { count })`); the extractor writes each language's forms (`_one`, `_few`, `_many`, `_other`). Never choose the form in code.
- `main.tsx` renders after the first language loads: `ready.then(render, startFailed)`, where `startFailed` reports and renders one static message; with a session, `Promise.all([..., ready])`.
- Route tests render real messages through `renderRoute` and assert visible text: a mocked `react-i18next`, `cimode` or a key-echoing `t` passes with a missing key or a wrong plural form.

## References

- `references/setup.md` — the ordered steps that end with a green `pnpm check`, the per-file additions for merging with other add-ons, `src/app/i18n.ts`, `main.tsx`, `router.tsx`, message files, generated types and their `tsc` errors, the entry budget. Open when adding the add-on or changing init options.
- `references/messages.md` — calls, plurals, context, `<Trans>` at react-i18next 18, `formatDateTime`, a translated page and form, the language switcher, server errors, zod, Base UI `locale` and direction. Open when writing a component's text.
- `references/gates.md` — `i18next.config.ts`, each gate's failures and output, the lines added to scripts, hooks, CI, `biome.json` and `knip.json`, the lint baseline. Open when a gate fails or when wiring them.
- `references/tests.md` — `renderRoute` with an instance and a `language` option, a language-switch route test, the setup module's test, which gate catches which mistake. Open before testing translated screens.

## Setup decisions

| Concern | Decision |
| --- | --- |
| Instance | `createI18n(language, resources?)` in `src/app/i18n.ts` returns `{ i18n, ready }` from `createInstance()`: one per app and per `renderRoute`, so a switch never leaks between tests |
| Provider | `createAppRouter({ history, i18n })` mounts `I18nextProvider` in `Wrap`, inside `CSPProvider`; components call `useTranslation()`, never import the instance |
| Init | `supportedLngs`, `fallbackLng: "en"`, `ns` = every namespace file, `defaultNS: "common"`, `escapeValue: false` (React escapes), `react: { useSuspense: false }` |
| First language | `pickLanguage([storedLanguage(), ...navigator.languages])`: stored value (untrusted, must equal a listed language), then browser tags by primary subtag, then English. No detector package |
| A switch | `i18n.changeLanguage(lng)` loads first; the `languageChanged` listener sets `<html lang>`, `dir`, zod's locale, and stores the choice |
| Files | `src/app/locales/<language>/<namespace>.json`, JSON v4; `common` for layout and `shared/ui`, one namespace per feature, named after its folder |
| Loading | a `BackendModule` over `import.meta.glob`: one hashed chunk per file; active and fallback languages load before the first render |
| Bundle | raise `ENTRY_BUDGET_BYTES` by the growth `pnpm build` reports (about 20 KB gzip for i18next with react-i18next on the scaffold), in the same change, naming them as the cause; never a fixed number without the build |
| Types | `i18next-cli types` writes `src/app/resources.d.ts` and `src/app/i18next.d.ts`, where you add `strictKeyChecks: true` |

## Keys and messages

- Nested by screen part, camelCase, naming the place: `list.title`, `errors.emailTaken`, `t("common:nav.users")` for another namespace. Never the English sentence as the key.
- `pnpm i18n:extract` adds new keys with the key as the English value and `""` elsewhere: write the text in the same change.
- A runtime value maps through literal calls: `{ active: t("status.active"), ... } satisfies Record<Status, string>`.
- Ordinals `t("list.rank", { count, ordinal: true })`; context `t("list.invited", { context: role })`.
- No default text in calls (`t(key, "Text")`): the text lives in `en/<namespace>.json`. A default value turns the key check off unless `strictKeyChecks: true` is set.
- `<Trans t={t} i18nKey="summary.invite" components={{ create: <Link to="/users/new" /> }} />`: name tags by meaning; an HTML void name (`link`, `br`) parses as self-closing and renders an empty element. In running text, wrap it in `<p className="*:underline">`: axe fails a link that only colour distinguishes (`link-in-text-block`).
- A page's `<title>` is translated like its heading: `<title>{t("list.title")}</title>`.
- Inside a sentence the message formats the value: `{{count, number}}`, `{{date, datetime(dateStyle: medium)}}`, `{{names, list}}`. A value alone uses `formatDateTime(iso, i18n.language)`; the language is a parameter so a switch re-renders it. Formatter shapes are `frontend-code-style`'s.

## Text from elsewhere

| Source | Do |
| --- | --- |
| `ApiError` | a literal call per `status` or `code` (the RFC 9457 `type` URI) where the copy is written (`submitErrors`); `requestId` is a `{{requestId}}` variable; never render `ApiError.message` |
| `ApiError.fieldErrors` | the backend's sentences, shown as sent: translating them is a backend contract change (a stable code per field, or messages localised from `Accept-Language`) to raise with the user, never patched in the form |
| zod issues (`api.zod.ts`, `validateSearch`) | zod's own locale, switched by `createI18n`; add each language to `ZOD_MESSAGES` |
| Base UI `NumberField`, `Slider`, `Progress`, `Meter` | `locale={i18n.language}`, else they follow the browser |
| `NOTICES` toast titles in `router.tsx` | a literal `i18n.t("notices.refresh")` call per `Notify` reason; lint cannot see them |

## Gates

`pnpm i18n:check` (`extract --ci`, `types --ci`, `status`, `lint`) runs in `pnpm check` before `tsc`, in a prek hook and in both CI files.

| Gate | Fails on |
| --- | --- |
| `extract --ci` | files out of sync with the code: new or unused keys, plural forms missing or out of order; it also rewrites them |
| `types --ci` | `resources.d.ts` older than the English files |
| `status` | a key empty or absent in a secondary language, or used in code and absent in `en` |
| `lint` | hardcoded JSX text (`acceptedTags: "all"`), concatenation, a variable dropped in a translation |
| `tsc` | an unknown key, a missing variable or `count`, an unknown `context` |

Adding the add-on to an app with English JSX baselines it once (`lint --update-baseline`); after that a new finding is translated, never baselined. No gate sees a runtime key, a string in a JSX ternary or outside JSX.

## Tests

`renderRoute(path, { language })` (default `"en"`) loads the app's JSON in memory and returns `i18n`; a switch test runs `await act(() => i18n.changeLanguage("ru"))`.

## Prior-version corrections

| Older examples write | Correct now |
| --- | --- |
| `fallbackLng` left out (implied `dev`) | set it; i18next 27 defaults to `false` |
| `initImmediate`, `compatibilityJSON: "v3"`, `interpolation.format` | `initAsync`; JSON v4 `_one`/`_other`; built-in formatters (the old options fail with TS2769) |
| `returnNull: false` | nothing: the default |
| `t("Hello, world")` natural-language keys | nested keys by place |
| `<Trans>Hi <1>{{name}}</1></Trans>` | `i18nKey` and named `components` |
| `i18next-parser` and its config | `i18next-cli extract`; `migrate-config` converts the config |
| `i18next-icu`, `react-intl`, `@lingui/core` | i18next JSON v4 with built-in formatters |
| `i18next-http-backend` fetching `/locales/...json` from `public/` | the glob backend: unhashed files are revalidated on every load, and an open tab gets a new deploy's text for its old code |
| `i18next-browser-languagedetector` | `pickLanguage` with the stored choice validated |
| default `i18next` instance with `.use(initReactI18next)` | `createInstance()` per router and `I18nextProvider` in `Wrap` |
| `typeof import("./en.json")` in `CustomTypeOptions` | generated `resources.d.ts`, which also checks variables |
| `<Trans shouldUnescape>`, `react-i18next/icu.macro` | removed at react-i18next 18 |
| `i18n.language !== prev.language` to detect a switch | compare the `i18n` objects: a live proxy since 18 |

## Red Flags — STOP

| About to… | Do this instead |
| --- | --- |
| `components={{ link: <a /> }}` | a non-void name: `guide`, `create`, `bold` |
| render `error.message` from an `ApiError` | a key per status or `code` |
| `date.toLocaleDateString()` or `Intl.DateTimeFormat("en")` | `formatDateTime(iso, i18n.language)` or a formatter in the message |
| `import i18n from "i18next"` in a component | `const { t, i18n } = useTranslation()` |
| `t("key", "Default text")` | the English text in `en/<namespace>.json` |
| edit `resources.d.ts` or reorder plural keys by hand | `pnpm i18n:extract` |
| `lint --update-baseline` to pass a new finding | translate the string |
