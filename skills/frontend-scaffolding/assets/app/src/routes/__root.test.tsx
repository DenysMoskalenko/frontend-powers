import { screen, waitForElementToBeRemoved } from "@testing-library/react";
import { expect, test } from "vitest";
import { getGetUserMockHandler, getListUsersMockHandler } from "@/api/generated/api.msw";
import { buildUser } from "@/test/factories/user";
import { renderRoute } from "@/test/render-route";
import { server } from "@/test/server";

test("a navigation that waits for its data shows a progress bar until the page is ready", async () => {
  const user = buildUser({ name: "Ada Lovelace" });
  const { promise: answered, resolve: answer } = Promise.withResolvers<void>();
  server.use(
    getListUsersMockHandler({ items: [user], total: 1, limit: 20, offset: 0 }),
    getGetUserMockHandler(async () => {
      await answered;
      return user;
    }),
  );
  const { user: pointer } = renderRoute("/users");

  await pointer.click(await screen.findByRole("link", { name: "Ada Lovelace" }));

  const progress = await screen.findByRole("progressbar", { name: "Loading page" });
  expect(screen.getByRole("heading", { name: "Users" })).toBeInTheDocument();
  answer();
  await waitForElementToBeRemoved(progress);
  expect(screen.getByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
});

test("a first load that waits for its data shows the layout and the progress bar", async () => {
  const user = buildUser({ name: "Ada Lovelace" });
  const { promise: answered, resolve: answer } = Promise.withResolvers<void>();
  server.use(
    getListUsersMockHandler(async () => {
      await answered;
      return { items: [user], total: 1, limit: 20, offset: 0 };
    }),
  );

  renderRoute("/users");

  const navigation = await screen.findByRole("navigation", { name: "Main" });
  const progress = screen.getByRole("progressbar", { name: "Loading page" });
  answer();
  await waitForElementToBeRemoved(progress);
  expect(screen.getByRole("heading", { name: "Users" })).toBeInTheDocument();
  // The same element: the layout is not mounted again, so focus or a held reference survives.
  expect(navigation).toBeInTheDocument();
});
