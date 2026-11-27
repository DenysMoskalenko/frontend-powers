---
name: tailwind-base-ui
description: "Use when using or wrapping a Base UI (@base-ui/react) button, dialog, menu, select or toast in src/shared/ui, editing src/styles.css or Tailwind CSS 4 (@theme, light-dark(), @container, breakpoints), adding a colour token or dark mode, or adding any package that renders UI (chart, date picker, virtual list, icons, font) under a strict CSP; on style-src-elem, 'Applying inline style violates', noTailwindRestyledComponents, bg-[--var], tailwind.config.js. Not for visual direction (frontend-design), motion (animate), component API design (vercel-composition-patterns), or biome.json (frontend-tooling)."
metadata:
  version: "0.1.1"
---

# Tailwind 4 and Base UI

Assumes Tailwind CSS 4.3, `@base-ui/react` 1.9, Biome 2.6, React 19.3.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, read its own modules, helpers, scripts and libraries and use those (a helper with the same name may have another shape), and say so when it has no equivalent instead of adding one, or a package this skill assumes, unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration, even where a table below calls the pattern older, and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If the project pins another major of a package than the line above, or an older minor, check the API or configuration key in the installed package before using it, follow the project and say which rules do not apply.

Visual direction, token values and type choices belong to `frontend-design`; polish and motion belong to `emil-design-eng` and `animate`; component API design belongs to `vercel-composition-patterns`; accessibility and UI review belong to `web-design-guidelines`; touch targets, hover-only controls and safe areas belong to `mobile-native`; native-element alternatives (`<dialog>`, `popover`) belong to `modern-web-guidance`, and the wrapper wins as `frontend-code-style`'s precedence table says. If one of those skills is available, load it before making that kind of decision. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules.

## Important

- Colours are role tokens only: a `light-dark()` pair on `:root`, exposed in `@theme inline`; `--color-*: initial` makes `bg-red-500` generate nothing. A missing role is a new token, never a palette class, hex value or `dark:` colour pair.
- Nothing may create a `<style>` element or inline script at runtime (CSP `style-src 'self'`, `script-src 'self'`): CSS-in-JS and CSS-injecting libraries are out; `style={{}}` and other CSSOM writes pass.
- A wrapper's looks come from a `variant` prop backed by a record of complete class strings; its `className` is layout only (margin, width, placement), joined with `cx()`. No class-merging or variant library.
- Style Base UI state with its data attributes as variants (`data-open:`, `data-disabled:`, `data-highlighted:`), and enter and exit with CSS transitions on `data-starting-style:` / `data-ending-style:`; never a `className` function.
- Mobile-first, and the page never scrolls sideways: a `src/shared/ui` component responds to its container (`@container`), so it fits a column, a dialog or a sidebar; a route layout responds to the viewport.

## References

- `references/wrappers.md` — data attributes and CSS variables; complete `Button` (`danger` variant), `ButtonLink`, `Dialog` (`size`, `AlertDialog`), `Menu`, `SelectField`, a container-responsive component, a feature composing them, toast options, which part gets `data-testid`. Open before changing `src/shared/ui`.
- `references/tokens-and-dark-mode.md` — the scaffold's `styles.css`, adding a token or a scale, a surface dark in both schemes, v4 variant output, the user-selectable theme add-on. Open when touching `styles.css` or theming.
- `references/csp-and-library-picks.md` — what the CSP blocks, measured libraries (component libraries and Sass included), proving a new dependency, the narrowest exception, virtua, lucide-react, fonts, TanStack Table 9. Open before adding any UI package.
- `references/prior-versions.md` — the full Tailwind 3 to 4, Radix to Base UI and library correction tables, Biome's messages and fixes. Open when an example or an old file disagrees with this skill.

## The entry file

`src/styles.css` starts with `@import "tailwindcss";` and uses only `@theme` (scales as literals: `--radius-control: 0.375rem` gives `rounded-control`), `@theme inline` (values that are `var(--x)`: the role colours), `@layer base`, `@custom-variant` (the theme add-on only), `@utility`, `@source` and `@import`. Never `tailwind.config.*`, `@config`, `@tailwind`, `@apply`, a PostCSS config or autoprefixer.

The scaffold's roles: `bg`, `surface`, `fg`, `muted`, `line` (dividers), `control` (a control's outline, 3:1 against `bg` and `surface`), `accent`, `accent-fg`, `danger`. A new role is `--x: light-dark(<light>, <dark>);` in `:root` plus `--color-x: var(--x);` in `@theme inline`, named by role, never hue. A surface dark in both schemes (a code block) takes `scheme-dark`, which flips every token inside it.

Dark mode follows the OS with no script (`color-scheme: light dark` on `:root`). A user-selectable theme is the tokens reference's add-on: an external blocking `public/theme.js`, because the CSP blocks inline script and React would paint the wrong scheme first.

## Responsive layout

- Tailwind's default breakpoints (`sm` 40rem to `2xl` 96rem); another set is `--breakpoint-*` in `@theme` (`--breakpoint-xs: 30rem`; `--breakpoint-2xl: initial` removes one), never `min-[30rem]:`.
- Unprefixed classes are the narrowest layout; prefixes widen it: `flex-col md:flex-row`.
- A `src/shared/ui` component puts `@container` on its outer element and uses `@sm:` to `@xl:`; route layout uses the viewport's `md:`.
- A wide table scrolls inside its own `overflow-x-auto` element, as the scaffold's `UserTable` does.
- Full heights are `min-h-dvh` or `h-dvh`, never `h-screen`.
- A desktop-only app says so in its architecture document, with its minimum width.

No lint rule checks this; sideways scroll is caught only by the end-to-end phone project (`frontend-testing`).

## Wrappers in `src/shared/ui`

The contract the scaffold's `button.tsx`, `text-field.tsx` and `toast.tsx` follow:

- One Base UI component per file, which may export its parts (`DialogTrigger`, `DialogPopup`), imported by subpath (`@base-ui/react/dialog`).
- Props from the part's namespace, `extends Omit<BaseButton.Props, "className">`; each added optional prop is `?: T | undefined`, or `exactOptionalPropertyTypes` fails callers with TS2375.
- `ref` travels in `...props`; no `forwardRef`, no `memo`.
- `const variants = { primary: cx("…") } as const` at module scope, applied as `className={cx(base, variants[variant], className)}`; `Button` defaults to `secondary`.
- A property the base string sets is never accepted through `className` but exposed as a variant (`DialogPopup`'s `size`): Tailwind orders the rules itself, so the caller's class can silently lose. An existing `className` prop stays when the variant is added.
- `data-testid` reaches the element a user acts on; the wrappers reference says which part for each wrapper. Naming it is `frontend-testing`'s.

A button that opens a dialog, menu or popover is that component's trigger part on a kit button, `<AlertDialogTrigger render={<Button variant="danger" />}>`, never a `Button` that sets `open` state: Safari does not focus a clicked button, so closing would return focus to the page. State drives `open` only when no button opens it (a navigation blocker). A link that looks like a button is `ButtonLink`; in a menu, `MenuLinkItem`.

Popups portal after `#root`, which has `isolation: isolate`, so app code needs no `z-index` above `z-10`; the fixed layers are the kit's (dialog backdrop and popup, toast viewport, navigation bar). `<CSPProvider disableStyleElements>` in the router's `Wrap` stops Base UI's `<style>` tags; a second React root needs its own.

A component raises a toast with `Toast.useToastManager().add(...)`, never through a second, module-level manager, whose toasts never render. A failure toast is `priority: "high", timeout: 0` with its reason as `id`; a success notice keeps the defaults (5 s, polite).

Placement of feature components is `frontend-project-structure`'s; wiring a field to form state is `frontend-forms`'s.

## Class composition and lint

`cx` (`src/shared/ui/cx.ts`) joins complete strings and drops `false` and `undefined`. The Tailwind rules read a class string only inside `className` or `cx()`, so every class string kept elsewhere (a `variants` or `sizes` record, a module constant) is wrapped in `cx()`, as `button.tsx` does. Class order is not enforced; leave it. `biome.json` is `frontend-tooling`'s.

| Rule | Catches | Fix |
| --- | --- | --- |
| `noTailwindRawColors` | `bg-red-500`, and `bg-black/50`, `text-white` (`allowBlackAndWhite: false`) | a role token |
| `noTailwindRestyledComponents` | a look class on a kit component outside `src/shared/ui` | a `variant` |
| `useTailwindStaticClassStrings` | a class built in a template literal | complete strings; `cx(a, b)` |
| `noTailwindArbitraryValue` | `w-[37rem]` outside `src/shared/ui` | a scale, or a wrapper that owns the value |

No lint catches a class whose token does not exist (`bg-primary` generates nothing and reports nothing), a class string in a variable or record outside `cx()`, or an arbitrary value inside `src/shared/ui`.

## Runtime styles and UI dependencies

The picks measured under the CSP, each with its recipe in the CSP reference: Base UI Toast (in the scaffold), virtua `VList` for a long list (size its parent: `VList` sets inline `height: 100%`), `lucide-react` named imports for icons, `@fontsource-variable/<family>` for a font, TanStack Table 9 (`useTable`, `tableFeatures`) for a data table.

Before adding any other package that renders UI or touches styles, run the CSP reference's dependency proof: a source grep (constructed stylesheets apply without a CSP report), then an end-to-end page (jsdom and `pnpm dev` enforce no CSP). A package that fails is dropped; when the app cannot do without it, ask the user and offer the narrowest exception from that reference. The header is `frontend-deploy`'s.

A UI kit shared by several apps, its CSS and `@source` included, is `frontend-shared-packages`'s.

## Prior-version corrections

| Older examples write | Correct now |
| --- | --- |
| `tailwind.config.js`, `@tailwind base;` | `@import "tailwindcss";`, `@theme` |
| `bg-[--brand]` | `bg-(--brand)`: the bracket form compiles to invalid CSS, unreported inside `src/shared/ui` |
| `h-screen`, `min-h-screen` | `h-dvh`, `min-h-dvh` |
| `@base-ui-components/react`, Radix `asChild` | `@base-ui/react/<part>`, `render={<El />}` |
| `data-[state=open]:` | `data-open:` |
| `cn()` from `clsx` + `tailwind-merge`, `cva()` | `cx()`, a variant record |

## Red Flags — STOP

| About to… | Do this instead |
| --- | --- |
| `` className={`bg-${tone}`} `` or `` `${base} ${className}` `` | a record of complete strings; `cx(base, className)`: a built name generates no CSS |
| `<Button className="rounded-none bg-danger">` in a feature | add a `variant` to the wrapper: `noTailwindRestyledComponents` fails it |
| `const tones = { ok: "bg-…" }` without `cx()` | `cx("bg-…")` per value: lint does not read a bare string |
| `<Button render={<Link to="/x" />}>` | `<ButtonLink render={<Link to="/x" />}>`: Base UI forbids it |
| `toastManager.add({ title })` for a failure | `priority: "high", timeout: 0` and the reason as `id`: a polite 5 s toast is missed |
| `useVirtualizer` from `@tanstack/react-virtual` | virtua `VList`: the React Compiler silently skips a component calling that hook |
| an inline `<script>` or `next-themes` against a theme flash | `public/theme.js` from the add-on: the CSP blocks inline script |
| `dataset.theme = localStorage.getItem("theme")` | accept only `"light"` and `"dark"`: storage is untrusted input |
