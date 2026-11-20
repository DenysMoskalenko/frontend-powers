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
    output: { target: "src/api/generated/api.zod.ts", client: "zod", mode: "single" },
  },
});
