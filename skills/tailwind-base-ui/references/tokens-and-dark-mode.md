# Tokens and dark mode

## Contents

- The entry file as the scaffold ships it
- Adding a colour token
- Adding a scale
- What the build does to `light-dark()`
- Variants that compile differently from v3
- Add-on: a user-selectable theme

## The entry file as the scaffold ships it

`src/styles.css`:

```css
@import "tailwindcss";

:root {
  color-scheme: light dark;

  --bg: light-dark(oklch(0.985 0 0), oklch(0.18 0 0));
  --surface: light-dark(oklch(1 0 0), oklch(0.23 0 0));
  --fg: light-dark(oklch(0.21 0.01 260), oklch(0.96 0 0));
  --muted: light-dark(oklch(0.45 0.01 260), oklch(0.72 0 0));
  --line: light-dark(oklch(0.88 0.01 260), oklch(0.32 0 0));
  /* A control's outline: at least 3:1 against bg and surface (WCAG 1.4.11). */
  --control: light-dark(oklch(0.62 0.01 260), oklch(0.55 0 0));
  --accent: light-dark(oklch(0.46 0.16 260), oklch(0.72 0.14 260));
  --accent-fg: light-dark(oklch(1 0 0), oklch(0.15 0 0));
  --danger: light-dark(oklch(0.5 0.19 27), oklch(0.72 0.17 22));
}

/* Only role colours exist as utilities: bg-red-500 generates nothing. */
@theme {
  --color-*: initial;
  --color-transparent: transparent;
  --color-current: currentColor;
  --grid-template-columns-label: auto 1fr;
}

@theme inline {
  --color-bg: var(--bg);
  --color-surface: var(--surface);
  --color-fg: var(--fg);
  --color-muted: var(--muted);
  --color-line: var(--line);
  --color-control: var(--control);
  --color-accent: var(--accent);
  --color-accent-fg: var(--accent-fg);
  --color-danger: var(--danger);
}

@layer base {
  /* iOS 26 Safari: Base UI backdrops switch to position: absolute and need a positioned body. */
  body {
    position: relative;
  }

  html {
    background: var(--color-bg);
    color: var(--color-fg);
  }

  a {
    color: var(--color-accent);
    text-underline-offset: 2px;
  }

  a:hover {
    text-decoration-line: underline;
  }

  :focus-visible {
    outline: 2px solid var(--color-accent);
    outline-offset: 2px;
  }

  /* The heading createAppRouter focuses after a navigation is a reading position, not a control. */
  h1[tabindex="-1"]:focus-visible {
    outline: none;
  }
}

/* Base UI's scrollbar rules, which <CSPProvider disableStyleElements> stops it injecting. */
.base-ui-disable-scrollbar {
  scrollbar-width: none;
}

.base-ui-disable-scrollbar::-webkit-scrollbar {
  display: none;
}

/* Popups portal to <body>; the app root is its own stacking context so they always sit above it. */
#root {
  isolation: isolate;
}
```

`index.html` carries `<meta name="color-scheme" content="light dark" />`, so the canvas and form
controls follow the OS before the CSS arrives.

`line` draws dividers (the header, table rows, the toast border). `control` draws the outline that
shows where a control is (a text field, a secondary button, a select trigger): WCAG 1.4.11 asks
3:1 against what surrounds it, which `line` does not reach.

## Adding a colour token

The dialog backdrop in the wrappers needs a translucent overlay colour. Two lines, one in each block:

```css
:root {
  /* ... */
  --scrim: light-dark(oklch(0 0 0 / 0.3), oklch(0 0 0 / 0.6));
}

@theme inline {
  /* ... */
  --color-scrim: var(--scrim);
}
```

`bg-scrim`, `text-scrim`, `border-scrim` and `bg-scrim/50` now exist. The name is the role, never the
hue (`scrim`, `success`, `warning`, not `green`). The values come from `frontend-design`. A token that
is the same in both schemes is still a `:root` variable, written without `light-dark()`.

`@theme inline` matters: with plain `@theme`, the utility reads `var(--color-scrim)`, which resolves
where `--color-scrim` is declared (`:root`), so overriding `--scrim` on a subtree does nothing. With
`inline`, the utility reads `var(--scrim)` directly.

## Adding a scale

A non-colour design value is a literal in `@theme`, and its namespace names the utility:

```css
@theme {
  /* ... */
  --radius-control: 0.375rem; /* rounded-control */
  --shadow-popup: 0 8px 24px oklch(0 0 0 / 0.16); /* shadow-popup */
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif; /* font-sans, and the default */
}
```

Only variables a used utility reads are emitted. To retire Tailwind's defaults in a namespace the
design owns, reset it like colours: `--radius-*: initial;`. The scaffold's
`--grid-template-columns-label: auto 1fr` (`grid-cols-label`) is how a value that would otherwise be
an arbitrary `grid-cols-[auto_1fr]` outside `src/shared/ui` becomes a name.

## What the build does to `light-dark()`

At the scaffold's `build.target` (chrome119, edge119, firefox128, safari17.4) Lightning CSS, run by
Vite on the built CSS, rewrites each `light-dark(a, b)` into a pair of `--lightningcss-light` /
`--lightningcss-dark` variables switched by the `color-scheme` declarations it finds. Consequences:

- Declare `color-scheme` only on `:root` selectors (`:root`, `:root[data-theme="dark"]`). The
  tokens resolve once on `:root` in the built CSS, so `color-scheme` on an inner element does not
  flip that subtree: it works in `pnpm dev` and stays light after `pnpm build`.
- A surface that is dark in both schemes (a code block, a video player) gets its own role tokens,
  such as `code-bg` and `code-fg`, added like any role but with one dark value and no `light-dark()`.
- A token is read through `var()`, never copied into a `@theme` literal, or the polyfill has
  nothing to switch.
- Check dark mode on `pnpm build && pnpm preview`, not only `pnpm dev`; the E2E axe scan runs both
  schemes on the production build.

## Variants that compile differently from v3

| Class | Compiles to |
| --- | --- |
| `hover:bg-bg` | inside `@media (hover: hover)`: no sticky hover on touch |
| `dark:bg-surface` (baseline, no `@custom-variant`) | inside `@media (prefers-color-scheme: dark)` |
| `bg-accent/90` | `color-mix(in oklab, var(--accent) 90%, transparent)` with a solid fallback |
| `scale-95`, `translate-y-2`, `rotate-3` | the individual `scale`, `translate`, `rotate` properties, not `transform` |
| `transition-transform` | `transform, translate, scale, rotate` (so it also animates the above) |
| `bg-[--bg]` | `background-color: --bg`: invalid, silently dropped; write `bg-(--bg)` |

## Add-on: a user-selectable theme

Add this only when the product asks for a light/dark/system switch. The baseline follows the OS
with no script. The toggle in the root layout adds about 4.6 KB gzip to the entry (measured on the
scaffold: Base UI `ToggleGroup` and `Toggle`); the entry budget is `frontend-tooling`'s.

How it works: an external, classic, render-blocking script in `<head>` copies a stored choice to
`<html data-theme>` before first paint; no stored choice means no attribute and the CSS follows the
OS live. An inline script is blocked by `script-src 'self'`, and a theme applied from React paints
the wrong scheme first (measured: first paint at about 15 ms, the app module much later). The script
blocks parsing, so keep it a few lines.

`index.html`, in `<head>` (the module script stays where it is):

```html
<meta name="color-scheme" content="light dark" />
<script src="/theme.js"></script>
```

`public/theme.js` (served as is, not bundled):

```js
// Applies a stored light/dark choice before first paint. External because the CSP blocks inline
// script. No stored choice: the page follows the OS through CSS.
(() => {
  let stored = null;
  try {
    stored = localStorage.getItem("theme");
  } catch {
    // Storage blocked: follow the OS.
  }
  // Storage is untrusted input: only the two known values reach the DOM.
  if (stored === "light" || stored === "dark") document.documentElement.dataset.theme = stored;
})();
```

`src/styles.css`, after `@import "tailwindcss";`:

```css
/* dark: = an explicit dark choice, or no choice and a dark OS. */
@custom-variant dark {
  &:where([data-theme="dark"], [data-theme="dark"] *) {
    @slot;
  }
  @media (prefers-color-scheme: dark) {
    &:where(:root:not([data-theme]), :root:not([data-theme]) *) {
      @slot;
    }
  }
}

:root[data-theme="light"] {
  color-scheme: light;
}

:root[data-theme="dark"] {
  color-scheme: dark;
}
```

The tokens flip through `color-scheme` alone; `@custom-variant dark` only matters for the rare
`dark:` class that changes something other than a colour token (an image, a shadow).

The theme module: the parser, the setter and the subscription the hook reads. `useSyncExternalStore`
over the attribute, with the `storage` event for other tabs; no context provider.

```ts,verify
// file: src/shared/lib/theme.ts
export type Theme = "light" | "dark" | "system";

// public/theme.js reads the same key before first paint.
const KEY = "theme";

/** Storage and the DOM are untrusted: anything but the two known values means "system". */
export const parseTheme = (value: string | null | undefined): Theme =>
  value === "light" || value === "dark" ? value : "system";

export const readTheme = () => parseTheme(document.documentElement.dataset.theme);

const apply = (theme: Theme) => {
  if (theme === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.dataset.theme = theme;
};

export const subscribeTheme = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  // Another tab changed the choice.
  const onStorage = (event: StorageEvent) => {
    if (event.key === KEY) apply(parseTheme(event.newValue));
  };
  window.addEventListener("storage", onStorage);
  return () => {
    observer.disconnect();
    window.removeEventListener("storage", onStorage);
  };
};

export function setTheme(theme: Theme) {
  apply(theme);
  try {
    if (theme === "system") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, theme);
  } catch {
    // Storage blocked: the choice lasts until reload.
  }
}
```

The hook, in `src/shared/hooks/`:

```ts,verify
// file: src/shared/hooks/use-theme.ts
import { useSyncExternalStore } from "react";
import { readTheme, subscribeTheme } from "@/shared/lib/theme";

export const useTheme = () => useSyncExternalStore(subscribeTheme, readTheme);
```

```ts,verify,test
// file: src/shared/lib/theme.test.ts
import { afterEach, expect, test } from "vitest";
import { parseTheme, setTheme } from "./theme";

afterEach(() => setTheme("system"));

test("a stored choice reaches the DOM and storage; system clears both", () => {
  setTheme("dark");
  expect(document.documentElement.dataset.theme).toBe("dark");
  expect(localStorage.getItem("theme")).toBe("dark");

  setTheme("system");
  expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  expect(localStorage.getItem("theme")).toBeNull();
});

test("anything but light or dark is read as system", () => {
  expect(parseTheme('dark" onload="x')).toBe("system");
  expect(parseTheme(null)).toBe("system");
});
```

The toggle, a Base UI toggle group. Pressing the pressed item again yields `[]`, which keeps the
current choice. In a translated app the labels, `aria-label` included, are `t()` calls inside the
component (`frontend-i18n`): no gate finds text in a record.

```tsx,verify
// file: src/shared/ui/theme-toggle.tsx
import { Toggle } from "@base-ui/react/toggle";
import { ToggleGroup } from "@base-ui/react/toggle-group";
import { useTheme } from "@/shared/hooks/use-theme";
import { setTheme, type Theme } from "@/shared/lib/theme";

const themes: readonly { value: Theme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemeToggle() {
  const theme = useTheme();
  return (
    <ToggleGroup
      aria-label="Theme"
      value={[theme]}
      onValueChange={([next]) => {
        const choice = themes.find((item) => item.value === next);
        if (choice) setTheme(choice.value);
      }}
      className="inline-flex rounded-md border border-control p-0.5"
    >
      {themes.map(({ value, label }) => (
        <Toggle
          key={value}
          value={value}
          className="h-7 rounded-md px-3 text-sm data-pressed:bg-accent data-pressed:text-accent-fg"
        >
          {label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}
```

Render `<ThemeToggle />` in the root layout's header. The E2E axe scan then also needs a pass with
each explicit choice, stored before the page loads; `frontend-testing`'s Playwright reference shows
it. `theme-color` metas belong to
`mobile-native`; if the app has them, `theme.js` updates them too.
