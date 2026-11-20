---
name: tailwind-base-ui
description: "Use when using or wrapping a Base UI (@base-ui/react) button, dialog, menu, select or toast in src/shared/ui, editing src/styles.css or Tailwind CSS 4 (@theme, light-dark(), @custom-variant), adding a colour token or dark mode, or adding any package that renders UI (chart, date picker, virtual list, icons, font) under a strict CSP; on style-src-elem, 'Applying inline style violates', noTailwindRestyledComponents, bg-[--var], tailwind.config.js. Not for visual direction (frontend-design), motion (animate), component API design (vercel-composition-patterns), or biome.json (frontend-tooling)."
metadata:
  version: "0.1.0"
---

# Tailwind 4 and Base UI

Assumes Tailwind CSS 4.3, `@base-ui/react` 1.9, Biome 2.6, React 19.3.

Names such as `apiFetch`, `ApiError`, `createAppRouter`, `renderRoute` and the `pnpm` scripts come from the frontend-scaffolding template. In a project built differently, use its own modules, helpers and scripts, and say so when it has no equivalent instead of adding one unasked. Apply these rules to new code; when editing existing code, keep its public contract, structure and tuned configuration and report differences instead of rewriting, unless asked. The project's own plan and architecture documents win over this skill. If `pnpm-lock.yaml` pins another major version than the line above, follow the project and say which rules may not apply.

Visual direction, token values and type choices belong to `frontend-design`; polish and motion belong to `emil-design-eng` and `animate`; component API design belongs to `vercel-composition-patterns`; accessibility and UI review belong to `web-design-guidelines`; native-element alternatives (`<dialog>`, `popover`) belong to `modern-web-guidance`, and the wrapper wins as `frontend-code-style`'s precedence table says. If one of those skills is available, load it before making that kind of decision. If it is not installed, continue with this skill alone: do not ask the user to install it and do not reconstruct its rules.

## Important

- Colours are role tokens only: a `light-dark()` pair on `:root`, exposed in `@theme inline`; `--color-*: initial` makes `bg-red-500` generate nothing. A missing role is a new token, never a palette class, hex value or `dark:` colour pair.
- Nothing may create a `<style>` element or inline script at runtime (CSP `style-src 'self'`, `script-src 'self'`): CSS-in-JS and CSS-injecting libraries are out; `style={{}}` and other CSSOM writes pass.
- A wrapper's looks come from a `variant` prop backed by a record of complete class strings; its `className` is layout only (margin, width, placement), joined with `cx()`. No class-merging or variant library.
- Write every class name whole: Tailwind reads source text, so `` `text-${tone}` `` generates nothing. A CSS variable is `bg-(--x)`; `bg-[--x]` compiles to invalid CSS, unreported inside `src/shared/ui`.
- Style Base UI state with its data attributes as variants (`data-open:`, `data-disabled:`, `data-highlighted:`), and enter and exit with CSS transitions on `data-starting-style:` / `data-ending-style:`; never a `className` function.

## References

- `references/wrappers.md` — Base UI's data attributes and CSS variables; complete `Button` with a `danger` variant, `ButtonLink`, `Dialog` and when to use `AlertDialog`, `Menu`, `SelectField`, the tokens each needs, a feature composing them, toasts, fields. Open before changing anything in `src/shared/ui`.
- `references/tokens-and-dark-mode.md` — the scaffold's `styles.css`, adding a token or a scale, what the build does to `light-dark()`, v4 variant output, the user-selectable theme add-on. Open when touching `styles.css` or theming.
- `references/csp-and-library-picks.md` — what the CSP blocks, measured library results, proving a new dependency, virtua, lucide-react, fonts, TanStack Table 9. Open before adding any UI package.
- `references/prior-versions.md` — the full Tailwind 3 to 4, Radix to Base UI and library correction tables. Open when an example or an old file disagrees with this skill.

## The entry file

`src/styles.css` starts with `@import "tailwindcss";` and uses only these at-rules:

| At-rule | For |
| --- | --- |
| `@theme` | `--color-*: initial`, then scales as literals: `--radius-control: 0.375rem` gives `rounded-control` |
| `@theme inline` | every theme variable whose value is `var(--x)`: the role colours |
| `@layer base` | element defaults in plain CSS |
| `@custom-variant` | `dark`, only with the user-selectable theme add-on |
| `@utility` | a custom utility (not `@layer utilities`) |
| `@source` | code outside the app root: a workspace UI package |
| `@import` | a package stylesheet such as `@fontsource-variable/inter` |

Never `tailwind.config.*`, `@config`, `@tailwind`, `@apply`, a PostCSS config or autoprefixer.

The scaffold's roles: `bg`, `surface`, `fg`, `muted`, `line` (dividers), `control` (a control's outline: 3:1 against `bg` and `surface`, WCAG 1.4.11), `accent`, `accent-fg`, `danger`; `scrim` and `danger-fg` come with the wrappers that need them. A new one is two lines, `--scrim: light-dark(<light>, <dark>);` in `:root` and `--color-scrim: var(--scrim);` in `@theme inline`, named by role, never hue. `@theme inline` matters: plain `@theme` resolves `var()` at `:root`, so a subtree override stops working.

Arbitrary values (`w-[min(28rem,calc(100vw-2rem))]`) belong in `src/shared/ui` only; elsewhere add a scale or a wrapper (Biome enforces it).

Declare `color-scheme` on `:root` selectors only: the build resolves the `light-dark()` tokens once on `:root`, so on an inner element it flips nothing after `pnpm build`. A surface dark in both schemes (a code block) gets its own role tokens.

## Dark mode

The baseline follows the OS with no script: `color-scheme: light dark` on `:root` and the `color-scheme` meta in `index.html` flip the tokens. No `data-theme` and no toggle.

A user-selectable theme is the add-on in the tokens reference: an external blocking `public/theme.js` in `<head>`, because the CSP blocks inline script and a theme applied from React paints the wrong scheme first. The stored value is untrusted: only `"light"` and `"dark"` reach the DOM.

## Wrappers in `src/shared/ui`

The contract the scaffold's `button.tsx`, `text-field.tsx` and `toast.tsx` follow:

- One Base UI component per file, which may export its parts (`Dialog`, `DialogTrigger`, `DialogPopup`), imported by subpath (`@base-ui/react/dialog`).
- Props from the part's namespace, `extends Omit<BaseButton.Props, "className">`; each added optional prop is `?: T | undefined`, or `exactOptionalPropertyTypes` fails callers with TS2375.
- `ref` travels in `...props`; no `forwardRef`, no `memo`.
- `const variants = { primary: "…", secondary: "…" } as const` at module scope, keyed by `variant`; `Button` defaults to `secondary`.
- `className={cx(base, variants[variant], className)}`, `className` documented as layout only.

`<DialogTrigger render={<Button />}>` puts a trigger on a kit button. A link that looks like a button is `ButtonLink` from the wrappers reference (the scaffold does not ship it), built on `useRender` + `mergeProps` and used as `<ButtonLink render={<Link to="/users/new" />}>`; Base UI forbids rendering a link through `Button`. In a menu, `Menu.LinkItem render={<Link />}`.

Popups portal to the end of `<body>`, after `#root`, which has `isolation: isolate`: app code needs no `z-index` above `z-10`, and the toast viewport (`z-50`) is the only fixed layer. `<CSPProvider disableStyleElements>` in the router's `Wrap` (`src/app/router.tsx`) stops Base UI's `<style>` tags (Select, ScrollArea); a second React root needs its own.

`createAppRouter` creates one toast manager per router, for `ToastProvider` and the query-error notices. A component raises a toast with `Toast.useToastManager().add({ title })`; never a second, module-level manager next to the router's, whose toasts never render.

Placement of feature components is `frontend-project-structure`'s; wiring a field to form state is `frontend-forms`'s.

## Class composition and lint

`cx` (`src/shared/ui/cx.ts`) joins complete strings and drops `false` and `undefined`; Biome's `tailwind.mergeFunctions` lists it, so its arguments are linted. Class order is not enforced; leave it. `biome.json` is `frontend-tooling`'s.

| Rule | Message | Fix |
| --- | --- | --- |
| `noTailwindRawColors` | This Tailwind CSS class uses a raw palette color. | a role token |
| `noTailwindRestyledComponents` | This Tailwind utility restyles a component. | a `variant` (rule off in `src/shared/ui`) |
| `useTailwindStaticClassStrings` | This class string is constructed dynamically. | complete strings; `cx(a, b)` |
| `noTailwindArbitraryValue` | Found an arbitrary value in a Tailwind CSS class. | a token or scale (off in `src/shared/ui`) |

`pnpm format` applies safe fixes: `noTailwindLegacyUtilities`, `useTailwindVariablesShorthand`. The `useTailwindShorthandClasses` fix is unsafe: write `size-4` by hand or run `pnpm exec biome check --write --unsafe <file>`.

Nothing reports `bg-opacity-50`, `outline-none`, or a resized `rounded`/`shadow`.

## Runtime styles and UI dependencies

| Need | Pick |
| --- | --- |
| toasts | Base UI Toast, in the scaffold |
| virtualized list | `virtua` `VList`; size its parent, since `VList` sets inline `height: 100%` |
| icons | `lucide-react` named imports, `aria-hidden`, `size-4` |
| custom font | `@fontsource-variable/<family>` in `styles.css`, `--font-sans`, the `preloadFont` Vite plugin from the CSP reference |
| data table | TanStack Table 9 (`useTable`, `tableFeatures`) |

Before adding any package that renders UI or touches styles, an animation library included, unless the CSP reference already measured it (the picks above), run the dependency proof in the CSP reference: a source grep, because constructed stylesheets apply without any CSP report, then an E2E page, because jsdom and `pnpm dev` enforce no CSP. A package that fails is dropped, never given `'unsafe-inline'` or a nonce. Headers are `frontend-deploy`'s; that test is `frontend-testing`'s.

## Workspace UI package

A kit package's CSS carries the tokens, `@theme` blocks, scrollbar rules and `@source "./";`; without `@source` the app emits none of the kit's classes. Packaging is `frontend-shared-packages`'s.

## Prior-version corrections

| Older examples write | Correct now |
| --- | --- |
| `tailwind.config.js`, `@tailwind base;` | `@import "tailwindcss";`, `@theme` |
| `bg-[--brand]` | `bg-(--brand)` |
| `outline-none`, `shadow`, `rounded` | `outline-hidden`, `shadow-sm`, `rounded-sm` |
| `@base-ui-components/react`, Radix `asChild` | `@base-ui/react/<part>`, `render={<El />}` |
| `data-[state=open]:` | `data-open:` |
| `cn()` from `clsx` + `tailwind-merge`, `cva()` | `cx()`, a variant record |

## Red Flags — STOP

| About to… | Do this instead |
| --- | --- |
| `` className={`bg-${tone}`} `` or `` `${base} ${className}` `` | a record of complete strings; `cx(base, className)` |
| `<Button className="rounded-none bg-danger">` in a feature | add a `variant` to the wrapper |
| `<Button render={<Link to="/x" />}>` | `<ButtonLink render={<Link to="/x" />}>` |
| `styled-components`, `@emotion/react`, `<svg><style>` | Tailwind classes or a static stylesheet |
| `AnimatePresence mode="popLayout"` from `framer-motion` | CSS transitions on `data-starting-style:` |
| `useVirtualizer` from `@tanstack/react-virtual` | virtua `VList`: the React Compiler silently skips a component calling that hook |
| an inline `<script>` or `next-themes` against a theme flash | `public/theme.js` from the add-on |
| `dataset.theme = localStorage.getItem("theme")` | accept only `"light"` and `"dark"` |
