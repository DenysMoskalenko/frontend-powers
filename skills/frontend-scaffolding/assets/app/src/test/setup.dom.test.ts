import { describe, expect, test } from "vitest";

describe("the setup isolates browser storage between tests", { shuffle: false }, () => {
  test("a test writes both storages", () => {
    localStorage.setItem("theme", "dark");
    sessionStorage.setItem("return-path", "/users");
  });

  test("the next test starts with both empty", () => {
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });
});
