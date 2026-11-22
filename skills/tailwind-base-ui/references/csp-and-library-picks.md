# The CSP and UI library picks

The shipped CSP is `style-src 'self'` and `script-src 'self'` with Trusted Types (`frontend-deploy`
owns the header). This file is what that means for UI code and dependencies.

## Contents

- What passes and what is blocked
- Measured under the CSP (precedence over older picks)
- Proving a new UI dependency
- Virtualized lists: virtua
- Icons: lucide-react
- A custom font
- Data tables: TanStack Table 9

## What passes and what is blocked

Measured on a production build served with the CSP in Chromium, Firefox and WebKit.

| Mechanism | Result |
| --- | --- |
| a static stylesheet from the bundle (Tailwind, a package's `.css` imported in `styles.css`) | passes |
| React `style={{ height }}`, `element.style.x = …`, `setProperty` (CSSOM writes) | passes: Base UI positioning, virtualizers and JS animation libraries all write this way |
| a `<style>` element created at runtime (CSS-in-JS, a library's injected CSS, `<svg><style>`) | blocked: `style-src-elem` violation, the rules are not applied |
| a `style="…"` attribute in markup or `setAttribute("style", …)` | blocked |
| `new CSSStyleSheet()` + `document.adoptedStyleSheets`, or `insertRule` on a sheet that already exists | **not blocked** in any engine: the CSP cannot catch it, so check the source. `insertRule` on a `<style>` created at runtime fails: its `sheet` is `null` and the element is reported |
| `dangerouslySetInnerHTML` with a string, `innerHTML =` | throws under `require-trusted-types-for 'script'`; render text instead (`frontend-deploy` owns the one exception) |
| an inline `<script>` | blocked by `script-src 'self'`; an external file in `public/` passes |

Base UI itself injects `<style>` for scrollbar hiding and some pre-paint behaviour; the scaffold's
`<CSPProvider disableStyleElements>` in the router's `Wrap` turns that off, and `styles.css` carries
the two scrollbar rules in its place. A widget mounted outside `Wrap` (a second React root) needs
its own `CSPProvider`.

## Measured under the CSP (precedence over older picks)

| Library | Result | Use instead |
| --- | --- | --- |
| `sonner` 2 | appends a `<style>` on import in every engine, even with its CSS imported statically; no option to turn it off | Base UI Toast (the scaffold's `toast.tsx`) |
| `@emotion/react`, `styled-components` | `<style>` at runtime; styles lost | Tailwind classes |
| `next-themes` | needs an inline script | `light-dark()` tokens; the `public/theme.js` add-on |
| `framer-motion` / `motion` 14 with `AnimatePresence mode="popLayout"` or `AnimateView` | `PopChild` and `AnimateView`'s view-transition reset each append a `<style>` | CSS transitions; `motion` 14 `motion.*` and plain `AnimatePresence` pass |
| `@tanstack/react-virtual` | passes the CSP; `useVirtualizer` is a hook the React Compiler knows it cannot compile, so it silently skips the whole component | virtua |
| `react-virtuoso` | passes; 22 KB gzip against virtua's 4 KB | virtua |
| `tailwind-merge`, `clsx`, `class-variance-authority`, `tailwind-variants` | pass; 0.3 to 20 KB gzip for nothing the wrapper contract needs | `cx()` and variant records |
| `input-otp` 1.5 | appends a `<style>` to `<head>` on mount | Base UI `OTPField` (`@base-ui/react/otp-field`) |
| `vaul` 1.1 | appends a `<style>` to `<head>` on import | Base UI `Drawer` (`@base-ui/react/drawer`) |
| `@number-flow/react` 0.6 | its `number-flow` element appends a `<style>` to its shadow root | the number as plain formatted text |
| Google Fonts `<link>` | needs `fonts.googleapis.com` in `style-src` and a font origin | `@fontsource-variable/*` |
| a chart library | none measured here | run the proof below; it passes only when the grep finds no `<style>` creation, `adoptedStyleSheets`, `insertRule` or `innerHTML`, and the E2E page with a rendered chart (tooltip and legend shown) reports nothing. A chart drawn as React SVG elements with `style={{}}` passes by mechanism; one that builds SVG markup as a string or styles its tooltip with a `<style>` does not |

`OTPField` and `Drawer` are stable parts of `@base-ui/react` 1.9, with no preview marking.

Sizes measured on a minified lib build, React external, gzip: lucide-react 1.76 1.9 KB for one icon
and 3.4 KB for twenty; virtua 0.55 `VList` 4.2 KB; Base UI Toast 7.6 KB on top of the other Base UI
parts.

## Proving a new UI dependency

Before adding any package that renders UI or touches styles, unless it is one of this file's
measured picks (virtua, lucide-react, `@fontsource-variable/*`, TanStack Table 9), which need no
new proof:

1. Search its published files for runtime style or HTML injection:

   ```bash
   grep -rlE 'createElement\(.style.\)|adoptedStyleSheets|insertRule|innerHTML' node_modules/<pkg>/
   ```

   Grep the whole package folder: packages publish to `dist`, `lib` or `esm`, and grep on a folder
   that does not exist prints nothing to standard output, which looks like a pass.
   `adoptedStyleSheets` and `insertRule` matter most: the browser will not report them.
2. Use the widget on a page that an E2E test visits. The scaffold's Playwright guard fixture fails
   the test on any `securitypolicyviolation`, console error or page error, and runs against
   `pnpm build && pnpm preview`, which serves the real headers. `pnpm dev` and Vitest under jsdom
   enforce no CSP, so a pass there proves nothing. Writing the test is `frontend-testing`'s.
3. The scaffold's Playwright config runs Chromium only. For a dependency that touches styles, run the
   test once in Firefox and WebKit too (`devices["Desktop Firefox"]`, `devices["Desktop Safari"]` as
   extra projects, locally): the picks below were measured in all three.

A dependency that fails is dropped, not accommodated: no `'unsafe-inline'`, no nonce, no
`style-src-attr`.

## Virtualized lists: virtua

`VList` sets an inline `height: 100%` on itself, which beats a height class on it: a `VList` with
`className="h-96"` renders zero rows in a parent with no height. Size the parent.

```tsx,verify
import { VList } from "virtua";

export function EventLog({ events }: { events: readonly { id: string; text: string }[] }) {
  return (
    <div className="h-96 rounded-md border border-line">
      <VList data={events}>
        {(event) => (
          <div key={event.id} className="border-line border-b px-3 py-2 text-sm">
            {event.text}
          </div>
        )}
      </VList>
    </div>
  );
}
```

`Virtualizer` is the part for a custom scroll container, `WindowVirtualizer` for page scroll.
Whether a list needs virtualizing at all is `web-design-guidelines`'s call.

## Icons: lucide-react

Named imports tree-shake. Size and colour come from classes (`size-4`, `text-muted`), because the
icons draw with `currentColor`. A decorative icon is `aria-hidden`; an icon-only button gets an
`aria-label`.

```tsx,verify
import { Check, Copy } from "lucide-react";
import { Button } from "@/shared/ui/button";

export function CopyButton({ copied, onCopy }: { copied: boolean; onCopy: () => void }) {
  return (
    <Button aria-label={copied ? "Copied" : "Copy"} onClick={onCopy}>
      {copied ? <Check aria-hidden className="size-4" /> : <Copy aria-hidden className="size-4" />}
    </Button>
  );
}
```

An SVG of the app's own goes in as a React component with no `<style>` element inside it.

## A custom font

The system stack is the default. A custom face is a `@fontsource-variable/<family>` package: it
ships per-subset `@font-face` rules with `unicode-range` and `font-display: swap`, served from the
app's own origin (`font-src` falls back to `default-src 'self'`). `build.assetsInlineLimit: 0`
keeps the files out of `data:` URLs, which the CSP would block.

```bash
pnpm add @fontsource-variable/inter
```

```css
@import "tailwindcss";
@import "@fontsource-variable/inter";

@theme {
  /* ... */
  --font-sans: "Inter Variable", ui-sans-serif, system-ui, sans-serif;
}
```

The font is only requested once the CSS is parsed. To start the Latin subset with the HTML, add
this plugin to `plugins` in `vite.config.ts` as `preloadFont(/\/inter-latin-wght-normal-[\w-]+\.woff2$/)`
(the file belongs to `frontend-tooling`):

```ts,verify
import type { Plugin } from "vite";

/** Preloads the one font file every page needs; fails the build when nothing matches. */
export const preloadFont = (pattern: RegExp): Plugin => ({
  name: "preload-font",
  apply: "build",
  transformIndexHtml: {
    order: "post",
    handler(_html, { bundle }) {
      const font = Object.keys(bundle ?? {}).find((file) => pattern.test(file));
      if (!font) throw new Error(`preload-font: nothing in the bundle matches ${pattern}`);
      return [
        {
          tag: "link",
          attrs: {
            rel: "preload",
            href: `/${font}`,
            as: "font",
            type: "font/woff2",
            crossorigin: true,
          },
          injectTo: "head",
        },
      ];
    },
  },
});
```

`crossorigin` is required on a font preload even from the same origin, or the browser fetches the
file twice.

## Data tables: TanStack Table 9

Headless and CSP-neutral. Version 9 replaced `useReactTable` and `getCoreRowModel` with `useTable`,
`tableFeatures` and a typed column helper; most examples online are version 8.

```tsx,verify
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import type { UserResponse } from "@/api/generated/api";

// Module scope: new features or columns on every render rebuild the row model.
const features = tableFeatures({});
const column = createColumnHelper<typeof features, UserResponse>();
const columns = column.columns([
  column.accessor("name", { header: "Name" }),
  column.accessor("email", { header: "Email" }),
]);

export function UsersGrid({ users }: { users: UserResponse[] }) {
  const table = useTable({ features, columns, data: users });
  return (
    <table className="w-full text-sm">
      <thead className="text-left text-muted">
        {table.getHeaderGroups().map((group) => (
          <tr key={group.id}>
            {group.headers.map((header) => (
              <th key={header.id} className="border-line border-b py-2">
                {header.isPlaceholder ? null : <table.FlexRender header={header} />}
              </th>
            ))}
          </tr>
        ))}
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row) => (
          <tr key={row.id}>
            {row.getAllCells().map((cell) => (
              <td key={cell.id} className="border-line border-b py-2">
                <table.FlexRender cell={cell} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
```

The install prints `Agent skills awaiting approval: @tanstack/react-table.`: decline with
`pnpm approve '!@tanstack/react-table'`, which writes `skills: false` under `permissions` in
`pnpm-workspace.yaml`, as the scaffold does for the router.

A cell or row component that receives a stable `row`, `cell` or `column` and reads table state
through a method (`row.getIsSelected()`) renders stale under the React Compiler. The maintainers'
fix: read it inside that component through `Subscribe`, or pass the value in as a prop.

```tsx,verify
import { type Row, rowSelectionFeature, Subscribe, tableFeatures } from "@tanstack/react-table";
import type { UserResponse } from "@/api/generated/api";

const features = tableFeatures({ rowSelectionFeature });

export function SelectionCell({ row }: { row: Row<typeof features, UserResponse> }) {
  return (
    <Subscribe source={row.table.atoms.rowSelection} selector={(selection) => selection[row.id]}>
      {(selected) => (
        <input
          type="checkbox"
          aria-label={`Select ${row.original.name}`}
          checked={!!selected}
          onChange={row.getToggleSelectedHandler()}
        />
      )}
    </Subscribe>
  );
}
```

Sorting, filtering and pagination are features passed to `tableFeatures({ ... })`; server-side
paging keeps its state in the URL (`tanstack-router-spa`) and its data in the Query cache
(`tanstack-query-api`). A plain list of rows needs no table library: the scaffold's `UserTable` is
a `<table>` with `map`.
