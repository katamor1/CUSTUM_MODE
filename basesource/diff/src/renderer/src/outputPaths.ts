export function areOutputPathsDistinct(outputPaths: string[]): boolean {
  const normalized = outputPaths.map(normalizeOutputPathForComparison);
  return new Set(normalized).size === normalized.length;
}

export function normalizeOutputPathForComparison(outputPath: string): string {
  const normalized = outputPath
    .trim()
    .replaceAll("\\", "/")
    .replace(/\/+/g, "/");
  const driveMatch = normalized.match(/^([A-Za-z]:)\/?(.*)$/);
  const absolute = driveMatch !== null || normalized.startsWith("/");
  const prefix = driveMatch
    ? `${driveMatch[1].toLowerCase()}/`
    : normalized.startsWith("/")
      ? "/"
      : "";
  const rest = driveMatch ? driveMatch[2] : normalized.replace(/^\/+/, "");
  const segments: string[] = [];
  for (const segment of rest.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length > 0 && segments.at(-1) !== "..") {
        segments.pop();
      } else if (!absolute) {
        segments.push(segment);
      }
      continue;
    }
    segments.push(segment);
  }
  return `${prefix}${segments.join("/")}`.replace(/\/+$/, "").toLowerCase();
}
