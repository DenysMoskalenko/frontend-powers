# tailwind-base-ui

### Triggering

**Should load**

1. "add a confirm dialog to src/shared/ui using base ui, styled like the rest of the kit"
2. "console says `Applying inline style violates the following Content Security Policy directive 'style-src 'self''` after I added a toast library"
3. "biome fails with `noTailwindRestyledComponents` on `<Button className=\"rounded-none bg-danger\">` in the users page, how do I fix it properly"
4. "we need a success/warning colour for status badges, where do I add it so it works in dark mode too"
5. "users want a light/dark/system switch in the header without a flash on load"
6. "`bg-[--anchor-width]` does nothing on my select popup, why"
7. "which virtualized list package should I use for a 10k-row audit log, and is lucide ok for icons"
8. "port this tailwind.config.js with theme.extend colors to our setup"
9. "the users table makes the whole page scroll sideways on my phone, fix the layout"
10. "export failures vanish after a few seconds and the screen reader never reads them"

**Should not load**

1. "pick a palette and a typeface for the admin app, something less generic" -> `frontend-design`
2. "make the menu open animation feel snappier, maybe a spring" -> `animate`
3. "turn off noTailwindArbitraryValue for the e2e folder in biome.json" -> `frontend-tooling`
4. "add our font CDN to the Content-Security-Policy header" -> `frontend-deploy`
5. "show the 422 field errors from the API under the email TextField" -> `frontend-forms`
6. "should UserCard live in features/users or in shared/ui?" -> `frontend-project-structure`
7. "write a Playwright test that the toast shows up after a failed refresh" -> `frontend-testing`
8. "design the props API for a compound Tabs component with a controlled value" -> `vercel-composition-patterns`
9. "share our src/shared/ui kit between two apps in a pnpm workspace" -> `frontend-shared-packages`
10. "add an end-to-end check that no page scrolls sideways on a phone" -> `frontend-testing`
11. "the icon buttons are too small to tap on mobile and the footer hides under the home bar" -> `mobile-native`

### Eval 1 - confirm dialog wrapper

**Prompt**: "Add a reusable confirm dialog to the UI kit and use it on the user details page: a Delete button opens it, it has a title, a description, Cancel and Delete buttons. The API has no delete endpoint yet, so Delete only closes the dialog for now."

**Fixture**: scaffold

**Must produce**:

- a new wrapper in `src/shared/ui/` (`alert-dialog.tsx`, `confirm-dialog.tsx` or `dialog.tsx`) importing from `@base-ui/react/alert-dialog` (preferred for a destructive confirm) or `@base-ui/react/dialog`, with `Portal`, `Backdrop` and `Popup`
- enter and exit transitions written with `data-starting-style:` and `data-ending-style:` classes plus a `motion-reduce:` class
- the trigger rendered as a kit button through `render={<Button ... />}`
- optional wrapper props typed `| undefined`, and `className` (if accepted) passed through `cx` as layout only
- the backdrop colour from a role token, adding one to `:root` with `light-dark()` and to `@theme inline` when none fits
- the Delete button's look chosen by a `variant` (adding one to `button.tsx` if needed), not by restyling classes at the call site

**Must not produce**:

- `forwardRef`
- the dialog opened by a plain `Button` whose `onClick` sets `open` state instead of its trigger part
- a palette class such as `bg-black/50` or `bg-red-600`
- `data-[state=open]` or any Radix import
- a `z-index` above `z-50`, such as `z-[9999]`
- a `className` function `(state) =>` on a Base UI part
- a popup width taken from the caller's `className` while the wrapper's base string also sets one
- `framer-motion` or `motion` imports

### Eval 2 - user-selectable theme

**Prompt**: "Add a Light / Dark / System theme switch to the header. The choice must survive reloads and there must be no flash of the wrong theme."

**Fixture**: scaffold

**Must produce**:

- a `public/theme.js` file loaded by `<script src="/theme.js">` in the `<head>` of `index.html`, not deferred and not a module
- the stored value accepted only when it is exactly `"light"` or `"dark"`, with `localStorage` access in `try`/`catch`
- `:root[data-theme="dark"] { color-scheme: dark }` and the light counterpart in `src/styles.css`
- a `@custom-variant dark` covering both an explicit dark choice and no choice with a dark OS, if `dark:` is used
- a hook built on `useSyncExternalStore` (or equivalent) that writes `data-theme` and storage, with "system" removing the attribute

**Must not produce**:

- an inline `<script>` in `index.html` or `dangerouslySetInnerHTML`
- `next-themes`
- applying the stored theme in a `useEffect` on mount as the only mechanism
- `dark:` colour classes added across components
- `darkMode: "class"` or a `tailwind.config.js`

### Eval 3 - status badge with colour tones

**Prompt**: "Add a StatusBadge that shows a user's status (active, invited, suspended) in green, amber and red."

**Fixture**: scaffold

**Must produce**:

- new role tokens (such as `success`, `warning`) as `light-dark()` pairs in `:root` and exposed in `@theme inline`, reusing `danger`
- a `const` record mapping each status to a complete class string, each value wrapped in `cx()` so the lint reads it
- class strings joined with `cx` where a base and a tone are combined

**Must not produce**:

- palette classes such as `bg-green-100` or `text-amber-700`
- a template literal building a class name, such as `` `bg-${tone}` ``
- `clsx`, `tailwind-merge`, `class-variance-authority` or `tailwind-variants`
- `dark:` colour pairs

### Eval 4 - long list and a completion toast

**Prompt**: "The audit log page will show up to 10,000 events. Make the list fast, and show a toast when the CSV export finishes."

**Fixture**: scaffold

**Must produce**:

- `virtua` (`VList` or `Virtualizer`) for the list
- the height set on the `VList`'s parent element, not only on the `VList`
- the toast raised through `Toast.useToastManager()` from `@base-ui/react/toast`, rendered by the existing `ToastProvider`

**Must not produce**:

- `@tanstack/react-virtual` or `react-virtuoso`
- `sonner` or any other toast package
- a second `Toast.createToastManager()` at module scope
- `priority: "high"` or `timeout: 0` on the success toast

### Eval 5 - a kit component used in two widths

**Prompt**: "Add a UserSummary component to the UI kit that shows a user's name, email and creation date. It goes in the narrow sidebar of the users list and full width on the user details page, and must look right on a phone."

**Fixture**: scaffold

**Must produce**:

- `@container` on the component's outer element, with `@sm:`, `@md:` or another `@` variant changing the layout
- unprefixed classes giving the narrow, stacked layout, with variants widening it
- colours from role tokens

**Must not produce**:

- viewport breakpoints (`sm:`, `md:`, `lg:`) as the component's only responsive classes
- `h-screen`, `100vh` or an arbitrary breakpoint such as `min-[30rem]:`
- a fixed width wider than a phone (`w-[600px]`, `min-w-[40rem]`)

### Eval 6 - failure toast

**Prompt**: "When the CSV export request fails, tell the user with a toast that includes the request id."

**Fixture**: scaffold

**Must produce**:

- `Toast.useToastManager().add(...)` (or the router's manager) with `priority: "high"` and `timeout: 0`
- an `id` on the toast so repeated failures update one toast

**Must not produce**:

- `sonner` or another toast package
- a module-level `Toast.createToastManager()`
- a failure toast left at the 5 s default

### Probe 1 - palette colour

**Prompt**: "Add a red error banner above the create-user form when the server is down."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:class(?:Name)?=[^>]*?\b(?:bg|text|border|ring|fill|stroke)-(?:red|rose|orange|amber|yellow|green|emerald|blue|sky|gray|slate|zinc|neutral|stone|black|white)(?:-\d{2,3})?\b)`

**Right answer**: `\b(?:bg|text|border)-danger\b`

### Probe 2 - dynamic class name

**Prompt**: "Give the Button wrapper a `tone` prop (accent or danger) that sets the background colour."

**Fixture**: scaffold

**Wrong answer**: `(?<!\x60\s?)className=\{\s*\x60[^\x60]*\$\{|(?:=|\(|:|return)\s*\x60[^\x60]*\b(?:bg|text|border)-\$\{`

### Probe 3 - merge library

**Prompt**: "Create a Card wrapper in src/shared/ui with `elevated` and `outlined` variants, and let callers override its classes."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:from\s+["'](?:clsx|tailwind-merge|class-variance-authority|tailwind-variants)["'])`

### Probe 4 - link rendered as a button

**Prompt**: "Make the 'New user' link in the header look like a primary button."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:<Button\b[^>]*render=\{\s*<Link)`

### Probe 5 - CSS-in-JS

**Prompt**: "Style the Card wrapper with styled-components so callers can theme it."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:from\s+["'](?:styled-components|@emotion\/(?:react|styled))["'])`

### Probe 6 - inline theme script

**Prompt**: "Dark mode flashes light for a moment when a user who chose dark reloads the page. Fix the flash."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:<script(?![^>]*\bsrc=)[^>]*>[^<]*localStorage)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:dangerouslySetInnerHTML=\{)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:from\s+["\x27]next-themes["\x27])`

### Probe 7 - bracketed CSS variable

**Prompt**: "Make the menu popup at least as wide as its trigger using Base UI's --anchor-width variable."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:class(?:Name)?=[^>]*?\b[\w-]+-\[--[\w-]+\])`

**Right answer**: `\(--anchor-width\)`

### Probe 8 - Radix state attribute

**Prompt**: "Rotate the chevron in the menu trigger when the menu is open."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:data-\[state=(?:open|closed)\]:[a-z])`

### Probe 9 - toast library

**Prompt**: "Show a 'Saved' toast after the user is created."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:from\s+["']sonner["'])|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:<Toaster\b)`

### Probe 10 - JS config file

**Prompt**: "Add our brand purple as a colour we can use in classes."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:theme:\s*\{\s*extend)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:module\.exports\s*=)|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:@config\s+["\x27])|(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:-\[#[0-9a-fA-F]{3,8}\])`

### Probe 11 - width through className

**Prompt**: "Our `src/shared/ui/dialog.tsx` `DialogPopup` wraps the Base UI dialog popup; its base class string has `w-[min(28rem,calc(100vw-2rem))]` and it accepts a layout-only `className`. The export dialog on the reports page needs to be wider. Do it."

**Fixture**: empty

**Note**: The prompt's `DialogPopup` accepts `className`, so a right answer adds a `size` variant and keeps `className` in the props for layout: the scope paragraph keeps an existing component's public contract, and the reference wrapper without `className` is for new code.

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:<DialogPopup\b[^>]*\bclassName=["{\x60][^>]*\b(?:min-|max-)?w-)`

**Right answer**: `(?<![\w-])sizes?\s*[=:]`

### Probe 12 - polite failure toast

**Prompt**: "If saving the profile fails, show a toast saying the change was not saved."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\.add\(\{(?![^}]*\bpriority\b)[^}]*\}\))`

**Right answer**: `priority:\s*["\x27]high["\x27]`

### Probe 13 - bare class string in a record

**Prompt**: "Add a Badge wrapper to src/shared/ui with neutral, accent and danger tones."

**Fixture**: scaffold

**Wrong answer**: `(?<!(?:^|\n)[^\x60\n]*(?:\x60[^\x60\n]*\x60[^\x60\n]*)*\x60[^\x60\n]*)(?:\b(?:neutral|accent|danger)\s*:\s*["\x27][^"\x27\n]*\b(?:bg|text|border)-)`

**Right answer**: `\b(?:neutral|accent|danger)\s*:\s*cx\(`
