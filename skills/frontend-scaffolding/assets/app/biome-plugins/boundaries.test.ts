import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { afterAll, expect, test } from "vitest";

const root = dirname(import.meta.dirname);
// Inside the project: Biome lints only files under its root, and the rule reads `/src/` paths.
const sandbox = mkdtempSync(join(root, "tmp-boundaries-"));
afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

// [file, import specifier, part of the expected diagnostic or null when allowed]
const cases: [string, string, string | null][] = [
  ["src/features/users/a.ts", "@/features/orders/b", "A feature never imports another feature"],
  ["src/features/users/b.ts", "@/features/users/c", null],
  ["src/features/users/c.ts", "@/routes/users/index", "features/, shared/ and api/ never import"],
  ["src/shared/ui/a.ts", "@/app/router", "features/, shared/ and api/ never import"],
  ["src/api/a.ts", "@/routes/index", "features/, shared/ and api/ never import"],
  ["src/shared/lib/a.ts", "@/features/users/b", "shared/ and api/ never import a feature"],
  ["src/api/b.ts", "@/features/users/b", "shared/ and api/ never import a feature"],
  ["src/features/users/d.ts", "../../shared/lib/a", "Import from another folder with the @/ alias"],
  ["src/features/users/e.ts", "./b", null],
  ["src/features/users/f.ts", "@/test/server", "Only tests import @/test/"],
  ["src/features/users/f.test.ts", "@/test/server", null],
  ["src/test/a.ts", "@/test/server", null],
  ["src/routes/a.tsx", "@/features/users/b", null],
  ["src/routes/b.tsx", "@/shared/ui/a", null],
  ["src/app/a.ts", "@/routes/index", null],
];

function lintSandbox() {
  for (const [file, specifier] of cases) {
    mkdirSync(dirname(join(sandbox, file)), { recursive: true });
    writeFileSync(join(sandbox, file), `import { x } from "${specifier}";\nexport const y = x;\n`);
  }
  const result = spawnSync("biome", ["lint", "--reporter=json", relative(root, sandbox)], {
    cwd: root,
    encoding: "utf8",
  });
  const report: {
    diagnostics: { category: string; message: string; location: { path: string } }[];
  } = JSON.parse(result.stdout);
  return report.diagnostics.filter((diagnostic) => diagnostic.category === "plugin");
}

test("the boundary rule flags every layer crossing and allows the rest", () => {
  const diagnostics = lintSandbox();

  const found = cases.map(([file, specifier]) => {
    const hit = diagnostics.find((d) => d.location.path === join(relative(root, sandbox), file));
    return [file, specifier, hit?.message ?? null];
  });
  const expected = cases.map(([file, specifier, message]) => [
    file,
    specifier,
    message === null ? null : expect.stringContaining(message),
  ]);
  expect(found).toEqual(expected);
});
