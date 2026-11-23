import { expect, test, vi } from "vitest";
import { reloadOnStaleChunk, rootErrorHandlers } from "./error-reporting";

test("errors React caught in a boundary go to the standard reportError", () => {
  // The test setup's reportError fails a test that reports; this one expects the report.
  const reportError = vi.fn();
  vi.stubGlobal("reportError", reportError);
  const error = new Error("loader failed");

  rootErrorHandlers.onCaughtError(error);

  expect(reportError).toHaveBeenCalledWith(error);
});

test("a stale chunk reloads during a navigation only, and not twice within a minute", () => {
  const reload = vi.fn();
  vi.stubGlobal("location", { reload });
  vi.useFakeTimers({ toFake: ["Date"] });
  const router: { state: { status: "idle" | "pending" } } = { state: { status: "idle" } };
  reloadOnStaleChunk(router);
  const staleChunk = () => {
    const event = new Event("vite:preloadError", { cancelable: true });
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  };

  // A hover's preload: the page stays.
  staleChunk();
  expect(reload).not.toHaveBeenCalled();

  router.state.status = "pending";
  staleChunk();
  vi.advanceTimersByTime(59_000);
  staleChunk();
  expect(reload).toHaveBeenCalledOnce();

  vi.advanceTimersByTime(2_000);
  staleChunk();
  expect(reload).toHaveBeenCalledTimes(2);
});
