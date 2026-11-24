import { API_ORIGIN, expect, test } from "./fixtures.ts";

// The router reports the failed load to the error funnel, which the guard would otherwise fail.
test.use({ expectedErrors: [/e2e: the user is unavailable/] });

test("a page that fails to load shows the error screen, and Try again recovers", async ({
  page,
  request,
}, testInfo) => {
  const created = await request.post(`${API_ORIGIN}/users`, {
    data: {
      name: "Edsger Dijkstra",
      email: `e2e-${testInfo.testId}-${testInfo.retry}@example.com`,
    },
  });
  const { id } = await created.json();
  // The stub cannot fail on demand: the first request for this user is answered with a 500 here.
  let failed = false;
  await page.route(`${API_ORIGIN}/users/${id}`, async (route) => {
    if (failed) return route.continue();
    failed = true;
    await route.fulfill({
      status: 500,
      headers: { "access-control-allow-origin": "*" },
      json: { error: "e2e: the user is unavailable", request_id: "e2e-500" },
    });
  });

  await page.goto(`/users/${id}`);

  await expect(page.getByRole("heading", { name: "This page could not be loaded" })).toBeVisible();
  await expect(page.getByText("Request id: e2e-500")).toBeVisible();
  await page.getByRole("button", { name: "Try again" }).click();
  await expect(page.getByRole("heading", { name: "Edsger Dijkstra" })).toBeVisible();
});
