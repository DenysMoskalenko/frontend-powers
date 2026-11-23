import { MutationObserver } from "@tanstack/react-query";
import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
import { getListUsersMockHandler } from "@/api/generated/api.msw";
import { buildUser } from "@/test/factories/user";
import { renderRoute, TEST_API_ORIGIN } from "@/test/render-route";
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

test("a failure toast is announced at once and stays until dismissed", async () => {
  vi.useFakeTimers();
  // Testing Library advances fake timers only through a global `jest`.
  vi.stubGlobal("jest", { advanceTimersByTime: vi.advanceTimersByTime });
  // renderRoute's `user` waits on real timers and would hang here.
  const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
  server.use(getListUsersMockHandler({ items: [buildUser()], total: 1, limit: 20, offset: 0 }));
  renderRoute("/users");
  await screen.findByText("Page 1 of 1");
  failListUsers();

  // The list went stale and the user comes back to the tab.
  returnToTab();

  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Could not refresh the data");
  expect(alert).toHaveTextContent("Request id: req-1");
  await act(() => vi.advanceTimersByTimeAsync(60_000));
  expect(alert).toBeInTheDocument();

  // F6 moves focus into the toasts, which un-hides their Dismiss button.
  await user.keyboard("{F6}");
  await user.click(screen.getByRole("button", { name: "Dismiss" }));
  await act(() => vi.advanceTimersByTimeAsync(1_000));
  expect(alert).not.toBeInTheDocument();
});

test("a repeated failure updates its toast with the latest request id; another reason adds one", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("jest", { advanceTimersByTime: vi.advanceTimersByTime });
  server.use(getListUsersMockHandler({ items: [buildUser()], total: 1, limit: 20, offset: 0 }));
  const { router } = renderRoute("/users");
  await screen.findByText("Page 1 of 1");
  failListUsers();

  returnToTab();
  const alert = await screen.findByRole("alert");
  expect(alert).toHaveTextContent("Request id: req-1");
  returnToTab();
  await waitFor(() => expect(alert).toHaveTextContent("Request id: req-2"));
  expect(screen.getAllByRole("alert")).toHaveLength(1);

  const failing = new MutationObserver(router.options.context.queryClient, {
    mutationFn: () => Promise.reject(new Error("not saved")),
  });
  await act(() => failing.mutate().catch(() => undefined));
  await waitFor(() => expect(screen.getAllByRole("alert")).toHaveLength(2));
  expect(screen.getAllByRole("alert")[0]).toHaveTextContent("The change was not saved");
});

function failListUsers() {
  let failures = 0;
  server.use(
    http.get(`${TEST_API_ORIGIN}/users`, () => {
      failures += 1;
      return HttpResponse.json(
        { error: "internal server error", request_id: `req-${failures}` },
        { status: 500 },
      );
    }),
  );
}

/** Makes the cached list stale and fires the focus refetch. */
function returnToTab() {
  vi.setSystemTime(Date.now() + 60_000);
  window.dispatchEvent(new Event("visibilitychange"));
}
