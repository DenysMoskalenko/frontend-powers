# frontend-i18n

### Triggering

**Should load**

1. Add Russian to the app: set up i18next so the UI follows the browser language and users can switch it in the header.
2. CI fails on `i18next-cli extract --ci` with "Some files were updated. This should not happen in CI mode." What do I commit?
3. tsc says `'pass these arguments as t() options': { page: string | number; }` on `t("list.pageOf")`. How do I fix it?
4. How do I show "1 user", "3 users" in English and the right forms in Russian with react-i18next?
5. Our `<Trans>` link renders an empty `<a>` with the text after it: `components={{ link: <a href="/help" /> }}`.
6. Since upgrading to i18next 27, a missing Russian translation shows the key instead of the English text.
7. The created dates in the users table stay English when the UI is switched to Russian.
8. `i18next-cli status` says `ru: 94% (16/17 keys) — 1 absent` in the release job. What now?
9. Add German as a third language.
10. Screen readers announce the toast region as "Notifications" in English although the UI is in Russian.

**Should not load**

1. Which `Intl.DateTimeFormat` options give a short weekday and a 24-hour clock? -> `frontend-code-style`
2. Format the API's decimal-string money amounts without losing digits. -> `frontend-code-style`
3. Map a 422 response's field errors onto the TanStack Form fields of the create user form. -> `frontend-forms`
4. The Russian route test for /users fails with "Requests without an MSW handler: GET https://api.test/users". -> `frontend-testing`
5. Add `pnpm i18n:extract --ci` as a step to the GitLab and GitHub CI jobs. -> `frontend-tooling`
6. Where should the useLanguage hook that two features use live, shared/hooks or a feature? -> `frontend-project-structure`
7. Review the wording and typography of the sign-up page. -> `web-design-guidelines`

### Eval 1 - adding the add-on

**Prompt**: The app needs English and Russian. Add i18next to this project: language from a saved choice or the browser, a switch that persists, and the checks in `pnpm check`.

**Fixture**: scaffold

**Must produce**:

- An instance made with `createInstance()` in a factory under `src/app/`, passed to `createAppRouter`, and mounted with `I18nextProvider` inside the router's `Wrap`.
- `fallbackLng` set to English (`"en"` or the `FALLBACK_LANGUAGE` constant) and `supportedLngs` in the init options.
- `interpolation: { escapeValue: false }`.
- Message files under `src/app/locales/<language>/<namespace>.json`, loaded through an `import.meta.glob` backend.
- `main.tsx` rendering after the init promise with `.then(render).catch(...)`, the handler reporting the error and rendering a static message instead of a blank page.
- A message file that fails to load made visible (`failedLoading`): the start fails, and a later switch is reported and keeps the current language.
- A stored language validated against the supported list before use.
- `i18next-cli extract --ci`, `types --ci` and `lint` in a script that `pnpm check` runs, `i18next-cli status` in a separate script for the release job, plus `"@swc/core": false` under `allowBuilds`.
- `renderRoute` building its instance from the app's JSON files.
- `i18next-cli lint --update-baseline` run once for the English text the app already has.
- `ENTRY_BUDGET_BYTES` raised by the growth `pnpm build` reports (about 20 KB gzip for i18next with react-i18next on the scaffold), with i18next and react-i18next named as the cause.

**Must not produce**:

- `i18next-http-backend` or message files in `public/locales`.
- `i18next-browser-languagedetector` added as a dependency.
- Init options without `fallbackLng`.
- `import i18n from "i18next"` inside a feature or shared component.
- `i18next-cli status` in `pnpm check` or the pre-commit hook.
- `ready.then(render, startFailed)` with the handler as the second argument of `then`.

### Eval 2 - translating the users list

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. Translate the users list page (namespace `users`): the heading, the "Page 2 of 3" pagination text, a "12 users" total and the created dates. Add a Russian test.

**Fixture**: scaffold

**Must produce**:

- `t("...", { page, pages })` with one key for the whole pagination sentence.
- `t("...", { count })` with `_one` and `_other` keys in English and `_one`, `_few`, `_many`, `_other` in Russian.
- Dates formatted with the active language passed in (`formatDateTime(iso, i18n.language)` or a message formatter).
- A route test through `renderRoute` in Russian asserting visible Russian text.

**Must not produce**:

- `"Page " + page` or a translated fragment joined to a value in JSX.
- `count === 1 ?` choosing the plural form.
- `vi.mock("react-i18next")` or a `t` that returns its key.
- `toLocaleDateString()` or `new Intl.DateTimeFormat("en")`.

### Eval 3 - field and server errors in Russian

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. Russian users see English errors on the create user form: zod's messages under the fields, the server's field errors and the form's failure message. Make them follow the UI language.

**Fixture**: scaffold

**Must produce**:

- The bound field in `src/shared/hooks/use-app-form.tsx` choosing a key per backend `code` and per schema issue kind (`code`, with `origin` or `format`, the bound as `count`), each a literal `t("...")` call, at render time.
- The error's own `message` shown for a code or issue kind with no key, with the backend's sentence named as what an untranslated code shows.
- `submitErrors` taking `t`, with `failed` and the request id as interpolated variables, one key per variant.
- Plural forms for the counted messages in Russian (`_one`, `_few`, `_many`, `_other`).

**Must not produce**:

- `error.message` from an `ApiError` rendered or passed to `t`.
- A key built from the error code at runtime (`` t(`errors.${error.code}`) ``).
- `z.config(ru())` or another `zod/locales` import as the text users read.
- Hand-edited messages in the generated `src/api/generated/api.zod.ts`.

### Eval 4 - a failing status gate

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. The release job fails at `pnpm i18n:status`: `ru: [...] 94% (16/17 keys) — 1 absent`. Someone added a button label last week. Make it pass.

**Fixture**: scaffold

**Must produce**:

- The Russian text for the new key written into `src/app/locales/ru/<namespace>.json`.
- `pnpm i18n:extract` (or `i18next-cli extract` plus `types`) run so the files and `resources.d.ts` match the code.

**Must not produce**:

- The English text copied into the Russian file.
- `status.ignoreKeys`, removing `status` from the release job, or `lint --update-baseline` to pass.
- A default value in the `t()` call instead of the JSON text.

### Eval 5 - adding a language

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json, English and Russian today. Add German.

**Fixture**: scaffold

**Must produce**:

- `"de"` added to `LANGUAGES` in `src/app/i18n.ts`.
- `"de"` added to `locales` in `i18next.config.ts`.
- `pnpm i18n:extract` run, and German text written for every key in `src/app/locales/de/`.

**Must not produce**:

- German files written by hand while `i18next.config.ts` still lists only `en` and `ru`.
- English text copied into the German files.
- `i18next-browser-languagedetector` or a second instance.

### Probe 1 - concatenated translation

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. Show "Welcome back, Ada" in the header with the user's name, in English and Russian.

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:[{=(]|return|=>)\s*t\([^)]*\)\s*\+)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\+\s*t\()|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\{t\([^)]*\)\}\s*[:,]?\s*\{\s*\w+(\.\w+)*\s*\})`

**Right answer**: `\{\{\s*\w+\s*\}\}`

### Probe 2 - plural chosen in code

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. Show "1 user" or "N users" above the users table.

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:[{=(:,]|return|=>)\s*[\w.]*(?:count|total|length)\s*===\s*1\s*\?)`

**Right answer**: `_one`

### Probe 3 - key built at runtime

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. Show each user's status (`active`, `suspended`, `invited`) translated in the users table.

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:\{|=|return|=>)\s*t\(\s*\x60[^\x60]*\$\{)`

### Probe 4 - void element name in Trans

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. Render "Need help? Read the guide." where "Read the guide" links to /help, translated.

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:<Trans[^>]*\bcomponents=\{\{\s*(?:link|br|img|input|hr|meta|area|source)\s*:)`

### Probe 5 - fallbackLng left out

**Prompt**: Write the i18next init options for an app in English and Russian.

**Fixture**: scaffold

**Wrong answer**: `^(?![\s\S]*(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)fallbackLng)[\s\S]*?(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)\.init\(`

**Right answer**: `fallbackLng:\s*(?:["']en["']|[A-Z_]+\b)`

### Probe 6 - mocking react-i18next

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. Write a test for the users page heading in Russian.

**Fixture**: scaffold

**Wrong answer**: `(?:^|\n)\s*vi\.mock\(\s*["\x27]react-i18next["\x27]|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:lng:\s*["\x27]cimode)`

### Probe 7 - rendering the server message

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. When creating a user fails, show the server's reason translated at the top of the form.

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:>|=)\s*\{\s*error\.message\s*\})|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:[{=(,]|return|=>)\s*t\(\s*(?:error\.message|\x60[^\x60]*\$\{\s*error\.))`

### Probe 8 - HTTP backend from public/

**Prompt**: Set up i18next in this app so each language's messages load only when needed.

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:from\s+["\x27]i18next-http-backend["\x27])|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:pnpm add[^\n]*i18next-http-backend)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:loadPath\s*:\s*["\x27\x60]\/locales)`

**Right answer**: `import\.meta\.glob`

### Probe 9 - locale-less date formatting

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. Languages: English and Russian. Show the user's creation date on the details page in the user's language.

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:toLocale(?:Date|Time)?String\(\s*(?:\)|undefined\b|\{))|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:Intl\.DateTimeFormat\(\s*(?:["\x27]en|undefined\b|\)))|(?:^|\n)(?!-)[^\n]*formatDateTime\(\s*[\w.]+\s*\)`

### Probe 10 - default text in t()

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. Keys are typed. Add a "Delete user" button label to the user details page.

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:[{=(,]|return|=>)\s*t\(\s*["\x27][\w.:-]+["\x27]\s*,\s*["\x27])|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\bt\([^)]*defaultValue\s*:)`

### Probe 11 - nested $t() with options

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. The welcome line "Welcome back, Ada" should reuse the greeting kept under `common:greeting` ("Welcome back, {{name}}") instead of repeating it in the users namespace. Write the messages and the call.

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)\$t\([^)\n]*,\s*\{`

**Right answer**: `t\(\s*["\x27](?:common:)?greeting["\x27]\s*,\s*\{`

### Probe 12 - start-up handler as the second argument of then

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app returns `{ i18n, ready }`. Write `src/main.tsx` so the app renders after the messages load and shows a message instead of a blank page when the start fails.

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)\bready\.then\(\s*render\s*,`

**Right answer**: `\.then\(\s*render\s*\)\s*\.catch\(`

### Probe 13 - status in the commit gate

**Prompt**: Assume the i18next add-on from our setup is installed with `i18next.config.ts`. Add the i18next-cli checks to the `package.json` scripts that `pnpm check` and the pre-commit hook run.

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)"(?:i18n:)?check"\s*:\s*"[^"\n]*i18next-cli status`

### Probe 14 - zod's locale as user text

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. The create user form shows zod's English messages under its fields to Russian users. Make them Russian.

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:from\s+["\x27]zod/locales["\x27]|z\.config\(\s*(?:z\.locales\.)?ru\(\))`
