import * as crypto from "crypto"
import * as fs from "fs/promises"
import * as path from "path"
import {
  PROCESS_EVIDENCE_INDEX_SCHEMA_VERSION,
  type ProcessEvidenceIndex,
  type ProcessEvidenceIndexEntry,
  type ProcessInput
} from "./processTypes"
import { workspacePath } from "./processPaths"

export interface CollectProcessEvidenceResult {
  absolutePath: string
  relativePath: string
  index: ProcessEvidenceIndex
}

export async function collectProcessEvidence(
  workspaceRoot: string,
  input: ProcessInput
): Promise<CollectProcessEvidenceResult> {
  if (!input.runId) {
    throw new Error("process input must include runId before collecting evidence")
  }
  const entries: ProcessEvidenceIndexEntry[] = []
  for (const [kind, files] of Object.entries(input.inputs)) {
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]
      const absolutePath = workspacePath(workspaceRoot, file.path)
      const stat = await fs.stat(absolutePath)
      if (!stat.isFile()) {
        throw new Error(`evidence input must be a file: ${file.path}`)
      }
      const content = await fs.readFile(absolutePath)
      entries.push({
        id: `${kind}-${index + 1}`,
        kind,
        title: file.title,
        path: file.path.replace(/\\/g, "/"),
        sizeBytes: stat.size,
        sha256: crypto.createHash("sha256").update(content).digest("hex"),
        encoding: file.encoding,
        truncated: false
      })
    }
  }
  const relativePath = `.bob-process-runs/${input.runId}/evidence-index.json`
  const absolutePath = workspacePath(workspaceRoot, relativePath)
  await fs.mkdir(path.dirname(absolutePath), { recursive: true })
  const index: ProcessEvidenceIndex = {
    schemaVersion: PROCESS_EVIDENCE_INDEX_SCHEMA_VERSION,
    entries
  }
  await fs.writeFile(absolutePath, `${JSON.stringify(index, null, 2)}\n`, "utf8")
  return { absolutePath, relativePath, index }
}
