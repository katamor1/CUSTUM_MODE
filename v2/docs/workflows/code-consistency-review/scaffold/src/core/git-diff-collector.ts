import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readJsonFile } from "./file-system.js";
import type { DiffSummary, ReviewInput } from "./result.js";

const execFileAsync = promisify(execFile);

export type GitDiffCollectorOptions = {
  diffFixturePath?: string;
};

export async function collectGitDiff(
  reviewInput: ReviewInput,
  options: GitDiffCollectorOptions = {},
): Promise<DiffSummary> {
  if (options.diffFixturePath) {
    const fixture = await readJsonFile<DiffSummary>(options.diffFixturePath);
    const warnings = fixture.warnings ?? [];
    return {
      base: fixture.base,
      head: fixture.head,
      files: fixture.files,
      unifiedDiff: fixture.unifiedDiff,
      warnings: [...warnings, "Loaded diff summary fixture."],
    };
  }

  const { base, head } = reviewInput.review;
  const warnings: string[] = [];

  const nameStatus = await runGit(["diff", "--name-status", `${base}..${head}`]);
  const stat = await runGit(["diff", "--numstat", `${base}..${head}`]);
  const unifiedDiff = await runGit(["diff", `${base}..${head}`]);

  const statByPath = parseNumstat(stat);
  const files = nameStatus
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [statusToken, ...paths] = line.split("\t");
      const path = paths[paths.length - 1] ?? "";
      const stats = statByPath.get(path);
      return {
        path,
        status: mapStatus(statusToken),
        additions: stats?.additions,
        deletions: stats?.deletions,
        language: detectLanguage(path),
      };
    });

  if (files.length === 0) {
    warnings.push("No changed files detected for the target range.");
  }

  return { base, head, files, unifiedDiff, warnings };
}

async function runGit(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

function parseNumstat(output: string): Map<string, { additions: number; deletions: number }> {
  const result = new Map<string, { additions: number; deletions: number }>();
  for (const line of output.split(/\r?\n/).filter(Boolean)) {
    const [additionsRaw, deletionsRaw, path] = line.split("\t");
    result.set(path, {
      additions: Number(additionsRaw) || 0,
      deletions: Number(deletionsRaw) || 0,
    });
  }
  return result;
}

function mapStatus(statusToken: string): DiffSummary["files"][number]["status"] {
  if (statusToken.startsWith("A")) return "added";
  if (statusToken.startsWith("M")) return "modified";
  if (statusToken.startsWith("D")) return "deleted";
  if (statusToken.startsWith("R")) return "renamed";
  return "unknown";
}

function detectLanguage(path: string): string | undefined {
  if (/\.(c|h)$/i.test(path)) return "c";
  if (/\.(cc|cpp|cxx|hpp|hh)$/i.test(path)) return "cpp";
  return undefined;
}
