import { describe, expect, it } from "vitest";
import { evaluateCConstantExpression } from "../../src/core/cConstantExpression";

describe("evaluateCConstantExpression", () => {
  it("evaluates supported integer literals, precedence, unary operators, and bitwise operators", () => {
    expect(evaluateCConstantExpression("1 + 2 * 3")).toBe(7);
    expect(evaluateCConstantExpression("(1 + 2) * 3")).toBe(9);
    expect(evaluateCConstantExpression("0x10 + 010 + 0b10")).toBe(26);
    expect(evaluateCConstantExpression("~0 & 0xff")).toBe(255);
    expect(evaluateCConstantExpression("1 << 4 | 3 ^ 1")).toBe(18);
    expect(evaluateCConstantExpression("-7 / 3")).toBe(-2);
    expect(evaluateCConstantExpression("7 % -3")).toBe(1);
  });

  it("recursively resolves object-like macros and numeric constants", () => {
    expect(evaluateCConstantExpression("ROWS * COLS", {
      ROWS: "BASE + 1",
      COLS: 4,
      BASE: "0x2"
    })).toBe(12);
  });

  it("returns undefined for cycles, unknown identifiers, invalid shifts, and division by zero", () => {
    expect(evaluateCConstantExpression("A", { A: "B + 1", B: "A + 1" })).toBeUndefined();
    expect(evaluateCConstantExpression("UNKNOWN + 1")).toBeUndefined();
    expect(evaluateCConstantExpression("1 << -1")).toBeUndefined();
    expect(evaluateCConstantExpression("1 / 0")).toBeUndefined();
  });

  it("rejects unsupported syntax without evaluating JavaScript", () => {
    expect(evaluateCConstantExpression("1 ? 2 : 3")).toBeUndefined();
    expect(evaluateCConstantExpression("sizeof(int)")).toBeUndefined();
    expect(evaluateCConstantExpression("process.exit(1)")).toBeUndefined();
    expect(evaluateCConstantExpression("1 && 2")).toBeUndefined();
  });
});
