export type PreprocessResult = {
  status: "ok"
  reviewId: string
  packageDir: string
  changedFiles: number
  documentEvidence: number
  codeEvidence: number
  repositoryIndexBuild?: {
    indexPath: string
    cachePath: string
    indexId: string
    sourceRevision: string
    contentHash: string
    symbolCount: number
    edgeCount: number
    scannedFiles: number
    reusedFiles: number
    rebuiltFiles: number
    removedFiles: number
    cacheStatus: "miss" | "partial" | "hit"
    warnings: string[]
  }
  artifactLedger: {
    path: string
    fresh: number
    stale: number
    missing: number
  }
  warnings: string[]
  summary: string
}
