import { expect, test, vi } from "vitest";
import * as z from "zod";
import { ApiError } from "@/api/api-error";
import { createQueryClient } from "./query-client";

const apiError = (status: number) => new ApiError({ status, message: `HTTP ${status}`, body: "" });

test.each([
  ["a 503", 0, apiError(503), true],
  ["a 429", 0, apiError(429), true],
  ["a network failure", 0, new TypeError("Failed to fetch"), true],
  ["a second 503", 1, apiError(503), true],
  ["a third 503", 2, apiError(503), false],
  ["a 500", 0, apiError(500), false],
  ["a 404", 0, apiError(404), false],
  ["a read timeout", 0, new DOMException("No response in time", "TimeoutError"), false],
  ["an abort", 0, new DOMException("The operation was aborted", "AbortError"), false],
  ["a broken 2xx body", 0, new SyntaxError("Unexpected end of JSON input"), false],
  ["a schema error", 0, new z.ZodError([]), false],
])("%s after %i failures is retried: %s", (_name, failureCount, error, retried) => {
  const { retry } = createQueryClient(() => {}).getDefaultOptions().queries ?? {};

  expect(typeof retry === "function" && retry(failureCount, error)).toBe(retried);
});

test.each([
  ["a query", {}, ["refresh"]],
  ["a silent query", { meta: { silent: true } }, []],
])("a failed refresh of %s notifies: %j", async (_name, options, reasons) => {
  const notify = vi.fn();
  const client = createQueryClient(notify);
  client.setQueryData(["users"], []);

  await client
    .fetchQuery({
      queryKey: ["users"],
      queryFn: () => Promise.reject(new TypeError("Failed to fetch")),
      staleTime: 0,
      retry: false,
      ...options,
    })
    .catch(() => {});

  expect(notify.mock.calls.map(([reason]) => reason)).toEqual(reasons);
});
