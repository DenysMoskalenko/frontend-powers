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
  await expect(apiFetch("/users/1", { method: "DELETE" })).resolves.toBeUndefined();
});

const binary = { "content-type": "application/octet-stream" };
const csv = { headers: { "content-type": "text/csv" } };

test("an empty body resolves undefined, whatever the status or content type", async () => {
  configureApi({ baseUrl: origin });
  server.use(
    http.delete(`${origin}/users/1`, () => new HttpResponse(null, { status: 204 })),
    http.get(`${origin}/users/1`, () => new HttpResponse("", { status: 200 })),
    http.post(`${origin}/users`, () => new HttpResponse(null, { status: 202, headers: binary })),
  );

  await expect(apiFetch("/users/1", { method: "DELETE" })).resolves.toBeUndefined();
  await expect(apiFetch("/users/1")).resolves.toBeUndefined();
  await expect(apiFetch("/users", { method: "POST" })).resolves.toBeUndefined();
});

test("a file response is a Blob with its bytes, a text/* response a string", async () => {
  configureApi({ baseUrl: origin });
  const bytes = new Uint8Array([0, 159, 255, 10]);
  server.use(
    http.get(`${origin}/users/1/avatar`, () => new HttpResponse(bytes, { headers: binary })),
    http.get(`${origin}/users/1/report`, () => HttpResponse.text("id,name\n1,Ada", csv)),
  );

  const file = await apiFetch<Blob>("/users/1/avatar");

  expect(file).toBeInstanceOf(Blob);
  expect(new Uint8Array(await file.arrayBuffer())).toEqual(bytes);
  await expect(apiFetch("/users/1/report")).resolves.toBe("id,name\n1,Ada");
});

const never = () => new Promise<never>(() => {});

test("a read without response headers in timeoutMs rejects with a TimeoutError", async () => {
  configureApi({ baseUrl: origin, timeoutMs: 100 });
  server.use(http.get(`${origin}/users`, never), http.head(`${origin}/users`, never));

  await expect(apiFetch("/users")).rejects.toMatchObject({ name: "TimeoutError" });
  await expect(apiFetch("/users", { method: "HEAD" })).rejects.toBeInstanceOf(DOMException);
});

test("the timeout stops at the response headers, so a slow body is read to the end", async () => {
  configureApi({ baseUrl: origin, timeoutMs: 100 });
  const encoder = new TextEncoder();
  server.use(
    http.get(`${origin}/users`, () => {
      const body = new ReadableStream({
        async start(controller) {
          controller.enqueue(encoder.encode('["ada",'));
          await new Promise((resolve) => setTimeout(resolve, 300));
          controller.enqueue(encoder.encode('"grace"]'));
          controller.close();
        },
      });
      return new HttpResponse(body, { headers: { "content-type": "application/json" } });
    }),
  );

  await expect(apiFetch("/users")).resolves.toEqual(["ada", "grace"]);
});

test("a write waits past timeoutMs: the server may still apply it", async () => {
  configureApi({ baseUrl: origin, timeoutMs: 100 });
  server.use(
    http.post(`${origin}/users`, async () => {
      await new Promise((resolve) => setTimeout(resolve, 300));
      return HttpResponse.json({ id: "1" }, { status: 201 });
    }),
  );

  await expect(apiFetch("/users", { method: "POST", body: "{}" })).resolves.toEqual({ id: "1" });
});

test("the caller's signal still cancels a read before the timeout", async () => {
  configureApi({ baseUrl: origin, timeoutMs: 10_000 });
  server.use(http.get(`${origin}/users`, never));
  const controller = new AbortController();

  const request = apiFetch("/users", { signal: controller.signal });
  controller.abort();

  await expect(request).rejects.toMatchObject({ name: "AbortError" });
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
