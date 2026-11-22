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

- After adding, renaming or editing a key, run `pnpm i18n:extract`, write the text in every language in the same change and run `pnpm check`: `status` fails on a `""` value, and `types --ci` fails until `i18n:extract` regenerates `resources.d.ts` from the edited English text.
- Set `fallbackLng` and `supportedLngs` in `init`: i18next 27 defaults `fallbackLng` to `false`, so a key missing in one language renders as the key instead of the English text.
- `main.tsx` renders after the first language loads: `ready.then(render, startFailed)`, where `startFailed` reports and renders one static message; with a session, `Promise.all([..., ready])`.

## References

- `references/setup.md` — the ordered steps that end with a green `pnpm check`, the per-file additions for merging with other add-ons, `src/app/i18n.ts`, `main.tsx`, `router.tsx`, message files, generated types and their `tsc` errors, the entry budget. Open when adding the add-on or changing init options.
- `references/messages.md` — calls, plurals, context, `<Trans>` at react-i18next 18, the add-on's two-argument `formatDateTime`, a translated page and form, the language switcher, server errors, zod, Base UI `locale`, built-in labels and direction. Open when writing a component's text.
- `references/gates.md` — `i18next.config.ts`, each gate's failures and output, the lines added to scripts, hooks, CI, `biome.json` and `knip.json`, the lint baseline. Open when a gate fails or when wiring them.
- `references/tests.md` — `renderRoute` with an instance and a `language` option, a language-switch route test, the setup module's test, which gate catches which mistake, the nested-`$t()` guard. Open before testing translated screens.

## Setup decisions

| Concern | Decision |
| --- | --- |
| Provider | `createI18n(language)` in `src/app/i18n.ts` builds one instance per router (`createInstance()`); `createAppRouter({ history, i18n })` mounts `I18nextProvider` in `Wrap`; components call `useTranslation()` and never `import i18n from "i18next"` |
| A switch | `i18n.changeLanguage(lng)` loads first; the `languageChanged` listener sets `<html lang>`, `dir`, zod's locale, and stores the choice |
| Files | `src/app/locales/<language>/<namespace>.json`, JSON v4; `common` for layout and `shared/ui`, one namespace per feature, named after its folder |
| A new language | add it to `LANGUAGES` and `ZOD_MESSAGES` (a `zod/locales` import) in `src/app/i18n.ts` and to `locales` in `i18next.config.ts`, run `pnpm i18n:extract`, translate every key: `status` fails on `""`, and without the config entry `extract` writes no files for it |
| Bundle | raise `ENTRY_BUDGET_BYTES` by the growth `pnpm build` reports (about 20 KB gzip for i18next with react-i18next on the scaffold), in the same change, naming them as the cause; never a fixed number without the build |

## Keys and messages

- Nested by screen part, camelCase, naming the place: `list.title`, `errors.emailTaken`, `t("common:nav.users")` for another namespace. Never the English sentence as the key.
- A runtime value maps through literal calls: `{ active: t("status.active"), ... } satisfies Record<Status, string>`.
- Ordinals `t("list.rank", { count, ordinal: true })`; context `t("list.invited", { context: role })`.
- `<Trans t={t} i18nKey="summary.invite" components={{ create: <Link to="/users/new" /> }} />`: name tags by meaning; an HTML void name (`link`, `br`) parses as self-closing and renders an empty element. In running text, wrap it in `<p className="*:underline">`: axe fails a link that only colour distinguishes (`link-in-text-block`).
- A page's `<title>` is translated like its heading: `<title>{t("list.title")}</title>`.
- Inside a sentence the message formats the value: `{{count, number}}`, `{{date, datetime(dateStyle: medium)}}`, `{{names, list}}`. A value alone uses `formatDateTime(iso, i18n.language)`: the add-on gives the scaffold's one-argument `formatDateTime` a `language` parameter (messages reference), so a switch re-renders it. Formatter shapes are `frontend-code-style`'s.

## Text from elsewhere

| Source | Do |
| --- | --- |
| `ApiError` | a literal call per `status` or `code` (the RFC 9457 `type` URI) where the copy is written (`submitErrors`); `requestId` is a `{{requestId}}` variable; never render `ApiError.message` |
| `ApiError.fieldErrors` | the backend's sentences, shown as sent: translating them is a backend contract change (a stable code per field, or messages localised from `Accept-Language`) to raise with the user, never patched in the form |
| zod issues (`api.zod.ts`, `validateSearch`) | zod's own locale, switched by `createI18n`; add each language to `ZOD_MESSAGES` |
| Base UI `NumberField`, `Slider`, `Progress`, `Meter` | `locale={i18n.language}`, else they follow the browser |
| Base UI's own English labels (`Toast.Viewport`'s "Notifications", `NumberField`'s "Increase") | `aria-label={t("...")}` on the part; no gate sees them |
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
