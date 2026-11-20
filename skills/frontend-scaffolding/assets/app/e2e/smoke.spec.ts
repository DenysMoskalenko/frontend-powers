import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { API_ORIGIN, expect, test } from "./fixtures.ts";

const uniqueEmail = (testId: string, retry: number) => `e2e-${testId}-${retry}@example.com`;

async function expectNoAxeViolations(page: Page) {
  const { violations } = await new AxeBuilder({ page })
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
    .analyze();
  expect(violations).toEqual([]);
}

test(
  "a user creates a user, opens it, and finds it in the list",
  { tag: "@smoke" },
  async ({ page }, testInfo) => {
    const email = uniqueEmail(testInfo.testId, testInfo.retry);
    const response = await page.goto("/");
    expect(response?.headers()["content-security-policy"]).toContain("trusted-types 'none'");

    await expect(page).toHaveURL("/users");
    await page.getByRole("link", { name: "New user" }).click();
    await page.getByRole("textbox", { name: "Name" }).fill("Ada Lovelace");
    await page.getByRole("textbox", { name: "Email" }).fill(email);
    await page.getByRole("button", { name: "Create user" }).click();

    await expect(page.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await page.getByRole("link", { name: "Users", exact: true }).click();
    await expect(page.getByRole("row", { name: new RegExp(email) })).toBeVisible();
  },
);

test("a failed background refresh shows a toast without breaking the CSP", async ({ page }) => {
  await page.clock.install();
  await page.goto("/users");
  await expect(page.getByRole("heading", { name: "Users" })).toBeVisible();
  // The stub cannot fail on demand: this one state is faked in the browser.
  await page.route(`${API_ORIGIN}/users?*`, (route) =>
    route.fulfill({
      status: 500,
      headers: { "access-control-allow-origin": "*" },
      json: { error: "internal server error", request_id: "e2e-500" },
    }),
  );

  await page.clock.fastForward("01:00");
  await page.evaluate(() => window.dispatchEvent(new Event("visibilitychange")));

  await expect(page.getByText("Could not refresh the data")).toBeVisible();
  await expect(page.getByText("Request id: e2e-500")).toBeVisible();
});

test("the user pages have no detectable accessibility violations in either colour scheme", async ({
  page,
  request,
}, testInfo) => {
  const created = await request.post(`${API_ORIGIN}/users`, {
    data: { name: "Grace Hopper", email: uniqueEmail(testInfo.testId, testInfo.retry) },
  });
  const { id } = await created.json();

  const pages: [path: string, heading: string][] = [
    ["/users", "Users"],
    ["/users/new", "New user"],
    [`/users/${id}`, "Grace Hopper"],
  ];
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    for (const [path, heading] of pages) {
      await page.goto(path);
      await expect(page.getByRole("heading", { name: heading })).toBeVisible();
      await expectNoAxeViolations(page);
    }
  }
});
