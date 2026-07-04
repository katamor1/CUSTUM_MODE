import { describe, expect, it } from "vitest";
import {
  canUseSettings,
  isJobBusy
} from "../../src/renderer/src/runState";

describe("renderer run state", () => {
  it("keeps settings unavailable until persisted settings load", () => {
    expect(canUseSettings(false, "idle")).toBe(false);
    expect(canUseSettings(true, "idle")).toBe(true);
  });

  it("locks editing while running or cancelling", () => {
    expect(isJobBusy("running")).toBe(true);
    expect(isJobBusy("cancelling")).toBe(true);
    expect(canUseSettings(true, "running")).toBe(false);
    expect(canUseSettings(true, "cancelling")).toBe(false);
    expect(canUseSettings(true, "cancelled")).toBe(true);
  });
});
