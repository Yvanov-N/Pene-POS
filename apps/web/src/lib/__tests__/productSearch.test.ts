import { describe, expect, it } from "vitest";
import { isExactPriceMatch, matchesProductSearch, parsePriceTerm } from "../productSearch";

const coke = { name: "Coca-Cola 33cl", barcode: "5449000000996", price: 500 };
const chips = { name: "Chips", barcode: undefined, price: 1500 };
const water = { name: "Eau minérale", barcode: "123", price: 250 };

describe("parsePriceTerm", () => {
  it("accepts plain and formatted numbers", () => {
    expect(parsePriceTerm("500")).toBe("500");
    expect(parsePriceTerm("1 000")).toBe("1000");
    expect(parsePriceTerm("1.000")).toBe("1000");
    expect(parsePriceTerm("500f")).toBe("500");
    expect(parsePriceTerm("500 FCFA")).toBe("500");
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
