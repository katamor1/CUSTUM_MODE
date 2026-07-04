import { describe, expect, it } from "vitest";
import {
  isTrustedRendererUrl,
  selectDevRendererUrl
} from "../../src/main/rendererTrust";

describe("renderer trust helpers", () => {
  it("ignores ELECTRON_RENDERER_URL when the app is packaged", () => {
    expect(selectDevRendererUrl("http://localhost:5173", true)).toBeUndefined();
  });

  it("only accepts loopback dev renderer URLs", () => {
    expect(selectDevRendererUrl("http://localhost:5173", false)).toBe("http://localhost:5173/");
    expect(selectDevRendererUrl("http://127.0.0.1:5173", false)).toBe("http://127.0.0.1:5173/");
    expect(selectDevRendererUrl("https://example.test/app", false)).toBeUndefined();
    expect(selectDevRendererUrl("file:///tmp/index.html", false)).toBeUndefined();
  });

  it("trusts packaged file renderers and the selected loopback dev origin only", () => {
    expect(isTrustedRendererUrl("file:///C:/app/out/renderer/index.html", undefined, true)).toBe(true);
    expect(isTrustedRendererUrl("http://localhost:5173/index.html", "http://localhost:5173", false)).toBe(true);
    expect(isTrustedRendererUrl("http://127.0.0.1:5173/index.html", "http://localhost:5173", false)).toBe(false);
    expect(isTrustedRendererUrl("https://example.test/app", "http://localhost:5173", false)).toBe(false);
  });
});
