# Downloads and uploads

Contents:

- [Downloading a protected file](#downloading-a-protected-file)
- [Uploading through the generated client](#uploading-through-the-generated-client)
- [Uploading straight to storage](#uploading-straight-to-storage)
- [Upload progress](#upload-progress)
- [A failed upload](#a-failed-upload)

A file field's value, its size and type checks and their field errors are `frontend-forms`'s. This
reference starts where the file leaves the form.

## Downloading a protected file

A plain `<a href>` to the API sends no token. Fetch the file through the generated function
instead: for a binary content type (`application/octet-stream`, `application/pdf`, `image/*`)
orval types it `Promise<Blob>` and `apiFetch` resolves a `Blob`; `text/csv` arrives as a string.
Then hand it to the browser as a download:

```ts,verify
// file: src/shared/lib/save-file.ts
/** Saves a file the app already holds, such as a `Blob` from `apiFetch`, as a download named `name`. */
export function saveFile(file: Blob, name: string) {
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  // On the next task: the click has handed the file to the browser's download by then.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
```

A download is an action, not cached server state: run the generated function as a `useMutation`'s
`mutationFn` with `onSuccess: (file) => saveFile(file, "report.pdf")`; a `text/csv` export arrives
as a string, so save it as `saveFile(new Blob([text], { type: "text/csv" }), "users.csv")`, and an
empty file resolves `undefined`, which has nothing to save. Disable the button while
`isPending`, and set `meta: { silent: true }` with the error rendered next to the button, because
the mutation toast says the change was not saved. The file name comes from the app: `apiFetch`
returns the body only, not `Content-Disposition`. The read timeout stops at the response headers,
so a slow file still arrives whole.

The whole file sits in memory before it is saved. A very large file is a short-lived link instead:
the backend returns a signed URL that expires within minutes, and the app navigates to it
(`window.location.assign(url)`). The API token never goes into a URL.

Checked in Chromium, Firefox and WebKit under the scaffold's CSP and Trusted Types: the click saves
the file under its name with no violation.

## Uploading through the generated client

For a `multipart/form-data` request body, the generated function builds the `FormData` itself and
sets no `Content-Type`, so the browser adds the boundary; never set that header by hand. The
mutation:

- uses `meta: { silent: true }` and shows its own pending state and error next to the file input;
- is cancelled through an `AbortController` the component keeps, passed as the generated function's
  `{ signal }` in a `mutationFn` of its own; mutations have no signal of their own in TanStack Query
  5.108, and an aborted upload may still have been stored;
- has no client timeout, like every write.

```ts
mutationFn: ({ id, file }: { id: string; file: File }) =>
  uploadAvatar(id, { file }, { signal: controller.current.signal }),
```

## Uploading straight to storage

When the backend hands out a signed URL for object storage, the file goes there with a plain
`fetch`, never `apiFetch` and never with the API token. A refusal still becomes an `ApiError`, so
"who shows which error" holds. Send exactly the headers the backend signed. The storage origin joins
`connect-src` through the deploy skill's `PUBLIC_*` origin procedure (`frontend-deploy`), and the
bucket's CORS rules must allow the app's origin.

```ts,verify
// file: src/api/signed-upload.ts
import { toApiError } from "./api-error";

/**
 * PUTs a file straight to object storage at a URL the backend signed. A plain `fetch`: `apiFetch`
 * would prefix the API origin and send the API token to the storage host.
 */
export async function putToSignedUrl(url: string, file: Blob, signal?: AbortSignal) {
  const response = await fetch(url, { method: "PUT", body: file, ...(signal && { signal }) });
  if (!response.ok) throw toApiError(response, await response.text());
}
```

```ts,verify,test
// file: src/api/signed-upload.test.ts
import { HttpResponse, http } from "msw";
import { expect, test } from "vitest";
import { server } from "@/test/server";
import { ApiError } from "./api-error";
import { configureApi } from "./fetcher";
import { putToSignedUrl } from "./signed-upload";

const signed = "https://storage.test/bucket/ada.png?signature=abc";

test("a signed upload never carries the API token, and a refusal is an ApiError", async () => {
  configureApi({ baseUrl: "https://api.test", getToken: async () => "token-1" });
  let authorization: string | null = "unset";
  server.use(
    http.put("https://storage.test/bucket/ada.png", ({ request }) => {
      authorization = request.headers.get("authorization");
      return new HttpResponse(null, { status: 200 });
    }),
  );

  await putToSignedUrl(signed, new Blob(["png"], { type: "image/png" }));
  expect(authorization).toBeNull();

  server.use(
    http.put("https://storage.test/bucket/ada.png", () =>
      HttpResponse.text("SignatureDoesNotMatch", { status: 403 }),
    ),
  );
  await expect(putToSignedUrl(signed, new Blob(["png"]))).rejects.toBeInstanceOf(ApiError);
});
```

## Upload progress

`fetch` cannot report upload progress. Where the user needs a progress bar, `apiUpload` in
`src/api/fetcher.ts` is the one place an `XMLHttpRequest` is allowed (its code is in the client
reference, after `apiFetch`, because it reads the same private configuration). It keeps every
contract of `apiFetch`: the token from `configureApi`, one retry after a 401, the body read the same
way, `ApiError` from `toApiError`, a `TypeError` for a network failure, the signal's reason for an
abort, no timeout. Pass the generated URL getter, so the path stays encoded:
`apiUpload(getUploadAvatarUrl(id), form, { signal, onProgress })`. `onProgress` receives
`(loaded, total)` in bytes.

MSW 3 intercepts jsdom's `XMLHttpRequest`. jsdom enforces CORS on it, so the test talks to the page's
own origin rather than answer preflights:

```ts,verify,test
// file: src/api/upload.dom.test.ts
import { HttpResponse, http } from "msw";
import { expect, test, vi } from "vitest";
import { server } from "@/test/server";
import { ApiError } from "./api-error";
import { apiUpload, configureApi } from "./fetcher";

// The page's own origin: jsdom's XMLHttpRequest enforces CORS, which these handlers do not answer.
const origin = window.location.origin;
const avatar = () => {
  const form = new FormData();
  form.append("file", new Blob(["x".repeat(64 * 1024)], { type: "image/png" }), "ada.png");
  return form;
};

test("an upload sends the token, reports progress and resolves the parsed body", async () => {
  configureApi({ baseUrl: origin, getToken: async () => "token-1" });
  let received: { authorization: string | null; body: string } | undefined;
  server.use(
    http.post(`${origin}/users/1/avatar`, async ({ request }) => {
      received = {
        authorization: request.headers.get("authorization"),
        body: await request.text(),
      };
      return HttpResponse.json({ url: "/avatars/1.png" }, { status: 201 });
    }),
  );
  const onProgress = vi.fn();

  await expect(apiUpload("/users/1/avatar", avatar(), { onProgress })).resolves.toEqual({
    url: "/avatars/1.png",
  });
  expect(received?.authorization).toBe("Bearer token-1");
  expect(received?.body).toContain('name="file"; filename="ada.png"');
  expect(onProgress).toHaveBeenCalled();
  expect(onProgress.mock.lastCall?.[0]).toBe(onProgress.mock.lastCall?.[1]);
});

test("a 401 retries once with the token from retryToken", async () => {
  const retryToken = vi.fn(async () => "token-2");
  configureApi({ baseUrl: origin, getToken: async () => "token-1", retryToken });
  server.use(
    http.post(`${origin}/users/1/avatar`, ({ request }) =>
      request.headers.get("authorization") === "Bearer token-2"
        ? new HttpResponse(null, { status: 204 })
        : HttpResponse.json({ error: "unauthorized" }, { status: 401 }),
    ),
  );

  await expect(apiUpload("/users/1/avatar", avatar())).resolves.toBeUndefined();
  expect(retryToken).toHaveBeenCalledExactlyOnceWith("token-1");
});

test("an error status rejects with the same ApiError apiFetch builds", async () => {
  configureApi({ baseUrl: origin });
  server.use(
    http.put(`${origin}/users/1/avatar`, () =>
      HttpResponse.json(
        {
          error: "validation failed",
          request_id: "req-7",
          details: { file: [{ code: "too_large", message: "at most 5 MB" }] },
        },
        { status: 422 },
      ),
    ),
  );

  const failure = apiUpload("/users/1/avatar", avatar(), { method: "PUT" });

  await expect(failure).rejects.toBeInstanceOf(ApiError);
  await expect(failure).rejects.toMatchObject({
    status: 422,
    requestId: "req-7",
    fieldErrors: { file: [{ code: "too_large", message: "at most 5 MB" }] },
  });
});

test("a network failure is a TypeError and an abort the signal's reason", async () => {
  configureApi({ baseUrl: origin });
  server.use(http.post(`${origin}/users/1/avatar`, () => HttpResponse.error()));
  await expect(apiUpload("/users/1/avatar", avatar())).rejects.toBeInstanceOf(TypeError);

  server.use(http.post(`${origin}/users/1/avatar`, () => new Promise<never>(() => {})));
  const controller = new AbortController();
  const upload = apiUpload("/users/1/avatar", avatar(), { signal: controller.signal });
  controller.abort();
  await expect(upload).rejects.toMatchObject({ name: "AbortError" });
});
```

## A failed upload

Mutations are never retried automatically (`createQueryClient`), and an upload is no exception: a
failed upload starts again from the user's action, from the first byte. A file too large to restart
needs resumable uploads from the backend (a multipart or chunked protocol), which is the backend's
decision first.
