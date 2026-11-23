import { ApiError, type FieldErrors } from "@/api/api-error";

/** What a failed submit shows: server errors on the fields the form renders, the rest as one form message. */
export function submitErrors(
  error: unknown,
  rendered: readonly string[],
  failed: string,
): { form?: string; fields: FieldErrors } {
  const requestId =
    error instanceof ApiError && error.requestId ? ` Request id: ${error.requestId}` : "";
  const fieldErrors = error instanceof ApiError ? Object.entries(error.fieldErrors) : [];
  const fields = Object.fromEntries(fieldErrors.filter(([name]) => rendered.includes(name)));
  const shown = Object.keys(fields).length;
  if (shown > 0 && shown === fieldErrors.length) return { fields };
  if (fieldErrors.length > 0) {
    return {
      form: `${failed} The server gave a reason this form cannot show.${requestId}`,
      fields,
    };
  }
  if (error instanceof ApiError && error.status === 409) {
    return { form: `${failed} It conflicts with data saved earlier.${requestId}`, fields };
  }
  return { form: `${failed} Try again.${requestId}`, fields };
}
