import { test as base, expect } from "@playwright/test";

/** Where the stub API listens; a real backend's origin works the same way. */
export const API_ORIGIN = "http://127.0.0.1:4010";

/**
 * Every test fails on a console error, an uncaught page error or a CSP / Trusted Types violation.
 * "Failed to load resource" is the browser logging an HTTP error status a test asked for.
 */
export const test = base.extend<{ guard: undefined }>({
  guard: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
          problems.push(message.text());
        }
      });
      page.on("pageerror", (error) => problems.push(error.message));
      await page.addInitScript(() => {
        document.addEventListener("securitypolicyviolation", (event) => {
          console.error(`CSP violation: ${event.violatedDirective} ${event.blockedURI}`);
        });
      });
      await use(undefined);
      expect(problems).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
