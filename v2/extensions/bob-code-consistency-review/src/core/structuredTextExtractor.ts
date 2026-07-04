const DEFAULT_MAX_STRUCTURED_TEXT_BYTES = 1024 * 1024

type ExtractOptions = {
  maxBytes?: number
  label?: string
}

type FencedBlock = {
  language: string
  body: string
}

export function extractSingleJsonObjectText(text: string, options: ExtractOptions = {}): string {
  assertWithinMaxBytes(text, options)
  const fencedCandidates = findFencedBlocks(text)
    .filter((block) => isJsonFence(block) || (!block.language && block.body.trim().startsWith("{")))
    .map((block) => block.body.trim())
  if (fencedCandidates.length > 0) return singleCandidate(fencedCandidates, "JSON")

  return singleCandidate(findBalancedJsonObjects(text), "JSON")
}

export function extractSingleYamlDocumentText(text: string, options: ExtractOptions = {}): string | undefined {
  assertWithinMaxBytes(text, options)
  const fencedCandidates = findFencedBlocks(text)
    .filter((block) => isYamlFence(block) && /^schema_version\s*:/m.test(block.body.trim()))
    .map((block) => block.body.trim())
  if (fencedCandidates.length > 0) return singleCandidate(fencedCandidates, "YAML")

  const schemaStarts = [...text.matchAll(/^schema_version\s*:/gm)].map((match) => match.index).filter((index): index is number => index !== undefined)
  if (schemaStarts.length === 0) return undefined
  if (schemaStarts.length > 1) throw new Error(`multiple YAML candidates found: ${schemaStarts.length}`)
  return trimWorkflowStateTrailer(text.slice(schemaStarts[0])).trim()
}

function assertWithinMaxBytes(text: string, options: ExtractOptions): void {
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_STRUCTURED_TEXT_BYTES
  const byteLength = Buffer.byteLength(text, "utf8")
  if (byteLength > maxBytes) {
    throw new Error(`${options.label ?? "structured text"} exceeds maximum size (${byteLength} > ${maxBytes} bytes)`)
  }
}

function singleCandidate(candidates: string[], kind: "JSON" | "YAML"): string {
  if (candidates.length === 0) throw new Error(`no ${kind} candidate found`)
  if (candidates.length > 1) throw new Error(`multiple ${kind} candidates found: ${candidates.length}`)
  return candidates[0]
}

function findFencedBlocks(text: string): FencedBlock[] {
  return [...text.matchAll(/```([A-Za-z0-9_-]*)[^\S\r\n]*\r?\n([\s\S]*?)\r?\n```/g)]
    .map((match) => ({ language: (match[1] ?? "").toLowerCase(), body: match[2] ?? "" }))
}

function isJsonFence(block: FencedBlock): boolean {
  return block.language === "json"
}

function isYamlFence(block: FencedBlock): boolean {
  return block.language === "yaml" || block.language === "yml" || block.language === ""
}

function findBalancedJsonObjects(text: string): string[] {
  const candidates: string[] = []
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (inString) {
      if (escaped) {
        escaped = false
      } else if (char === "\\") {
        escaped = true
      } else if (char === "\"") {
        inString = false
      }
      continue
    }
    if (char === "\"") {
      inString = true
      continue
    }
    if (char === "{") {
      if (depth === 0) start = index
      depth += 1
      continue
    }
    if (char === "}" && depth > 0) {
      depth -= 1
      if (depth === 0 && start >= 0) {
        candidates.push(text.slice(start, index + 1).trim())
        start = -1
      }
    }
  }

  return candidates
}

function trimWorkflowStateTrailer(text: string): string {
  const lines = text.split(/\r?\n/)
  const stop = lines.findIndex((line, index) => index > 0 && /^<\/(?:state|workflow_state)>/.test(line.trim()))
  return (stop >= 0 ? lines.slice(0, stop) : lines).join("\n").trim()
}
