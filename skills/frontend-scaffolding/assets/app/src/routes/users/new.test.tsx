import { screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
import type { UserResponse } from "@/api/generated/api";
import {
  getCreateUserMockHandler,
  getGetUserMockHandler,
  getListUsersMockHandler,
} from "@/api/generated/api.msw";
import { buildUser } from "@/test/factories/user";
import { renderRoute, TEST_API_ORIGIN } from "@/test/render-route";
import { server } from "@/test/server";

const errorAnswer = (status: number, body: object) =>
  http.post(`${TEST_API_ORIGIN}/users`, () => HttpResponse.json(body, { status }));

test("creating a user posts the form, opens the new user and refreshes the cached list", async () => {
  const ada = buildUser({ name: "Ada Lovelace", email: "ada@example.com" });
  const stored: UserResponse[] = [];
  const posted: unknown[] = [];
  server.use(
    getListUsersMockHandler(() => ({ items: stored, total: stored.length, limit: 20, offset: 0 })),
    getCreateUserMockHandler(async ({ request }) => {
      posted.push(await request.json());
      stored.push(ada);
      return ada;
    }),
    getGetUserMockHandler(ada),
  );
  const { user } = renderRoute("/users");
  await screen.findByText("No users yet.");
  await user.click(screen.getByRole("link", { name: "New user" }));

  await user.type(await screen.findByRole("textbox", { name: "Name" }), "Ada Lovelace");
  await user.type(screen.getByRole("textbox", { name: "Email" }), "ada@example.com");
  await user.click(screen.getByRole("button", { name: "Create user" }));

  expect(await screen.findByRole("heading", { name: "Ada Lovelace" })).toBeInTheDocument();
  expect(posted).toEqual([{ name: "Ada Lovelace", email: "ada@example.com" }]);

  await user.click(screen.getByRole("link", { name: "Users" }));

  const table = await screen.findByRole("table", { name: "Users" });
  expect(within(table).getByRole("link", { name: "Ada Lovelace" })).toBeInTheDocument();
});

test("an invalid form shows field errors, focuses the first one and sends nothing", async () => {
  const { user } = renderRoute("/users/new");
  expect(await screen.findByRole("heading", { name: "New user" })).toBeInTheDocument();
  expect(document.title).toBe("New user");

  await user.type(await screen.findByRole("textbox", { name: "Email" }), "not-an-email");
  await user.click(screen.getByRole("button", { name: "Create user" }));

  expect(screen.getByRole("textbox", { name: "Name" })).toHaveAttribute("aria-invalid", "true");
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Name" })).toHaveFocus());
  expect(screen.getByRole("textbox", { name: "Email" })).toHaveAccessibleDescription(
    "Invalid email address",
  );
});

test("the server's field errors show under their fields", async () => {
  server.use(
    errorAnswer(422, {
      error: "validation failed",
      details: { email: [{ code: "email", message: "must be a deliverable address", params: {} }] },
    }),
  );
  const { user } = renderRoute("/users/new");

  await user.type(await screen.findByRole("textbox", { name: "Name" }), "Ada");
  await user.type(screen.getByRole("textbox", { name: "Email" }), "ada@example.com");
  await user.click(screen.getByRole("button", { name: "Create user" }));

  expect(await screen.findByText("must be a deliverable address")).toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Email" })).toHaveAccessibleDescription(
    "must be a deliverable address",
  );
  await waitFor(() => expect(screen.getByRole("textbox", { name: "Email" })).toHaveFocus());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

test("a server error for a field the form does not show is a form error", async () => {
  server.use(
    errorAnswer(422, {
      error: "validation failed",
      details: { role: [{ code: "role", message: null, params: {} }] },
    }),
  );
  const { user } = renderRoute("/users/new");

  await user.type(await screen.findByRole("textbox", { name: "Name" }), "Ada");
  await user.type(screen.getByRole("textbox", { name: "Email" }), "ada@example.com");
  await user.click(screen.getByRole("button", { name: "Create user" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The server rejected the user for a reason this form cannot show.",
  );
});

test("an unexpected server error is a form error with the request id", async () => {
  server.use(errorAnswer(500, { error: "internal server error", request_id: "req-5" }));
  const { user } = renderRoute("/users/new");

  await user.type(await screen.findByRole("textbox", { name: "Name" }), "Ada");
  await user.type(screen.getByRole("textbox", { name: "Email" }), "ada@example.com");
  await user.click(screen.getByRole("button", { name: "Create user" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The user was not created. Try again. Request id: req-5",
  );
  expect(screen.queryByText("The change was not saved")).not.toBeInTheDocument();
});

test("a taken email is a form error, not a toast", async () => {
  server.use(errorAnswer(409, { error: "conflict", request_id: "req-9" }));
  const { user } = renderRoute("/users/new");

  await user.type(await screen.findByRole("textbox", { name: "Name" }), "Ada");
  await user.type(screen.getByRole("textbox", { name: "Email" }), "ada@example.com");
  await user.click(screen.getByRole("button", { name: "Create user" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "A user with this email already exists.",
  );
  expect(screen.queryByText("The change was not saved")).not.toBeInTheDocument();
  expect(screen.getByRole("textbox", { name: "Email" })).toHaveValue("ada@example.com");
});

test("leaving a filled-in form asks first and stays when the user cancels", async () => {
  const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
  const { user, router } = renderRoute("/users/new");

  await user.type(await screen.findByRole("textbox", { name: "Name" }), "Ada");
  await user.click(screen.getByRole("link", { name: "Users" }));

  expect(confirm).toHaveBeenCalledWith("Discard the new user?");
  expect(router.state.location.pathname).toBe("/users/new");
  expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Ada");
});
