import { screen } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { getGetUserMockHandler } from "@/api/generated/api.msw";
import { buildUser } from "@/test/factories/user";
import { renderRoute, TEST_API_ORIGIN } from "@/test/render-route";
import { server } from "@/test/server";

const id = "0193a1b2-0000-7000-8000-000000000001";

test("shows the user the API returns", async () => {
  server.use(
    getGetUserMockHandler(buildUser({ id, name: "Ada Lovelace", email: "ada@example.com" })),
  );

  renderRoute(`/users/${id}`);

  expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  expect(screen.getByText("ada@example.com")).toBeInTheDocument();
  expect(screen.getByText("Nov 1, 2026, 9:30 AM")).toBeInTheDocument();
  expect(document.title).toBe("Ada Lovelace");
});

test("an id the API does not know shows the not-found page", async () => {
  server.use(
    http.get(`${TEST_API_ORIGIN}/users/:id`, () =>
      HttpResponse.json({ error: `user ${id} not found` }, { status: 404 }),
    ),
  );

  renderRoute(`/users/${id}`);

  expect(await screen.findByRole("heading", { name: "User not found" })).toBeInTheDocument();
  expect(document.title).toBe("User not found");
});

test("a server error shows the request id, and Try again reloads the user", async () => {
  server.use(
    http.get(
      `${TEST_API_ORIGIN}/users/:id`,
      () =>
        HttpResponse.json({ error: "internal server error", request_id: "req-7" }, { status: 500 }),
      { once: true },
    ),
    getGetUserMockHandler(buildUser({ id, name: "Ada Lovelace" })),
  );
  const { user } = renderRoute(`/users/${id}`);

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("This page could not be loaded");
  expect(alert).toHaveTextContent("Request id: req-7");

  await user.click(screen.getByRole("button", { name: "Try again" }));

  expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
});

test("a malformed id shows the not-found page without asking the API", async () => {
  renderRoute("/users/not-a-uuid");

  expect(await screen.findByRole("heading", { name: "User not found" })).toBeInTheDocument();
});
