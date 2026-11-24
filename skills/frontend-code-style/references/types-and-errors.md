# Types, Errors, Dates and Money

## Contents

- Domain types: unions, exhaustive switches, lookup tables, brands
- Types from the generated client
- Values from outside
- HTML attributes newer than `@types/react`
- Error classes
- Catching, rethrowing and reporting
- Dates and money

## Domain types: unions, exhaustive switches, lookup tables, brands

```ts,verify
export const OrderStatus = { Draft: "draft", Paid: "paid", Shipped: "shipped" } as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export type OrderEvent =
  | { type: "paid"; amountMinor: number }
  | { type: "shipped"; trackingCode: string }
  | { type: "cancelled"; reason?: string | undefined };

export function describeEvent(event: OrderEvent): string {
  switch (event.type) {
    case "paid":
      return "Payment received";
    case "shipped":
      return `Shipped, tracking ${event.trackingCode}`;
    case "cancelled":
      return event.reason ?? "Cancelled";
    default:
      // The server may send a variant this build does not know yet.
      event satisfies never;
      return "Unknown event";
  }
}

type Tab = "profile" | "security";

export function tabTitle(tab: Tab): string {
  switch (tab) {
    case "profile":
      return "Profile";
    case "security":
      return "Security";
    default:
      return tab satisfies never;
  }
}

export const statusLabel = {
  draft: "Draft",
  paid: "Paid",
  shipped: "Shipped",
} satisfies Record<OrderStatus, string>;
```

Adding a variant to `OrderEvent` fails `tsc` with TS1360 at `satisfies never`; adding a status
fails it at `statusLabel`. Biome's `useExhaustiveSwitchCases` (on in `biome.json`) reports missing
cases only in a `switch` without a `default`, so with one the `satisfies never` line is the
guarantee. That guarantee is compile-time only: `return value satisfies never` hands back the raw
value at run time. A union the app alone produces (`Tab`) may end that way. A union that comes from
the server can gain a variant before this build is replaced, so its `default` keeps
`value satisfies never;` as a statement and then returns an explicit fallback, as `describeEvent`
does, or throws `new Error("unknown order event", { cause: value })` where an error screen is the
right outcome.

Brand only where one signature takes ids of two entities and swapping them would compile:

```ts,verify
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

export type AccountId = Brand<string, "AccountId">;
export const accountId = (id: string) => id as AccountId;

export function transfer(from: AccountId, to: AccountId, amountMinor: number) {
  return { from, to, amountMinor };
}
```

A branded id is still assignable to `string`, so it passes into generated functions unchanged.

## Types from the generated client

```ts,verify
import type { CreateUser, UserResponse } from "@/api/generated/api";

export type UserSummary = Pick<UserResponse, "id" | "name">;
export type UserDraft = Partial<CreateUser>;

export function toSummary({ id, name }: UserResponse): UserSummary {
  return { id, name };
}
```

Never redeclare `UserResponse` by hand: after `pnpm api:generate` the copy silently disagrees.

## Values from outside

`JSON.parse`, `response.json()`, `event.data` and storage reads are untyped. Assign them to
`unknown` and narrow; parse an object shape with a zod schema where `tanstack-query-api` says zod
runs (storage, socket messages, search params).

```ts,verify
const DEFAULT_PAGE_SIZE = 20;

export function readPageSize(storage: Storage): number {
  let stored: unknown;
  try {
    stored = JSON.parse(storage.getItem("page-size") ?? "null");
  } catch {
    // Blocked storage or a corrupt value: the default is the handling.
    return DEFAULT_PAGE_SIZE;
  }
  return typeof stored === "number" && Number.isInteger(stored) && stored > 0
    ? stored
    : DEFAULT_PAGE_SIZE;
}
```

A swallowing `catch` is allowed only where the fallback is the handling, and its one-line comment
says so: a blocked or corrupt storage read, the unawaited loader prefetch that
`tanstack-query-api` shows, and a best-effort beacon whose loss is expected. Everything else
handles, rethrows or reports.

```ts
// An analytics ping: ad blockers and lost connections drop it routinely, and reporting would flood the tracker.
sendPing(event).catch(() => undefined);
```

## HTML attributes newer than `@types/react`

Check a new attribute against the `build.target` floor first. Invoker commands (`command`,
`commandfor`) and `interestfor` are above it and do nothing in part of the supported range: do not
use them; a dialog or a menu is a `shared/ui` wrapper (`tailwind-base-ui`). An attribute that is
only a hint, such as `writingsuggestions`, may be used below its support line, and when
`@types/react` 19.3 does not know it the JSX fails with TS2322. Declare the attribute once, never
spread it `as any` (Biome `noExplicitAny`). Save the block as `src/react-html.d.ts`, beside
`vite-env.d.ts`: a `.d.ts` file needs no importer, while knip reports a `.ts` module nothing imports.

```ts,verify
import "react";

declare module "react" {
  interface HTMLAttributes<T> {
    writingsuggestions?: "true" | "false" | undefined;
  }
}
```

```tsx,verify
export function NotesField() {
  return <textarea name="notes" writingsuggestions="false" />;
}
```

Delete the declaration once `@types/react` types the attribute.

## Error classes

```ts,verify
export class QuotaExceededError extends Error {
  override name = "QuotaExceededError";
  readonly limit: number;

  constructor(limit: number, options?: ErrorOptions) {
    super(`quota of ${limit} exceeded`, options);
    this.limit = limit;
  }
}
```

`override` is required by `noImplicitOverride` (TS4114); fields are assigned in the body because
`erasableSyntaxOnly` forbids parameter properties (TS1294). `options` carries `{ cause }`. HTTP
failures are `ApiError`, owned by `tanstack-query-api`; do not add a second HTTP error class.

## Catching, rethrowing and reporting

```tsx,verify
import { ApiError } from "@/api/api-error";
import { type CreateUser, createUser } from "@/api/generated/api";
import { Button } from "@/shared/ui/button";

export class ImportFailedError extends Error {
  override name = "ImportFailedError";
}

/** `undefined` when the email is taken; anything else is not this function's to handle. */
export async function createUnlessTaken(data: CreateUser) {
  try {
    return await createUser(data);
  } catch (error) {
    if (error instanceof ApiError && error.status === 409) return undefined;
    throw error;
  }
}

export async function importRows(rows: readonly CreateUser[]) {
  for (const [index, row] of rows.entries()) {
    try {
      await createUser(row);
    } catch (error) {
      throw new ImportFailedError(`row ${index + 1} failed`, { cause: error });
    }
  }
}

export function CopyButton({ text }: { text: string }) {
  return (
    <Button
      onClick={() => {
        navigator.clipboard.writeText(text).catch(reportError);
      }}
    >
      Copy
    </Button>
  );
}
```

- `reportError` is a platform global with no import. It dispatches a `window` `error` event; a
  tracker added later (`frontend-deploy` owns telemetry) listens there. A promise rejection nobody
  handles raises `unhandledrejection` instead, not `error`: Biome's `noFloatingPromises` keeps
  them from being written, and an error tracker listens for that event itself.
- A thrown error in a loader or render reaches `RouteError` (the router's
  `defaultErrorComponent`) or a route's own `errorComponent`, and React reports it through
  `rootErrorHandlers`, passed to `createRoot` in `main.tsx`. Rethrow; do not report first.
- The copy button's failure is shown nowhere, so it is reported. An error the user is shown, as a
  route error screen, a form message or a toast, is not reported by app code; copy shown for an
  `ApiError` names its `requestId` when present. A server write in a component goes through a
  mutation, whose failures the QueryClient already toasts; a mutation whose error the screen shows
  with its own copy turns that toast off with `meta: { silent: true }`. `tanstack-query-api` owns that policy.
- The block body makes the discarded promise visible; Biome accepts either form.

## Dates and money

The API sends two kinds of date, and each has its own formatter in
`src/shared/lib/format-date.ts`. An instant (`2026-03-01T09:30:00Z`, OpenAPI `format: date-time`)
goes through the scaffold's `formatDateTime` and shows in the user's time zone. A calendar date
(`2026-03-01`, `format: date`: a birthday, a due date) goes through `formatDate`, which the
scaffold does not ship: the block below is the file with it added.
`new Date("2026-03-01")` is midnight UTC, so a local-time formatter, `toLocaleDateString()` or
`getDate()` shows 28 February to every user west of UTC; `formatDate` formats in UTC and shows the
same day everywhere. Never pass a calendar date through local-time `Date` arithmetic; compare two
as strings (`YYYY-MM-DD` sorts as text), and send a date input's value as it is (`frontend-forms`).

```ts,verify
// file: src/shared/lib/format-date.ts
// English only until the app has translations; module level, so it is built once.
const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });
// A calendar date parses as midnight UTC: formatted in UTC it keeps its day in every time zone.
const calendarDate = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeZone: "UTC" });

/** Formats an ISO 8601 timestamp from the API for display. */
export function formatDateTime(iso: string) {
  return dateTime.format(new Date(iso));
}

/** Formats a calendar date from the API (`YYYY-MM-DD`), the same day in every time zone. */
export function formatDate(isoDate: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) throw new Error(`not a calendar date: ${isoDate}`);
  return calendarDate.format(new Date(isoDate));
}
```

```ts,verify,test
import { expect, test } from "vitest";
import { formatDate } from "@/shared/lib/format-date";

test("a calendar date keeps its day west of UTC", () => {
  const newYork = new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeZone: "America/New_York",
  });
  expect(newYork.format(new Date("2026-03-01"))).toBe("Feb 28, 2026");
  expect(formatDate("2026-03-01")).toBe("Mar 1, 2026");
});

test("a timestamp is not a calendar date", () => {
  expect(() => formatDate("2026-03-01T09:30:00Z")).toThrow("not a calendar date");
});
```

The first assertion is the bug a local-time formatter has in New York; `formatDate` ignores the
process time zone by construction. Tests that run under another `TZ` are `frontend-testing`'s.

Money goes through a formatter beside it:

```ts,verify
// file: src/shared/lib/format-money.ts
// Module level: an Intl formatter is expensive to build and safe to share.
const moneyFormats = new Map<string, Intl.NumberFormat>();

type DecimalString = `${number}`;
const isDecimalString = (value: string): value is DecimalString => /^-?\d+(\.\d+)?$/.test(value);

function moneyFormat(currency: string) {
  let format = moneyFormats.get(currency);
  if (!format) {
    format = new Intl.NumberFormat("en", { style: "currency", currency });
    moneyFormats.set(currency, format);
  }
  return format;
}

/** `amount` is the API's decimal string, formatted without passing through a float. */
export function formatMoney(amount: string, currency: string) {
  if (!isDecimalString(amount)) throw new Error(`not a decimal amount: ${amount}`);
  return moneyFormat(currency).format(amount);
}

/** Integer minor units: exact for display below 2^53; sums stay in integers. */
export function formatMinor(amountMinor: number, currency: string) {
  const format = moneyFormat(currency);
  // JPY has no minor unit and KWD has three: the currency's own digits give the divisor.
  return format.format(amountMinor / 10 ** (format.resolvedOptions().maximumFractionDigits ?? 2));
}
```

`Intl.NumberFormat#format` is typed to take a number, a bigint or a `` `${number}` `` string, so a
plain `string` fails with TS2769; the guard narrows it. When the app gains translations the locale
comes from i18next (`frontend-i18n`).

```ts,verify,test
import { expect, test } from "vitest";
import { formatMinor } from "@/shared/lib/format-money";

const euro = new Intl.NumberFormat("en", { style: "currency", currency: "EUR" });

test("a decimal string keeps digits that parseFloat loses", () => {
  const amount = "12345678901234567.89";
  expect(euro.format(amount)).toBe("€12,345,678,901,234,567.89");
  expect(euro.format(Number.parseFloat(amount))).toBe("€12,345,678,901,234,568.00");
});

test("minor units follow each currency's own fraction digits", () => {
  expect(formatMinor(123_456, "USD")).toBe("$1,234.56");
  expect(formatMinor(123_456, "JPY")).toBe("¥123,456");
  expect(formatMinor(123_456, "KWD")).toBe("KWD\u00a0123.456");
});
```
