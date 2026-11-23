import { defineConfig, devices } from "@playwright/test";
import { API_ORIGIN } from "./e2e/fixtures.ts";

const isCI = !!process.env.CI;
const APP_ORIGIN = "http://localhost:4173";

export default defineConfig({
  testDir: "e2e",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  // A test that passes only on a retry fails CI; the retry still records its trace.
  failOnFlakyTests: isCI,
  reporter: isCI ? [["list"], ["junit", { outputFile: "test-results/junit.xml" }]] : "list",
  use: { baseURL: APP_ORIGIN, trace: "on-first-retry" },
  projects: [
    { name: "chromium", use: devices["Desktop Chrome"] },
    // Safari's engine on a phone-sized touch screen: the narrow layout and WebKit-only bugs.
    { name: "phone", use: devices["iPhone 17e"] },
  ],
  webServer: [
    {
      command: "node e2e/stub-api.ts",
      url: `${API_ORIGIN}/health/live`,
      env: { PORT: new URL(API_ORIGIN).port },
      reuseExistingServer: !isCI,
    },
    {
      // The production build with the generated security headers, as users get it.
      command: "pnpm build && pnpm preview",
      url: APP_ORIGIN,
      env: { PUBLIC_API_ORIGIN: API_ORIGIN },
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
  ],
});
