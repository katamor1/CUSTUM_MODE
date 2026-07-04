export const REVIEW_PACKET_STATE_KEY = "bobBazaar.reviewPacket"

export interface ReviewPacketDocument {
  uri: string
  fileName?: string
  text: string
}

export interface ReviewPacketPickItem {
  uri: string
  label: string
  detail?: string
}

export interface ReviewPacketSelectionRequest {
  documents: ReviewPacketDocument[]
  activeUri?: string
  visibleUris?: string[]
  expectedUri?: string
  state?: Record<string, string>
  runId?: string
  pickPacket?: (items: ReviewPacketPickItem[]) => Promise<ReviewPacketPickItem | undefined> | ReviewPacketPickItem | undefined
}

export interface ReviewPacketState {
  packetUri: string
  runId?: string
  stepId?: string
  createdAt?: string
  target?: string
}

interface ReviewPacketCandidate extends ReviewPacketPickItem {
  text: string
}

export function buildReviewPacketState(input: {
  packetUri: string
  runId?: string
  stepId?: string
  target?: string
  createdAt?: string
}): ReviewPacketState {
  return {
    packetUri: input.packetUri,
    runId: input.runId,
    stepId: input.stepId,
    target: input.target,
    createdAt: input.createdAt ?? new Date().toISOString()
  }
}

export async function selectReviewPacketText(request: ReviewPacketSelectionRequest): Promise<string | undefined> {
  const candidates = orderedPacketCandidates(request)
  const expectedUri = request.expectedUri ?? packetUriFromState(request.state, request.runId)
  if (expectedUri) {
    const selected = candidates.find((candidate) => candidate.uri === expectedUri)
    if (!selected) throw new Error(`Bazaar review packet document was not found: ${expectedUri}`)
    return selected.text
  }
  if (candidates.length <= 1) return candidates[0]?.text
  const picked = await Promise.resolve(request.pickPacket?.(candidates.map(({ text: _text, ...item }) => item)))
  if (!picked) return undefined
  return candidates.find((candidate) => candidate.uri === picked.uri)?.text
}

function orderedPacketCandidates(request: ReviewPacketSelectionRequest): ReviewPacketCandidate[] {
  const byUri = new Map(request.documents.map((document) => [document.uri, document]))
  const ordered: ReviewPacketDocument[] = []
  const seen = new Set<string>()
  const add = (uri: string | undefined): void => {
    if (!uri || seen.has(uri)) return
    const document = byUri.get(uri)
    if (!document) return
    seen.add(uri)
    ordered.push(document)
  }
  add(request.activeUri)
  for (const uri of request.visibleUris ?? []) add(uri)
  for (const document of request.documents) add(document.uri)
  return ordered
    .filter((document) => isReviewPacket(document.text))
    .map((document) => ({
      uri: document.uri,
      label: document.fileName || document.uri,
      detail: packetTargetSummary(document.text),
      text: document.text
    }))
}

function packetUriFromState(state: Record<string, string> | undefined, runId: string | undefined): string | undefined {
  const packetState = parseReviewPacketState(state?.[REVIEW_PACKET_STATE_KEY])
  if (!packetState?.packetUri) return undefined
  if (packetState.runId && runId && packetState.runId !== runId) return undefined
  return packetState.packetUri
}

function parseReviewPacketState(value: string | undefined): ReviewPacketState | undefined {
  if (!value) return undefined
  try {
    const parsed = JSON.parse(value)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined
    const record = parsed as Record<string, unknown>
    return typeof record.packetUri === "string" && record.packetUri
      ? {
        packetUri: record.packetUri,
        runId: typeof record.runId === "string" ? record.runId : undefined,
        stepId: typeof record.stepId === "string" ? record.stepId : undefined,
        createdAt: typeof record.createdAt === "string" ? record.createdAt : undefined,
        target: typeof record.target === "string" ? record.target : undefined
      }
      : undefined
  } catch {
    return undefined
  }
}

function isReviewPacket(text: string): boolean {
  return text.includes("# Bazaar Revision Review Request") && text.includes("## Bazaar diff")
}

function packetTargetSummary(text: string): string | undefined {
  const mode = text.match(/^Review mode:\s*(.+)$/m)?.[1]?.trim()
  const target = text.match(/^Revision target:\s*(.+)$/m)?.[1]?.trim()
  return [mode, target].filter(Boolean).join(" / ") || undefined
}
