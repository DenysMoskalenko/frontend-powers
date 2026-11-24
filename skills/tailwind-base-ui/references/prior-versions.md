# Prior-version corrections: Tailwind 3 to 4, Radix and older Base UI

## Contents

- Tailwind configuration and at-rules
- Tailwind utilities and variants
- Base UI and React
- Libraries and lint, and what Biome misses

Each Tailwind row was compiled with Tailwind 4.3. "Still compiles" means the old form builds without
an error, which is why a wrong habit survives review.

## Tailwind configuration and at-rules (Prior-version)

| Older examples write | Correct now |
| --- | --- |
| `tailwind.config.js` with `content`, `theme.extend`, `darkMode: "class"` | CSS-first in `src/styles.css`: `@theme`, automatic source detection, `@custom-variant dark` |
| `@tailwind base; @tailwind components; @tailwind utilities;` | `@import "tailwindcss";` (`@tailwind base` still compiles and silently emits no preflight and no theme) |
| `postcss.config.js` with `autoprefixer` | the `@tailwindcss/vite` plugin; prefixing is built in |
| `@config "./tailwind.config.js"` | not used |
| `theme('colors.red.500')`, `resolveConfig()` | `var(--color-x)`; `theme(--breakpoint-md)` only where `var()` cannot go (a media query) |
| `@layer utilities { .x { } }` for a custom utility | `@utility x { }` |
| `@tailwindcss/container-queries` | built in: `@container`, `@md:flex` |
| `content: ["../kit/src/**"]` for a workspace package | `@source "./";` in the package's CSS |

## Tailwind utilities and variants (Prior-version)

| Older examples write | Correct now |
| --- | --- |
| `bg-opacity-50`, `text-opacity-*` | `bg-accent/50` (`bg-opacity-50` emits nothing) |
| `shadow`, `shadow-sm` | `shadow-sm`, `shadow-xs` (the scale moved down one step) |
| `rounded`, `rounded-sm`; `blur`, `blur-sm` | `rounded-sm`, `rounded-xs`; `blur-sm`, `blur-xs` |
| `outline-none` to hide the focus ring | `outline-hidden` (keeps a forced-colors outline); `outline-none` is now `outline-style: none` |
| `ring` for a 3px blue ring | `ring-3 ring-accent` (bare `ring` is 1px `currentColor`) |
| `border` relying on gray-200 | `border border-line`: the default border colour is `currentColor` |
| `!flex` | `flex!` |
| `first:*:pt-0` | `*:first:pt-0`: variants now apply left to right |
| `bg-[--brand]` | `bg-(--brand)` (`bg-[--brand]` compiles to `background-color: --brand`) |
| `grid-cols-[max-content,auto]` | `grid-cols-[max-content_auto]` |
| `space-y-4` | `gap-4` on a flex or grid parent (`space-*` changed selectors) |
| `transform` before `scale-95` | nothing: `scale-*`, `translate-*`, `rotate-*` set their own properties |
| `bg-gradient-to-r` | `bg-linear-to-r` |
| `flex-grow`, `flex-shrink`, `overflow-ellipsis`, `decoration-clone`, `break-words` | `grow`, `shrink`, `text-ellipsis`, `box-decoration-clone`, `wrap-break-word` |
| `max-w-screen-md` | `max-w-(--breakpoint-md)` |
| `start-4`, `end-4` | `inset-s-4`, `inset-e-4` |
| `w-4 h-4` | `size-4` |
| `left-*`, `ml-*` with `rtl:` overrides | logical `inset-s-*`, `ms-*`, `ps-*` |
| a JS autosize hook for a textarea | `field-sizing-content` with a `rows` minimum, where a fixed height is acceptable: Firefox before 152 and Safari before 26.2 ignore it, keep the rows and scroll; keep the hook where growing is required |
| `h-screen`, `min-h-screen` (`100vh`) | `h-dvh`, `min-h-dvh`: `100vh` is taller than a phone's visible area while its toolbars show |
| `dark:bg-gray-900` pairs on every element | a `light-dark()` token; `dark:` only for non-colour differences |
| `hover:` assumed to apply on touch | `hover:` is inside `@media (hover: hover)` |

New in 4.x and worth reaching for: `not-*`, `in-*`, `starting:` (`@starting-style`),
`pointer-coarse:`, `user-invalid:`, `inert:`, `scheme-dark`, `text-shadow-*`, `mask-*`.

## Base UI and React (Prior-version)

| Older examples write | Correct now |
| --- | --- |
| `@base-ui-components/react` | `@base-ui/react`, imported per part: `@base-ui/react/dialog` |
| Radix `asChild` | `render={<Button />}`; in a custom component, `useRender` + `mergeProps` |
| Radix `data-[state=open]:`, `data-[state=closed]:` | `data-open:`, `data-closed:` |
| Radix `data-[disabled]:`, `data-[highlighted]:` | `data-disabled:`, `data-highlighted:` |
| Radix `forceMount` with an animation library for exit | CSS transitions on `data-starting-style:` and `data-ending-style:` |
| Radix `--radix-popover-content-transform-origin` | `--transform-origin` |
| Radix `--radix-dropdown-menu-trigger-width` | `--anchor-width` |
| `className={(state) => …}` on every part | data-attribute variants in a complete class string |
| `forwardRef` in a wrapper | `ref` is a prop in React 19 and travels in `...props`; Biome `noReactForwardRef` |
| `<Button render={<Link />} nativeButton={false}>` | `ButtonLink` built on `useRender`; `Menu.LinkItem` in a menu |

## Libraries and lint (Prior-version)

| Older examples write | Correct now |
| --- | --- |
| `sonner` `<Toaster />` and `toast()` | Base UI Toast: the scaffold's `ToastProvider`, `Toast.useToastManager().add()` |
| `next-themes` `ThemeProvider` | OS-driven `light-dark()` tokens; the `public/theme.js` add-on for a user choice |
| `framer-motion` | `motion` (`motion/react`) when a design needs it, without `AnimatePresence mode="popLayout"` or `AnimateView` (both append a `<style>`) |
| `cn()` from `clsx` and `tailwind-merge` | `cx()` from `src/shared/ui/cx.ts` |
| `cva()`, `tailwind-variants` | a `const` record of complete class strings keyed by `variant` |
| `@tanstack/react-virtual` `useVirtualizer`, `react-virtuoso` | virtua `VList` |
| TanStack Table 8 `useReactTable`, `getCoreRowModel` | Table 9 `useTable({ features, columns, data })`, `tableFeatures({})` |
| Biome `useSortedClasses` | not enabled; the Biome 2.6 `noTailwind*` and `useTailwind*` rules are |

The messages to search for: `noTailwindRawColors` "This Tailwind CSS class uses a raw palette color.",
`noTailwindRestyledComponents` "This Tailwind utility restyles a component.",
`useTailwindStaticClassStrings` "This class string is constructed dynamically.",
`noTailwindArbitraryValue` "Found an arbitrary value in a Tailwind CSS class."

`pnpm format` applies the safe fixes (`noTailwindLegacyUtilities`, `useTailwindVariablesShorthand`).
The `useTailwindShorthandClasses` fix is unsafe: write `size-4` by hand or run
`pnpm exec biome check --write --unsafe <file>`. Nothing reports `bg-opacity-50`, `outline-none`, or
a resized `rounded` or `shadow`: the tables above are the only check.
