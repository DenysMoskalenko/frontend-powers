import { randomBytes } from "node:crypto";
import { build, type Plugin } from "vite";
import { expect, test } from "vitest";
import { entryBudget } from "./vite.config.ts";

// An entry of about 2 kB gzip that cannot compress further.
const entry: Plugin = {
  name: "entry",
  resolveId: (id) => (id === "entry" ? "\0entry" : undefined),
  load: (id) =>
    id === "\0entry" ? `globalThis.data = "${randomBytes(1500).toString("base64")}";` : undefined,
};

const buildWithBudget = (limit: number) =>
  build({
    configFile: false,
    logLevel: "silent",
    plugins: [entry, entryBudget(limit)],
    build: { write: false, rolldownOptions: { input: "entry" } },
  });

test("a build over the budget fails and says by how much", async () => {
  await expect(buildWithBudget(1_000)).rejects.toThrow(
    /entry \+ static imports: \d+ B gzip \(budget 1000 B\)/,
  );
});

test("a build within the budget passes", async () => {
  await expect(buildWithBudget(10_000)).resolves.toBeDefined();
});
