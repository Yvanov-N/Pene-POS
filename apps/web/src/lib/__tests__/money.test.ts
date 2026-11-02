import { describe, expect, it } from "vitest";
import { decimalPlaces, parseAmount, roundMoney } from "../money";
import { numberSchema } from "../validation";

describe("parseAmount", () => {
  it("accepts a decimal comma or point and spaced thousands", () => {
    expect(parseAmount("12,5")).toBe(12.5);
    expect(parseAmount("12.5")).toBe(12.5);
    expect(parseAmount("1 250,75")).toBe(1250.75);
    expect(parseAmount("1 250")).toBe(1250);
    expect(parseAmount("-500")).toBe(-500);
    expect(parseAmount(" 300 ")).toBe(300);
  });

  it("rejects anything else", () => {
    expect(parseAmount("")).toBeNaN();
    expect(parseAmount("12,5,3")).toBeNaN();
    expect(parseAmount("abc")).toBeNaN();
  });
});

describe("roundMoney", () => {
  it("removes float drift", () => {
    expect(roundMoney(0.1 + 0.2)).toBe(0.3);
    expect(roundMoney(12.5 * 3)).toBe(37.5);
    expect(roundMoney(1.005)).toBe(1.01);
  });
});

describe("decimalPlaces", () => {
  it("counts decimals", () => {
    expect(decimalPlaces(12)).toBe(0);
    expect(decimalPlaces(12.5)).toBe(1);
    expect(decimalPlaces(12.555)).toBe(3);
  });
});

describe("numberSchema with decimals", () => {
  const money = numberSchema("invalid", { min: 0, decimals: 2 });

  it("accepts a French decimal comma", async () => {
    expect(await money.isValid("12,5")).toBe(true);
    expect(await money.validate("12,50")).toBe(12.5);
  });

  it("rejects more than 2 decimals, negatives and garbage", async () => {
    expect(await money.isValid("12,555")).toBe(false);
    expect(await money.isValid("-1")).toBe(false);
    expect(await money.isValid("abc")).toBe(false);
    expect(await money.isValid("")).toBe(false);
  });

  it("keeps integer fields integer", async () => {
    const quantity = numberSchema("invalid", { integer: true, moreThan: 0 });
    expect(await quantity.isValid("3")).toBe(true);
    expect(await quantity.isValid("2,5")).toBe(false);
  });
});
