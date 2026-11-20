import { expect, test } from "vitest";
import { toApiError } from "./api-error";

const response = (status: number, headers: Record<string, string> = {}) =>
  new Response(null, { status, headers });

test("an axum ErrorBody keeps its message and request id, and maps validator details to fields", () => {
  const error = toApiError(response(422), {
    error: "validation failed",
    request_id: "req-1",
    details: {
      email: [{ code: "email", message: null, params: {} }],
      address: { city: [{ code: "length", message: "too long", params: {} }] },
    },
  });

  expect(error).toMatchObject({
    status: 422,
    message: "validation failed",
    requestId: "req-1",
    fieldErrors: { email: "email", "address.city": "too long" },
  });
});

test("a FastAPI validation error maps each location to a dotted field path", () => {
  const error = toApiError(response(422), {
    detail: [
      { loc: ["body", "email"], msg: "value is not a valid email address", type: "value_error" },
      { loc: ["body", "address", "city"], msg: "Field required", type: "missing" },
    ],
  });

  expect(error.fieldErrors).toEqual({
    email: "value is not a valid email address",
    "address.city": "Field required",
  });
});

test("a FastAPI HTTPException keeps its detail as the message", () => {
  const error = toApiError(response(404), { detail: "User not found" });

  expect(error).toMatchObject({ status: 404, message: "User not found", fieldErrors: {} });
});

test("an RFC 9457 problem keeps its type as the code and its detail as the message", () => {
  const error = toApiError(response(409), {
    type: "https://example.com/problems/email-taken",
    title: "Conflict",
    status: 409,
    detail: "The email is taken",
  });

  expect(error).toMatchObject({
    message: "The email is taken",
    code: "https://example.com/problems/email-taken",
  });
});

test("a body nobody recognises falls back to the status, and the request id to the header", () => {
  const error = toApiError(response(502, { "x-request-id": "req-2" }), "<html>Bad gateway</html>");

  expect(error).toMatchObject({ message: "HTTP 502", requestId: "req-2", fieldErrors: {} });
});

test("array items use TanStack Form's index syntax in both validation shapes", () => {
  const axum = toApiError(response(422), {
    error: "validation failed",
    details: { items: { "0": { name: [{ code: "length", message: null }] } } },
  });
  const fastApi = toApiError(response(422), {
    detail: [{ loc: ["body", "items", 0, "name"], msg: "Field required" }],
  });

  expect(axum.fieldErrors).toEqual({ "items[0].name": "length" });
  expect(fastApi.fieldErrors).toEqual({ "items[0].name": "Field required" });
});
