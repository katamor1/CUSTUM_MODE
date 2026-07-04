import { describe, expect, it } from "vitest";
import { decodeTextBuffer } from "../../src/core/textDecoder";

describe("decodeTextBuffer", () => {
  it("decodes UTF-8 without changing Japanese text", () => {
    expect(decodeTextBuffer(Buffer.from("日本語コメント", "utf8"))).toBe("日本語コメント");
  });

  it("falls back to Shift-JIS for legacy C sources", () => {
    expect(decodeTextBuffer(Buffer.from([0x83, 0x65, 0x83, 0x58, 0x83, 0x67]))).toBe("テスト");
  });
});
