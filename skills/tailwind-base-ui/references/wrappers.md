# Base UI wrappers in `src/shared/ui`

Complete wrappers, compiled against `@base-ui/react` 1.9 under the scaffold's `tsconfig.json` and
`biome.json`. Copy them when an app first needs the part.

## Contents

- Data attributes and CSS variables
- Button and a link that looks like a button
- Dialog
- Menu
- Select
- A component that responds to its container
- Composing them in a feature
- Toasts
- Test ids
- Field

## Data attributes and CSS variables

Every attribute below works as a Tailwind variant: `data-open:`, `not-data-disabled:`,
`in-data-open:` (an ancestor has it), `data-[side=top]:` (an attribute with a value). Each part's
page under `node_modules/@base-ui/react/docs/react/components/` lists exactly which it sets.

| Attribute | Set on | Meaning |
| --- | --- | --- |
| `data-disabled` | most parts | disabled |
| `data-open`, `data-closed` | popups, triggers' popups, collapsibles | open state |
| `data-popup-open` | a trigger | its popup is open |
| `data-starting-style`, `data-ending-style` | anything that mounts or unmounts | the first and last frame: transition from or to these |
| `data-highlighted` | menu, select, combobox items | keyboard or pointer highlight |
| `data-pressed` | toggle, toggle-group items | pressed |
| `data-checked`, `data-unchecked`, `data-indeterminate` | checkbox, radio, switch, checkable menu items | checked state |
| `data-valid`, `data-invalid`, `data-dirty`, `data-touched`, `data-filled`, `data-focused` | Field parts and the control inside `Field.Root` | field state |
| `data-required`, `data-readonly` | form controls | attributes mirrored |
| `data-side`, `data-align` | positioners and popups | where it was placed: `data-[side=top]:` |
| `data-instant` | tooltip, popover, menu popups | open without animation (keyboard, a second tooltip) |
| `data-nested`, `data-nested-dialog-open` | menus, dialogs | nesting |
| `data-orientation` | tabs, slider, separator, toolbar | `data-[orientation=vertical]:` |
| `data-type` | toast root | the `type` passed to `add()`: `data-[type=error]:` |
| `data-limited`, `data-expanded`, `data-behind` | toast root and content | over the limit, stack expanded, behind the front toast |
| `data-swiping`, `data-swipe-direction` | toast root, drawer | swipe gestures |

CSS variables Base UI sets, read with the parenthesis shorthand:

| Variable | Set on | Typical class |
| --- | --- | --- |
| `--transform-origin` | popup | `origin-(--transform-origin)` |
| `--anchor-width`, `--anchor-height` | positioner | `min-w-(--anchor-width)` |
| `--available-width`, `--available-height` | positioner | `max-h-(--available-height)` |
| `--positioner-width`, `--popup-width` (and `-height`) | positioner, popup | size transitions |
| `--toast-index`, `--toast-offset-y`, `--toast-height`, `--toast-frontmost-height` | toast root | stacked toasts |
| `--toast-swipe-movement-x`, `--toast-swipe-movement-y` | toast root | swipe-to-dismiss |

## Button and a link that looks like a button

The scaffold's `Button` plus a `danger` variant, with its look exported so a second component can
share it. Base UI forbids rendering a link through `Button` (`nativeButton={false}` is for a `div`,
never an `a`), so the link is its own component built on `useRender`.

```tsx,verify
// file: src/shared/ui/button.tsx
import { Button as BaseButton } from "@base-ui/react/button";
import { cx } from "./cx";

// Wrapped in cx() so the Tailwind lint rules read them, as they read a className.
const base = cx(
  "inline-flex h-9 items-center justify-center gap-2 rounded-md px-4 font-medium text-sm transition-colors data-disabled:opacity-50",
);

const variants = {
  primary: cx("bg-accent text-accent-fg hover:not-data-disabled:bg-accent/90"),
  secondary: cx("border border-control bg-surface text-fg hover:not-data-disabled:bg-bg"),
  danger: cx("bg-danger text-danger-fg hover:not-data-disabled:bg-danger/90"),
} as const;

export type ButtonVariant = keyof typeof variants;

/** The button look, shared with `ButtonLink`. */
export const buttonClass = (variant: ButtonVariant, className: string | undefined) =>
  cx(base, variants[variant], className);

interface ButtonProps extends Omit<BaseButton.Props, "className"> {
  variant?: ButtonVariant | undefined;
  /** Layout only (margin, width, placement); looks come from `variant`. */
  className?: string | undefined;
}

export function Button({ variant = "secondary", className, ...props }: ButtonProps) {
  return <BaseButton {...props} className={buttonClass(variant, className)} />;
}
```

`danger` needs one token the scaffold lacks, the text colour on `danger`. These values give 6.6:1
(light) and 7.4:1 (dark) by the WCAG 2 formula, and at least 5.7:1 under the hover's `/90`; a
design that changes `--danger` takes its values from `frontend-design` and checks 4.5:1 again.

```css
:root {
  --danger-fg: light-dark(oklch(1 0 0), oklch(0.15 0 0));
}

@theme inline {
  --color-danger-fg: var(--danger-fg);
}
```

The link cancels the scaffold's `a:hover` underline with `no-underline`: utilities sit in a later
cascade layer than `@layer base`, so the class wins without a hover variant.

```tsx,verify
// file: src/shared/ui/button-link.tsx
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { type ButtonVariant, buttonClass } from "./button";
import { cx } from "./cx";

interface ButtonLinkProps extends Omit<useRender.ComponentProps<"a">, "className"> {
  variant?: ButtonVariant | undefined;
  /** Layout only (margin, width, placement); looks come from `variant`. */
  className?: string | undefined;
}

/** A link with the Button look and link semantics: `render={<Link to="/users/new" />}`. */
export function ButtonLink({
  variant = "secondary",
  className,
  render,
  ...props
}: ButtonLinkProps) {
  return useRender({
    defaultTagName: "a",
    render,
    props: mergeProps<"a">(props, {
      className: cx("no-underline", buttonClass(variant, className)),
    }),
  });
}
```

## Dialog

Root, trigger and close are Base UI's parts unchanged; the wrapper owns the portal, backdrop and
popup. Under reduced motion the popups still fade, only the scale goes, as in the scaffold's toast.
The width is a `size` variant, not a `className`: with both `w-[min(28rem,…)]` in the base and a
caller's `w-96`, the built CSS puts `w-96` first, so it silently loses.

A confirmation of a destructive action ("Delete user?") is `AlertDialog` from
`@base-ui/react/alert-dialog`, not `Dialog`: it has `role="alertdialog"` and an outside click does
not dismiss it. It has the same parts, so `alert-dialog.tsx` is this file with `AlertDialog` in
place of `Dialog`, and its confirm button is `<Button variant="danger">`.

The backdrop needs a `scrim` token, which the scaffold lacks:

```css
:root {
  --scrim: light-dark(oklch(0 0 0 / 0.3), oklch(0 0 0 / 0.6));
}

@theme inline {
  --color-scrim: var(--scrim);
}
```

```tsx,verify
// file: src/shared/ui/dialog.tsx
import { Dialog as BaseDialog } from "@base-ui/react/dialog";
import type { ReactNode } from "react";
import { cx } from "./cx";

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;

const sizes = {
  sm: cx("w-[min(24rem,calc(100vw-2rem))]"),
  md: cx("w-[min(28rem,calc(100vw-2rem))]"),
  lg: cx("w-[min(40rem,calc(100vw-2rem))]"),
} as const;

// No `className`: the base string sets the width and the placement, so a caller's class could lose.
interface DialogPopupProps
  extends Omit<BaseDialog.Popup.Props, "className" | "children" | "title"> {
  title: ReactNode;
  description?: ReactNode | undefined;
  children?: ReactNode | undefined;
  size?: keyof typeof sizes | undefined;
}

export function DialogPopup({
  title,
  description,
  children,
  size = "md",
  ...props
}: DialogPopupProps) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 min-h-dvh bg-scrim transition-opacity duration-150 data-ending-style:opacity-0 data-starting-style:opacity-0 supports-[-webkit-touch-callout:none]:absolute" />
      <BaseDialog.Popup
        {...props}
        className={cx(
          "-translate-1/2 fixed top-1/2 left-1/2 flex flex-col gap-3 rounded-lg bg-surface p-6 text-fg shadow-lg transition-[opacity,scale] duration-150 data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-opacity",
          sizes[size],
        )}
      >
        <BaseDialog.Title className="font-semibold text-lg">{title}</BaseDialog.Title>
        {description === undefined ? null : (
          <BaseDialog.Description className="text-muted text-sm">
            {description}
          </BaseDialog.Description>
        )}
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}
```

`supports-[-webkit-touch-callout:none]:absolute` is Base UI's iOS 26 Safari fix; it pairs with
`body { position: relative }` in `styles.css`.

## Menu

```tsx,verify
// file: src/shared/ui/menu.tsx
import { Menu as BaseMenu } from "@base-ui/react/menu";
import type { ReactNode } from "react";
import { cx } from "./cx";

export const Menu = BaseMenu.Root;
export const MenuTrigger = BaseMenu.Trigger;

interface MenuPopupProps {
  children: ReactNode;
  side?: BaseMenu.Positioner.Props["side"] | undefined;
  "data-testid"?: string | undefined;
}

export function MenuPopup({ children, side = "bottom", "data-testid": testId }: MenuPopupProps) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner side={side} sideOffset={6} className="outline-hidden">
        <BaseMenu.Popup
          data-testid={testId}
          className="min-w-40 origin-(--transform-origin) rounded-lg border border-line bg-surface p-1 text-fg shadow-md outline-hidden transition-[opacity,scale] duration-100 data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-opacity"
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  );
}

// cx() so the Tailwind lint rules read it, as they read a className.
const item = cx(
  "flex h-8 cursor-default select-none items-center rounded-md px-2 text-sm outline-hidden data-disabled:opacity-50 data-highlighted:bg-accent data-highlighted:text-accent-fg",
);

export function MenuItem(props: Omit<BaseMenu.Item.Props, "className">) {
  return <BaseMenu.Item {...props} className={item} />;
}

/** Navigation inside a menu: `<MenuLinkItem render={<Link to="/users" />}>Users</MenuLinkItem>`. */
export function MenuLinkItem(props: Omit<BaseMenu.LinkItem.Props, "className">) {
  return <BaseMenu.LinkItem {...props} className={item} />;
}
```

## Select

A select is a field, the shape of the scaffold's `TextField`: `Field.Root invalid` sets
`data-invalid` on the trigger and `Field.Error match` shows the message. `items` lets
`Select.Value` show the label of the chosen value. `<CSPProvider disableStyleElements>` already
stops the `<style>` Select would inject.

```tsx,verify
// file: src/shared/ui/select-field.tsx
import { Field } from "@base-ui/react/field";
import { Select } from "@base-ui/react/select";
import { cx } from "./cx";

interface SelectFieldProps<Value extends string>
  extends Omit<Select.Root.Props<Value>, "items" | "multiple" | "children"> {
  label: string;
  items: { value: Value; label: string }[];
  placeholder?: string | undefined;
  /** A server or form-library error; marks the field invalid. */
  error?: string | undefined;
  /** Layout only (margin, width, placement). */
  className?: string | undefined;
  /** Lands on the trigger, the element a user clicks. */
  "data-testid"?: string | undefined;
}

export function SelectField<Value extends string>({
  label,
  items,
  placeholder,
  error,
  className,
  "data-testid": testId,
  ...props
}: SelectFieldProps<Value>) {
  return (
    <Field.Root invalid={error !== undefined} className={cx("flex flex-col gap-1", className)}>
      {/* The trigger is a button: a div label avoids a native label's click and hover forwarding. */}
      <Field.Label nativeLabel={false} render={<div />} className="font-medium text-sm">
        {label}
      </Field.Label>
      <Select.Root {...props} items={items}>
        <Select.Trigger
          data-testid={testId}
          className="flex h-9 items-center justify-between gap-2 rounded-md border border-control bg-surface px-3 text-sm data-invalid:border-danger"
        >
          <Select.Value placeholder={placeholder} className="data-placeholder:text-muted" />
          <Select.Icon className="text-muted">
            <svg aria-hidden viewBox="0 0 16 16" fill="currentColor" className="size-4">
              <path d="M11 10H5l3 3.5zm0-4H5l3-3.5z" />
            </svg>
          </Select.Icon>
        </Select.Trigger>
        <Select.Portal>
          <Select.Positioner alignItemWithTrigger={false} sideOffset={6} className="outline-hidden">
            <Select.Popup className="min-w-(--anchor-width) origin-(--transform-origin) rounded-lg border border-line bg-surface p-1 text-fg shadow-md outline-hidden transition-[opacity,scale] duration-100 data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0 motion-reduce:transition-opacity">
              <Select.List className="max-h-(--available-height) overflow-y-auto">
                {items.map((item) => (
                  <Select.Item
                    key={item.value}
                    value={item.value}
                    className="flex h-8 cursor-default select-none items-center rounded-md px-2 text-sm outline-hidden data-disabled:opacity-50 data-selected:font-medium data-highlighted:bg-accent data-highlighted:text-accent-fg"
                  >
                    <Select.ItemText>{item.label}</Select.ItemText>
                  </Select.Item>
                ))}
              </Select.List>
            </Select.Popup>
          </Select.Positioner>
        </Select.Portal>
      </Select.Root>
      <Field.Error match={error !== undefined} className="text-danger text-sm">
        {error}
      </Field.Error>
    </Field.Root>
  );
}
```

Use it with a typed list: `<SelectField label="Status" items={statuses} value={status}
onValueChange={setStatus} />`, where `statuses` is `{ value: OrderStatus; label: string }[]`; in a
test the trigger is `getByRole("combobox", { name: "Status" })` and each choice an `option`.

## A component that responds to its container

A kit component lays itself out by the width it is given, not the window's, so the same component
works in a page column, a dialog and a sidebar. `@container` on its outer element; `@md:` and the
other `@` variants then test that element (`@sm` 24rem, `@md` 28rem, `@lg` 32rem, `@xl` 36rem).

```tsx,verify
// file: src/shared/ui/detail-list.tsx
import type { ReactNode } from "react";

interface DetailListProps {
  items: readonly { label: string; value: ReactNode }[];
}

/** Label and value pairs: stacked in a narrow container, side by side from `@md` (28rem). */
export function DetailList({ items }: DetailListProps) {
  return (
    <div className="@container">
      <dl className="grid gap-x-4 gap-y-1 @md:grid-cols-label">
        {items.map(({ label, value }) => (
          <div key={label} className="contents">
            <dt className="text-muted text-sm @md:text-base">{label}</dt>
            <dd className="mb-2 @md:mb-0">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
```

## Composing them in a feature

`render` puts a Base UI trigger on a kit `Button` (the trigger's ref and focus return go through),
and puts the router's `Link` inside `ButtonLink` and `MenuLinkItem`. A component raises a toast
through `Toast.useToastManager()`; there is no module-level toast object.

```tsx,verify
// file: src/features/users/user-actions.tsx
import { Toast } from "@base-ui/react/toast";
import { Link } from "@tanstack/react-router";
import type { UserResponse } from "@/api/generated/api";
import { Button } from "@/shared/ui/button";
import { ButtonLink } from "@/shared/ui/button-link";
import { Dialog, DialogClose, DialogPopup, DialogTrigger } from "@/shared/ui/dialog";
import { Menu, MenuItem, MenuLinkItem, MenuPopup, MenuTrigger } from "@/shared/ui/menu";

export function UserActions({ user }: { user: UserResponse }) {
  const toasts = Toast.useToastManager();
  const copyEmail = () =>
    navigator.clipboard
      .writeText(user.email)
      .then(() => toasts.add({ title: "Email copied" }), reportError);

  return (
    <div className="flex gap-2">
      <ButtonLink
        variant="primary"
        render={<Link to="/users/$userId" params={{ userId: user.id }} />}
      >
        Open
      </ButtonLink>
      <Menu>
        <MenuTrigger render={<Button />}>More</MenuTrigger>
        <MenuPopup>
          <MenuItem onClick={copyEmail}>Copy email</MenuItem>
          <MenuLinkItem render={<Link to="/users/new" />}>New user</MenuLinkItem>
        </MenuPopup>
      </Menu>
      <Dialog>
        <DialogTrigger render={<Button />}>Details</DialogTrigger>
        <DialogPopup size="sm" title={user.name} description={user.email}>
          <DialogClose render={<Button className="self-end" />}>Close</DialogClose>
        </DialogPopup>
      </Dialog>
    </div>
  );
}
```

## Toasts

The scaffold's `src/shared/ui/toast.tsx` renders the toasts; `createAppRouter` creates one manager
per router and hands it to `ToastProvider` and to the `createQueryClient` callback, which turns a
failed refresh or mutation into a toast titled from `NOTICES` in `router.tsx`; each test's router
has its own toasts. Inside React, `Toast.useToastManager().add(...)`. Outside React (a socket
handler), pass the manager in from where the router is created; never create a second manager at
module scope, or its toasts never render.

What `add()` does with its options in `@base-ui/react` 1.9:

| Option | Default | Effect |
| --- | --- | --- |
| `timeout` | `5000` ms | `0` keeps the toast until the user dismisses it |
| `priority` | `"low"` | announced politely through the viewport's live region. `"high"`: the viewport adds a visually hidden `role="alert"` copy of the title and description, announced at once; the toast itself becomes an `alertdialog` hidden from assistive technology until F6 moves focus into the viewport |
| `id` | generated | an `add()` under the id of a toast on screen updates that toast in place and restarts its timer; `update(id, ...)` does nothing once the toast is gone |

- A failure (data not refreshed, a change not saved) is `priority: "high", timeout: 0`: it may be
  the only sign that the work was lost, and a polite toast that leaves after 5 s is missed by a
  screen-reader user mid-sentence and by anyone who looked away.
- One toast per failure reason: pass the reason as `id`, so three failed polls leave one toast
  carrying the latest request id, not three.
- A success notice ("Email copied") keeps the defaults, low priority and timed: the user's own
  action already confirmed it, and an urgent announcement would interrupt.

```tsx,verify,test
// file: src/shared/ui/toast.test.tsx
import { Toast } from "@base-ui/react/toast";
import { act, render, screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { ToastProvider } from "./toast";

test("a toast added again under its id replaces the one on screen", async () => {
  const manager = Toast.createToastManager();
  render(<ToastProvider manager={manager}>{null}</ToastProvider>);
  const fail = (requestId: string) =>
    manager.add({
      id: "refresh",

      title: "Could not refresh the data",
      description: `Request id: ${requestId}`,
      priority: "high",
      timeout: 0,
    });

  act(() => {
    fail("a");
    fail("b");
    fail("c");
  });

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Request id: c");
  expect(screen.getAllByRole("alert")).toHaveLength(1);
});
```

A `Toast.Root` is named by its title; finding toasts in route tests belongs to `frontend-testing`.

To style a toast by `type`, add `data-[type=error]:border-danger` to the root's class string in
`toast.tsx`; to add an action, `actionProps: { children: "Retry", onClick }` on `add()` and a
`<Toast.Action />` part in the list.

## Test ids

Every wrapper passes `data-testid` to the element a user acts on; naming it is `frontend-testing`'s
convention. A wrapper that spreads its props onto one Base UI part forwards it already. One that
sends its props elsewhere (`SelectField` to `Select.Root`, which renders no element for them) or
takes a fixed prop list (`MenuPopup`) declares `"data-testid"?: string | undefined` and puts it on
the part.

| Wrapper | Receives `data-testid` |
| --- | --- |
| `Button`, `ButtonLink`, `TextField` | the `<button>`, the `<a>`, the `<input>` |
| `SelectField` | the trigger (`combobox`), not the hidden input |
| `CheckboxField` (`frontend-forms`) | the checkbox |
| `DialogTrigger`, `DialogClose`, `MenuTrigger` | the button, or the kit `Button` in `render` |
| `DialogPopup`, `MenuPopup` | the popup (`dialog`, `menu`) |
| `MenuItem`, `MenuLinkItem` | the item |
| `ToastProvider` | nothing: a failure toast is found by its `alert` role |

```tsx,verify,test
// file: src/shared/ui/test-ids.test.tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test } from "vitest";
import { Button } from "./button";
import { Dialog, DialogPopup, DialogTrigger } from "./dialog";
import { Menu, MenuItem, MenuPopup, MenuTrigger } from "./menu";
import { SelectField } from "./select-field";

test("each wrapper puts data-testid on the element a user acts on", async () => {
  const user = userEvent.setup();
  render(
    <>
      <SelectField label="Status" items={[{ value: "active", label: "Active" }]} data-testid="s" />
      <Dialog>
        <DialogTrigger render={<Button data-testid="dt" />}>Details</DialogTrigger>
        <DialogPopup title="Details" data-testid="dp" />
      </Dialog>
      <Menu>
        <MenuTrigger render={<Button data-testid="mt" />}>More</MenuTrigger>
        <MenuPopup data-testid="mp">
          <MenuItem data-testid="mi">Copy</MenuItem>
        </MenuPopup>
      </Menu>
    </>,
  );
  expect(screen.getByTestId("s")).toBe(screen.getByRole("combobox", { name: "Status" }));

  await user.click(screen.getByTestId("dt"));
  expect(await screen.findByTestId("dp")).toBe(screen.getByRole("dialog", { name: "Details" }));
  await user.keyboard("{Escape}");

  await user.click(screen.getByTestId("mt"));
  expect(await screen.findByTestId("mp")).toBe(screen.getByRole("menu"));
  expect(screen.getByTestId("mi")).toBe(screen.getByRole("menuitem", { name: "Copy" }));
});
```

## Field

`TextField` in the scaffold is the contract `frontend-forms` wires to form state: `error` set makes
`Field.Root invalid`, which sets `data-invalid` on the control (`data-invalid:border-danger`), and
`Field.Error match={error !== undefined}` shows the message whatever the native validity says.
A checkbox or switch field follows the same shape as `TextField` and `SelectField`: `Field.Root
invalid`, the Base UI control, `Field.Error match`. A control's outline (a select trigger, a checkbox box, an input) is
`border-control`, which keeps 3:1 against `bg` and `surface`; `border-line` is for dividers.
