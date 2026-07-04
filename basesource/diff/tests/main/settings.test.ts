import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSettingsFile, saveSettingsFile } from "../../src/main/settings";
import { DEFAULT_APP_SETTINGS } from "../../src/shared/settings";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("settings persistence", () => {
  it("deeply merges legacy settings with nested row-output defaults", async () => {
    const root = await mkdtemp(join(tmpdir(), "diffrepo-settings-"));
    tempRoots.push(root);
    const settingsPath = join(root, "settings.json");
    await writeFile(settingsPath, JSON.stringify({
      winMergePath: "C:/Tools/WinMergeU.exe",
      rowOutput: {
        cFiles: { contextRows: 12 }
      }
    }));

    await expect(loadSettingsFile(settingsPath, DEFAULT_APP_SETTINGS)).resolves.toEqual({
      winMergePath: "C:/Tools/WinMergeU.exe",
      bazaarPath: "brz",
      lastOutputDirectory: "",
      rowOutput: {
        cFiles: { contextRows: 12, hideRetainedRows: true },
        otherTextFiles: { contextRows: 100, hideRetainedRows: true }
      }
    });
  });

  it("rejects invalid settings without writing a settings file", async () => {
    const root = await mkdtemp(join(tmpdir(), "diffrepo-settings-save-"));
    tempRoots.push(root);
    const settingsPath = join(root, "nested", "settings.json");

    await expect(saveSettingsFile(settingsPath, {
      winMergePath: "WinMergeU.exe",
      rowOutput: {
        cFiles: { contextRows: -1, hideRetainedRows: false }
      }
    }, DEFAULT_APP_SETTINGS)).rejects.toThrow("設定値が不正です");

    await expect(readFile(settingsPath, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
