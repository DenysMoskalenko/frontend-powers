import { screen, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
import { getListUsersMockHandler } from "@/api/generated/api.msw";
import { buildUser } from "@/test/factories/user";
import { renderRoute, TEST_API_ORIGIN } from "@/test/render-route";
import { server } from "@/test/server";

test("lists the users the API returns, linked to their pages", async () => {
  const ada = buildUser({ name: "Ada Lovelace", email: "ada@example.com" });
  server.use(getListUsersMockHandler({ items: [ada], total: 1, limit: 20, offset: 0 }));

  renderRoute("/users");

  const table = await screen.findByRole("table", { name: "Users" });
  const row = within(table).getByRole("row", { name: /Ada Lovelace/ });
  expect(row).toHaveTextContent("Ada Lovelaceada@example.comNov 1, 2026, 9:30 AM");
  expect(within(row).getByRole("link", { name: "Ada Lovelace" })).toHaveAttribute(
    "href",
    `/users/${ada.id}`,
  );
  expect(document.title).toBe("Users");
});

test("the page number in the URL selects the API page", async () => {
  const requested: string[] = [];
  server.use(
    getListUsersMockHandler(({ request }) => {
      requested.push(new URL(request.url).search);
      return { items: [buildUser()], total: 45, limit: 20, offset: 20 };
    }),
  );

  renderRoute("/users?page=2");

  expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
  expect(requested).toEqual(["?limit=20&offset=20"]);
});

test("an invalid page number falls back to the first page", async () => {
  const requested: string[] = [];
  server.use(
    getListUsersMockHandler(({ request }) => {
      requested.push(new URL(request.url).search);
      return { items: [], total: 0, limit: 20, offset: 0 };
    }),
  );

  renderRoute("/users?page=abc");

  expect(await screen.findByText("No users yet.")).toBeInTheDocument();
  expect(screen.getByText("Page 1 of 1")).toBeInTheDocument();
  expect(requested).toEqual(["?limit=20&offset=0"]);
});

test("a page past the end opens the last page", async () => {
  server.use(
    getListUsersMockHandler(({ request }) => {
      const offset = Number(new URL(request.url).searchParams.get("offset"));
      return { items: offset < 45 ? [buildUser()] : [], total: 45, limit: 20, offset };
    }),
  );

  const { router } = renderRoute("/users?page=9&view=compact");

  expect(await screen.findByText("Page 3 of 3")).toBeInTheDocument();
  expect(router.state.location.search).toEqual({ page: 3, view: "compact" });
  expect(router.history.length).toBe(1);
});

test("Next moves to the following page", async () => {
  server.use(
    getListUsersMockHandler(({ request }) => {
      const offset = Number(new URL(request.url).searchParams.get("offset"));
      return { items: [buildUser({ name: `User at ${offset}` })], total: 21, limit: 20, offset };
    }),
  );
  const { user, router } = renderRoute("/users?view=compact");

  await user.click(await screen.findByRole("link", { name: "Next" }));

  expect(await screen.findByRole("link", { name: "User at 20" })).toBeInTheDocument();
  expect(router.state.location.search).toEqual({ page: 2, view: "compact" });
});

test("Previous keeps the other search keys", async () => {
  server.use(
    getListUsersMockHandler(({ request }) => {
      const offset = Number(new URL(request.url).searchParams.get("offset"));
      return { items: [buildUser({ name: `User at ${offset}` })], total: 45, limit: 20, offset };
    }),
  );
  const { user, router } = renderRoute("/users?page=3&view=compact");

  await user.click(await screen.findByRole("link", { name: "Previous" }));

  expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
  expect(router.state.location.search).toEqual({ page: 2, view: "compact" });
});

test("a failed first load shows the error screen inside the layout", async () => {
  server.use(
    http.get(`${TEST_API_ORIGIN}/users`, () =>
      HttpResponse.json({ error: "internal server error", request_id: "req-2" }, { status: 500 }),
    ),
  );

  renderRoute("/users");

  expect(await screen.findByRole("alert")).toHaveTextContent("Request id: req-2");
  expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  expect(screen.queryByText("Could not refresh the data")).not.toBeInTheDocument();
  expect(document.title).toBe("This page could not be loaded");
});

test("a failed background refresh keeps the list and shows a toast", async () => {
  server.use(
    getListUsersMockHandler({
      items: [buildUser({ name: "Ada" })],
      total: 1,
      limit: 20,
      offset: 0,
    }),
  );
  renderRoute("/users");
  await screen.findByRole("link", { name: "Ada" });
  server.use(
    http.get(`${TEST_API_ORIGIN}/users`, () =>
      HttpResponse.json({ error: "internal server error", request_id: "req-1" }, { status: 500 }),
    ),
  );

  // The user comes back to the tab after the list went stale.
  vi.setSystemTime(Date.now() + 60_000);
  window.dispatchEvent(new Event("visibilitychange"));

  expect(await screen.findByText("Could not refresh the data")).toBeInTheDocument();
  expect(screen.getByText("Request id: req-1")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ada" })).toBeInTheDocument();
});
