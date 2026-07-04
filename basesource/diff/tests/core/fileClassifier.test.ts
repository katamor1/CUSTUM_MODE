import { describe, expect, it } from "vitest";
import { isTextBuffer } from "../../src/core/fileClassifier";

describe("isTextBuffer", () => {
  it("accepts UTF-8 and Shift_JIS-like text without NUL bytes", () => {
    expect(isTextBuffer(Buffer.from("hello\r\nworld", "utf8"))).toBe(true);
    expect(isTextBuffer(Buffer.from([0x83, 0x65, 0x83, 0x58, 0x83, 0x67, 0x0d, 0x0a]))).toBe(true);
  });

  it("rejects buffers containing NUL bytes", () => {
    expect(isTextBuffer(Buffer.from([0x48, 0x00, 0x49]))).toBe(false);
  });

  it("rejects buffers dominated by binary control bytes", () => {
    expect(isTextBuffer(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 14, 15, 16, 17]))).toBe(false);
  });
});
