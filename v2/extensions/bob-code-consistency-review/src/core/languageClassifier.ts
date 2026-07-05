import * as path from "node:path"

export const LANGUAGE_VALUES = [
  "c",
  "cpp",
  "h",
  "hpp",
  "typescript",
  "javascript",
  "python",
  "csharp",
  "java",
  "go",
  "rust",
  "shell",
  "sql",
  "json",
  "yaml",
  "markdown",
  "text",
  "unknown"
] as const

export type ReviewLanguage = typeof LANGUAGE_VALUES[number]

const EXTENSION_LANGUAGE_MAP = new Map<string, ReviewLanguage>([
  [".c", "c"],
  [".cc", "cpp"],
  [".cpp", "cpp"],
  [".cxx", "cpp"],
  [".h", "h"],
  [".hh", "hpp"],
  [".hpp", "hpp"],
  [".hxx", "hpp"],
  [".ts", "typescript"],
  [".tsx", "typescript"],
  [".mts", "typescript"],
  [".cts", "typescript"],
  [".js", "javascript"],
  [".jsx", "javascript"],
  [".mjs", "javascript"],
  [".cjs", "javascript"],
  [".py", "python"],
  [".pyw", "python"],
  [".cs", "csharp"],
  [".java", "java"],
  [".go", "go"],
  [".rs", "rust"],
  [".sh", "shell"],
  [".bash", "shell"],
  [".zsh", "shell"],
  [".ps1", "shell"],
  [".bat", "shell"],
  [".cmd", "shell"],
  [".sql", "sql"],
  [".json", "json"],
  [".jsonc", "json"],
  [".yaml", "yaml"],
  [".yml", "yaml"],
  [".md", "markdown"],
  [".markdown", "markdown"],
  [".txt", "text"],
  [".text", "text"]
])

const C_LIKE_LANGUAGES = new Set<ReviewLanguage>(["c", "cpp", "h", "hpp"])

export function classifyLanguageFromPath(filePath: string): ReviewLanguage {
  const extension = path.extname(filePath).toLowerCase()
  return EXTENSION_LANGUAGE_MAP.get(extension) ?? "unknown"
}

export function isCLikeLanguage(language: string | undefined): boolean {
  return C_LIKE_LANGUAGES.has(language as ReviewLanguage)
}

export function isSupportedReviewLanguage(language: string | undefined): language is ReviewLanguage {
  return LANGUAGE_VALUES.includes(language as ReviewLanguage)
}
