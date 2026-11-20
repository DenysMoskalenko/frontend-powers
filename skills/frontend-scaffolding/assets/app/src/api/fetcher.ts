import { type ApiError, toApiError } from "./api-error";

interface ApiConfig {
  baseUrl: string;
  getToken: () => Promise<string | undefined>;
  /** After a 401 to `rejected`: a fresh token for one retry, or `undefined` to fail. */
  retryToken: (rejected: string | undefined) => Promise<string | undefined>;
}

const defaults: ApiConfig = {
  baseUrl: "",
  getToken: async () => undefined,
  retryToken: async () => undefined,
};

let config = defaults;

/** Sets what every API call needs; each call starts again from the defaults. */
export function configureApi(options: Partial<ApiConfig>) {
  config = { ...defaults, ...options };
}

/** The orval mutator: the only place that knows the base URL, the token and the error shape. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const send = (token: string | undefined) => {
    const headers = new Headers(init.headers);
    if (token) headers.set("Authorization", `Bearer ${token}`);
    return fetch(config.baseUrl + path, { ...init, headers });
  };
  const token = await config.getToken();
  let response = await send(token);
  if (response.status === 401) {
    const fresh = await config.retryToken(token);
    if (fresh) response = await send(fresh);
  }
  const text = await response.text();
  let body: unknown = text;
  if (text && /\bjson\b/.test(response.headers.get("content-type") ?? "")) {
    try {
      body = JSON.parse(text);
    } catch (error) {
      // A proxy's error page under a JSON content type is still the response's ApiError.
      if (response.ok) throw error;
    }
  }
  if (response.ok) return body as T;
  throw toApiError(response, body);
}

/** orval types every query and mutation error with this instead of the spec's error body. */
export type ErrorType<_Body> = ApiError | Error;
