/** One server error on a field: `message` to show, `code` (axum's `code`, pydantic's `type`) to translate by. */
export interface FieldError {
  message: string;
  code?: string;
}

/** Field path, as TanStack Form names fields (`address.city`, `items[0].name`), to its errors in order. */
export type FieldErrors = Record<string, FieldError[]>;

/**
 * The one error `apiFetch` throws for a non-2xx response, whatever the backend: axum `ErrorBody`,
 * FastAPI `{ detail }` or RFC 9457 `application/problem+json`. A network failure stays a
 * `TypeError` and an abort an `AbortError`. `message` is for developers, never rendered as is.
 */
export class ApiError extends Error {
  override name = "ApiError";
  readonly status: number;
  readonly code: string | undefined;
  readonly requestId: string | undefined;
  readonly fieldErrors: FieldErrors;
  readonly body: unknown;

  constructor(init: {
    status: number;
    message: string;
    code?: string | undefined;
    requestId?: string | undefined;
    fieldErrors?: FieldErrors;
    body: unknown;
  }) {
    super(init.message);
    this.status = init.status;
    this.code = init.code;
    this.requestId = init.requestId;
    this.fieldErrors = init.fieldErrors ?? {};
    this.body = init.body;
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);

const joinPath = (prefix: string, key: string) =>
  /^\d+$/.test(key) ? `${prefix}[${key}]` : prefix ? `${prefix}.${key}` : key;

const fieldError = (message: string, code: string | undefined): FieldError =>
  code ? { message, code } : { message };

function addError(out: FieldErrors, path: string, error: FieldError) {
  // `Object.hasOwn`: a field named `constructor` must not find Object.prototype's.
  if (Object.hasOwn(out, path)) out[path]?.push(error);
  else out[path] = [error];
}

// axum + validator: `{ field: [{ code, message }] }`, a nested struct as a nested object. The depth cap
// keeps a hostile body from overflowing the stack, which would throw something other than ApiError.
function fromValidatorDetails(
  details: unknown,
  prefix = "",
  out: FieldErrors = {},
  depth = 0,
): FieldErrors {
  if (!isRecord(details) || depth > 32) return out;
  for (const [key, value] of Object.entries(details)) {
    const path = joinPath(prefix, key);
    if (!Array.isArray(value)) {
      fromValidatorDetails(value, path, out, depth + 1);
      continue;
    }
    for (const item of value) {
      if (!isRecord(item)) continue;
      const code = text(item.code);
      addError(out, path, fieldError(text(item.message) ?? code ?? "invalid", code));
    }
  }
  return out;
}

// FastAPI: `[{ loc: ["body", ...path], msg }]`; the first `loc` entry names the request part. pydantic
// prefixes a custom validator's message with its error type, which the user should not see.
function fromFastApiDetail(detail: unknown[]): FieldErrors {
  const out: FieldErrors = {};
  for (const item of detail) {
    if (!isRecord(item) || !Array.isArray(item.loc)) continue;
    const path = item.loc.slice(1).map(String).reduce(joinPath, "");
    if (!path) continue;
    const message = text(item.msg)?.replace(/^(Value error|Assertion failed), /, "");
    addError(out, path, fieldError(text(message) ?? "invalid", text(item.type)));
  }
  return out;
}

export function toApiError(response: Response, body: unknown): ApiError {
  const { status } = response;
  const fields = isRecord(body) ? body : {};
  const requestId = text(fields.request_id) ?? response.headers.get("x-request-id") ?? undefined;
  const base = { status, requestId, body };

  if (text(fields.error)) {
    return new ApiError({
      ...base,
      message: String(fields.error),
      fieldErrors: fromValidatorDetails(fields.details),
    });
  }
  if (text(fields.title) || text(fields.type)) {
    const type = text(fields.type);
    return new ApiError({
      ...base,
      message: text(fields.detail) ?? text(fields.title) ?? `HTTP ${status}`,
      code: type === "about:blank" ? undefined : type,
    });
  }
  if (Array.isArray(fields.detail)) {
    return new ApiError({
      ...base,
      message: "validation failed",
      fieldErrors: fromFastApiDetail(fields.detail),
    });
  }
  return new ApiError({ ...base, message: text(fields.detail) ?? `HTTP ${status}` });
}
