import * as path from "node:path"

export type RepositoryIndexSymbolRecord = {
  id: string
  name: string
  path: string
  kind: string
  language: string
  estimated_tokens: number
  visibility?: "public" | "protected" | "private" | "internal" | "unknown"
  risk_tags?: string[]
  is_test?: boolean
}

export type RepositoryIndexEdgeRecord = {
  from: string
  to?: string
  kind: string
  resolution: "resolved" | "unknown"
  reason: string
  target_hint?: string
}

export type RepositoryReferenceCandidate = {
  from: string
  kind: "imports" | "includes" | "tests" | "calls" | "uses-type"
  reason: string
  targetPath?: string
  targetName?: string
  targetKinds?: string[]
}

export type RepositorySourceFragment = {
  path: string
  language: string
  symbols: RepositoryIndexSymbolRecord[]
  edges: RepositoryIndexEdgeRecord[]
  references: RepositoryReferenceCandidate[]
}

type DeclarationPattern = {
  kind: string
  expression: RegExp
  exportedGroup?: number
}

const DECLARATION_PATTERNS: Record<string, DeclarationPattern[]> = {
  typescript: [
    { kind: "function", expression: /\b(export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gu, exportedGroup: 1 },
    { kind: "class", expression: /\b(export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/gu, exportedGroup: 1 },
    { kind: "interface", expression: /\b(export\s+)?interface\s+([A-Za-z_$][\w$]*)/gu, exportedGroup: 1 },
    { kind: "type", expression: /\b(export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/gu, exportedGroup: 1 },
    { kind: "enum", expression: /\b(export\s+)?(?:const\s+)?enum\s+([A-Za-z_$][\w$]*)/gu, exportedGroup: 1 },
    { kind: "global", expression: /\b(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?=[:=])/gu, exportedGroup: 1 }
  ],
  javascript: [
    { kind: "function", expression: /\b(export\s+)?(?:default\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gu, exportedGroup: 1 },
    { kind: "class", expression: /\b(export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/gu, exportedGroup: 1 },
    { kind: "global", expression: /\b(export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*(?==)/gu, exportedGroup: 1 }
  ],
  python: [
    { kind: "function", expression: /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(/gmu },
    { kind: "class", expression: /^\s*class\s+([A-Za-z_]\w*)\b/gmu },
    { kind: "global", expression: /^([A-Z][A-Z0-9_]*)\s*=/gmu }
  ],
  c: [
    { kind: "type", expression: /\b(?:typedef\s+)?(?:struct|enum|union)\s+([A-Za-z_]\w*)/gu },
    { kind: "function", expression: /^(?:[A-Za-z_]\w*[\w\s*:&<>]*\s+)+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*\{/gmu }
  ],
  h: [
    { kind: "type", expression: /\b(?:typedef\s+)?(?:struct|enum|union)\s+([A-Za-z_]\w*)/gu },
    { kind: "function", expression: /^(?:[A-Za-z_]\w*[\w\s*:&<>]*\s+)+([A-Za-z_]\w*)\s*\([^;{}]*\)\s*[;{]/gmu }
  ],
  cpp: [
    { kind: "type", expression: /\b(?:class|struct|enum|union)\s+([A-Za-z_]\w*)/gu },
    { kind: "function", expression: /^(?:[A-Za-z_]\w*[\w\s*:&<>~]*\s+)+([A-Za-z_~]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?\{/gmu }
  ],
  hpp: [
    { kind: "type", expression: /\b(?:class|struct|enum|union)\s+([A-Za-z_]\w*)/gu },
    { kind: "function", expression: /^(?:[A-Za-z_]\w*[\w\s*:&<>~]*\s+)+([A-Za-z_~]\w*)\s*\([^;{}]*\)\s*(?:const\s*)?[;{]/gmu }
  ],
  csharp: [
    { kind: "type", expression: /\b(?:public\s+|internal\s+|private\s+|protected\s+)*(?:class|interface|struct|enum|record)\s+([A-Za-z_]\w*)/gu },
    { kind: "function", expression: /\b(?:public|internal|private|protected)\s+(?:static\s+|async\s+|virtual\s+|override\s+)*[A-Za-z_][\w<>,?\[\]]*\s+([A-Za-z_]\w*)\s*\(/gu }
  ],
  java: [
    { kind: "type", expression: /\b(?:public\s+|private\s+|protected\s+|abstract\s+|final\s+)*(?:class|interface|enum|record)\s+([A-Za-z_]\w*)/gu },
    { kind: "function", expression: /\b(?:public|private|protected)\s+(?:static\s+|final\s+|synchronized\s+|abstract\s+)*[A-Za-z_][\w<>,?\[\]]*\s+([A-Za-z_]\w*)\s*\(/gu }
  ],
  go: [
    { kind: "function", expression: /^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)\s*\(/gmu },
    { kind: "type", expression: /^\s*type\s+([A-Za-z_]\w*)\s+/gmu },
    { kind: "global", expression: /^\s*(?:var|const)\s+([A-Za-z_]\w*)\b/gmu }
  ],
  rust: [
    { kind: "function", expression: /\b(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?fn\s+([A-Za-z_]\w*)\s*\(/gu },
    { kind: "type", expression: /\b(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|type)\s+([A-Za-z_]\w*)/gu },
    { kind: "global", expression: /\b(?:pub(?:\([^)]*\))?\s+)?(?:static|const)\s+([A-Za-z_]\w*)/gu }
  ]
}

const CALL_EXCLUSIONS = new Set([
  "break", "catch", "class", "constructor", "continue", "describe", "do", "else", "for", "function",
  "if", "import", "it", "new", "require", "return", "super", "switch", "test", "throw", "typeof", "while"
])

export function extractRepositorySourceFragment(input: {
  path: string
  language: string
  text: string
  byteLength: number
}): RepositorySourceFragment {
  const testFile = isTestPath(input.path)
  const fileId = repositoryFileSymbolId(input.path)
  const declarations = extractDeclarations(input.path, input.language, input.text, testFile)
  const symbols: RepositoryIndexSymbolRecord[] = [
    {
      id: fileId,
      name: input.path,
      path: input.path,
      kind: "unknown",
      language: input.language,
      estimated_tokens: estimateTokens(input.byteLength),
      ...(testFile ? { risk_tags: ["test-impact"], is_test: true } : {})
    },
    ...declarations
  ].sort(compareSymbols)
  const edges = declarations.map<RepositoryIndexEdgeRecord>((symbol) => ({
    from: fileId,
    to: symbol.id,
    kind: "contains",
    resolution: "resolved",
    reason: `${input.path} declares ${symbol.kind} ${symbol.name}`
  })).sort(compareEdges)
  const references = [
    ...extractPathReferences(input.path, input.language, input.text, testFile),
    ...extractNameReferences(input.path, input.text, declarations)
  ].sort(compareReferences)

  return { path: input.path, language: input.language, symbols, edges, references }
}

export function repositoryFileSymbolId(filePath: string): string {
  return `file:${filePath}`
}

export function isTestPath(filePath: string): boolean {
  const normalized = filePath.toLowerCase().replace(/\\/g, "/")
  const base = path.posix.basename(normalized)
  return normalized.split("/").some((segment) => ["test", "tests", "__tests__", "spec", "specs"].includes(segment))
    || /(?:^|[._-])(?:test|spec)\.[^.]+$/u.test(base)
    || /_test\.go$/u.test(base)
    || /^test_.*\.py$/u.test(base)
}

function extractDeclarations(
  filePath: string,
  language: string,
  text: string,
  testFile: boolean
): RepositoryIndexSymbolRecord[] {
  const found: Array<{ kind: string; name: string; offset: number; exported: boolean; matchedLength: number }> = []
  for (const pattern of DECLARATION_PATTERNS[language] ?? []) {
    pattern.expression.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.expression.exec(text)) !== null) {
      const nameIndex = pattern.exportedGroup === 1 ? 2 : 1
      const name = match[nameIndex]
      if (!name) continue
      found.push({
        kind: pattern.kind,
        name,
        offset: match.index,
        exported: pattern.exportedGroup === 1 ? Boolean(match[1]) : visibleByLanguage(language, match[0], name),
        matchedLength: match[0].length
      })
      if (match[0].length === 0) pattern.expression.lastIndex += 1
    }
  }

  found.sort((left, right) => left.offset - right.offset || left.kind.localeCompare(right.kind) || left.name.localeCompare(right.name))
  const totals = new Map<string, number>()
  for (const item of found) {
    const key = `${item.kind}\u0000${item.name}`
    totals.set(key, (totals.get(key) ?? 0) + 1)
  }
  const occurrences = new Map<string, number>()

  return found.map<RepositoryIndexSymbolRecord>((item) => {
    const key = `${item.kind}\u0000${item.name}`
    const occurrence = (occurrences.get(key) ?? 0) + 1
    occurrences.set(key, occurrence)
    const suffix = (totals.get(key) ?? 0) > 1 ? `@${occurrence}` : ""
    return {
      id: `${item.kind}:${filePath}#${item.name}${suffix}`,
      name: item.name,
      path: filePath,
      kind: item.kind,
      language,
      estimated_tokens: Math.max(1, Math.ceil(item.matchedLength / 4)),
      visibility: item.exported ? "public" : "internal",
      ...(testFile ? { risk_tags: ["test-impact"], is_test: true } : {})
    }
  }).sort(compareSymbols)
}

function visibleByLanguage(language: string, source: string, name: string): boolean {
  if (language === "python") return !name.startsWith("_")
  if (language === "go") return /^[A-Z]/u.test(name)
  if (language === "rust") return /\bpub\b/u.test(source)
  return /\b(?:public|export)\b/u.test(source)
}

function extractPathReferences(
  filePath: string,
  language: string,
  text: string,
  testFile: boolean
): RepositoryReferenceCandidate[] {
  const result: RepositoryReferenceCandidate[] = []
  const seen = new Set<string>()
  const add = (kind: "imports" | "includes" | "tests", targetPath: string, reason: string): void => {
    const normalized = targetPath.trim()
    if (!normalized) return
    const key = `${kind}\u0000${normalized}`
    if (seen.has(key)) return
    seen.add(key)
    result.push({ from: repositoryFileSymbolId(filePath), kind, targetPath: normalized, reason })
  }

  if (["typescript", "javascript"].includes(language)) {
    const expressions = [
      /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu,
      /\brequire\s*\(\s*["']([^"']+)["']\s*\)/gu,
      /\bimport\s*\(\s*["']([^"']+)["']\s*\)/gu
    ]
    for (const expression of expressions) {
      collectPathMatches(expression, text, (target) => add(testFile ? "tests" : "imports", target, `${testFile ? "test" : "source"} imports ${target}`))
    }
  } else if (["c", "cpp", "h", "hpp"].includes(language)) {
    collectPathMatches(/^\s*#\s*include\s*"([^"]+)"/gmu, text, (target) => add(testFile ? "tests" : "includes", target, `${testFile ? "test" : "source"} includes ${target}`))
  } else if (language === "python") {
    collectPathMatches(/^\s*from\s+([.A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+import\b/gmu, text, (target) => add(testFile ? "tests" : "imports", target, `${testFile ? "test" : "source"} imports ${target}`))
    collectPathMatches(/^\s*import\s+([.A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)/gmu, text, (target) => add(testFile ? "tests" : "imports", target, `${testFile ? "test" : "source"} imports ${target}`))
  }

  return result
}

function collectPathMatches(expression: RegExp, text: string, add: (target: string) => void): void {
  expression.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = expression.exec(text)) !== null) {
    if (match[1]) add(match[1])
    if (match[0].length === 0) expression.lastIndex += 1
  }
}

function extractNameReferences(
  filePath: string,
  text: string,
  declarations: RepositoryIndexSymbolRecord[]
): RepositoryReferenceCandidate[] {
  const result: RepositoryReferenceCandidate[] = []
  const declarationNames = new Set(declarations.map((item) => item.name))
  const seen = new Set<string>()
  const fileId = repositoryFileSymbolId(filePath)

  const callExpression = /\b([A-Za-z_$][\w$]*)\s*\(/gu
  let callMatch: RegExpExecArray | null
  while ((callMatch = callExpression.exec(text)) !== null) {
    const name = callMatch[1]
    if (!name || CALL_EXCLUSIONS.has(name) || declarationNames.has(name)) continue
    const key = `calls\u0000${name}`
    if (seen.has(key)) continue
    seen.add(key)
    result.push({
      from: fileId,
      kind: "calls",
      targetName: name,
      targetKinds: ["function"],
      reason: `${filePath} references callable ${name}`
    })
  }

  const typeExpressions = [
    /\b(?:new|extends|implements)\s+([A-Z][A-Za-z0-9_$]*)/gu,
    /:\s*([A-Z][A-Za-z0-9_$]*)\b/gu
  ]
  for (const expression of typeExpressions) {
    expression.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = expression.exec(text)) !== null) {
      const name = match[1]
      if (!name || declarationNames.has(name)) continue
      const key = `uses-type\u0000${name}`
      if (seen.has(key)) continue
      seen.add(key)
      result.push({
        from: fileId,
        kind: "uses-type",
        targetName: name,
        targetKinds: ["type", "class", "interface", "enum"],
        reason: `${filePath} references type ${name}`
      })
    }
  }
  return result
}

function estimateTokens(byteLength: number): number {
  return Math.max(1, Math.ceil(byteLength / 4))
}

function compareSymbols(left: RepositoryIndexSymbolRecord, right: RepositoryIndexSymbolRecord): number {
  return left.id.localeCompare(right.id)
}

function edgeKey(edge: RepositoryIndexEdgeRecord): string {
  return `${edge.from}\u0000${edge.to ?? ""}\u0000${edge.kind}\u0000${edge.resolution}\u0000${edge.reason}\u0000${edge.target_hint ?? ""}`
}

function compareEdges(left: RepositoryIndexEdgeRecord, right: RepositoryIndexEdgeRecord): number {
  return edgeKey(left).localeCompare(edgeKey(right))
}

function compareReferences(left: RepositoryReferenceCandidate, right: RepositoryReferenceCandidate): number {
  return left.from.localeCompare(right.from)
    || left.kind.localeCompare(right.kind)
    || (left.targetPath ?? "").localeCompare(right.targetPath ?? "")
    || (left.targetName ?? "").localeCompare(right.targetName ?? "")
    || left.reason.localeCompare(right.reason)
}
