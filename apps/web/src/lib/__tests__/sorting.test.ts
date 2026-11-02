import { describe, expect, it } from "vitest";
import { compareValues, sortRows } from "../sorting";

describe("compareValues / sortRows", () => {
  it("sorts text the French way, numbers numerically", () => {
    expect(sortRows(["Fromage", "étudiant", "Eau"], (v) => v, "asc")).toEqual(["Eau", "étudiant", "Fromage"]);
    expect(sortRows(["Item 10", "Item 2"], (v) => v, "asc")).toEqual(["Item 2", "Item 10"]);
    expect(sortRows([300, 12.5, 1000], (v) => v, "desc")).toEqual([1000, 300, 12.5]);
  });

  it("keeps empty values last in both directions", () => {
    const rows = [{ v: 2 }, { v: undefined }, { v: 5 }, { v: null }];
    expect(sortRows(rows, (r) => r.v, "asc").map((r) => r.v)).toEqual([2, 5, undefined, null]);
    expect(sortRows(rows, (r) => r.v, "desc").map((r) => r.v)).toEqual([5, 2, undefined, null]);
  });

  it("treats ISO dates as text in chronological order", () => {
    expect(compareValues("2026-10-01T00:00:00Z", "2026-11-01T00:00:00Z", "asc")).toBeLessThan(0);
  });

  it("orders booleans false before true ascending", () => {
    expect(sortRows([true, false], (v) => v, "asc")).toEqual([false, true]);
  });
});
