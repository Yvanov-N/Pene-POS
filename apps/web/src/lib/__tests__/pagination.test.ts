import { describe, expect, it } from "vitest";
import { clampPage, paginate } from "../pagination";

describe("clampPage", () => {
  it("keeps a valid page", () => {
    expect(clampPage("3", 1, 10)).toBe(3);
  });

  it("clamps out-of-range pages", () => {
    expect(clampPage("0", 4, 10)).toBe(1);
    expect(clampPage("-2", 4, 10)).toBe(1);
    expect(clampPage("99", 4, 10)).toBe(10);
  });

  it("falls back to the current page on garbage", () => {
    expect(clampPage("", 4, 10)).toBe(4);
    expect(clampPage("abc", 4, 10)).toBe(4);
  });

  it("never returns 0 when there are no pages", () => {
    expect(clampPage("5", 1, 0)).toBe(1);
  });
});

describe("paginate", () => {
  const rows = Array.from({ length: 23 }, (_, i) => i);

  it("slices the requested page", () => {
    expect(paginate(rows, 1, 10)).toEqual({ rows: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9], totalPages: 3 });
    expect(paginate(rows, 3, 10).rows).toEqual([20, 21, 22]);
  });

  it("clamps a page past the end (e.g. after a filter shrank the list)", () => {
    expect(paginate(rows, 9, 10).rows).toEqual([20, 21, 22]);
  });

  it("has one page when empty", () => {
    expect(paginate([], 1, 10)).toEqual({ rows: [], totalPages: 1 });
  });
});
