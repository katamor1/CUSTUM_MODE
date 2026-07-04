import { describe, expect, it } from "vitest";
import { makeUniqueWorksheetNames } from "../../src/core/sheetNames";

describe("makeUniqueWorksheetNames", () => {
  it("uses the file name when it is unique", () => {
    const result = makeUniqueWorksheetNames(["ENG/Message.rc", "JPN/Window.txt"]);

    expect(result).toEqual(new Map([
      ["ENG/Message.rc", "Message.rc"],
      ["JPN/Window.txt", "Window.txt"]
    ]));
  });

  it("adds parent directory context when file names collide", () => {
    const result = makeUniqueWorksheetNames(["ENG/Resource.rc", "JPN/Resource.rc"]);

    expect(result.get("ENG/Resource.rc")).toBe("Resource.rc_ENG");
    expect(result.get("JPN/Resource.rc")).toBe("Resource.rc_JPN");
  });

  it("removes Excel-forbidden characters and keeps names within 31 characters", () => {
    const longPath = "SRC/very-long-name-with-[bad]-characters-aaaaaaaaaaaaaaaa.txt";
    const result = makeUniqueWorksheetNames([longPath]);
    const name = result.get(longPath);

    expect(name).toBeDefined();
    expect(name).not.toMatch(/[\\/?*\[\]:]/);
    expect(name!.length).toBeLessThanOrEqual(31);
  });
});
