import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
import { server } from "@/test/server";
import { ApiError } from "./api-error";
import { apiFetch, configureApi } from "./fetcher";
import { getUser } from "./generated/api";

const origin = "https://api.test";

test("sends the token from configureApi as a bearer header next to the caller's headers", async () => {
  configureApi({ baseUrl: origin, getToken: async () => "token-1" });
  let received: Headers | undefined;
  server.use(
    http.post(`${origin}/users`, ({ request }) => {
      received = request.headers;
      return HttpResponse.json({});
    }),
  );

  await apiFetch("/users", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });

  expect(received?.get("authorization")).toBe("Bearer token-1");
  expect(received?.get("content-type")).toBe("application/json");
});

const unauthorized = () => HttpResponse.json({ error: "unauthorized" }, { status: 401 });

test("a 401 retries once with the token from retryToken", async () => {
  const retryToken = vi.fn(async () => "token-2");
  configureApi({ baseUrl: origin, getToken: async () => "token-1", retryToken });
  server.use(
    http.get(`${origin}/users`, ({ request }) =>
      request.headers.get("authorization") === "Bearer token-2"
        ? HttpResponse.json(["ada"])
        : unauthorized(),
    ),
  );

  await expect(apiFetch("/users")).resolves.toEqual(["ada"]);
  expect(retryToken).toHaveBeenCalledExactlyOnceWith("token-1");
});

test("a 401 on the retry rejects with ApiError", async () => {
  const retryToken = vi.fn(async () => "token-2");
  configureApi({ baseUrl: origin, getToken: async () => "token-1", retryToken });
  let requests = 0;
  server.use(
    http.get(`${origin}/users`, () => {
      requests += 1;
      return unauthorized();
    }),
  );

  const failure = apiFetch("/users");

  await expect(failure).rejects.toBeInstanceOf(ApiError);
  await expect(failure).rejects.toMatchObject({ status: 401, message: "unauthorized" });
  expect(requests).toBe(2);
  expect(retryToken).toHaveBeenCalledOnce();
});

test("by default a 401 rejects with ApiError without a retry", async () => {
  configureApi({ baseUrl: origin });
  let requests = 0;
  server.use(
    http.get(`${origin}/users`, () => {
      requests += 1;
      return unauthorized();
    }),
  );

  await expect(apiFetch("/users")).rejects.toMatchObject({ status: 401 });
  expect(requests).toBe(1);
});

test("an empty or unparsable error body under a JSON content type still rejects with ApiError", async () => {
  configureApi({ baseUrl: origin });
  const json = { "content-type": "application/json" };
  server.use(
    http.get(`${origin}/users/1`, () => new HttpResponse(null, { status: 503, headers: json })),
    http.get(
      `${origin}/users`,
      () => new HttpResponse("<html>Bad gateway</html>", { status: 502, headers: json }),
    ),
    http.delete(`${origin}/users/1`, () => new HttpResponse(null, { status: 204, headers: json })),
  );

  await expect(apiFetch("/users/1")).rejects.toMatchObject({ name: "ApiError", status: 503 });
  await expect(apiFetch("/users")).rejects.toMatchObject({ name: "ApiError", status: 502 });
  await expect(apiFetch("/users/1", { method: "DELETE" })).resolves.toBe("");
});

test("a successful response with an unparsable JSON body rejects with the parse error", async () => {
  configureApi({ baseUrl: origin });
  server.use(
    http.get(
      `${origin}/users`,
      () => new HttpResponse("{", { headers: { "content-type": "application/json" } }),
    ),
  );

  await expect(apiFetch("/users")).rejects.toBeInstanceOf(SyntaxError);
});

test("the generated client encodes path parameters, so a crafted id cannot reach another endpoint", async () => {
  configureApi({ baseUrl: origin, getToken: async () => "token-1" });
  const requested: string[] = [];
  server.use(
    http.get(`${origin}/*`, ({ request }) => {
      requested.push(request.url);
      return HttpResponse.json({});
    }),
  );

  await getUser("../admin/export");
  await getUser("1?role=admin#");

  expect(requested).toEqual([
    `${origin}/users/..%2Fadmin%2Fexport`,
    `${origin}/users/1%3Frole%3Dadmin%23`,
  ]);
});
