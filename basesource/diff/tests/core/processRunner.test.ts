import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PROCESS_TREE_TERMINATION_BUDGET_MS,
  runProcess
} from "../../src/core/processRunner";

describe("runProcess", () => {
  it("keeps owned process-tree termination within the main force-stop deadline", () => {
    expect(PROCESS_TREE_TERMINATION_BUDGET_MS).toBeLessThan(4000);
  });

  it("rejects with AbortError and stops the owned process tree", async () => {
    const tempDirectory = await mkdtemp(join(tmpdir(), "diffrepo-process-runner-"));
    const pidPath = join(tempDirectory, "grandchild.pid");
    const controller = new AbortController();
    const running = runProcess(
      process.execPath,
      [
        "-e",
        [
          "const { spawn } = require('node:child_process');",
          "const { writeFileSync } = require('node:fs');",
          "const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
          `writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));`,
          "setInterval(() => {}, 1000);"
        ].join("")
      ],
      controller.signal
    );

    try {
      const grandchildPid = await waitForPid(pidPath);
      const startedAt = Date.now();
      controller.abort();

      await expect(running).rejects.toMatchObject({ name: "AbortError" });
      await expect(waitForProcessExit(grandchildPid)).resolves.toBeUndefined();
      expect(Date.now() - startedAt).toBeLessThan(5000);
    } finally {
      controller.abort();
      await running.catch(() => undefined);
      await rm(tempDirectory, { recursive: true, force: true });
    }
  }, 15000);

  it("includes child stderr in non-zero exit errors", async () => {
    await expect(runProcess(process.execPath, [
      "-e",
      "process.stderr.write('excel com parser details'); process.exit(7);"
    ])).rejects.toThrow(/excel com parser details/);
  });

  it("decodes Japanese stderr from a Windows child process without mojibake", async () => {
    await expect(runProcess(process.execPath, [
      "-e",
      "process.stderr.write(Buffer.from([0x83,0x47,0x83,0x89,0x81,0x5b])); process.exit(7);"
    ])).rejects.toThrow(/エラー/);
  });
});

async function waitForPid(pidPath: string): Promise<number> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    try {
      return Number(await readFile(pidPath, "utf8"));
    } catch {
      await delay(25);
    }
  }

  throw new Error("Timed out waiting for grandchild PID");
}

async function waitForProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await delay(25);
  }

  throw new Error(`Process ${pid} is still running`);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
