import { afterEach, expect, test, vi } from "vitest";
import { reloadOnStaleChunk, rootErrorHandlers } from "./error-reporting";

afterEach(() => sessionStorage.clear());

test("errors React caught in a boundary go to the standard reportError", () => {
  // The test setup's reportError fails a test that reports; this one expects the report.
  const reportError = vi.fn();
  vi.stubGlobal("reportError", reportError);
  const error = new Error("loader failed");

  rootErrorHandlers.onCaughtError(error);

  expect(reportError).toHaveBeenCalledWith(error);
});

test("a stale chunk reloads the page, but not twice within a minute", () => {
  const reload = vi.fn();
  vi.stubGlobal("location", { reload });
  vi.useFakeTimers({ toFake: ["Date"] });
  reloadOnStaleChunk();
  const staleChunk = () => {
    const event = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(event);
    return event;
  };

  expect(staleChunk().defaultPrevented).toBe(true);
  vi.advanceTimersByTime(59_000);
  expect(staleChunk().defaultPrevented).toBe(false);
  expect(reload).toHaveBeenCalledOnce();

  vi.advanceTimersByTime(2_000);
  expect(staleChunk().defaultPrevented).toBe(true);
  expect(reload).toHaveBeenCalledTimes(2);
});
