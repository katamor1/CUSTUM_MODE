import { describe, expect, it } from "vitest";
import {
  resolveFirstDroppedDirectoryPath,
  resolveFirstDroppedPath
} from "../../src/renderer/src/dropPath";

describe("resolveFirstDroppedPath", () => {
  it("uses the preload resolver for the first dropped file", async () => {
    const dropped = new File(["content"], "sample-folder");
    const path = await resolveFirstDroppedPath([dropped], async (file) => {
      expect(file).toBe(dropped);
      return "C:\\sample\\folder";
    });

    expect(path).toBe("C:\\sample\\folder");
  });

  it("returns null when no file is dropped or no path can be resolved", async () => {
    await expect(resolveFirstDroppedPath([], async () => "unused")).resolves.toBeNull();
    await expect(resolveFirstDroppedPath([new File([""], "empty")], async () => "")).resolves.toBeNull();
  });

  it("returns only dropped paths that are directories", async () => {
    const dropped = new File(["content"], "sample-file");
    await expect(resolveFirstDroppedDirectoryPath(
      [dropped],
      async () => "C:\\sample\\file.txt",
      async () => false
    )).resolves.toBeNull();

    await expect(resolveFirstDroppedDirectoryPath(
      [dropped],
      async () => "C:\\sample\\folder",
      async () => true
    )).resolves.toBe("C:\\sample\\folder");
  });
});
