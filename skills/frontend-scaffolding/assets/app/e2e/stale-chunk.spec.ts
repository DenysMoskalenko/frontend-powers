import { API_ORIGIN, expect, test } from "./fixtures.ts";

test("after a deploy, hovering a link keeps the page and clicking it loads the new build", async ({
  page,
  request,
}, testInfo) => {
  const name = `Stale ${testInfo.testId}-${testInfo.retry}`;
  const created = await request.post(`${API_ORIGIN}/users`, {
    data: { name, email: `e2e-${testInfo.testId}-${testInfo.retry}@example.com` },
  });
  const { id } = await created.json();
  let loads = 0;
  page.on("load", () => loads++);
  await page.goto("/users");
  const link = page.getByRole("link", { name });
  await expect(link).toBeVisible();
  // With sign-in a page load is two (the app, then the app back from the identity provider).
  const started = loads;

  // The deploy: the route's old chunk is gone (a 404, as the container answers), and after one
  // reload the tab runs the new build, whose chunks exist.
  await page.route("**/assets/_userId-*.js", (route) =>
    loads === started
      ? route.fulfill({ status: 404, headers: { "cache-control": "no-cache" } })
      : route.continue(),
  );
  const preload = page.waitForResponse((response) => response.url().includes("/_userId-"));
  await link.hover();
  await preload;
  // Throws "Execution context was destroyed" if the failed preload reloads the page.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve, 500)));
  expect(loads).toBe(started);

  await link.click();

  await expect(page.getByRole("heading", { name })).toBeVisible();
  await expect(page).toHaveURL(`/users/${id}`);
  expect(loads).toBeGreaterThan(started);
});
