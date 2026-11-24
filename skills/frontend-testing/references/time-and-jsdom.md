# Time and jsdom

## Contents

- [Pinning now](#pinning-now)
- [A test in another time zone](#a-test-in-another-time-zone)
- [Fake timers with user-event](#fake-timers-with-user-event)
- [jsdom gaps](#jsdom-gaps)
- [Stub helpers](#stub-helpers)

## Pinning now

- `TZ=UTC` is set for every test in the Vitest config, so `formatDateTime("2026-11-01T09:30:00Z")` renders `Nov 1, 2026, 9:30 AM` on every machine.
- `vi.setSystemTime(...)` without `vi.useFakeTimers()` fakes `Date` only: `findBy*`, MSW, React and TanStack Query keep their real timers. That is enough to make cached data stale (`vi.setSystemTime(Date.now() + 60_000)` before a `visibilitychange` event, as `src/routes/users/index.test.tsx` does) and to pin "today".
- No config option resets the system time; the setup file's `afterEach` calls `vi.useRealTimers()`, which does.

## A test in another time zone

`TZ=UTC` hides the bug a calendar date (`YYYY-MM-DD`) has west of UTC, where `new Date("2026-03-01")` is still 28 February. One test runs under another zone with `vi.stubEnv("TZ", "America/New_York")`: from that line `Date` and every `Intl` formatter built afterwards use New York, in both projects, and `unstubEnvs` puts UTC back before the next test. No separate file or project is needed. A formatter built at module level keeps the zone it was built in, so a statically imported helper still formats in UTC and the test passes against the buggy version too: import the module afresh after the stub.

The helper and its rule are `frontend-code-style`'s; this block repeats its `src/shared/lib/format-date.ts` only so the test below runs on its own:

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
import { expect, test, vi } from "vitest";

test("a calendar date keeps its day for a user in New York", async () => {
  vi.stubEnv("TZ", "America/New_York");
  // A module-level Intl formatter keeps the zone it was built in: build it again under New York.
  vi.resetModules();
  const { formatDate } = await import("@/shared/lib/format-date");

  expect(new Date("2026-03-01").getDate()).toBe(28);
  expect(formatDate("2026-03-01")).toBe("Mar 1, 2026");
});
```

The first assertion proves the zone took effect, so the test cannot pass by accident. Measured at Vitest 5.1: with a formatter built without `timeZone: "UTC"`, this test fails with `"Feb 28, 2026"`; the same test with a static import passes.

## Fake timers with user-event

Use `vi.useFakeTimers()` only when the behaviour is a timer: a toast's auto-close, a debounce, polling, a retry delay. Three things are required at Vitest 5.1 with Testing Library, each verified by a hang without it:

1. `vi.stubGlobal("jest", { advanceTimersByTime: vi.advanceTimersByTime })`. Testing Library detects fake timers only through a global `jest`; without it `findBy*` and its `act` drain wait on timers nobody advances and the test times out. `unstubGlobals` removes the stub after the test.
2. A user-event instance of your own: `userEvent.setup({ advanceTimers: vi.advanceTimersByTime })`. The `user` that `renderRoute` returns waits on timers between actions and hangs under fake timers.
3. Advance with `await act(() => vi.advanceTimersByTimeAsync(ms))`, then assert with `getBy*` or on an element you already hold.

`vi.useFakeTimers({ shouldAdvanceTime: true })` is not a substitute: it advances on the wall clock as well, so a 1000 ms debounce had already fired after a 999 ms advance.

A failure toast is persistent and assertive (`timeout: 0`, `priority: "high"`; the options are `tailwind-base-ui`'s): it stays until dismissed, its text is announced through a visually hidden `role="alert"` copy, and its Dismiss button is `aria-hidden` until F6 moves focus into the toasts. The test below pins all three:

```tsx,verify,test
import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
import { getListUsersMockHandler } from "@/api/generated/api.msw";
import { buildUser } from "@/test/factories/user";
import { renderRoute, TEST_API_ORIGIN } from "@/test/render-route";
import { server } from "@/test/server";

test("a failed refresh toast stays until the user dismisses it", async () => {
  vi.useFakeTimers();
  // Testing Library advances fake timers only through a global `jest`.
  vi.stubGlobal("jest", { advanceTimersByTime: vi.advanceTimersByTime });
  // renderRoute's `user` waits on real timers and would hang here.
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  server.use(
    getListUsersMockHandler({
      items: [buildUser({ name: "Ada" })],
      total: 1,
      limit: 20,
      offset: 0,
    }),
  );
  renderRoute("/users");
  await screen.findByRole("link", { name: "Ada" });
  server.use(
    http.get(`${TEST_API_ORIGIN}/users`, () =>
      HttpResponse.json({ error: "internal server error", request_id: "req-1" }, { status: 500 }),
    ),
  );

  vi.setSystemTime(Date.now() + 60_000);
  window.dispatchEvent(new Event("visibilitychange"));
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Could not refresh the data");

  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(alert).toBeInTheDocument();

  // F6 moves focus into the toasts, which un-hides their Dismiss button.
  await user.keyboard("{F6}");
  await user.click(screen.getByRole("button", { name: "Dismiss" }));
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(screen.queryByText("Could not refresh the data")).not.toBeInTheDocument();
});
```

MSW 3 does not touch timers; a handler that calls `delay(ms)` needs the same `advanceTimersByTimeAsync` to answer.

## jsdom gaps

Measured in jsdom 31.0 under the scaffold's setup.

| Missing or different | What happens | Do |
|---|---|---|
| Layout: `getBoundingClientRect()` and `offsetWidth`/`offsetHeight` are `0` | a virtualized list renders no rows; anything measured has size zero | assert layout in Playwright; when a component only needs a size to render, `vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(40)` (restored by `restoreMocks`) |
| `window.scrollTo`, `scrollBy`: "Not implemented" | the router calls `scrollTo` on every navigation | `src/test/setup-dom.ts` assigns a no-op `scrollTo`; add others there the same way when a component calls them |
| `Element.prototype.scrollIntoView` is `undefined` | `TypeError: … is not a function` in the component | add `Element.prototype.scrollIntoView = () => {};` beside the `scrollTo` line in `src/test/setup-dom.ts` |
| `matchMedia` is `undefined` | `TypeError` on first render of anything reading a media query | `stubMatchMedia` below, per test |
| `ResizeObserver`, `IntersectionObserver` are `undefined` | `ReferenceError` on mount | `stubObservers` below, per test; what they would observe is Playwright's |
| The platform `reportError` only dispatches an `error` event and logs `Uncaught [Error: …]` to the virtual console | a reported error would pass the test, so the setup file replaces it with one that records each call and fails the test after its body | a test that expects a report: `vi.stubGlobal("reportError", vi.fn())` and assert the call, as `src/app/error-reporting.dom.test.ts` does |
| A focused element that becomes disabled or hidden keeps focus until the next animation frame, then blurs to `body` | `expect(document.body).toHaveFocus()` right after the change fails | `await waitFor(() => expect(document.body).toHaveFocus())`, or assert where the app moves focus next |
| `window.confirm`, `alert`: "Not implemented", return `undefined` | a `useBlocker` confirm always cancels | `vi.spyOn(window, "confirm").mockReturnValue(false)` and assert `toHaveBeenCalledWith("Discard the new user?")` |
| `navigator.clipboard` is `undefined` until `userEvent.setup()` installs a stub | the stub is never reset under `globals: false`: text copied in one test is read by the next | read what was copied in the same test; never assert an empty clipboard |
| File inputs | `await user.upload(screen.getByLabelText("File"), new File(["a,b"], "users.csv", { type: "text/csv" }))` works and honours `accept` | no stub |
| `HTMLDialogElement.prototype.showModal` is `undefined` | native `<dialog>` cannot open | Base UI `Dialog` does not use it; a native dialog is tested in Playwright |
| `EventSource` is `undefined`, `WebSocket` is real | a realtime client connects nowhere | realtime test recipes are `frontend-realtime`'s |

`vi.stubGlobal(name, value)` sets the property on `globalThis`, which is `window` here, and `unstubGlobals: true` removes it after each test. Assigning `window.matchMedia = …` directly is never undone and leaks into every later test in the file.

## Stub helpers

Add these to `src/test/` when the first component needs them, not before:

```ts,verify
// file: src/test/browser-stubs.ts
import { vi } from "vitest";

/** jsdom has no matchMedia: answers each query with `matches(query)`. Removed after the test. */
export function stubMatchMedia(matches: (query: string) => boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(() => false),
  }));
}

/** jsdom has neither observer; a component that only subscribes needs them to mount. */
export function stubObservers() {
  class NoopObserver {
    observe = vi.fn();
    unobserve = vi.fn();
    disconnect = vi.fn();
    takeRecords = vi.fn(() => []);
  }
  vi.stubGlobal("ResizeObserver", NoopObserver);
  vi.stubGlobal("IntersectionObserver", NoopObserver);
}
```

```ts,verify,test
// file: src/test/browser-stubs.dom.test.ts
import { expect, test } from "vitest";
import { stubMatchMedia, stubObservers } from "@/test/browser-stubs";

test("the stubs answer like the platform for the duration of one test", () => {
  stubMatchMedia((query) => query === "(prefers-color-scheme: dark)");
  stubObservers();

  expect(window.matchMedia("(prefers-color-scheme: dark)").matches).toBe(true);
  expect(window.matchMedia("(prefers-reduced-motion: reduce)").matches).toBe(false);
  expect(() => new ResizeObserver(() => {}).observe(document.body)).not.toThrow();
});

test("unstubGlobals removed them again", () => {
  expect(window.matchMedia).toBeUndefined();
  expect(globalThis.ResizeObserver).toBeUndefined();
});
```

The second test depends on order only in one direction: it passes whether it runs first or after the stubbing test, which is the property it pins.
