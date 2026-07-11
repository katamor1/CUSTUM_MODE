import { normalizeChangedFilePathStrict } from "./fileSystem"
import { classifyLanguageFromPath } from "./languageClassifier"
import type { DiffSummary } from "./diffTypes"

const DIFF_STATUSES = new Set<DiffSummary["files"][number]["status"]>([
  "added",
  "modified",
  "deleted",
  "renamed",
  "unknown"
])

/** JSON textをparseし、trusted DiffSummary境界へ正規化する。 */
export function parseDiffFixtureText(text: string): DiffSummary {
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`diff fixture JSON is invalid: ${detail}`)
  }
  return parseDiffFixture(value)
}

/**
 * JSON由来のdiff fixtureを実VCS出力と同じtrusted DiffSummary境界へ正規化する。
 */
export function parseDiffFixture(value: unknown): DiffSummary {
  const fixture = requireRecord(value, "diff fixture")
  const base = requireIdentifierString(fixture.base, "diff fixture.base")
  const head = requireIdentifierString(fixture.head, "diff fixture.head")
  if (!Array.isArray(fixture.files)) throw new Error("diff fixture.files must be an array")

  const seenPaths = new Set<string>()
  const files = fixture.files.map((value, index) => {
    const label = `diff fixture.files[${index}]`
    const file = requireRecord(value, label)
    const rawPath = requireString(file.path, `${label}.path`)
    const filePath = normalizeChangedFilePathStrict(rawPath, `${label}.path`)
    if (seenPaths.has(filePath)) throw new Error(`diff fixture has duplicate changed file path: ${filePath}`)
    seenPaths.add(filePath)

    const status = requireStatus(file.status, `${label}.status`)
    const additions = optionalNonNegativeInteger(file.additions, `${label}.additions`)
    const deletions = optionalNonNegativeInteger(file.deletions, `${label}.deletions`)
    const language = optionalNonEmptyExactString(file.language, `${label}.language`) ?? classifyLanguageFromPath(filePath)
    const isTest = optionalBoolean(file.is_test, `${label}.is_test`)
    const isInterfaceCandidate = optionalBoolean(file.is_interface_candidate, `${label}.is_interface_candidate`)

    return compactObject({
      path: filePath,
      status,
      additions,
      deletions,
      language,
      is_test: isTest,
      is_interface_candidate: isInterfaceCandidate
    }) as DiffSummary["files"][number]
  })

  const vcs = optionalVcs(fixture.vcs)
  const vcsRoot = optionalIdentifierString(fixture.vcsRoot, "diff fixture.vcsRoot")
  const unifiedDiff = optionalString(fixture.unifiedDiff, "diff fixture.unifiedDiff")
  const warnings = optionalStringArray(fixture.warnings, "diff fixture.warnings") ?? []

  return compactObject({
    vcs,
    vcsRoot,
    base,
    head,
    files,
    unifiedDiff,
    warnings
  }) as DiffSummary
}

function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} must be a string`)
  return value
}

function requireIdentifierString(value: unknown, label: string): string {
  const text = requireString(value, label)
  validateIdentifierString(text, label)
  return text
}

function optionalIdentifierString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  const text = requireString(value, label)
  validateIdentifierString(text, label)
  return text
}

function validateIdentifierString(value: string, label: string): void {
  if (!value) throw new Error(`${label} must not be empty`)
  if (value.trim() !== value) throw new Error(`${label} contains outer whitespace`)
  if (/[\0-\x1F\x7F]/u.test(value)) throw new Error(`${label} contains control characters`)
}

function optionalString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  return requireString(value, label)
}

function optionalNonEmptyExactString(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  const text = requireString(value, label)
  if (!text || text.trim() !== text) throw new Error(`${label} must be a non-empty exact string`)
  if (/[\0-\x1F\x7F]/u.test(text)) throw new Error(`${label} contains control characters`)
  return text
}

function optionalNonNegativeInteger(value: unknown, label: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer`)
  }
  return value
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "boolean") throw new Error(`${label} must be a boolean`)
  return value
}

function requireStatus(value: unknown, label: string): DiffSummary["files"][number]["status"] {
  if (typeof value !== "string" || !DIFF_STATUSES.has(value as DiffSummary["files"][number]["status"])) {
    throw new Error(`${label} must be one of: ${[...DIFF_STATUSES].join(", ")}`)
  }
  return value as DiffSummary["files"][number]["status"]
}

function optionalVcs(value: unknown): DiffSummary["vcs"] | undefined {
  if (value === undefined) return undefined
  if (value !== "git" && value !== "bazaar") throw new Error("diff fixture.vcs must be git or bazaar")
  return value
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings`)
  }
  return [...value]
}

function compactObject<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>
}
