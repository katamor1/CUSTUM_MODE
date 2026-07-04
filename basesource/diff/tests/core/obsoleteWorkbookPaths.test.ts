import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const OBSOLETE_PATTERNS = [
  ["excel", "Com", "Exporter"].join(""),
  ["exportReportsWorkbook", "WithExcel"].join(""),
  ["computeHiddenC", "ReportRows"].join(""),
  ["CONTEXT_ROWS_AFTER", "_UNCHANGED_BLANK"].join(""),
  ["exportReports", "Workbook("].join("")
];

describe("workbook production paths", () => {
  it("contains no obsolete COM, non-streaming, or post-export visibility implementation", async () => {
    const sourceFiles = await collectTypeScriptFiles(join(process.cwd(), "src"));
    const matches: string[] = [];

    for (const filePath of sourceFiles) {
      const source = await readFile(filePath, "utf8");
      for (const pattern of OBSOLETE_PATTERNS) {
        if (source.includes(pattern)) {
          matches.push(`${filePath}: ${pattern}`);
        }
      }
    }

    expect(matches).toEqual([]);
  });
});

async function collectTypeScriptFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(async (entry) => {
    const entryPath = join(directory, entry.name);
    if (entry.isDirectory()) {
      return collectTypeScriptFiles(entryPath);
    }
    return entry.name.endsWith(".ts") || entry.name.endsWith(".tsx") ? [entryPath] : [];
  }));
  return files.flat();
}
