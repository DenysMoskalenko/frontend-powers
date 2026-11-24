import { onlineManager } from "@tanstack/react-query";
import { screen, waitFor, within } from "@testing-library/react";
import { delay, HttpResponse, http } from "msw";
import { afterEach, expect, test, vi } from "vitest";
import type { UserResponse } from "@/api/generated/api";
import {
  getCreateUserMockHandler,
  getGetUserMockHandler,
  getListUsersMockHandler,
} from "@/api/generated/api.msw";
import { buildUser } from "@/test/factories/user";
import { renderRoute, TEST_API_ORIGIN } from "@/test/render-route";
import { server } from "@/test/server";

afterEach(() => onlineManager.setOnline(true));

const errorAnswer = (status: number, body: object) =>
  http.post(`${TEST_API_ORIGIN}/users`, () => HttpResponse.json(body, { status }));

test("creating a user posts the form, opens the new user, and the cached list paints with them", async () => {
  const ada = buildUser({ name: "Ada Lovelace", email: "ada@example.com" });
  const stored: UserResponse[] = [];
  const posted: unknown[] = [];
  server.use(
    getListUsersMockHandler(async () => {
      // Slower than a paint, so a list painted from the old cache would be seen.
      if (stored.length > 0) await delay(100);
      return { items: stored, total: stored.length, limit: 20, offset: 0 };
    }),
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

  // The first paint of the list, not a later refetch, already has the new row.
  await screen.findByRole("heading", { name: "Users" });
  const table = screen.getByRole("table", { name: "Users" });
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
    "The user was not created. The server gave a reason this form cannot show.",
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

test("a conflict that names a field shows under that field, not as a toast", async () => {
  server.use(
    errorAnswer(409, {
      error: "conflict",
      details: { email: [{ code: "unique", message: "This email is already taken." }] },
    }),
  );
  const { user } = renderRoute("/users/new");

  await user.type(await screen.findByRole("textbox", { name: "Name" }), "Ada");
  await user.type(screen.getByRole("textbox", { name: "Email" }), "ada@example.com");
  await user.click(screen.getByRole("button", { name: "Create user" }));

  const email = screen.getByRole("textbox", { name: "Email" });
  await waitFor(() => expect(email).toHaveAccessibleDescription("This email is already taken."));
  expect(email).toHaveValue("ada@example.com");
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(screen.queryByText("The change was not saved")).not.toBeInTheDocument();
});

test("a conflict without a field is a form error", async () => {
  server.use(errorAnswer(409, { error: "conflict", request_id: "req-9" }));
  const { user } = renderRoute("/users/new");

  await user.type(await screen.findByRole("textbox", { name: "Name" }), "Ada");
  await user.type(screen.getByRole("textbox", { name: "Email" }), "ada@example.com");
  await user.click(screen.getByRole("button", { name: "Create user" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The user was not created. It conflicts with data saved earlier. Request id: req-9",
  );
});

test("after a failed submit a field's error follows its value", async () => {
  const { user } = renderRoute("/users/new");
  const email = await screen.findByRole("textbox", { name: "Email" });
  const name = screen.getByRole("textbox", { name: "Name" });
  await user.type(email, "ada");
  await user.click(screen.getByRole("button", { name: "Create user" }));
  await waitFor(() => expect(name).toHaveFocus());

  await user.type(email, "@example");
  expect(email).toHaveAccessibleDescription("Invalid email address");
  expect(name).toHaveAttribute("aria-invalid", "true");

  await user.type(email, ".com");
  expect(email).not.toHaveAttribute("aria-invalid");
  expect(name).toHaveAttribute("aria-invalid", "true");
});

test("a server field error stays while another field changes and goes when its own does", async () => {
  server.use(
    errorAnswer(422, {
      error: "validation failed",
      details: { email: [{ code: "email", message: "must be a deliverable address" }] },
    }),
  );
  const { user } = renderRoute("/users/new");
  const name = await screen.findByRole("textbox", { name: "Name" });
  const email = screen.getByRole("textbox", { name: "Email" });
  await user.type(name, "Ada");
  await user.type(email, "ada@example.com");
  await user.click(screen.getByRole("button", { name: "Create user" }));
  await waitFor(() => expect(email).toHaveFocus());
  expect(email).toHaveAccessibleDescription("must be a deliverable address");

  await user.type(name, " Lovelace");
  expect(email).toHaveAccessibleDescription("must be a deliverable address");

  await user.type(email, "m");
  expect(email).not.toHaveAttribute("aria-invalid");
});

test("submitting again after a server error asks the server again", async () => {
  let posts = 0;
  server.use(
    http.post(`${TEST_API_ORIGIN}/users`, () => {
      posts += 1;
      return HttpResponse.json(
        {
          error: "validation failed",
          details: { email: [{ code: "email", message: "try later" }] },
        },
        { status: 422 },
      );
    }),
  );
  const { user } = renderRoute("/users/new");
  await user.type(await screen.findByRole("textbox", { name: "Name" }), "Ada");
  await user.type(screen.getByRole("textbox", { name: "Email" }), "ada@example.com");
  const submit = screen.getByRole("button", { name: "Create user" });

  await user.click(submit);
  await screen.findByText("try later");
  await user.click(submit);

  await waitFor(() => expect(posts).toBe(2));
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

test("a submit while offline fails at once and is never sent later", async () => {
  let posts = 0;
  server.use(
    http.post(`${TEST_API_ORIGIN}/users`, () => {
      posts += 1;
      return HttpResponse.error();
    }),
  );
  const { user } = renderRoute("/users/new");
  await user.type(await screen.findByRole("textbox", { name: "Name" }), "Ada");
  await user.type(screen.getByRole("textbox", { name: "Email" }), "ada@example.com");
  onlineManager.setOnline(false);

  await user.click(screen.getByRole("button", { name: "Create user" }));

  expect(await screen.findByRole("alert")).toHaveTextContent(
    "The user was not created. Try again.",
  );
  expect(screen.getByRole("button", { name: "Create user" })).toBeEnabled();
  onlineManager.setOnline(true);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(posts).toBe(1);
});
