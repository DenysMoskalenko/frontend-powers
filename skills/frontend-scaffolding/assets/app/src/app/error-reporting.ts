import type { RootOptions } from "react-dom/client";

// React and the router catch render and loader errors in boundaries, so those never reach `window`.
// The standard `reportError` re-raises them as a window `error` event, the one place an error
// tracker listens; code that handles an error it cannot show calls `reportError` too.
export const rootErrorHandlers = {
  onUncaughtError: (error) => reportError(error),
  onCaughtError: (error) => reportError(error),
  onRecoverableError: (error) => reportError(error),
} satisfies RootOptions;

/** A route chunk of the previous deploy is gone: reload onto the new `index.html`. */
export function reloadOnStaleChunk() {
  window.addEventListener("vite:preloadError", (event) => {
    // A failure within a minute of the last reload is not a stale deploy: no reload loop.
    const last = Number(sessionStorage.getItem("reloaded-for-stale-chunk"));
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem("reloaded-for-stale-chunk", String(Date.now()));
    event.preventDefault();
    location.reload();
  });
}
