// An in-memory stand-in for the backend's users API, with the same paths, status codes and
// `ErrorBody` shapes, so the E2E suite runs without a database. Point PUBLIC_API_ORIGIN at a real
// backend to run the same suite against it.
import { randomUUID } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

interface User {
  id: string;
  email: string;
  name: string;
  created_at: string;
}

const users: User[] = [];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function send(response: ServerResponse, status: number, body?: unknown) {
  response.writeHead(status, body === undefined ? {} : { "content-type": "application/json" });
  response.end(body === undefined ? undefined : JSON.stringify(body));
}

function errorBody(response: ServerResponse, error: string, details?: unknown) {
  const request_id = String(response.getHeader("x-request-id"));
  return details === undefined ? { error, request_id } : { error, request_id, details };
}

// The shape `validator` serialises a failed rule to.
const rule = (code: string, params: Record<string, unknown>) => [{ code, message: null, params }];

async function readJson(request: IncomingMessage): Promise<unknown> {
  let text = "";
  for await (const chunk of request) text += chunk;
  return JSON.parse(text);
}

function listUsers(response: ServerResponse, query: URLSearchParams) {
  const limit = Number(query.get("limit") ?? 20);
  const offset = Number(query.get("offset") ?? 0);
  const details = {
    ...(!(limit >= 1 && limit <= 100) && {
      limit: rule("range", { min: 1, max: 100, value: limit }),
    }),
    ...(!(offset >= 0 && offset <= 10_000) && {
      offset: rule("range", { max: 10_000, value: offset }),
    }),
  };
  if (Object.keys(details).length > 0) {
    return send(response, 422, errorBody(response, "validation failed", details));
  }
  const items = users.toReversed().slice(offset, offset + limit);
  send(response, 200, { items, total: users.length, limit, offset });
}

async function createUser(request: IncomingMessage, response: ServerResponse) {
  let body: unknown;
  try {
    body = await readJson(request);
  } catch {
    return send(response, 400, errorBody(response, "Failed to parse the request body as JSON"));
  }
  const { email, name }: { email?: unknown; name?: unknown } =
    typeof body === "object" && body !== null ? body : {};
  const details = {
    ...(!(typeof email === "string" && /^[^@\s]+@[^@\s]+$/.test(email)) && {
      email: rule("email", { value: email }),
    }),
    ...(!(typeof name === "string" && name.length >= 1 && name.length <= 100) && {
      name: rule("length", { min: 1, max: 100, value: name }),
    }),
  };
  if (Object.keys(details).length > 0 || typeof email !== "string" || typeof name !== "string") {
    return send(response, 422, errorBody(response, "validation failed", details));
  }
  if (users.some((user) => user.email === email)) {
    const taken = [{ code: "unique", message: "This email is already taken.", params: {} }];
    return send(response, 409, errorBody(response, "conflict", { email: taken }));
  }
  const user = { id: randomUUID(), email, name, created_at: new Date().toISOString() };
  users.push(user);
  send(response, 201, user);
}

function getUser(response: ServerResponse, id: string) {
  if (!uuid.test(id)) return send(response, 400, errorBody(response, `Invalid URL: ${id}`));
  const user = users.find((candidate) => candidate.id === id);
  if (!user) return send(response, 404, errorBody(response, `user ${id} not found`));
  send(response, 200, user);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://stub");
  response.setHeader("x-request-id", randomUUID());
  // The backend's CORS layer: the browser app runs on another origin.
  response.setHeader("access-control-allow-origin", request.headers.origin ?? "*");
  response.setHeader("vary", "origin");
  if (request.method === "OPTIONS") {
    response.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE");
    response.setHeader("access-control-allow-headers", "*");
    return send(response, 204);
  }

  const [, resource, id, ...rest] = url.pathname.split("/");
  if (request.method === "GET" && url.pathname === "/health/live") return send(response, 200);
  if (resource === "users" && id === undefined && request.method === "GET") {
    return listUsers(response, url.searchParams);
  }
  if (resource === "users" && id === undefined && request.method === "POST") {
    return createUser(request, response);
  }
  if (resource === "users" && id && rest.length === 0 && request.method === "GET") {
    return getUser(response, id);
  }
  send(response, 404, errorBody(response, "route not found"));
});

server.listen(Number(process.env.PORT ?? 4010), "127.0.0.1");
