import { describe, expect, it } from "vitest";
import {
  DEFAULT_APP_SETTINGS,
  normalizeAppSettings,
  validateRowOutputPolicy
} from "../../src/shared/settings";

describe("app settings", () => {
  it("deeply fills missing settings with defaults", () => {
    expect(normalizeAppSettings({ winMergePath: "x" })).toEqual({
      winMergePath: "x",
      bazaarPath: "brz",
      lastOutputDirectory: "",
      rowOutput: {
        cFiles: { contextRows: 100, hideRetainedRows: true },
        otherTextFiles: { contextRows: 100, hideRetainedRows: true }
      }
    });

    expect(DEFAULT_APP_SETTINGS.rowOutput.cFiles).not.toBe(DEFAULT_APP_SETTINGS.rowOutput.otherTextFiles);
  });

  it("accepts only non-negative safe integer row counts", () => {
    expect(validateRowOutputPolicy({ contextRows: 0, hideRetainedRows: false })).toBe(true);
    expect(validateRowOutputPolicy({ contextRows: 100, hideRetainedRows: true })).toBe(true);
    expect(validateRowOutputPolicy({ contextRows: -1, hideRetainedRows: true })).toBe(false);
    expect(validateRowOutputPolicy({ contextRows: 1.5, hideRetainedRows: true })).toBe(false);
    expect(validateRowOutputPolicy({ contextRows: Number.MAX_SAFE_INTEGER + 1, hideRetainedRows: true })).toBe(false);
    expect(validateRowOutputPolicy({ contextRows: 1, hideRetainedRows: "yes" })).toBe(false);
  });
});
