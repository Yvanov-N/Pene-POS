import { describe, expect, it } from "vitest";
import { isExactPriceMatch, matchesProductSearch, parsePriceTerm } from "../productSearch";

const coke = { name: "Coca-Cola 33cl", barcode: "5449000000996", price: 500 };
const chips = { name: "Chips", barcode: undefined, price: 1500 };
const water = { name: "Eau minérale", barcode: "123", price: 250 };
const bread = { name: "Pain", barcode: undefined, price: 12.5 };

describe("parsePriceTerm", () => {
  it("accepts plain and formatted numbers", () => {
    expect(parsePriceTerm("500")).toBe("500");
    expect(parsePriceTerm("1 000")).toBe("1000");
    expect(parsePriceTerm("1.000")).toBe("1000");
    expect(parsePriceTerm("500f")).toBe("500");
    expect(parsePriceTerm("500 FCFA")).toBe("500");
  });

  it("reads 1-2 digits after a separator as decimals", () => {
    expect(parsePriceTerm("12,5")).toBe("12.5");
    expect(parsePriceTerm("12.50")).toBe("12.5");
    expect(parsePriceTerm("1 250,75")).toBe("1250.75");
    expect(parsePriceTerm("1.000,5")).toBe("1000.5");
  });

  it("rejects words", () => {
    expect(parsePriceTerm("coca")).toBeNull();
    expect(parsePriceTerm("")).toBeNull();
  });
});

describe("matchesProductSearch", () => {
  it("matches by name and barcode", () => {
    expect(matchesProductSearch(coke, "coca")).toBe(true);
    expect(matchesProductSearch(coke, "5449")).toBe(true);
    expect(matchesProductSearch(chips, "coca")).toBe(false);
  });

  it("matches by price digits", () => {
    expect(matchesProductSearch(coke, "500")).toBe(true);
    expect(matchesProductSearch(chips, "500")).toBe(true);
    expect(matchesProductSearch(water, "500")).toBe(false);
    expect(matchesProductSearch(chips, "1 500 FCFA")).toBe(true);
    expect(matchesProductSearch(bread, "12,5")).toBe(true);
    expect(isExactPriceMatch(bread, "12,50")).toBe(true);
  });

  it("matches everything on an empty term", () => {
    expect(matchesProductSearch(water, "  ")).toBe(true);
  });
});

describe("isExactPriceMatch", () => {
  it("only matches the exact price", () => {
    expect(isExactPriceMatch(coke, "500")).toBe(true);
    expect(isExactPriceMatch(chips, "500")).toBe(false);
    expect(isExactPriceMatch(coke, "coca")).toBe(false);
  });
});
