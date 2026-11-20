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
8. `i18next-cli status` says `ru: 94% (16/17 keys) — 1 absent` in the pre-commit hook. What now?

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
- `main.tsx` rendering after the init promise, with a rejection handler that reports the error and renders a static message instead of a blank page.
- A stored language validated against the supported list before use.
- `i18next-cli extract --ci`, `status` and `lint` in a script that `pnpm check` runs, plus `"@swc/core": false` under `allowBuilds`.
- `renderRoute` building its instance from the app's JSON files.
- `i18next-cli lint --update-baseline` run once for the English text the app already has.
- `ENTRY_BUDGET_BYTES` raised by the growth `pnpm build` reports (about 20 KB gzip for i18next with react-i18next on the scaffold), with i18next and react-i18next named as the cause.

**Must not produce**:

- `i18next-http-backend` or message files in `public/locales`.
- `i18next-browser-languagedetector` added as a dependency.
- Init options without `fallbackLng`.
- `import i18n from "i18next"` inside a feature or shared component.

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

### Eval 3 - server errors and validation in Russian

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. Russian users see English errors on the create user form: zod's messages and the server's error text. Make both follow the UI language.

**Fixture**: scaffold

**Must produce**:

- A mapping from `ApiError` status or `code` to translation keys, each a literal `t("...")` call.
- zod's locale switched with the language (`z.config(ru())` or equivalent from `zod/locales`) without dropping `jitless`.
- Copy for unknown errors from a key, with the request id as an interpolated variable when shown.
- The server's `fieldErrors` sentences shown as sent, with translating them named as a backend contract change (a stable code per field, or messages localised from `Accept-Language`) for the user to raise.

**Must not produce**:

- `error.message` from an `ApiError` rendered or passed to `t`.
- A key built from the error code at runtime (`` t(`errors.${error.code}`) ``).
- `error.code` compared with a short name such as `"email_taken"` instead of a status or a full problem `type` URI.
- Hand-edited messages in the generated `src/api/generated/api.zod.ts`.
- Server `fieldErrors` sentences replaced by client keys or translated in the form.

### Eval 4 - a failing status gate

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. `pnpm check` fails at `i18next-cli status`: `ru: [...] 94% (16/17 keys) — 1 absent`. I just added a button label. Make it pass.

**Fixture**: scaffold

**Must produce**:

- The Russian text for the new key written into `src/app/locales/ru/<namespace>.json`.
- `pnpm i18n:extract` (or `i18next-cli extract` plus `types`) run so the files and `resources.d.ts` match the code.

**Must not produce**:

- The English text copied into the Russian file.
- `status.ignoreKeys`, removing `status` from the check script, or `lint --update-baseline` to pass.
- A default value in the `t()` call instead of the JSON text.

### Probe 1 - concatenated translation

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. Show "Welcome back, Ada" in the header with the user's name, in English and Russian.

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:(?:[{=(]|return|=>)\s*t\([^)]*\)\s*\+)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\+\s*t\()|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\{t\([^)]*\)\}\s*[:,]?\s*\{\s*\w+(\.\w+)*\s*\})`

**Right answer**: `\{\{\s*\w+\s*\}\}`

### Probe 2 - plural chosen in code

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. Show "1 user" or "N users" above the users table.

**Fixture**: scaffold

**Wrong answer**: `(?:[{=(:,]|return|=>)\s*[\w.]*(?:count|total|length)\s*===\s*1\s*\?`

**Right answer**: `_one`

### Probe 3 - key built at runtime

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. Show each user's status (`active`, `suspended`, `invited`) translated in the users table.

**Fixture**: scaffold

**Wrong answer**: `(?:\{|=|return|=>)\s*t\(\s*\x60[^\x60]*\$\{`

### Probe 4 - void element name in Trans

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. Render "Need help? Read the guide." where "Read the guide" links to /help, translated.

**Fixture**: scaffold

**Wrong answer**: `<Trans[^>]*\bcomponents=\{\{\s*(?:link|br|img|input|hr|meta|area|source)\s*:`

### Probe 5 - fallbackLng left out

**Prompt**: Write the i18next init options for an app in English and Russian.

**Fixture**: scaffold

**Wrong answer**: `^(?![\s\S]*fallbackLng)[\s\S]*\.init\(`

**Right answer**: `fallbackLng:\s*(?:["']en["']|[A-Z_]+\b)`

### Probe 6 - mocking react-i18next

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. Write a test for the users page heading in Russian.

**Fixture**: scaffold

**Wrong answer**: `(?:^|\n)\s*vi\.mock\(\s*["\x27]react-i18next["\x27]|lng:\s*["\x27]cimode`

### Probe 7 - rendering the server message

**Prompt**: Assume the i18next add-on from our setup is installed: `createI18n` in src/app, messages in src/app/locales/<language>/<namespace>.json. When creating a user fails, show the server's reason translated at the top of the form.

**Fixture**: scaffold

**Wrong answer**: `(?:>|=)\s*\{\s*error\.message\s*\}|(?:[{=(,]|return|=>)\s*t\(\s*(?:error\.message|\x60[^\x60]*\$\{\s*error\.)`

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

**Wrong answer**: `(?:[{=(,]|return|=>)\s*t\(\s*["\x27][\w.:-]+["\x27]\s*,\s*["\x27]|\bt\([^)]*defaultValue\s*:`
