import { describe, expect, it } from "vitest";
import { parseNonNegativeIntegerText } from "../../src/renderer/src/settingsValidation";

describe("parseNonNegativeIntegerText", () => {
  it("parses zero and non-negative safe integers", () => {
    expect(parseNonNegativeIntegerText("0")).toBe(0);
    expect(parseNonNegativeIntegerText("100")).toBe(100);
    expect(parseNonNegativeIntegerText(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
  });

  it("rejects empty, negative, decimal, unsafe, and non-numeric values", () => {
    expect(parseNonNegativeIntegerText("")).toBeUndefined();
    expect(parseNonNegativeIntegerText("-1")).toBeUndefined();
    expect(parseNonNegativeIntegerText("1.5")).toBeUndefined();
    expect(parseNonNegativeIntegerText(String(Number.MAX_SAFE_INTEGER + 1))).toBeUndefined();
    expect(parseNonNegativeIntegerText("abc")).toBeUndefined();
  });
});
