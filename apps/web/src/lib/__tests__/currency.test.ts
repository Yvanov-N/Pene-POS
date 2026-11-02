import { describe, expect, it, vi } from "vitest";

// The real i18n module reads localStorage at import time (browser-only); the
// formatter only needs the current language.
const fakeI18n = vi.hoisted(() => ({ language: "fr" }));
vi.mock("@/i18n", () => ({ default: fakeI18n }));

import { formatCurrency } from "../currency";

// Intl puts narrow/non-breaking spaces in fr-FR output -- compare on plain spaces.
const plain = (text: string) => text.replace(/[  ]/g, " ");

describe("formatCurrency", () => {
  it("shows whole amounts without decimals and others with exactly two (fr)", () => {
    fakeI18n.language = "fr";
    expect(plain(formatCurrency(1250))).toBe("1 250 FCFA");
    expect(plain(formatCurrency(12.5))).toBe("12,50 FCFA");
    expect(plain(formatCurrency(0.1 + 0.2))).toBe("0,30 FCFA");
  });

  it("uses the en-US separators in English", () => {
    fakeI18n.language = "en";
    expect(plain(formatCurrency(1250.75))).toContain("1,250.75");
  });
});
