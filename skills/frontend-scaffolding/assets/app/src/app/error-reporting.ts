import type { AnyRouter } from "@tanstack/react-router";
import type { RootOptions } from "react-dom/client";

// React and the router catch render and loader errors in boundaries, so those never reach `window`.
// The standard `reportError` re-raises them as a window `error` event, the one place an error
// tracker listens; code that handles an error it cannot show calls `reportError` too.
export const rootErrorHandlers = {
  onUncaughtError: (error) => reportError(error),
  onCaughtError: (error) => reportError(error),
  onRecoverableError: (error) => reportError(error),
} satisfies RootOptions;

/** A chunk of the previous deploy is gone: a navigation reloads onto the new `index.html`. */
export function reloadOnStaleChunk(router: { state: Pick<AnyRouter["state"], "status"> }) {
  // Never `preventDefault()`: Vite would resolve the import with `undefined` and the router would report a
  // TypeError; uncancelled, the router recognises the failed import and waits for the reload.
  window.addEventListener("vite:preloadError", () => {
    // A preload on hover fails quietly; the click that follows is a navigation and reloads here.
    if (router.state.status !== "pending") return;
    // A failure within a minute of the last reload is not a stale deploy: no reload loop.
    const last = Number(sessionStorage.getItem("reloaded-for-stale-chunk"));
    if (Date.now() - last < 60_000) return;
    sessionStorage.setItem("reloaded-for-stale-chunk", String(Date.now()));
    location.reload();
  });
}
