import { defineConfig } from "orval";

const input = { target: "./openapi.json" };

export default defineConfig({
  api: {
    input,
    output: {
      target: "src/api/generated/api.ts",
      client: "react-query",
      httpClient: "fetch",
      mode: "single",
      // A path parameter goes through encodeURIComponent: `../admin` or `1?x=y` cannot reach another endpoint.
      urlEncodeParameters: true,
      mock: { generators: [{ type: "msw" }] },
      override: {
        mutator: { path: "src/api/fetcher.ts", name: "apiFetch" },
        fetch: { includeHttpResponseReturnType: false },
        query: { useSuspenseQuery: true, shouldSplitQueryKey: true },
      },
    },
  },
  zod: {
    input,
    output: {
      target: "src/api/generated/api.zod.ts",
      client: "zod",
      mode: "single",
      // Optional keys infer `x?: T`, which `exactOptionalPropertyTypes` accepts as the client's body type.
      override: { zod: { exactOptional: true } },
    },
  },
});
