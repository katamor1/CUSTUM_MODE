import { spawn } from "node:child_process";
import type { RunProcess } from "./reportJob";

const MAX_OUTPUT_LENGTH = 12000;
const FORCE_KILL_DELAY_MS = 100;
const TASKKILL_GRACE_MS = 500;
const TASKKILL_FORCE_TIMEOUT_MS = 3200;
export const PROCESS_TREE_TERMINATION_BUDGET_MS =
  TASKKILL_GRACE_MS
  + FORCE_KILL_DELAY_MS
  + TASKKILL_FORCE_TIMEOUT_MS
  + FORCE_KILL_DELAY_MS;

export const runProcess: RunProcess = async (executable, args, signal) => {
  signal?.throwIfAborted();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk);
    });

    let aborting = false;
    const abort = (): void => {
      if (aborting) {
        return;
      }

      aborting = true;
      void terminateProcessTree(child.pid, child).finally(() => {
        reject(abortError());
      });
    };

    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) {
      abort();
    }

    child.once("error", (error) => {
      signal?.removeEventListener("abort", abort);
      if (!aborting) {
        reject(error);
      }
    });
    child.once("close", (code) => {
      signal?.removeEventListener("abort", abort);
      if (aborting) {
        return;
      }

      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(formatProcessError(executable, code, stdoutChunks, stderrChunks)));
    });
  });
};

async function terminateProcessTree(
  pid: number | undefined,
  child: ReturnType<typeof spawn>
): Promise<void> {
  if (pid === undefined) {
    return;
  }

  if (process.platform === "win32") {
    await runTaskkill(pid, false, TASKKILL_GRACE_MS);
    if (await waitForExit(child, FORCE_KILL_DELAY_MS)) {
      return;
    }

    await runTaskkill(pid, true, TASKKILL_FORCE_TIMEOUT_MS);
    await waitForExit(child, FORCE_KILL_DELAY_MS);
    return;
  }

  child.kill("SIGTERM");
  if (await waitForExit(child, FORCE_KILL_DELAY_MS)) {
    return;
  }

  child.kill("SIGKILL");
  await waitForExit(child, FORCE_KILL_DELAY_MS);
}

async function runTaskkill(pid: number, force: boolean, timeoutMs: number): Promise<void> {
  await new Promise<void>((resolve) => {
    const args = ["/PID", String(pid), "/T"];
    if (force) {
      args.push("/F");
    }

    const killer = spawn("taskkill.exe", args, {
      windowsHide: true,
      stdio: "ignore"
    });
    let settled = false;
    const finish = (): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(() => {
      killer.kill();
      finish();
    }, timeoutMs);

    killer.once("error", finish);
    killer.once("exit", finish);
  });
}

async function waitForExit(
  child: ReturnType<typeof spawn>,
  timeoutMs: number
): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) {
    return true;
  }

  return new Promise<boolean>((resolve) => {
    const timeout = setTimeout(() => {
      child.removeListener("exit", onExit);
      resolve(false);
    }, timeoutMs);

    const onExit = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };

    child.once("exit", onExit);
  });
}

function abortError(): Error {
  const error = new Error("The operation was aborted");
  error.name = "AbortError";
  return error;
}

function formatProcessError(
  executable: string,
  code: number | null,
  stdoutChunks: Buffer[],
  stderrChunks: Buffer[]
): string {
  const output = [
    decodeProcessOutput(stderrChunks).trim(),
    decodeProcessOutput(stdoutChunks).trim()
  ].filter((value) => value.length > 0).join("\n");

  const baseMessage = `${executable} exited with code ${code ?? "unknown"}`;
  if (output.length === 0) {
    return baseMessage;
  }

  return `${baseMessage}\n${truncateOutput(output)}`;
}

function decodeProcessOutput(chunks: Buffer[]): string {
  const bytes = Buffer.concat(chunks);
  const utf8Text = bytes.toString("utf8");
  if (!utf8Text.includes("\uFFFD")) {
    return utf8Text;
  }

  try {
    return new TextDecoder("shift_jis").decode(bytes);
  } catch {
    return utf8Text;
  }
}

function truncateOutput(value: string): string {
  if (value.length <= MAX_OUTPUT_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_OUTPUT_LENGTH)}\n... output truncated ...`;
}
