// English only until the app has translations; module level, so it is built once.
const dateTime = new Intl.DateTimeFormat("en", { dateStyle: "medium", timeStyle: "short" });

/** Formats an ISO 8601 timestamp from the API for display. */
export function formatDateTime(iso: string) {
  return dateTime.format(new Date(iso));
}
