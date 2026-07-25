import { describe, expect, it } from "vitest";
import { extractErrorMessage } from "@/services/sync/outbox";

// Regression test: two complete_sale outbox entries got stuck in production
// with their entire diagnostic value replaced by the literal string
// "[object Object]" -- the old `error instanceof Error ? error.message :
// String(error)` check silently failed for a real Supabase error object
// (PostgrestError-shaped: {message, details, hint, code}) that wasn't
// `instanceof Error` once bundled, falling through to String(), which
// stringifies any plain object to exactly that useless literal.
describe("extractErrorMessage", () => {
  it("extracts .message from a real Error instance", () => {
    expect(extractErrorMessage(new Error("boom"))).toBe("boom");
  });

  it("extracts .message from a plain object that is NOT instanceof Error (the actual bug)", () => {
    const postgrestErrorShaped = { message: "permission denied for table sales", details: null, hint: null, code: "42501" };
    expect(postgrestErrorShaped instanceof Error).toBe(false); // confirms the failure mode
    expect(extractErrorMessage(postgrestErrorShaped)).toBe("permission denied for table sales");
  });

  it("never produces the literal '[object Object]' for a message-less plain object", () => {
    const result = extractErrorMessage({ code: "ECONNRESET" });
    expect(result).not.toBe("[object Object]");
    expect(result).toContain("ECONNRESET");
  });

  it("handles a plain string", () => {
    expect(extractErrorMessage("network down")).toBe("network down");
  });

  it("handles null/undefined without throwing", () => {
    expect(() => extractErrorMessage(null)).not.toThrow();
    expect(() => extractErrorMessage(undefined)).not.toThrow();
  });
});
