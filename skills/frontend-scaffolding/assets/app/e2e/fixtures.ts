import { test as base, expect, type Page } from "@playwright/test";

/** Where the stub API listens; a real backend's origin works the same way. */
export const API_ORIGIN = "http://127.0.0.1:4010";

interface Options {
  /** Errors a spec provokes on purpose (the route error screen reports one); others still fail it. */
  expectedErrors: RegExp[];
}

/**
 * Every test fails on a console error, an uncaught page error or a CSP / Trusted Types violation.
 * "Failed to load resource" is the browser logging an HTTP error status a test asked for.
 */
export const test = base.extend<Options & { guard: undefined }>({
  expectedErrors: [[], { option: true }],
  guard: [
    async ({ page, expectedErrors }, use) => {
      const problems: string[] = [];
      const record = (text: string) => {
        if (!expectedErrors.some((expected) => expected.test(text))) problems.push(text);
      };
      page.on("console", (message) => {
        if (message.type() === "error" && !message.text().startsWith("Failed to load resource")) {
          record(message.text());
        }
      });
      page.on("pageerror", (error) => record(error.message));
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

/** The page never scrolls sideways (a wide table scrolls inside its own container). */
export async function expectNoSidewaysScroll(page: Page) {
  const { scrollWidth, clientWidth } = await page.evaluate(() => {
    const root = document.documentElement;
    return { scrollWidth: root.scrollWidth, clientWidth: root.clientWidth };
  });
  expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
}

export { expect };
