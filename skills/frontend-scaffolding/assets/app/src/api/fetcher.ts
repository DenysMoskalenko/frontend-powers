import { type ApiError, toApiError } from "./api-error";

interface ApiConfig {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
  /** After a 401 to `rejected`: a fresh token for one retry, or `undefined` to fail. */
  retryToken: (rejected: string | undefined) => Promise<string | undefined>;
  /** How long a GET or HEAD waits for response headers before it rejects with a `TimeoutError`. */
  timeoutMs: number;
}

const defaults: ApiConfig = {
  baseUrl: "",
  getToken: async () => undefined,
  retryToken: async () => undefined,
  timeoutMs: 30_000,
};

let config = defaults;

/** Sets what every API call needs, once at startup; a second call replaces the first, unset keys back to the defaults. */
export function configureApi(options: Partial<ApiConfig>) {
  config = { ...defaults, ...options };
}

// A write gets no client timeout: the server may still apply a write the client gave up on.
const isRead = (method: string | undefined) => /^(GET|HEAD)$/i.test(method ?? "GET");

async function fetchWithin(url: string, init: RequestInit, timeoutMs: number) {
  const timeout = new AbortController();
  // Cleared once headers arrive, so a slow body is never cut.
  const timer = setTimeout(
    () => timeout.abort(new DOMException("No response in time", "TimeoutError")),
    timeoutMs,
  );
  const signal = init.signal ? AbortSignal.any([init.signal, timeout.signal]) : timeout.signal;
  try {
    return await fetch(url, { ...init, signal });
  } catch (error) {
    throw timeout.signal.aborted ? timeout.signal.reason : error;
  } finally {
    clearTimeout(timer);
  }
}

/** JSON parsed, `text/*` and untyped bodies as text, anything else a `Blob`; an empty body is `undefined`. */
async function readBody(response: Response): Promise<unknown> {
  const type = response.headers.get("content-type") ?? "";
  if (type && !/\bjson\b|^text\//i.test(type)) {
    const blob = await response.blob();
    return blob.size > 0 ? blob : undefined;
  }
  const text = await response.text();
  if (!text) return undefined;
  if (!/\bjson\b/i.test(type)) return text;
  try {
    return JSON.parse(text);
  } catch (error) {
    // A proxy's error page under a JSON content type is still the response's ApiError.
    if (response.ok) throw error;
    return text;
  }
}

/** The orval mutator: the only place that knows the base URL, the token, the timeout and the error shape. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = (token: string | undefined) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    const request = { ...init, headers };
    const url = config.baseUrl + path;
    return isRead(init.method) ? fetchWithin(url, request, config.timeoutMs) : fetch(url, request);
  };
  const token = await config.getToken();
  let response = await send(token);
  if (response.status === 401) {
    const fresh = await config.retryToken(token);
    if (fresh) response = await send(fresh);
  }
  const body = await readBody(response);
  if (response.ok) return body as T;
  throw toApiError(response, body);
}

/** orval types every query and mutation error with this instead of the spec's error body. */
export type ErrorType<_Body> = ApiError | Error;
