export type PreprocessResult = {
  status: "ok"
  reviewId: string
  packageDir: string
  changedFiles: number
  documentEvidence: number
  codeEvidence: number
  warnings: string[]
  summary: string
}
