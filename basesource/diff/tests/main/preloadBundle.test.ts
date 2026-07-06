import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import config from "../../electron.vite.config";

interface ElectronViteConfigShape {
  preload?: {
    build?: {
      rollupOptions?: {
        output?: unknown;
      };
    };
  };
}

describe("preload bundle wiring", () => {
  it("builds the sandboxed preload as CommonJS and loads that file", async () => {
    const preloadOutput = getPreloadOutput();
    expect(preloadOutput.format).toBe("cjs");
    expect(preloadOutput.entryFileNames).toBe("[name].cjs");

    const mainSource = await readFile(join(process.cwd(), "src/main/index.ts"), "utf8");
    expect(mainSource).toContain("../preload/index.cjs");
    expect(mainSource).toContain("sandbox: true");
  });
});

function getPreloadOutput(): { format?: unknown; entryFileNames?: unknown } {
  const output = (config as ElectronViteConfigShape).preload?.build?.rollupOptions?.output;
  if (!isObject(output) || Array.isArray(output)) {
    throw new Error("preload output must be a single Rollup output object");
  }
  return output;
}

function isObject(value: unknown): value is { format?: unknown; entryFileNames?: unknown } {
  return typeof value === "object" && value !== null;
}
