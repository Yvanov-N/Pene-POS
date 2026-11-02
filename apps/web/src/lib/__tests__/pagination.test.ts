import { describe, expect, it } from "vitest";
import { clampPage } from "../pagination";

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
