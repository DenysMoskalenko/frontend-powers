// The compiler transforms modules for the browser only, so this runs in the dom project.
import { expect, inject, test } from "vitest";
import { RouteError } from "@/shared/ui/route-error";

test("components run compiled under `pnpm test` and uncompiled in a coverage run", () => {
  const compiled = String(RouteError).includes("react.memo_cache_sentinel");

  expect(compiled).toBe(inject("reactCompiler"));
});
