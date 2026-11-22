import { screen, waitFor } from "@testing-library/react";
import { expect, test } from "vitest";
import { getListUsersMockHandler } from "@/api/generated/api.msw";
import { buildUser } from "@/test/factories/user";
import { renderRoute } from "@/test/render-route";
import { server } from "@/test/server";

const listUsers = () =>
  getListUsersMockHandler(({ request }) => {
    const offset = Number(new URL(request.url).searchParams.get("offset"));
    return { items: [buildUser({ name: `User at ${offset}` })], total: 45, limit: 20, offset };
  });

test("search values keep the text the URL carries; a number is a number only as typed", async () => {
  server.use(listUsers());

  const { router } = renderRoute("/users?page=2&q=1.50&e=1e3&id=12345678901234567890");

  expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
  expect(router.state.location.search).toEqual({
    page: 2,
    q: "1.50",
    e: "1e3",
    id: "12345678901234567890",
  });
  expect(router.options.stringifySearch({ q: "1.50", page: 2 })).toBe("?q=1.50&page=2");
});

test("a navigation to another page moves focus to its heading", async () => {
  server.use(listUsers());
  const { user } = renderRoute("/users");
  await screen.findByText("Page 1 of 3");

  await user.click(screen.getByRole("link", { name: "New user" }));

  const heading = await screen.findByRole("heading", { level: 1, name: "New user" });
  await waitFor(() => expect(heading).toHaveFocus());
});

test("a search-only navigation leaves focus where it is", async () => {
  server.use(listUsers());
  const { user } = renderRoute("/users");
  await screen.findByText("Page 1 of 3");
  const next = screen.getByRole("link", { name: "Next" });

  await user.click(next);

  expect(await screen.findByText("Page 2 of 3")).toBeInTheDocument();
  expect(next).toHaveFocus();
});

test("the first render focuses nothing", async () => {
  server.use(listUsers());

  renderRoute("/users");

  expect(await screen.findByText("Page 1 of 3")).toBeInTheDocument();
  expect(document.body).toHaveFocus();
});
