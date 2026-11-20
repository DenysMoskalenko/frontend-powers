import { expect, test } from "vitest";
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
])("%s after %i failures is retried: %s", (_name, failureCount, error, retried) => {
  const { retry } = createQueryClient(() => {}).getDefaultOptions().queries ?? {};

  expect(typeof retry === "function" && retry(failureCount, error)).toBe(retried);
});
