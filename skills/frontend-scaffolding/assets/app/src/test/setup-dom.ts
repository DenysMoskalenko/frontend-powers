// `*.test.tsx` and `*.dom.test.ts` only, after setup.ts.
import "@testing-library/jest-dom/vitest";
import { configure } from "@testing-library/dom";
import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// The bound only ends a hang; a loaded CI machine must never reach it.
configure({ asyncUtilTimeout: 5_000 });
// jsdom has no layout; the router restores scroll after every navigation.
window.scrollTo = () => {};

// Runs before setup.ts's afterEach (hooks run in reverse), so an unmount's reportError still fails the test.
afterEach(() => {
  // `globals: false` turns off Testing Library's automatic cleanup.
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});
