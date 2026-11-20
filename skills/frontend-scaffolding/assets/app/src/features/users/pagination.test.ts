import { expect, test } from "vitest";
import { pageCount, toListParams } from "./pagination";

test.each([
  [1, { limit: 20, offset: 0 }],
  [2, { limit: 20, offset: 20 }],
  [5, { limit: 20, offset: 80 }],
])("page %i asks the API for %o", (page, params) => {
  expect(toListParams(page)).toEqual(params);
});

test.each([
  [0, 1],
  [1, 1],
  [20, 1],
  [21, 2],
  [45, 3],
])("%i users make %i pages", (total, pages) => {
  expect(pageCount({ total, limit: 20 })).toBe(pages);
});
