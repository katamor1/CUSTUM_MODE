import path from "node:path";

const EXCEL_FORBIDDEN_CHARS = /[\\/?*\[\]:]/g;
const MAX_WORKSHEET_NAME_LENGTH = 31;

export function makeUniqueWorksheetNames(relativePaths: string[]): Map<string, string> {
  const normalized = relativePaths.map((relativePath) => ({
    original: relativePath,
    normalized: normalizeRelativePath(relativePath),
    base: sanitizeWorksheetName(path.posix.basename(normalizeRelativePath(relativePath)))
  }));

  const baseCounts = new Map<string, number>();
  for (const item of normalized) {
    baseCounts.set(item.base, (baseCounts.get(item.base) ?? 0) + 1);
  }

  const used = new Set<string>();
  const result = new Map<string, string>();
  for (const item of normalized) {
    const parentName = sanitizeWorksheetName(path.posix.basename(path.posix.dirname(item.normalized)));
    const needsParent = (baseCounts.get(item.base) ?? 0) > 1 && parentName !== ".";
    const suffix = needsParent ? `_${parentName}` : "";
    const uniqueName = makeUniqueName(item.base, suffix, used);
    used.add(uniqueName);
    result.set(item.original, uniqueName);
  }

  return result;
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replaceAll("\\", "/");
}

function sanitizeWorksheetName(value: string): string {
  const sanitized = value.replace(EXCEL_FORBIDDEN_CHARS, "_").trim();
  return sanitized.length > 0 ? sanitized : "Sheet";
}

function makeUniqueName(base: string, suffix: string, used: Set<string>): string {
  let counter = 1;
  let name = fitName(base, suffix);
  while (used.has(name)) {
    counter += 1;
    name = fitName(base, `${suffix}_${counter}`);
  }

  return name;
}

function fitName(base: string, suffix: string): string {
  const safeSuffix = suffix.slice(0, MAX_WORKSHEET_NAME_LENGTH);
  const baseLimit = Math.max(1, MAX_WORKSHEET_NAME_LENGTH - safeSuffix.length);
  return `${base.slice(0, baseLimit)}${safeSuffix}`;
}
