import { screen } from "@testing-library/react";
import { expect, test } from "vitest";
import { getListUsersMockHandler } from "@/api/generated/api.msw";
import { renderRoute } from "@/test/render-route";
import { server } from "@/test/server";

test("the root path opens the user list", async () => {
  server.use(getListUsersMockHandler({ items: [], total: 0, limit: 20, offset: 0 }));

  const { router } = renderRoute("/");

  expect(await screen.findByRole("heading", { name: "Users" })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe("/users");
});

test("an unknown path shows the not-found page", async () => {
  renderRoute("/no-such-page");

  expect(await screen.findByRole("heading", { name: "Page not found" })).toBeInTheDocument();
  expect(screen.getByRole("navigation", { name: "Main" })).toBeInTheDocument();
  expect(document.title).toBe("Page not found");
});
