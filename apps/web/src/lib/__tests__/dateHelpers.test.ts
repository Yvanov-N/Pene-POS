import { describe, expect, it } from "vitest";
import { getRangeForFilter } from "../dateHelpers";

// Local-time constructors on both sides, so these hold in any test timezone.
const local = (y: number, m: number, d: number, h = 0, min = 0, s = 0, ms = 0) =>
  new Date(y, m - 1, d, h, min, s, ms).toISOString();

const NOW = new Date(2026, 10, 3, 10, 30); // 3 Nov 2026, 10:30

describe("getRangeForFilter", () => {
  it("compares today so far with yesterday until the same time", () => {
    expect(getRangeForFilter("today", undefined, NOW)).toEqual({
      current: { start: local(2026, 11, 3), end: local(2026, 11, 3, 23, 59, 59, 999) },
      previous: { start: local(2026, 11, 2), end: local(2026, 11, 2, 10, 30) },
    });
  });

  it("compares a finished day with the whole day before", () => {
    expect(getRangeForFilter("yesterday", undefined, NOW)).toEqual({
      current: { start: local(2026, 11, 2), end: local(2026, 11, 2, 23, 59, 59, 999) },
      previous: { start: local(2026, 11, 1), end: local(2026, 11, 1, 23, 59, 59, 999) },
    });
  });

  it("covers the last 7 days including today, against the 7 before at the same time", () => {
    expect(getRangeForFilter("last7days", undefined, NOW)).toEqual({
      current: { start: local(2026, 10, 28), end: local(2026, 11, 3, 23, 59, 59, 999) },
      previous: { start: local(2026, 10, 21), end: local(2026, 10, 27, 10, 30) },
    });
  });

  it("compares a one-day custom range in the past with exactly one day", () => {
    expect(getRangeForFilter("custom", { start: "2026-10-15", end: "2026-10-15" }, NOW)).toEqual({
      current: { start: local(2026, 10, 15), end: local(2026, 10, 15, 23, 59, 59, 999) },
      previous: { start: local(2026, 10, 14), end: local(2026, 10, 14, 23, 59, 59, 999) },
    });
  });

  it("accepts custom dates picked in reverse order", () => {
    expect(getRangeForFilter("custom", { start: "2026-10-20", end: "2026-10-11" }, NOW)).toEqual(
      getRangeForFilter("custom", { start: "2026-10-11", end: "2026-10-20" }, NOW),
    );
  });

  it("cuts the previous period at the same elapsed time when a custom range reaches today", () => {
    expect(getRangeForFilter("custom", { start: "2026-11-02", end: "2026-11-03" }, NOW).previous).toEqual({
      start: local(2026, 10, 31),
      end: local(2026, 11, 1, 10, 30),
    });
  });

  it("falls back to today while the custom dates are incomplete", () => {
    expect(getRangeForFilter("custom", undefined, NOW)).toEqual(getRangeForFilter("today", undefined, NOW));
  });
});
