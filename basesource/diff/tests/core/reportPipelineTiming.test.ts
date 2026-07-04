import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { runProcess } from "../../src/core/processRunner";
import { generateDiffWorkbook } from "../../src/core/reportJob";
import { DEFAULT_APP_SETTINGS } from "../../src/shared/settings";

const measure = process.env.DIFFREPO_MEASURE_REPORT === "1" ? describe : describe.skip;

measure("report pipeline timing", () => {
  it("writes local timing data for the Electron report pipeline", async () => {
    const root = resolve("local-samples/path-test-accuracy-speed");
    const leftRoot = join(root, "left");
    const rightRoot = join(root, "right");
    const outputRoot = join(root, "output");
    const workDirectory = join(outputRoot, "work");

    await mkdir(outputRoot, { recursive: true });
    await rm(workDirectory, { recursive: true, force: true });

    const startedAt = performance.now();
    const phaseTimes = new Map<string, number>();
    let phaseStartedAt = startedAt;
    let currentPhase = "start";

    const summary = await generateDiffWorkbook({
      source: { kind: "folders", leftRoot, rightRoot },
      winMergePath: process.env.WINMERGE_PATH ?? await defaultWinMergePath(),
      outputWorkbookPath: join(outputRoot, "diff-report.xlsx"),
      outputPathTestWorkbookPath: join(outputRoot, "path-test-report.xlsx"),
      outputChangeListPath: join(outputRoot, "diff-change-list.docx"),
      rowOutput: DEFAULT_APP_SETTINGS.rowOutput,
      workDirectory,
      keepWorkDirectory: true,
      runProcess,
      onProgress(progress) {
        const now = performance.now();
        if (progress.phase !== currentPhase) {
          phaseTimes.set(currentPhase, (phaseTimes.get(currentPhase) ?? 0) + now - phaseStartedAt);
          currentPhase = progress.phase;
          phaseStartedAt = now;
        }
      }
    });

    phaseTimes.set(currentPhase, (phaseTimes.get(currentPhase) ?? 0) + performance.now() - phaseStartedAt);

    const result = {
      comparedFiles: summary.comparedFiles,
      changedFiles: summary.changedFiles,
      totalMs: Math.round(performance.now() - startedAt),
      phaseMs: Object.fromEntries([...phaseTimes].map(([phase, ms]) => [phase, Math.round(ms)])),
      outputRoot
    };

    await writeFile(join(outputRoot, "timings.json"), JSON.stringify(result, null, 2));
    expect(result.comparedFiles).toBeGreaterThan(0);
  }, 120000);
});

async function defaultWinMergePath(): Promise<string> {
  for (const candidate of [
    "C:/Program Files/WinMerge/WinMergeU.exe",
    "C:/Program Files (x86)/WinMerge/WinMergeU.exe",
    "WinMergeU.exe"
  ]) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next standard installation path.
    }
  }
  return "WinMergeU.exe";
}
